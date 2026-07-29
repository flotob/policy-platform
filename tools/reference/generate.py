"""Differential-test reference generator.

Runs red-dwarf (the validated Python reimplementation of the Polis math) over
the committed openData fixtures and dumps stage-level reference outputs as
JSON. The TypeScript math package must reproduce these numbers — that suite
is the permanent proof the port is faithful.

Usage:  .venv/bin/python generate.py            (from tools/reference/)
Regenerate whenever fixtures or the pinned red-dwarf version change; artifacts
are committed.
"""

from __future__ import annotations

import csv
import json
import warnings
from importlib.metadata import version
from pathlib import Path

warnings.filterwarnings("ignore")

from reddwarf.implementations.polis import run_pipeline  # noqa: E402

FIXTURES = Path(__file__).resolve().parents[2] / "packages/math/test/fixtures"
CONVERSATIONS = [
    "brexit-consensus",
    "15-per-hour-seattle",
    "canadian-electoral-reform",
    "london.youth.policing",
]
RANDOM_STATE = 42


def load_votes(path: Path) -> list[dict]:
    """votes.csv → vote dicts, deduped to the latest vote per (participant, statement)."""
    latest: dict[tuple[int, int], dict] = {}
    with path.open(encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            key = (int(row["voter-id"]), int(row["comment-id"]))
            vote = {
                "participant_id": int(row["voter-id"]),
                "statement_id": int(row["comment-id"]),
                "vote": int(row["vote"]),
                "modified": int(row["timestamp"]),
            }
            if key not in latest or vote["modified"] >= latest[key]["modified"]:
                latest[key] = vote
    return list(latest.values())


def load_mod_out(path: Path) -> list[int]:
    """comments.csv → statement ids moderated out (moderated == -1)."""
    with path.open(encoding="utf-8") as fh:
        return [
            int(row["comment-id"])
            for row in csv.DictReader(fh)
            if int(row["moderated"]) == -1
        ]


def main() -> None:
    for name in CONVERSATIONS:
        conv_dir = FIXTURES / name
        votes = load_votes(conv_dir / "votes.csv")
        mod_out = load_mod_out(conv_dir / "comments.csv")

        result = run_pipeline(
            votes=votes,
            mod_out_statement_ids=mod_out,
            random_state=RANDOM_STATE,
        )

        raw = result.raw_vote_matrix
        pca = result.reducer
        clusterer = result.clusterer

        reference = {
            "meta": {
                "conversation": name,
                "reddwarf_version": version("red-dwarf"),
                "random_state": RANDOM_STATE,
                "n_votes_deduped": len(votes),
                "mod_out_statement_ids": sorted(mod_out),
            },
            "matrix": {
                "participant_ids": [int(i) for i in raw.index],
                "statement_ids": [int(c) for c in raw.columns],
                "votes_per_participant": [
                    int(n) for n in raw.count(axis="columns")
                ],
                "column_sums": [
                    None if raw[c].count() == 0 else float(raw[c].sum())
                    for c in raw.columns
                ],
            },
            "pca": {
                "mean": [float(x) for x in pca.mean_],
                "components": [[float(x) for x in row] for row in pca.components_],
                "explained_variance": [float(x) for x in pca.explained_variance_],
            },
            "projections": {
                "participants": {
                    str(pid): [float(x), float(y)]
                    for pid, (x, y) in result.participant_projections.items()
                },
                "statements": {
                    str(sid): [float(x), float(y)]
                    for sid, (x, y) in (result.statement_projections or {}).items()
                },
            },
            "clustering": {
                "k": int(clusterer.n_clusters) if clusterer is not None else None,
                "labels": {
                    str(pid): int(label)
                    for pid, label in zip(
                        result.participants_df.loc[
                            result.participants_df["to_cluster"], :
                        ].index,
                        clusterer.labels_,
                    )
                }
                if clusterer is not None
                else {},
            },
            "consensus": json.loads(json.dumps(result.consensus, default=float)),
            "repness": json.loads(json.dumps(result.repness, default=float)),
            "group_aware_consensus": json.loads(
                json.dumps(result.group_aware_consensus or {}, default=float)
            ),
        }

        out = conv_dir / "reference.json"
        out.write_text(json.dumps(reference) + "\n", encoding="utf-8")
        print(
            f"{name}: {len(reference['matrix']['participant_ids'])} participants × "
            f"{len(reference['matrix']['statement_ids'])} statements, "
            f"k={reference['clustering']['k']}, → {out.name} "
            f"({out.stat().st_size // 1024} KB)"
        )


if __name__ == "__main__":
    main()
