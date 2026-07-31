"""TDD: rag_gt.blocks.gate_dedup wraps rag_gt.generation.dataset_budget.
dedup_pairs verbatim (TODO.md sec. 3/8) -- the one gate block of the 6 in
this task with genuinely separable real behavior (see gate_dedup.py's
module docstring for the embed_fn=None decision and why cosine_threshold
must never be loosened from 0.92 by default). Direct unit coverage of
dedup_pairs' own two-pass dedup logic already lives in
tests/test_assembly_dedup.py; this file adds only the thin block-adapter
(artifact in/out + meta shape, embed_fn wiring, cosine_threshold override)
coverage on top, following the pattern in tests/test_blocks_bridge_quality.py.
"""
from __future__ import annotations

import json

from rag_gt.blocks.gate_dedup import run


def _qa(qa_id, doc, question, fact_ids, nli_scores):
    return {
        "qa_id": qa_id,
        "doc": doc,
        "question": question,
        "gold_fact_ids": fact_ids,
        "answer_clauses": [
            {"text": f"clause {i}", "fact_id": fid, "nli": score}
            for i, (fid, score) in enumerate(zip(fact_ids, nli_scores))
        ],
    }


def _qa_artifact(records: list, tmp_path) -> dict:
    ref = tmp_path / "qa_in.json"
    ref.write_text(json.dumps(records), encoding="utf-8")
    return {"type": "qa", "ref": str(ref), "meta": {"count": len(records)}}


def test_identical_gold_fact_ids_collapse_keeping_more_evidence_units(tmp_path):
    records = [
        _qa("Q1", "docA", "question one", ["docA_F1", "docA_F2"], [0.9, 0.9]),
        _qa("Q2", "docA", "question two", ["docA_F2", "docA_F1"], [0.6]),
    ]
    out = run({"qa": _qa_artifact(records, tmp_path)}, {}, artifacts_dir=tmp_path)

    kept = json.loads(open(out["qa"]["ref"], encoding="utf-8").read())
    assert [qa["qa_id"] for qa in kept] == ["Q1"]
    assert out["qa"]["meta"]["count"] == 1
    assert out["qa"]["meta"]["count_in"] == 2
    assert out["qa"]["meta"]["n_dupes_dropped_evidence"] == 1
    assert out["qa"]["meta"]["n_dupes_dropped_question"] == 0


def test_shared_evidence_scoped_per_doc_not_collapsed_across_docs(tmp_path):
    records = [
        _qa("Q1", "docA", "q1", ["F1", "F2"], [0.9, 0.9]),
        _qa("Q2", "docB", "q2", ["F1", "F2"], [0.9, 0.9]),
    ]
    out = run({"qa": _qa_artifact(records, tmp_path)}, {}, artifacts_dir=tmp_path)

    kept = json.loads(open(out["qa"]["ref"], encoding="utf-8").read())
    assert len(kept) == 2
    assert out["qa"]["meta"]["n_dupes_dropped_evidence"] == 0


def test_default_embed_fn_is_none_so_near_dupe_question_pass_is_skipped(tmp_path):
    """No embed_fn is threaded through by default (see module docstring) --
    two near-paraphrase questions over DIFFERENT gold facts must both
    survive, since only the shared-evidence pass runs without an embedder."""
    records = [
        _qa("Q1", "docA", "What details must be included in the record?",
            ["docA_F1"], [0.9]),
        _qa("Q2", "docA", "What details must be recorded?",
            ["docA_F2"], [0.9]),
    ]
    out = run({"qa": _qa_artifact(records, tmp_path)}, {}, artifacts_dir=tmp_path)

    kept = json.loads(open(out["qa"]["ref"], encoding="utf-8").read())
    assert len(kept) == 2
    assert out["qa"]["meta"]["n_dupes_dropped_question"] == 0


def test_near_dupe_cosine_param_overrides_default_when_embed_fn_supplied(tmp_path):
    """cosine_threshold must not be loosened silently -- but an explicit
    param override (with an injected embed_fn) is honored."""

    class _FakeEmbedder:
        VECTORS = {
            "What details must be included in the record?": [1.0, 0.01, 0.0],
            "What details must be recorded?": [0.999, 0.045, 0.0],
        }

        def __call__(self, texts):
            return [self.VECTORS[t] for t in texts]

    records = [
        _qa("Q1", "docA", "What details must be included in the record?",
            ["docA_F1", "docA_F2"], [0.95, 0.9]),
        _qa("Q2", "docA", "What details must be recorded?",
            ["docA_F3"], [0.8]),
    ]
    out = run(
        {"qa": _qa_artifact(records, tmp_path)},
        {"near_dupe_cosine": 0.92, "embed_fn": _FakeEmbedder()},
        artifacts_dir=tmp_path,
    )

    kept = json.loads(open(out["qa"]["ref"], encoding="utf-8").read())
    assert [qa["qa_id"] for qa in kept] == ["Q1"]
    assert out["qa"]["meta"]["n_dupes_dropped_question"] == 1


def test_default_cosine_threshold_matches_dedup_pairs_real_default(tmp_path):
    """No near_dupe_cosine param supplied -> the block must use 0.92, same
    as dedup_pairs' own hard-coded default -- never a looser value."""
    from rag_gt.blocks import gate_dedup as m

    captured = {}
    real_dedup_pairs = m.dedup_pairs

    def spy(pairs, *, embed_fn=None, cosine_threshold=0.92):
        captured["cosine_threshold"] = cosine_threshold
        captured["embed_fn"] = embed_fn
        return real_dedup_pairs(pairs, embed_fn=embed_fn, cosine_threshold=cosine_threshold)

    m.dedup_pairs = spy
    try:
        records = [_qa("Q1", "docA", "q1", ["F1"], [0.9])]
        run({"qa": _qa_artifact(records, tmp_path)}, {}, artifacts_dir=tmp_path)
    finally:
        m.dedup_pairs = real_dedup_pairs

    assert captured["cosine_threshold"] == 0.92
    assert captured["embed_fn"] is None


def test_empty_qa_list_is_handled(tmp_path):
    out = run({"qa": _qa_artifact([], tmp_path)}, {}, artifacts_dir=tmp_path)

    kept = json.loads(open(out["qa"]["ref"], encoding="utf-8").read())
    assert kept == []
    assert out["qa"]["meta"]["count"] == 0
    assert out["qa"]["meta"]["count_in"] == 0
