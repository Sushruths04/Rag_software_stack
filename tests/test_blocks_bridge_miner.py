"""TDD: rag_gt.blocks.bridge_miner wraps rag_gt.graph.bridge_index.
build_bridge_index + rag_gt.graph.bridge_linker.build_bridge_pairs
verbatim -- the deterministic ($0), no-LLM bridge-mining logic (TODO.md
§3/§8), NOT rag_gt.allpdf.pipeline._build_graph's LLM-based TypedSFG
classifier. Direct unit coverage of build_bridge_index/build_bridge_pairs
already lives in tests/test_bridge_index.py and tests/test_bridge_linker.py
(genuine-pair-kept / duplicate-dropped / cross-page-only assertions); this
file adds only the thin block-adapter (artifact in/out + meta shape)
coverage on top, following the pattern in
tests/test_blocks_facts_bridges_import.py.
"""
from __future__ import annotations

import json

from rag_gt.blocks.bridge_miner import run


def _genuine_pair_facts():
    """Two facts on different pages sharing the salient phrase 'essential
    variable' -- a genuine cross-page bridge (mirrors test_bridge_linker.py's
    fixture)."""
    return [
        {"doc": "d", "id": "d_F1", "text": "The preheating temperature is an essential variable.", "page": 13},
        {"doc": "d", "id": "d_F2", "text": "A change in an essential variable beyond its qualified range requires requalification.", "page": 16},
    ]


def _no_bridge_facts():
    """Facts that share nothing salient (and/or sit on the same page) --
    no cross-page bridge group can form."""
    return [
        {"doc": "d", "id": "d_F1", "text": "Short unrelated statement one.", "page": 1},
        {"doc": "d", "id": "d_F2", "text": "Totally different content here.", "page": 1},
    ]


def test_bridge_miner_produces_verified_pair(tmp_path):
    facts = _genuine_pair_facts()
    facts_ref = tmp_path / "facts.json"
    facts_ref.write_text(json.dumps(facts), encoding="utf-8")
    facts_artifact = {"type": "facts", "ref": str(facts_ref), "meta": {"count": len(facts)}}

    out = run({"facts": facts_artifact}, {}, artifacts_dir=tmp_path)

    assert set(out.keys()) == {"bridges"}
    artifact = out["bridges"]
    assert artifact["type"] == "bridges"

    pairs = json.loads(open(artifact["ref"], encoding="utf-8").read())
    assert len(pairs) == 1
    pair = pairs[0]
    assert {pair["fact_a"], pair["fact_b"]} == {"d_F1", "d_F2"}
    assert pair["bridge_entity"]
    assert pair["bridge_norm"]
    assert pair["bridge_type"] in {"TERM", "STANDARD_REF"}
    assert sorted(pair["pages"]) == [13, 16]
    assert "content_jaccard" in pair
    assert pair["pair_id"]

    # meta folds build_bridge_pairs's own stats dict in, on top of "count".
    assert artifact["meta"]["count"] == 1
    assert artifact["meta"]["verified_pairs"] == 1
    assert "candidate_pairs" in artifact["meta"]
    assert "dropped_bridge_missing" in artifact["meta"]
    assert "dropped_duplicate" in artifact["meta"]


def test_bridge_miner_no_bridges_found_returns_empty_list(tmp_path):
    facts = _no_bridge_facts()
    facts_ref = tmp_path / "facts.json"
    facts_ref.write_text(json.dumps(facts), encoding="utf-8")
    facts_artifact = {"type": "facts", "ref": str(facts_ref), "meta": {"count": len(facts)}}

    out = run({"facts": facts_artifact}, {}, artifacts_dir=tmp_path)

    artifact = out["bridges"]
    pairs = json.loads(open(artifact["ref"], encoding="utf-8").read())
    assert pairs == []
    assert artifact["meta"]["count"] == 0
    assert artifact["meta"]["verified_pairs"] == 0


def test_bridge_miner_max_pages_param_passthrough(tmp_path):
    """params["max_pages"] is forwarded to build_bridge_index; a max_pages
    of 1 forbids the >=2-distinct-pages requirement bridge_index itself
    enforces, so no bridge group -- and therefore no pair -- can form."""
    facts = _genuine_pair_facts()
    facts_ref = tmp_path / "facts.json"
    facts_ref.write_text(json.dumps(facts), encoding="utf-8")
    facts_artifact = {"type": "facts", "ref": str(facts_ref), "meta": {"count": len(facts)}}

    out = run({"facts": facts_artifact}, {"max_pages": 1}, artifacts_dir=tmp_path)

    pairs = json.loads(open(out["bridges"]["ref"], encoding="utf-8").read())
    assert pairs == []
