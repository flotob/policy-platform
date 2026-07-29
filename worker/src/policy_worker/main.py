"""Extraction worker: polls the jobs table, extracts text, writes it back.

Postgres is the only bus (SKIP LOCKED). Run modes:
    policy-worker            # poll forever
    policy-worker --once     # drain the queue, then exit (tests/acceptance)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import time
from pathlib import Path

import psycopg

from .contracts import validate
from .extract import extract_text

log = logging.getLogger("policy_worker")

CLAIM_SQL = """
    UPDATE jobs SET status = 'running', attempts = attempts + 1, started_at = now()
    WHERE id = (
        SELECT id FROM jobs
        WHERE status = 'pending' AND kind = 'extract_document'
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
    )
    RETURNING id, payload, attempts, max_attempts
"""


def process_one(conn: psycopg.Connection, blob_dir: Path) -> bool:
    """Claim and process a single job. Returns False when the queue is empty."""
    with conn.transaction():
        row = conn.execute(CLAIM_SQL).fetchone()
    if row is None:
        return False
    job_id, payload, attempts, max_attempts = row
    if isinstance(payload, str):
        payload = json.loads(payload)
    try:
        validate("extract_document.payload", payload)
        path = blob_dir / payload["blob_path"]
        text, tool = extract_text(path)
        result = {"text": text, "tool": tool, "chars": len(text or "")}
        validate("extract_document.result", result)
        with conn.transaction():
            conn.execute(
                """UPDATE documents
                   SET extracted_text = %s, extraction_tool = %s, extracted_at = now()
                   WHERE id = %s""",
                (text, tool, payload["document_id"]),
            )
            conn.execute(
                """UPDATE jobs
                   SET status = 'done', result = %s, finished_at = now()
                   WHERE id = %s""",
                (json.dumps(result), job_id),
            )
        log.info("job %s done (%s chars)", job_id, result["chars"])
    except Exception as exc:  # noqa: BLE001 — job isolation: one bad file must not kill the loop
        status = "failed" if attempts >= max_attempts else "pending"
        with conn.transaction():
            conn.execute(
                """UPDATE jobs
                   SET status = %s, error = %s,
                       finished_at = CASE WHEN %s = 'failed' THEN now() END
                   WHERE id = %s""",
                (status, f"{type(exc).__name__}: {exc}", status, job_id),
            )
        log.warning("job %s -> %s: %s", job_id, status, exc)
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="drain queue and exit")
    parser.add_argument(
        "--poll-interval", type=float,
        default=float(os.environ.get("POLL_INTERVAL", "2")),
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    dsn = os.environ["DATABASE_URL"]
    blob_dir = Path(os.environ.get("BLOB_DIR", "blobs"))
    log.info("worker up (blob_dir=%s, once=%s)", blob_dir, args.once)

    with psycopg.connect(dsn, autocommit=True) as conn:
        while True:
            worked = process_one(conn, blob_dir)
            if not worked:
                if args.once:
                    return
                time.sleep(args.poll_interval)


if __name__ == "__main__":
    main()
