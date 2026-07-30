"""Block: chunks_import [FREE] -- (empty) -> chunks.

Wraps rag_gt.rag.loader.load_chunks(doc_id) verbatim (05_BLOCK_CATALOG.md
§3.2). Params: {"doc_id": str}.

Also accepts params={"path": <existing file>} to load chunks straight from
a project-local s2_chunks_full.json-shaped file via load_chunks_from(path),
bypassing the hardcoded doc_id map -- an explicit path wins whenever it
points at a file that exists; otherwise doc_id resolution is unchanged.
"""
from __future__ import annotations

from pathlib import Path

from rag_gt.blocks._common import artifact, write_json_artifact
from rag_gt.rag.loader import load_chunks, load_chunks_from


def run(inputs: dict, params: dict, artifacts_dir: Path | str | None = None) -> dict:
    path = str(params.get("path") or "")
    doc_id = str(params.get("doc_id") or "")
    if path and Path(path).is_file():
        chunks = load_chunks_from(path)
        source = "path"
    else:
        chunks = load_chunks(doc_id)
        source = "doc_id"
    ref = write_json_artifact(artifacts_dir, "chunks_import", chunks)
    return {
        "chunks": artifact(
            "chunks", str(ref),
            {"count": len(chunks), "doc_id": doc_id, "source": source},
        )
    }
