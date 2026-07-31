"""TDD: rag_gt.rag.loader.load_gt_pairs_from must also accept the round-3
"final" wrapper object shape ({"pairs": [...], "stats": {...}}), not just a
bare JSON array or JSONL. Existing array/JSONL behavior must be unchanged.
"""
from __future__ import annotations

import json

from rag_gt.rag.loader import load_gt_pairs_from


def test_load_gt_pairs_from_handles_pairs_wrapper_object(tmp_path):
    f = tmp_path / "final.json"
    f.write_text(
        json.dumps({"pairs": [{"qa_id": "V2Q1"}, {"qa_id": "V2Q2"}], "stats": {"n": 2}}),
        encoding="utf-8",
    )
    pairs = load_gt_pairs_from(f)
    assert [p["qa_id"] for p in pairs] == ["V2Q1", "V2Q2"]


def test_load_gt_pairs_from_still_reads_array_and_jsonl(tmp_path):
    arr = tmp_path / "a.json"
    arr.write_text(json.dumps([{"qa_id": "x"}]), encoding="utf-8")
    jl = tmp_path / "b.jsonl"
    jl.write_text('{"qa_id": "y"}\n{"qa_id": "z"}\n', encoding="utf-8")
    assert [p["qa_id"] for p in load_gt_pairs_from(arr)] == ["x"]
    assert [p["qa_id"] for p in load_gt_pairs_from(jl)] == ["y", "z"]
