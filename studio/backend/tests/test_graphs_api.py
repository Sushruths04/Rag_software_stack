"""Tests for graph persistence endpoints: POST/GET /api/graphs, GET /api/graphs/{id}.

Uses a ``tmp_path``-backed dependency override so these tests never touch
the real ``studio/backend/data/graphs/`` directory (see ``get_graphs_dir``
in ``studio.backend.api``).
"""

import pytest
from fastapi.testclient import TestClient

from studio.backend.api import app, get_graphs_dir

client = TestClient(app)


@pytest.fixture
def graphs_dir(tmp_path):
    directory = tmp_path / "graphs"
    app.dependency_overrides[get_graphs_dir] = lambda: directory
    yield directory
    app.dependency_overrides.pop(get_graphs_dir, None)


def _graph(name="my graph"):
    return {
        "schema_version": 1,
        "name": name,
        "blocks": [
            {"id": "b1", "type": "facts_import", "position": {"x": 10, "y": 20}, "params": {"path": "x.json"}},
            {"id": "b2", "type": "neighbor_sampler", "position": {"x": 300, "y": 20}, "params": {}},
        ],
        "wires": [
            {"id": "w1", "from": {"block": "b1", "port": "facts"}, "to": {"block": "b2", "port": "facts"}},
        ],
        "meta": {"created": "2026-07-01T00:00:00Z", "modified": "2026-07-01T00:00:00Z", "notes": "test graph"},
    }


def test_save_graph_returns_id_and_graph(graphs_dir):
    resp = client.post("/api/graphs", json=_graph())
    assert resp.status_code == 200
    body = resp.json()
    assert "id" in body and body["id"]
    assert body["graph"]["name"] == "my graph"
    assert body["graph"]["blocks"][0]["type"] == "facts_import"
    # persisted to disk under the overridden directory
    assert (graphs_dir / f"{body['id']}.json").exists()


def test_save_then_load_round_trips(graphs_dir):
    saved = client.post("/api/graphs", json=_graph()).json()
    graph_id = saved["id"]

    resp = client.get(f"/api/graphs/{graph_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == graph_id
    assert body["graph"] == saved["graph"]


def test_load_unknown_id_404s(graphs_dir):
    resp = client.get("/api/graphs/does-not-exist")
    assert resp.status_code == 404


def test_list_graphs_returns_saved_entries(graphs_dir):
    id1 = client.post("/api/graphs", json=_graph("graph one")).json()["id"]
    id2 = client.post("/api/graphs", json=_graph("graph two")).json()["id"]

    resp = client.get("/api/graphs")
    assert resp.status_code == 200
    body = resp.json()
    ids = {g["id"] for g in body["graphs"]}
    assert ids == {id1, id2}
    names = {g["id"]: g["name"] for g in body["graphs"]}
    assert names[id1] == "graph one"
    assert names[id2] == "graph two"
    for entry in body["graphs"]:
        assert "modified" in entry
        # list entries must not carry the full body (no blocks/wires keys)
        assert "blocks" not in entry
        assert "wires" not in entry


def test_list_graphs_empty_when_no_saves(graphs_dir):
    resp = client.get("/api/graphs")
    assert resp.status_code == 200
    assert resp.json() == {"graphs": []}


def test_save_graph_does_not_touch_real_data_dir(graphs_dir, monkeypatch):
    """Guard against accidentally writing to the real data/graphs dir if the
    dependency override were ever bypassed."""
    from studio.backend import graph_store

    client.post("/api/graphs", json=_graph())
    assert not graph_store.DEFAULT_GRAPHS_DIR.exists() or list(graph_store.DEFAULT_GRAPHS_DIR.glob("*.json")) == []
