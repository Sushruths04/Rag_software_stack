"""Tests for the standalone FastAPI app: GET /api/blocks, POST /api/graphs/validate.

Uses TestClient (httpx-backed) rather than starting a real server process —
per the task rules, no long-running server should be launched here.
"""

from fastapi.testclient import TestClient

from studio.backend.api import app
from studio.backend.registry import REGISTRY

client = TestClient(app)


def _block(id_, type_, params=None, x=0, y=0):
    return {"id": id_, "type": type_, "position": {"x": x, "y": y}, "params": params or {}}


def _wire(id_, from_block, from_port, to_block, to_port):
    return {
        "id": id_,
        "from": {"block": from_block, "port": from_port},
        "to": {"block": to_block, "port": to_port},
    }


def test_health_returns_ok():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_get_blocks_returns_all_registry_entries():
    resp = client.get("/api/blocks")
    assert resp.status_code == 200
    body = resp.json()
    assert "blocks" in body
    types = {b["type"] for b in body["blocks"]}
    assert types == set(REGISTRY.keys())
    assert len(body["blocks"]) == 33


def test_get_blocks_entry_has_ports_cost_category_and_json_schema():
    resp = client.get("/api/blocks")
    body = resp.json()
    entry = next(b for b in body["blocks"] if b["type"] == "neighbor_sampler")
    assert entry["category"] == "mining"
    assert entry["cost"] == "free"
    assert entry["inputs"] == [{"name": "facts", "type": "facts", "multi": False, "required": True}]
    assert entry["outputs"] == [{"name": "candidates", "type": "candidates", "multi": False, "required": True}]
    schema = entry["params_schema"]
    assert schema["properties"]["window"]["default"] == 3
    assert entry["estimate"] is False


def test_get_blocks_marks_locked_params_and_paid_estimate():
    resp = client.get("/api/blocks")
    body = resp.json()
    gate = next(b for b in body["blocks"] if b["type"] == "gate_clause")
    assert gate["locked_params"] == ["threshold"]

    paid = next(b for b in body["blocks"] if b["type"] == "qa_gen_pairs")
    assert paid["cost"] == "paid"
    assert paid["estimate"] is True


def test_validate_valid_graph_returns_order_and_cost():
    graph = {
        "schema_version": 1,
        "blocks": [
            _block("b1", "facts_import", params={"path": "facts.json"}),
            _block("b2", "neighbor_sampler"),
            _block("b3", "qa_gen_pairs"),
            _block("b4", "gate_grounding"),
            _block("b5", "assembler"),
        ],
        "wires": [
            _wire("w1", "b1", "facts", "b2", "facts"),
            _wire("w2", "b2", "candidates", "b3", "candidates"),
            _wire("w3", "b1", "facts", "b3", "facts"),
            _wire("w4", "b3", "qa", "b4", "qa"),
            _wire("w5", "b4", "qa", "b5", "qa"),
        ],
    }
    resp = client.post("/api/graphs/validate", json=graph)
    assert resp.status_code == 200
    body = resp.json()
    assert body["valid"] is True
    assert body["order"] == ["b1", "b2", "b3", "b4", "b5"]
    assert body["cost"]["total_calls"] > 0
    assert body["errors"] == []


def test_validate_type_mismatch_wire_returns_errors():
    graph = {
        "schema_version": 1,
        "blocks": [
            _block("b1", "facts_import", params={"path": "x.json"}),
            _block("b2", "chunker"),
        ],
        "wires": [_wire("w1", "b1", "facts", "b2", "chunks")],
    }
    resp = client.post("/api/graphs/validate", json=graph)
    assert resp.status_code == 200
    body = resp.json()
    assert body["valid"] is False
    codes = {e["code"] for e in body["errors"]}
    assert "wire_type_mismatch" in codes


def test_validate_cycle_returns_error():
    graph = {
        "schema_version": 1,
        "blocks": [_block("b1", "gate_clause"), _block("b2", "gate_joint")],
        "wires": [
            _wire("w1", "b1", "qa", "b2", "qa"),
            _wire("w2", "b2", "qa", "b1", "qa"),
        ],
    }
    resp = client.post("/api/graphs/validate", json=graph)
    body = resp.json()
    assert body["valid"] is False
    assert any(e["code"] == "cycle_detected" for e in body["errors"])


def test_validate_unknown_param_returns_error():
    graph = {
        "schema_version": 1,
        "blocks": [_block("b1", "neighbor_sampler", params={"bogus": 1})],
        "wires": [],
    }
    resp = client.post("/api/graphs/validate", json=graph)
    body = resp.json()
    assert body["valid"] is False
    assert any(e["code"] == "invalid_params" for e in body["errors"])


def test_validate_missing_grounding_gate_returns_warning_but_valid():
    graph = {
        "schema_version": 1,
        "blocks": [
            _block("b1", "facts_import", params={"path": "x.json"}),
            _block("b2", "neighbor_sampler"),
            _block("b3", "qa_gen_pairs"),
            _block("b4", "assembler"),
        ],
        "wires": [
            _wire("w1", "b1", "facts", "b2", "facts"),
            _wire("w2", "b2", "candidates", "b3", "candidates"),
            _wire("w3", "b1", "facts", "b3", "facts"),
            _wire("w4", "b3", "qa", "b4", "qa"),
        ],
    }
    resp = client.post("/api/graphs/validate", json=graph)
    body = resp.json()
    assert body["valid"] is True
    assert any(w["code"] == "missing_grounding_gate" for w in body["warnings"])
