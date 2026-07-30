"""Tests for the block registry: PortSpec, BlockSpec, REGISTRY.

Covers 05_BLOCK_CATALOG.md §3 (33 blocks) at the contract level: every block
has typed ports drawn from the §1 type system, a free|paid cost class, a
Pydantic params model, and a stub run(inputs, params) -> dict callable with
the correct signature that returns typed fake artifacts without importing
rag_gt.
"""

import inspect

import pytest
from pydantic import BaseModel, ValidationError

from studio.backend.registry import REGISTRY, PortSpec, BlockSpec

PORT_TYPES = {
    "pdf",
    "chunks",
    "facts",
    "bridges",
    "candidates",
    "qa",
    "index",
    "eval",
    "report",
}

EXPECTED_BLOCK_TYPES = {
    "pdf_source",
    "chunks_import",
    "facts_import",
    "bridges_import",
    "qa_import",
    "chunker",
    "fact_extract_llm",
    "fact_debris_filter",
    "fact_splitter",
    "provenance_join",
    "bridge_miner",
    "bridge_quality",
    "neighbor_sampler",
    "cluster_builder",
    "qa_gen_pairs",
    "qa_gen_clusters",
    "qa_gen_bridges",
    "demotion",
    "gate_clause",
    "gate_joint",
    "gate_loo",
    "gate_grounding",
    "gate_leak",
    "gate_dedup",
    "assembler",
    "verifier",
    "index_builder",
    "evaluator",
    "sweep",
    "report",
    "bbox_viewer",
    "note",
    "cost_probe",
}

PAID_BLOCK_TYPES = {"fact_extract_llm", "qa_gen_pairs", "qa_gen_clusters", "qa_gen_bridges", "verifier"}

GATE_BLOCK_TYPES = {
    "gate_clause",
    "gate_joint",
    "gate_loo",
    "gate_grounding",
    "gate_leak",
    "gate_dedup",
}


def test_registry_has_all_33_catalog_blocks():
    assert set(REGISTRY.keys()) == EXPECTED_BLOCK_TYPES
    assert len(REGISTRY) == 33


@pytest.mark.parametrize("block_type", sorted(EXPECTED_BLOCK_TYPES))
def test_every_block_is_a_well_formed_blockspec(block_type):
    spec = REGISTRY[block_type]
    assert isinstance(spec, BlockSpec)
    assert spec.type == block_type
    assert spec.cost in ("free", "paid")
    assert isinstance(spec.category, str) and spec.category
    for port in (*spec.inputs, *spec.outputs):
        assert isinstance(port, PortSpec)
        assert port.type in PORT_TYPES
    assert inspect.isclass(spec.params) and issubclass(spec.params, BaseModel)
    assert callable(spec.run)
    sig = inspect.signature(spec.run)
    assert list(sig.parameters) == ["inputs", "params"]


def test_paid_blocks_match_catalog():
    paid = {t for t, s in REGISTRY.items() if s.cost == "paid"}
    assert paid == PAID_BLOCK_TYPES


def test_gates_are_free_and_qa_to_qa():
    for t in GATE_BLOCK_TYPES:
        spec = REGISTRY[t]
        assert spec.cost == "free"
        assert [p.type for p in spec.inputs] == ["qa"]
        assert [p.type for p in spec.outputs] == ["qa"]


def test_sources_have_no_inputs():
    for t in ("pdf_source", "chunks_import", "facts_import", "bridges_import", "qa_import"):
        assert REGISTRY[t].inputs == ()


def test_params_model_rejects_unknown_field():
    spec = REGISTRY["neighbor_sampler"]
    with pytest.raises(ValidationError):
        spec.params.model_validate({"window": 3, "not_a_real_param": True})


def test_params_model_has_expected_defaults_for_neighbor_sampler():
    spec = REGISTRY["neighbor_sampler"]
    p = spec.params.model_validate({})
    assert p.window == 3
    assert p.min_cosine == 0.40
    assert p.max_cosine == 0.95
    assert p.max_uses_per_fact == 2


def test_locked_threshold_param_on_gate_clause():
    spec = REGISTRY["gate_clause"]
    schema = spec.params.model_json_schema()
    assert schema["properties"]["threshold"]["default"] == 0.65
    assert schema["properties"]["threshold"].get("locked") is True


def test_assembler_and_report_declare_multi_in():
    assert REGISTRY["assembler"].inputs[0].multi is True
    assert REGISTRY["report"].inputs[0].multi is True
    # single-in ports elsewhere default to non-multi
    assert REGISTRY["gate_clause"].inputs[0].multi is False


def test_stub_run_returns_typed_fake_artifacts_for_facts_import():
    spec = REGISTRY["facts_import"]
    out = spec.run({}, {"path": "data/eval_results/facts_v1_grounded/facts_x.json"})
    assert set(out.keys()) == {p.name for p in spec.outputs}
    artifact = out["facts"]
    assert artifact["type"] == "facts"
    assert isinstance(artifact["ref"], str) and artifact["ref"]
    assert isinstance(artifact["meta"], dict)
    assert "count" in artifact["meta"]


def test_stub_run_is_deterministic_given_same_inputs_and_params():
    spec = REGISTRY["neighbor_sampler"]
    facts_artifact = {"type": "facts", "ref": "stub:facts_import:x", "meta": {"count": 40}}
    out1 = spec.run({"facts": facts_artifact}, {"window": 3})
    out2 = spec.run({"facts": facts_artifact}, {"window": 3})
    assert out1 == out2


def test_stub_run_never_imports_rag_gt():
    import studio.backend.stubs as stubs_module
    import sys

    assert "rag_gt" not in sys.modules or all(
        "rag_gt" not in (getattr(v, "__module__", "") or "") for v in vars(stubs_module).values()
    )
    src = inspect.getsource(stubs_module)
    assert "import rag_gt" not in src
    assert "from rag_gt" not in src


def test_bridge_miner_has_conditional_estimate_and_default_free_cost():
    spec = REGISTRY["bridge_miner"]
    assert spec.cost == "free"
    assert spec.estimate is not None
    facts_artifact = {"type": "facts", "ref": "stub", "meta": {"count": 100}}
    off = spec.estimate({"inputs": {"facts": facts_artifact}, "params": {"cosine_scorer": "off"}})
    api = spec.estimate({"inputs": {"facts": facts_artifact}, "params": {"cosine_scorer": "api"}})
    assert off.calls == 0
    assert api.calls > 0


@pytest.mark.parametrize("block_type", sorted(PAID_BLOCK_TYPES))
def test_paid_blocks_have_estimate_callables(block_type):
    assert REGISTRY[block_type].estimate is not None
