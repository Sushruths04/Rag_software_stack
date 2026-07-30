"""Block: qa_import [FREE] -- (empty) -> qa.

Wraps rag_gt.rag.loader.load_gt_pairs_from(path) (05_BLOCK_CATALOG.md §3.1).
Params: {"path": str} pointing at a GT pairs file: JSON array, JSONL, or the
round-3 final {"pairs": [...], "stats": {...}} wrapper.
"""
from __future__ import annotations

from pathlib import Path

from rag_gt.blocks._common import artifact, write_json_artifact
from rag_gt.rag.loader import load_gt_pairs_from


def run(inputs: dict, params: dict, artifacts_dir: Path | str | None = None) -> dict:
    path = Path(str(params.get("path") or ""))
    pairs = load_gt_pairs_from(path)
    ref = write_json_artifact(artifacts_dir, "qa_import", pairs)
    return {"qa": artifact("qa", str(ref), {"count": len(pairs)})}
