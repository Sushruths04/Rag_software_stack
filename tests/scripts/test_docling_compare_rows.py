from types import SimpleNamespace
from scripts.docling_ingest_compare import compare_doc

def _ing(backend, chars, units, pages, notes=(), with_bbox=0):
    us = [SimpleNamespace(page_no=1, bboxes=[(1, 2, 3, 4)] if i < with_bbox else [])
          for i in range(units)]
    return SimpleNamespace(backend_used=backend, char_count=chars, n_units=units,
                           pages_covered=pages, notes=list(notes), units=us)

def test_compare_doc_reports_backend_switch_and_deltas():
    prof = SimpleNamespace(doc_id="d", page_count=10, doc_type_guess="scan",
                           recommended_backend="docling_ocr")
    row = compare_doc(prof,
                      before=_ing("legacy", 1000, 50, 10),
                      after=_ing("docling_ocr", 4000, 80, 10, with_bbox=80),
                      chunks_before=list(range(12)), chunks_after=list(range(20)))
    assert row["doc_id"] == "d"
    assert row["backend_before"] == "legacy" and row["backend_after"] == "docling_ocr"
    assert row["char_delta_pct"] == 300.0
    assert row["chunks_before"] == 12 and row["chunks_after"] == 20
    assert row["bbox_unit_share_after"] == 1.0 and row["bbox_unit_share_before"] == 0.0
