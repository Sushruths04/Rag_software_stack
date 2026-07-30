"""Per-call $ pricing on the cost estimators (roadmap housekeeping item).

The CostConfirmSheet renders a $ column and total as soon as every estimated
block reports a real ``usd`` figure; until now every estimator returned
``usd=None`` (call counts only). These tests pin the pricing behaviour:

- known chat model (from RAG_LLM_CHAT_MODEL) -> real usd derived from the
  measured avg tokens/call of an actual run, never fabricated;
- unknown model -> usd stays None (the sheet keeps its honest fallback);
- zero-call estimates -> usd == 0.0 regardless of model;
- the API 402 payload carries the usd figures end to end.
"""

import json

import pytest

from studio.backend import stubs as S

MISTRAL = "mistralai/Mistral-Small-3.2-24B-Instruct-2506"


def _candidates(pairs: int) -> dict:
    return {"type": "candidates", "ref": "mem://c", "meta": {"pairs": pairs}}


def test_qa_gen_pairs_reports_usd_for_known_model(monkeypatch):
    monkeypatch.setenv("RAG_LLM_CHAT_MODEL", MISTRAL)
    est = S.estimate_qa_gen_pairs({"inputs": {"candidates": _candidates(100)}, "params": {}})
    assert est.calls == 130
    assert isinstance(est.usd, float)
    assert est.usd > 0.0


def test_usd_scales_linearly_with_calls(monkeypatch):
    monkeypatch.setenv("RAG_LLM_CHAT_MODEL", MISTRAL)
    small = S.estimate_qa_gen_pairs({"inputs": {"candidates": _candidates(100)}, "params": {}})
    large = S.estimate_qa_gen_pairs({"inputs": {"candidates": _candidates(200)}, "params": {}})
    assert large.usd == pytest.approx(small.usd * 2, rel=0.01)


def test_unknown_model_keeps_usd_none(monkeypatch):
    monkeypatch.setenv("RAG_LLM_CHAT_MODEL", "some/unknown-model-x99")
    est = S.estimate_qa_gen_pairs({"inputs": {"candidates": _candidates(100)}, "params": {}})
    assert est.usd is None


def test_zero_call_estimate_is_free_even_without_model(monkeypatch):
    monkeypatch.delenv("RAG_LLM_CHAT_MODEL", raising=False)
    est = S.estimate_bridge_miner({"inputs": {}, "params": {"cosine_scorer": "off"}})
    assert est.calls == 0
    assert est.usd == 0.0


def test_bridge_miner_api_scorer_stays_unpriced(monkeypatch):
    """Embedding calls have no measured token basis — usd must stay None
    (never fabricate) even when the chat model is known."""
    monkeypatch.setenv("RAG_LLM_CHAT_MODEL", MISTRAL)
    facts = {"type": "facts", "ref": "mem://f", "meta": {"count": 50}}
    est = S.estimate_bridge_miner({"inputs": {"facts": facts}, "params": {"cosine_scorer": "api"}})
    assert est.calls == 50
    assert est.usd is None


def test_all_chat_estimators_priced_for_known_model(monkeypatch):
    monkeypatch.setenv("RAG_LLM_CHAT_MODEL", MISTRAL)
    chunks = {"type": "chunks", "ref": "mem://ch", "meta": {"count": 40}}
    qa = {"type": "qa", "ref": "mem://qa", "meta": {"count": 25}}
    bridges = {"type": "bridges", "ref": "mem://b", "meta": {"count": 30}}
    clusters = {"type": "candidates", "ref": "mem://cl", "meta": {"clusters": 10}}

    for est in (
        S.estimate_fact_extract_llm({"inputs": {"chunks": chunks}, "params": {}}),
        S.estimate_qa_gen_clusters({"inputs": {"candidates": clusters}, "params": {}}),
        S.estimate_qa_gen_bridges({"inputs": {"bridges": bridges}, "params": {}}),
        S.estimate_verifier({"inputs": {"qa": qa}, "params": {}}),
    ):
        assert isinstance(est.usd, float) and est.usd > 0.0, est


def test_402_payload_carries_usd(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient

    from studio.backend.api import app
    from studio.backend.tests.test_run_endpoint import FACTS, _block, _wire

    monkeypatch.setenv("RAG_LLM_CHAT_MODEL", MISTRAL)

    facts_path = tmp_path / "facts.json"
    facts_path.write_text(json.dumps(FACTS), encoding="utf-8")
    graph = {
        "schema_version": 1,
        "name": "paid-usd",
        "blocks": [
            _block("facts_import", "facts_import", params={"path": str(facts_path)}),
            _block("neighbor_sampler", "neighbor_sampler"),
            _block(
                "qa_gen_pairs",
                "qa_gen_pairs",
                params={"doc": "din_iso_15609_welding_procedure_full", "workers": 1},
            ),
        ],
        "wires": [
            _wire("w1", "facts_import", "facts", "neighbor_sampler", "facts"),
            _wire("w2", "neighbor_sampler", "candidates", "qa_gen_pairs", "candidates"),
            _wire("w3", "facts_import", "facts", "qa_gen_pairs", "facts"),
        ],
    }

    client = TestClient(app)
    resp = client.post("/api/graphs/run?use_stubs=false", json=graph)
    assert resp.status_code == 402
    qa_estimate = next(e for e in resp.json()["estimated"] if e["block_id"] == "qa_gen_pairs")
    assert isinstance(qa_estimate["usd"], float)
    assert qa_estimate["usd"] > 0.0
