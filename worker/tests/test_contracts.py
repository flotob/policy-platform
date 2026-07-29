import jsonschema
import pytest

from policy_worker.contracts import DEFAULT_SCHEMA_DIR, validate

pytestmark = pytest.mark.skipif(
    not (DEFAULT_SCHEMA_DIR / "extract_document.payload.json").exists(),
    reason="contract schemas not emitted yet (run pnpm build in packages/contracts)",
)

VALID = {
    "document_id": "018f2f47-0000-7000-8000-000000000000",
    "blob_path": "ab/abcd.pdf",
    "filename": "stellungnahme.pdf",
}


def test_valid_payload_passes():
    validate("extract_document.payload", VALID)


def test_unknown_field_rejected():
    with pytest.raises(jsonschema.ValidationError):
        validate("extract_document.payload", {**VALID, "extra": True})


def test_missing_field_rejected():
    bad = {k: v for k, v in VALID.items() if k != "blob_path"}
    with pytest.raises(jsonschema.ValidationError):
        validate("extract_document.payload", bad)


def test_result_contract():
    validate(
        "extract_document.result",
        {"text": "hello", "tool": "pymupdf/1.26", "chars": 5},
    )
    with pytest.raises(jsonschema.ValidationError):
        validate("extract_document.result", {"text": "x", "tool": "t", "chars": -1})
