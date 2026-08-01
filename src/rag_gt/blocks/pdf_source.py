"""Block: pdf_source [FREE] -- (empty) -> pdf + chunks.

The one block standing between GRAFT Studio and the same raw-PDF-in flow the
web pipeline already has. Until now it was a stub returning a hardcoded
``{"pages": 46}``, so the canvas could only start from already-chunked,
already-fact-extracted documents.

Runs the engine's Stage 0-2 front end verbatim -- ``profile_pdf`` ->
``ingest_document`` -> ``agentic_chunk`` -- which is the same path
``rag_gt.allpdf.pipeline`` takes, so a Studio graph starting here sees
exactly what the CLI would produce, including the adaptive backend choice
(legacy / docling_table / docling_ocr) and the chunking strategy picked from
the document profile.

Emits two artifacts:
  - ``pdf``    : the document itself, with the real page count and the
                 profile's routing decisions (``bbox_viewer`` consumes this)
  - ``chunks`` : ready to feed ``chunker`` / ``fact_extract_llm``

Free: no LLM call. Docling is CPU-only layout work.
"""
from __future__ import annotations

from pathlib import Path

from rag_gt.allpdf.chunk import agentic_chunk
from rag_gt.allpdf.ingest import ingest_document
from rag_gt.allpdf.preflight import profile_pdf
from rag_gt.blocks._common import artifact, write_json_artifact


def run(inputs: dict, params: dict, artifacts_dir: Path | str | None = None) -> dict:
    path = str(params.get("path") or "").strip()
    if not path:
        raise ValueError("pdf_source requires params['path'] (a PDF file)")
    src = Path(path)
    if not src.is_file():
        raise FileNotFoundError(f"pdf_source: no such PDF: {src}")

    doc_id = str(params.get("doc_id") or "").strip() or src.stem

    profile = profile_pdf(str(src), doc_id)
    ingest = ingest_document(
        profile,
        docling_page_cap=int(params.get("docling_page_cap", 60)),
        allow_docling=bool(params.get("allow_docling", True)),
    )
    chunked = agentic_chunk(profile, ingest)

    # Surfaced so a graph can be trusted without reading the log: a document
    # whose pages_covered lags its page_count lost content during ingestion,
    # which is exactly the class of silent failure this pipeline has hit
    # before (docling_page_cap truncation, silent Docling page drops).
    coverage = (
        ingest.pages_covered / profile.page_count if profile.page_count else 0.0
    )

    chunks_ref = write_json_artifact(artifacts_dir, "pdf_source_chunks", chunked.chunks)
    return {
        "pdf": artifact(
            "pdf",
            str(src),
            {
                "doc_id": doc_id,
                "pages": profile.page_count,
                "pages_covered": ingest.pages_covered,
                "page_coverage": round(coverage, 3),
                "backend": ingest.backend_used,
                "doc_type": profile.doc_type_guess,
                "scanned": profile.scanned,
                "notes": ingest.notes,
            },
        ),
        "chunks": artifact(
            "chunks",
            str(chunks_ref),
            {
                "count": len(chunked.chunks),
                "doc_id": doc_id,
                "strategy": chunked.strategy,
                "source": "pdf_source",
            },
        ),
    }
