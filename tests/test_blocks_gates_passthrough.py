"""TDD: gate_clause/gate_joint/gate_loo/gate_grounding are pure identity
pass-throughs (TODO.md sec. 3/8) -- clause/joint/necessity/grounding
filtering already happens inside qa_gen_pairs/qa_gen_clusters/qa_gen_bridges
via gate_qa_group before a `qa` artifact ever exists (see each block
module's own docstring for the full architecture note). The one
correctness property that matters for these four is that they never mutate
or drop anything: an "identity" gate that silently changed a record would
be a real regression, not just a missing feature.

Each block is exercised with the SAME representative qa-record fixture and
a matching params dict pulled from that block's real studio params model
defaults, to prove the params are truly inert.
"""
from __future__ import annotations

import json

import pytest

from rag_gt.blocks import gate_clause, gate_grounding, gate_joint, gate_loo


def _qa_records() -> list[dict]:
    return [
        {
            "qa_id": "V2Q00001",
            "hop_type": "single",
            "evidence_strategy": "neighbor_pair",
            "bridge_entity": "",
            "question": "What is the minimum preheat temperature?",
            "answer": "150 C",
            "answer_clauses": [{"text": "150 C", "fact_id": "F1", "nli": 0.91}],
            "gold_fact_ids": ["F1"],
            "gold_chunk_ids": ["ck_F1"],
            "gold_pages": [3],
            "gold_bboxes": {"F1": [1, 2, 3, 4]},
            "grounding_complete": True,
            "necessity": {"necessity_score": 1.0, "necessary_fact_ids": ["F1"],
                          "loo_entailment": [], "passed": True},
            "verify": {"bridge_hidden": None, "duplicate": False,
                       "faithful": True, "verdict": "PENDING_STAGE_D"},
            "source_pair_id": "P1",
            "doc": "din_iso_15609",
        },
        {
            "qa_id": "V2Q00002",
            "hop_type": "bridge",
            "evidence_strategy": "cluster_2plus2",
            "bridge_entity": "ISO 15607",
            "question": "What must precede production welding under this scheme?",
            "answer": "A qualified procedure specification; a qualified welder",
            "answer_clauses": [
                {"text": "A qualified procedure specification", "fact_id": "F2", "nli": 0.88},
                {"text": "a qualified welder", "fact_id": "F3", "nli": 0.90},
            ],
            "gold_fact_ids": ["F2", "F3"],
            "gold_chunk_ids": ["ck_F2", "ck_F3"],
            "gold_pages": [4, 5],
            "gold_bboxes": {"F2": [1, 2, 3, 4], "F3": [5, 6, 7, 8]},
            "grounding_complete": True,
            "necessity": {"necessity_score": 1.0, "necessary_fact_ids": ["F2", "F3"],
                          "loo_entailment": [0.2, 0.3], "passed": True},
            "verify": {"bridge_hidden": True, "duplicate": False,
                       "faithful": True, "verdict": "PENDING_STAGE_D"},
            "source_pair_id": "P2",
            "doc": "din_iso_15609",
        },
    ]


def _qa_artifact(records: list, tmp_path, name="qa_in.json") -> dict:
    ref = tmp_path / name
    ref.write_text(json.dumps(records), encoding="utf-8")
    return {"type": "qa", "ref": str(ref), "meta": {"count": len(records)}}


_BLOCKS = [
    (gate_clause, {"threshold": 0.65}),
    (gate_joint, {"single_fact_max": 0.50, "joint_min": 0.85}),
    (gate_loo, {}),
    (gate_grounding, {}),
]


@pytest.mark.parametrize("block,params", _BLOCKS, ids=[b.__name__ for b, _ in _BLOCKS])
def test_identity_gate_returns_qa_list_unchanged(block, params, tmp_path):
    records = _qa_records()
    out = block.run({"qa": _qa_artifact(records, tmp_path)}, params, artifacts_dir=tmp_path)

    result = json.loads(open(out["qa"]["ref"], encoding="utf-8").read())
    assert result == records
    assert out["qa"]["meta"]["count"] == len(records)
    assert out["qa"]["meta"]["passthrough"] is True


@pytest.mark.parametrize("block,params", _BLOCKS, ids=[b.__name__ for b, _ in _BLOCKS])
def test_identity_gate_handles_empty_qa_list(block, params, tmp_path):
    out = block.run({"qa": _qa_artifact([], tmp_path)}, params, artifacts_dir=tmp_path)

    result = json.loads(open(out["qa"]["ref"], encoding="utf-8").read())
    assert result == []
    assert out["qa"]["meta"]["count"] == 0


@pytest.mark.parametrize("block,params", _BLOCKS, ids=[b.__name__ for b, _ in _BLOCKS])
def test_identity_gate_ignores_unrelated_extra_params(block, params, tmp_path):
    """Params are accepted but inert (see module docstrings) -- passing an
    unrelated extra key must not raise or change the output."""
    records = _qa_records()
    noisy_params = {**params, "some_future_param": "whatever"}
    out = block.run({"qa": _qa_artifact(records, tmp_path)}, noisy_params, artifacts_dir=tmp_path)

    result = json.loads(open(out["qa"]["ref"], encoding="utf-8").read())
    assert result == records
