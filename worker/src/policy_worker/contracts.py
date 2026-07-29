"""Validation against the committed JSON Schema contract artifacts.

The TS side (packages/contracts) is the source of truth; this module refuses
any payload that does not match the committed schema, so the boundary cannot
drift silently.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

import jsonschema

# worker/src/policy_worker/contracts.py -> parents[3] == platform repo root
DEFAULT_SCHEMA_DIR = Path(__file__).resolve().parents[3] / "packages/contracts/schemas"


def schema_dir() -> Path:
    return Path(os.environ.get("CONTRACT_SCHEMA_DIR", DEFAULT_SCHEMA_DIR))


@lru_cache(maxsize=None)
def _load(name: str) -> dict:
    path = schema_dir() / f"{name}.json"
    return json.loads(path.read_text(encoding="utf-8"))


def validate(name: str, instance: dict) -> None:
    """Raise jsonschema.ValidationError if instance violates the contract."""
    jsonschema.validate(
        instance,
        _load(name),
        format_checker=jsonschema.FormatChecker(),
    )
