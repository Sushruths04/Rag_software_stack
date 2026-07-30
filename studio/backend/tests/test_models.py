"""Tests for the Graph file schema (schema_version 1).

Mirrors the example in 02_PHASE2_APP_PLAN.md "Graph file schema" section:
blocks[] (id/type/position/params), wires[] (id/from{block,port}/to{block,port}),
meta{created,modified,notes}.
"""

import pytest
from pydantic import ValidationError

from studio.backend.models import Graph


SAMPLE_GRAPH = {
    "schema_version": 1,
    "name": "din_iso_6507 multi-hop GT",
    "blocks": [
        {
            "id": "b1",
            "type": "facts_import",
            "position": {"x": 80, "y": 120},
            "params": {
                "path": "data/eval_results/facts_v1_grounded/facts_din_iso_6507_vickers_full.json"
            },
        },
        {
            "id": "b2",
            "type": "neighbor_sampler",
            "position": {"x": 360, "y": 80},
            "params": {
                "window": 3,
                "min_cosine": 0.4,
                "max_cosine": 0.95,
                "max_uses_per_fact": 2,
            },
        },
    ],
    "wires": [
        {
            "id": "w1",
            "from": {"block": "b1", "port": "facts"},
            "to": {"block": "b2", "port": "facts"},
        }
    ],
    "meta": {"created": "2026-07-01T00:00:00Z", "modified": "", "notes": ""},
}


def test_parses_plan_example_graph():
    g = Graph.model_validate(SAMPLE_GRAPH)
    assert g.schema_version == 1
    assert g.name == "din_iso_6507 multi-hop GT"
    assert len(g.blocks) == 2
    assert g.blocks[0].id == "b1"
    assert g.blocks[0].type == "facts_import"
    assert g.blocks[0].position.x == 80
    assert g.blocks[1].params["window"] == 3
    assert len(g.wires) == 1
    assert g.wires[0].from_.block == "b1"
    assert g.wires[0].from_.port == "facts"
    assert g.wires[0].to.block == "b2"
    assert g.wires[0].to.port == "facts"


def test_round_trips_from_alias_on_dump():
    g = Graph.model_validate(SAMPLE_GRAPH)
    dumped = g.model_dump(by_alias=True)
    assert dumped["wires"][0]["from"] == {"block": "b1", "port": "facts"}
    # re-parse the dump to prove it's stable
    g2 = Graph.model_validate(dumped)
    assert g2 == g


def test_defaults_when_optional_fields_missing():
    minimal = {"schema_version": 1, "blocks": [], "wires": []}
    g = Graph.model_validate(minimal)
    assert g.name == ""
    assert g.blocks == []
    assert g.wires == []
    assert g.meta.notes == ""


def test_rejects_unknown_top_level_field():
    bad = dict(SAMPLE_GRAPH)
    bad["bogus_field"] = 1
    with pytest.raises(ValidationError):
        Graph.model_validate(bad)


def test_rejects_block_missing_required_id():
    bad = {
        "schema_version": 1,
        "blocks": [{"type": "facts_import", "position": {"x": 0, "y": 0}, "params": {}}],
        "wires": [],
    }
    with pytest.raises(ValidationError):
        Graph.model_validate(bad)


def test_block_params_default_to_empty_dict():
    g = Graph.model_validate(
        {
            "schema_version": 1,
            "blocks": [{"id": "b1", "type": "note", "position": {"x": 0, "y": 0}}],
            "wires": [],
        }
    )
    assert g.blocks[0].params == {}
