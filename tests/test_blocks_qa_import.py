"""TDD: rag_gt.blocks.qa_import wraps rag_gt.rag.loader.load_gt_pairs_from
verbatim (05_BLOCK_CATALOG.md §3.1), mirroring facts_import's structure.
Params: {"path": str} pointing at a GT pairs file: JSON array, JSONL, or the
round-3 "final" {"pairs": [...], "stats": {...}} wrapper.

Note: write_json_artifact (rag_gt.blocks._common) writes content-addressed
filenames (`qa_import_<sha256[:16]>.json`), not a fixed `qa_import.json` --
confirmed by reading _common.py and mirroring how the facts_import tests
assert against `out["facts"]["ref"]` rather than a literal filename.
"""
from __future__ import annotations

import json

from rag_gt.blocks import qa_import


def test_qa_import_loads_wrapper_file_and_emits_qa_artifact(tmp_path):
    src = tmp_path / "final.json"
    src.write_text(json.dumps({"pairs": [{"qa_id": "V2Q1"}], "stats": {}}), encoding="utf-8")

    out = qa_import.run({}, {"path": str(src)}, artifacts_dir=tmp_path)

    qa = out["qa"]
    assert qa["type"] == "qa" and qa["meta"]["count"] == 1
    written = json.loads(open(qa["ref"], encoding="utf-8").read())
    assert written[0]["qa_id"] == "V2Q1"


def test_qa_import_writes_data_matching_load_gt_pairs_from(tmp_path):
    from rag_gt.rag.loader import load_gt_pairs_from

    src = tmp_path / "s7_pairs.json"
    src.write_text(json.dumps([{"qa_id": "x"}, {"qa_id": "y"}]), encoding="utf-8")

    expected = load_gt_pairs_from(src)
    out = qa_import.run({}, {"path": str(src)}, artifacts_dir=tmp_path)

    assert set(out.keys()) == {"qa"}
    written = json.loads(open(out["qa"]["ref"], encoding="utf-8").read())
    assert written == expected
