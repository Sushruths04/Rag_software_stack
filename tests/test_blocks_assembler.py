"""TDD: rag_gt.blocks.assembler -- qa (multi-in) -> qa (TODO.md sec. 3/8).

Real job (see assembler.py's own module docstring for the full reasoning):
merge N independently-produced qa artifact lists (one per upstream
qa_gen_*/gate chain wired into the multi-in ``qa`` port), then apply the
``target_total`` budget cap. Multi-hop records (``hop_type != "single"``)
are kept in full when ``keep_all_multi_hop`` (default True); the remaining
budget is split across the surviving single-hop records' own ``doc`` field
via ``dataset_budget.allocate_singles`` (proportional, largest-remainder),
and within a doc whose allotment is below its supply, the survivors are
picked by ``dataset_budget._keep_rank`` (more evidence units, then higher
min clause NLI -- the same signal ``dedup_pairs`` already uses to choose a
survivor). Every surviving record's ``qa_id`` is renumbered sequentially
(the static studio catalog's own documented purpose for this block).
"""
from __future__ import annotations

import json

from rag_gt.blocks.assembler import run


def _qa(doc, hop_type, fact_ids, nli_scores, tag):
    return {
        "doc": doc,
        "hop_type": hop_type,
        "tag": tag,
        "gold_fact_ids": fact_ids,
        "answer_clauses": [
            {"text": f"clause {i}", "fact_id": fid, "nli": score}
            for i, (fid, score) in enumerate(zip(fact_ids, nli_scores))
        ],
    }


def _qa_artifact(records: list, tmp_path, name: str) -> dict:
    ref = tmp_path / f"{name}.json"
    ref.write_text(json.dumps(records), encoding="utf-8")
    return {"type": "qa", "ref": str(ref), "meta": {"count": len(records)}}


def _tags(kept):
    return {qa["tag"] for qa in kept}


def test_merges_two_or_more_qa_streams_with_no_cap(tmp_path):
    stream_a = [_qa("docA", "single", [f"A{i}"], [0.9], f"a{i}") for i in range(2)]
    stream_b = [_qa("docB", "single", [f"B{i}"], [0.9], f"b{i}") for i in range(3)]
    inputs = {"qa": [_qa_artifact(stream_a, tmp_path, "a"), _qa_artifact(stream_b, tmp_path, "b")]}

    out = run(inputs, {"target_total": 0}, artifacts_dir=tmp_path)  # falsy -> uncapped

    kept = json.loads(open(out["qa"]["ref"], encoding="utf-8").read())
    assert len(kept) == 5
    assert _tags(kept) == {"a0", "a1", "b0", "b1", "b2"}
    assert out["qa"]["meta"]["count"] == 5
    assert out["qa"]["meta"]["n_sources"] == 2
    assert out["qa"]["meta"]["per_source_counts"] == [2, 3]
    assert out["qa"]["meta"]["count_before_cap"] == 5
    assert out["qa"]["meta"]["count_after_cap"] == 5


def test_qa_ids_renumbered_sequentially_across_merged_streams(tmp_path):
    stream_a = [_qa("docA", "single", [f"A{i}"], [0.9], f"a{i}") for i in range(2)]
    stream_b = [_qa("docB", "single", [f"B{i}"], [0.9], f"b{i}") for i in range(3)]
    inputs = {"qa": [_qa_artifact(stream_a, tmp_path, "a"), _qa_artifact(stream_b, tmp_path, "b")]}

    out = run(inputs, {"target_total": 0}, artifacts_dir=tmp_path)

    kept = json.loads(open(out["qa"]["ref"], encoding="utf-8").read())
    assert [qa["qa_id"] for qa in kept] == [f"V2Q{i:05d}" for i in range(1, 6)]


def test_single_stream_passthrough_when_under_target_total(tmp_path):
    stream = [_qa("docA", "single", [f"A{i}"], [0.9], f"a{i}") for i in range(3)]
    inputs = {"qa": [_qa_artifact(stream, tmp_path, "only")]}

    out = run(inputs, {}, artifacts_dir=tmp_path)  # default target_total=500, well above 3

    kept = json.loads(open(out["qa"]["ref"], encoding="utf-8").read())
    assert len(kept) == 3
    assert _tags(kept) == {"a0", "a1", "a2"}
    assert out["qa"]["meta"]["count_before_cap"] == 3
    assert out["qa"]["meta"]["count_after_cap"] == 3
    assert out["qa"]["meta"]["target_total"] == 500
    assert out["qa"]["meta"]["n_sources"] == 1
    assert out["qa"]["meta"]["per_source_counts"] == [3]


def test_budget_cap_keeps_all_multi_hop_and_ranks_singles_per_doc(tmp_path):
    """target_total=4, 1 multi-hop record (always kept) + 5 single-hop
    records across 2 docs (docA: 3 singles, docB: 2 singles). Remaining
    singles budget is 4 - 1 = 3, split via allocate_singles({"docA": 3,
    "docB": 2}, 3) -> docA=2, docB=1 (verified by hand: quotas 1.8/1.2,
    floor 1/1, one remainder slot to docA's larger fractional remainder).
    Within docA, the top 2 by _keep_rank (evidence-unit count, then min
    clause NLI) must survive: a2 has 2 evidence clauses (beats a1's 1 and
    a3's 1), then a1 (min NLI 0.9) beats a3 (min NLI 0.3). Within docB, b1
    (NLI 0.95) beats b2 (NLI 0.2)."""
    qa_a1 = _qa("docA", "single", ["A1"], [0.9], "a1")
    qa_a2 = _qa("docA", "single", ["A2a", "A2b"], [0.9, 0.9], "a2")
    qa_a3 = _qa("docA", "single", ["A3"], [0.3], "a3")
    qa_b1 = _qa("docB", "single", ["B1"], [0.95], "b1")
    qa_b2 = _qa("docB", "single", ["B2"], [0.2], "b2")
    qa_m1 = _qa("docA", "bridge", ["M1a", "M1b"], [0.9, 0.9], "m1")

    stream = [qa_a1, qa_a2, qa_a3, qa_b1, qa_b2, qa_m1]
    inputs = {"qa": [_qa_artifact(stream, tmp_path, "one")]}

    out = run(inputs, {"target_total": 4}, artifacts_dir=tmp_path)

    kept = json.loads(open(out["qa"]["ref"], encoding="utf-8").read())
    assert _tags(kept) == {"m1", "a2", "a1", "b1"}
    assert out["qa"]["meta"]["count"] == 4
    assert out["qa"]["meta"]["count_before_cap"] == 6
    assert out["qa"]["meta"]["count_after_cap"] == 4
    assert out["qa"]["meta"]["multi_hop"] == 1
    assert out["qa"]["meta"]["keep_all_multi_hop"] is True


def test_keep_all_multi_hop_false_caps_the_full_pool_including_multi_hop(tmp_path):
    """With keep_all_multi_hop=False, the multi-hop record is just another
    candidate in the same doc-proportional cap -- not automatically kept."""
    qa_a1 = _qa("docA", "single", ["A1"], [0.1], "a1")  # weakest
    qa_a2 = _qa("docA", "single", ["A2"], [0.99], "a2")  # strongest single
    qa_m1 = _qa("docA", "bridge", ["M1"], [0.5], "m1")  # mid-ranked, same doc

    stream = [qa_a1, qa_a2, qa_m1]
    inputs = {"qa": [_qa_artifact(stream, tmp_path, "one")]}

    out = run(inputs, {"target_total": 2, "keep_all_multi_hop": False}, artifacts_dir=tmp_path)

    kept = json.loads(open(out["qa"]["ref"], encoding="utf-8").read())
    assert len(kept) == 2
    assert _tags(kept) == {"a2", "m1"}  # a1 (weakest NLI) dropped
    assert out["qa"]["meta"]["keep_all_multi_hop"] is False


def test_meta_reports_per_source_counts_for_three_streams(tmp_path):
    stream_a = [_qa("docA", "single", ["A1"], [0.9], "a1")]
    stream_b = [_qa("docB", "single", [f"B{i}"], [0.9], f"b{i}") for i in range(2)]
    stream_c = [_qa("docC", "bridge", ["C1", "C2"], [0.9, 0.9], "c1")]
    inputs = {
        "qa": [
            _qa_artifact(stream_a, tmp_path, "a"),
            _qa_artifact(stream_b, tmp_path, "b"),
            _qa_artifact(stream_c, tmp_path, "c"),
        ]
    }

    out = run(inputs, {"target_total": 0}, artifacts_dir=tmp_path)

    assert out["qa"]["meta"]["n_sources"] == 3
    assert out["qa"]["meta"]["per_source_counts"] == [1, 2, 1]
    assert out["qa"]["meta"]["count"] == 4
    assert out["qa"]["meta"]["multi_hop"] == 1


def test_empty_qa_list_is_handled(tmp_path):
    out = run({"qa": []}, {}, artifacts_dir=tmp_path)

    kept = json.loads(open(out["qa"]["ref"], encoding="utf-8").read())
    assert kept == []
    assert out["qa"]["meta"]["count"] == 0
    assert out["qa"]["meta"]["n_sources"] == 0
    assert out["qa"]["meta"]["per_source_counts"] == []
