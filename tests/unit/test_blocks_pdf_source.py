"""pdf_source must turn a real PDF into real chunks, not a hardcoded stub.

Until 2026-08-01 this block returned {"pages": 46} regardless of input, so
GRAFT Studio could only start from already-chunked documents -- the single
gap between it and the raw-PDF-in flow the web pipeline already had.

Uses a synthetic PDF built with PyMuPDF: no fixture file, no LLM, no network.
"""

from __future__ import annotations

import json

import fitz
import pytest

from rag_gt.blocks import pdf_source


@pytest.fixture
def sample_pdf(tmp_path):
    doc = fitz.open()
    for i in range(4):
        page = doc.new_page()
        page.insert_text(
            (72, 96),
            f"{i + 1}.1 Clause heading {i}\n"
            "This clause states a requirement that is long enough to survive "
            "sentence splitting and chunk packing without being discarded by "
            "any downstream length filter.",
            fontsize=11,
        )
    out = tmp_path / "din_test_standard.pdf"
    doc.save(str(out))
    doc.close()
    return out


class TestPdfSourceProducesRealArtifacts:
    def test_emits_both_pdf_and_chunks(self, sample_pdf, tmp_path):
        out = pdf_source.run({}, {"path": str(sample_pdf)}, artifacts_dir=tmp_path)
        assert set(out) == {"pdf", "chunks"}
        assert out["pdf"]["type"] == "pdf"
        assert out["chunks"]["type"] == "chunks"

    def test_page_count_is_real_not_the_hardcoded_46(self, sample_pdf, tmp_path):
        out = pdf_source.run({}, {"path": str(sample_pdf)}, artifacts_dir=tmp_path)
        assert out["pdf"]["meta"]["pages"] == 4, "page count must come from the PDF"

    def test_chunks_artifact_is_readable_and_non_empty(self, sample_pdf, tmp_path):
        out = pdf_source.run({}, {"path": str(sample_pdf)}, artifacts_dir=tmp_path)
        chunks = json.loads(open(out["chunks"]["ref"], encoding="utf-8").read())
        assert chunks, "expected real chunks"
        assert out["chunks"]["meta"]["count"] == len(chunks)
        assert all("text" in c and c["text"].strip() for c in chunks)

    def test_reports_full_page_coverage_for_a_clean_pdf(self, sample_pdf, tmp_path):
        out = pdf_source.run({}, {"path": str(sample_pdf)}, artifacts_dir=tmp_path)
        m = out["pdf"]["meta"]
        assert m["pages_covered"] == m["pages"]
        assert m["page_coverage"] == 1.0, (
            "coverage is surfaced so silent ingestion loss is visible on the canvas"
        )

    def test_doc_id_defaults_to_the_filename_stem(self, sample_pdf, tmp_path):
        out = pdf_source.run({}, {"path": str(sample_pdf)}, artifacts_dir=tmp_path)
        assert out["pdf"]["meta"]["doc_id"] == "din_test_standard"

    def test_explicit_doc_id_wins(self, sample_pdf, tmp_path):
        out = pdf_source.run(
            {}, {"path": str(sample_pdf), "doc_id": "custom"}, artifacts_dir=tmp_path
        )
        assert out["pdf"]["meta"]["doc_id"] == "custom"
        assert out["chunks"]["meta"]["doc_id"] == "custom"

    def test_records_the_backend_and_chunking_strategy_actually_used(
        self, sample_pdf, tmp_path
    ):
        out = pdf_source.run({}, {"path": str(sample_pdf)}, artifacts_dir=tmp_path)
        assert out["pdf"]["meta"]["backend"] in {
            "legacy", "docling_table", "docling_ocr",
        }
        assert out["chunks"]["meta"]["strategy"] in {
            "clause", "heading", "recursive", "table_aware", "ocr_block",
        }


class TestPdfSourceFailsLoudly:
    def test_missing_path_param_raises(self, tmp_path):
        with pytest.raises(ValueError, match="requires params"):
            pdf_source.run({}, {}, artifacts_dir=tmp_path)

    def test_nonexistent_file_raises(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            pdf_source.run({}, {"path": str(tmp_path / "nope.pdf")}, artifacts_dir=tmp_path)
