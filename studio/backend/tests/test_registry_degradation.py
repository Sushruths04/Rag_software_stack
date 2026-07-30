"""Packaged-build behavior: a runtime without the rag_gt engine stack
(torch/spacy/...) must still serve every endpoint. ``use_stubs=false`` — the
frontend Run button's default — degrades to the stub registry with a logged
warning instead of raising ImportError into a 500.
"""

import sys

from studio.backend.registry import REGISTRY, build_registry


def test_build_registry_degrades_to_stubs_when_live_adapters_cannot_import(monkeypatch):
    # a sys.modules entry of None makes `from studio.backend.adapters_live
    # import ...` raise ImportError — the exact failure mode of a packaged
    # runtime that ships without the ML engine dependencies
    monkeypatch.delitem(sys.modules, "studio.backend.adapters_live", raising=False)
    monkeypatch.setitem(sys.modules, "studio.backend.adapters_live", None)

    registry = build_registry(use_stubs=False)

    assert set(registry) == set(REGISTRY)
    # every entry is the stub spec (run callables identical to the stub table)
    assert all(registry[t].run is REGISTRY[t].run for t in registry)


def test_run_endpoint_still_works_when_live_adapters_cannot_import(monkeypatch):
    from fastapi.testclient import TestClient

    from studio.backend.api import app

    monkeypatch.delitem(sys.modules, "studio.backend.adapters_live", raising=False)
    monkeypatch.setitem(sys.modules, "studio.backend.adapters_live", None)

    client = TestClient(app)
    # minimal RUNNABLE free graph (the compiler requires a qa/eval/report
    # producer): qa_import alone produces a qa artifact
    graph = {
        "schema_version": 1,
        "name": "stub-only",
        "blocks": [
            {"id": "b1", "type": "qa_import", "position": {"x": 0, "y": 0}, "params": {"path": "qa.json"}},
        ],
        "wires": [],
    }
    resp = client.post("/api/graphs/run?use_stubs=false", json=graph)
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
