"""TDD: rag_gt.blocks.gate_leak wraps rag_gt.generation.answer_first_v2.
qa_bridge_hidden (TODO.md sec. 3/8) -- a NEW, real, standalone gate (unlike
its 4 identity-passthrough siblings, see gate_clause.py's module docstring).
Direct unit coverage of qa_bridge_hidden's own accept/reject rule lives in
tests/test_answer_first_v2.py; this file adds only the thin block-adapter
(artifact in/out + meta shape) coverage on top, following the pattern in
tests/test_blocks_bridge_quality.py.
"""
from __future__ import annotations

import json

from rag_gt.blocks.gate_leak import run


def _qa(qa_id: str, bridge_entity: str, question: str) -> dict:
    return {
        "qa_id": qa_id,
        "hop_type": "bridge" if bridge_entity else "single",
        "bridge_entity": bridge_entity,
        "question": question,
        "answer": "some answer",
        "gold_fact_ids": ["F1"],
        "doc": "din_iso_15609",
    }


def _qa_artifact(records: list, tmp_path) -> dict:
    ref = tmp_path / "qa_in.json"
    ref.write_text(json.dumps(records), encoding="utf-8")
    return {"type": "qa", "ref": str(ref), "meta": {"count": len(records)}}


def test_clean_question_is_kept(tmp_path):
    records = [_qa("Q1", "ISO 15607", "What must precede production welding?")]
    out = run({"qa": _qa_artifact(records, tmp_path)}, {}, artifacts_dir=tmp_path)

    kept = json.loads(open(out["qa"]["ref"], encoding="utf-8").read())
    assert [r["qa_id"] for r in kept] == ["Q1"]
    assert out["qa"]["meta"]["count"] == 1
    assert out["qa"]["meta"]["count_in"] == 1
    assert out["qa"]["meta"]["dropped_leak"] == 0


def test_leaked_bridge_phrase_is_dropped_and_counted(tmp_path):
    records = [
        _qa("Q1", "ISO 15607", "What must precede production welding?"),
        _qa("Q2", "ISO 15607", "What does ISO 15607 require before production welding?"),
    ]
    out = run({"qa": _qa_artifact(records, tmp_path)}, {}, artifacts_dir=tmp_path)

    kept = json.loads(open(out["qa"]["ref"], encoding="utf-8").read())
    assert [r["qa_id"] for r in kept] == ["Q1"]
    assert out["qa"]["meta"]["count"] == 1
    assert out["qa"]["meta"]["count_in"] == 2
    assert out["qa"]["meta"]["dropped_leak"] == 1


def test_single_hop_records_with_no_bridge_entity_are_never_dropped(tmp_path):
    records = [_qa("Q1", "", "What is the minimum preheat temperature?")]
    out = run({"qa": _qa_artifact(records, tmp_path)}, {}, artifacts_dir=tmp_path)

    kept = json.loads(open(out["qa"]["ref"], encoding="utf-8").read())
    assert [r["qa_id"] for r in kept] == ["Q1"]
    assert out["qa"]["meta"]["dropped_leak"] == 0


def test_empty_qa_list_is_handled(tmp_path):
    out = run({"qa": _qa_artifact([], tmp_path)}, {}, artifacts_dir=tmp_path)

    kept = json.loads(open(out["qa"]["ref"], encoding="utf-8").read())
    assert kept == []
    assert out["qa"]["meta"]["count"] == 0
    assert out["qa"]["meta"]["count_in"] == 0
    assert out["qa"]["meta"]["dropped_leak"] == 0
