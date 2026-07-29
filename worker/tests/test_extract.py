from pathlib import Path

import pymupdf
import pytest

from policy_worker.extract import extract_text


@pytest.fixture
def sample_pdf(tmp_path: Path) -> Path:
    path = tmp_path / "sample.pdf"
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Die Landkarte des Streits — Testdokument.")
    doc.save(path)
    doc.close()
    return path


def test_pdf_extraction(sample_pdf: Path):
    text, tool = extract_text(sample_pdf)
    assert text is not None
    assert "Landkarte des Streits" in text
    assert tool is not None and tool.startswith("pymupdf/")


def test_plaintext_extraction(tmp_path: Path):
    f = tmp_path / "note.txt"
    f.write_text("hello", encoding="utf-8")
    assert extract_text(f) == ("hello", "plaintext")


def test_unsupported_format(tmp_path: Path):
    f = tmp_path / "archive.zip"
    f.write_bytes(b"PK\x03\x04")
    assert extract_text(f) == (None, None)
