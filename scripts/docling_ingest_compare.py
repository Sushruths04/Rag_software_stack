"""Gap-closure item: Docling vs legacy ingest, extraction/chunking level only.

Runs each doc twice through the REAL stage-0/1/2 path — once with
allow_docling=False (the pre-install behavior) and once with the default —
and reports what actually changed. Zero LLM calls.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

DOCS = [
    ("synth_scanned", r"D:\Mini Thesis\RAG_GT\data\test_corpus_allpdf\synth_scanned.pdf"),
    ("din_iso_6507_vickers", r"D:\Mini Thesis\RAG_GT\data\test_corpus_allpdf\din_iso_6507_vickers.pdf"),
    ("rag_lewis2020", r"D:\Mini Thesis\RAG_GT\data\test_corpus_allpdf\rag_lewis2020.pdf"),
]
OUT_DIR = Path(__file__).resolve().parents[1] / "data" / "eval_results"


def _bbox_share(ing) -> float:
    units = getattr(ing, "units", []) or []
    if not units:
        return 0.0
    # SourceUnit exposes a `bboxes` list (empty when the backend gives no
    # geometry); a non-empty list means this unit carries page coordinates.
    return sum(1 for u in units if getattr(u, "bboxes", None)) / len(units)


def compare_doc(prof, before, after, chunks_before, chunks_after) -> dict:
    return {
        "doc_id": prof.doc_id,
        "pages": prof.page_count,
        "recommended_backend": prof.recommended_backend,
        "backend_before": before.backend_used,
        "backend_after": after.backend_used,
        "chars_before": before.char_count,
        "chars_after": after.char_count,
        "char_delta_pct": round(
            (after.char_count - before.char_count) / max(before.char_count, 1) * 100, 1
        ),
        "units_before": before.n_units,
        "units_after": after.n_units,
        "pages_covered_before": before.pages_covered,
        "pages_covered_after": after.pages_covered,
        "bbox_unit_share_before": round(_bbox_share(before), 3),
        "bbox_unit_share_after": round(_bbox_share(after), 3),
        "chunks_before": len(chunks_before),
        "chunks_after": len(chunks_after),
        "notes_before": list(before.notes),
        "notes_after": list(after.notes),
    }


def main() -> int:
    from rag_gt.allpdf.chunk import agentic_chunk
    from rag_gt.allpdf.ingest import ingest_document
    from rag_gt.allpdf.preflight import profile_pdf

    rows = []
    for doc_id, path in DOCS:
        prof = profile_pdf(path, doc_id)
        t0 = time.time()
        before = ingest_document(prof, allow_docling=False)
        t_before = time.time() - t0
        cb = agentic_chunk(prof, before).chunks
        t0 = time.time()
        after = ingest_document(prof)  # default allow_docling=True
        t_after = time.time() - t0
        ca = agentic_chunk(prof, after).chunks
        row = compare_doc(prof, before, after, cb, ca)
        row["ingest_seconds_before"] = round(t_before, 1)
        row["ingest_seconds_after"] = round(t_after, 1)
        rows.append(row)
        print(f"[compare] {doc_id}: {row['backend_before']} -> {row['backend_after']} "
              f"chars {row['chars_before']}->{row['chars_after']} "
              f"chunks {row['chunks_before']}->{row['chunks_after']}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "docling_ingest_compare.json").write_text(
        json.dumps(rows, indent=2), encoding="utf-8"
    )
    md = ["# Docling vs legacy — ingest-level comparison", "",
          "| doc | backend before→after | chars Δ% | units | chunks | bbox share | s/ingest |",
          "|---|---|---|---|---|---|---|"]
    for r in rows:
        md.append(
            f"| {r['doc_id']} | {r['backend_before']}→{r['backend_after']} "
            f"| {r['char_delta_pct']} | {r['units_before']}→{r['units_after']} "
            f"| {r['chunks_before']}→{r['chunks_after']} "
            f"| {r['bbox_unit_share_before']}→{r['bbox_unit_share_after']} "
            f"| {r['ingest_seconds_before']}→{r['ingest_seconds_after']} |")
    (OUT_DIR / "docling_ingest_compare.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
