"""Tests for compile_graph: type-mismatch wires, cycles, unknown params,
structural lints (05_BLOCK_CATALOG.md §5), cost roll-up, and a full valid
pipeline graph.
"""

import pytest

from studio.backend.compiler import GraphError, CompiledPlan, compile_graph


def _block(id_, type_, params=None, x=0, y=0):
    return {"id": id_, "type": type_, "position": {"x": x, "y": y}, "params": params or {}}


def _wire(id_, from_block, from_port, to_block, to_port):
    return {
        "id": id_,
        "from": {"block": from_block, "port": from_port},
        "to": {"block": to_block, "port": to_port},
    }


def test_unknown_block_type_is_an_error():
    graph = {
        "schema_version": 1,
        "blocks": [_block("b1", "not_a_real_block_type")],
        "wires": [],
    }
    result = compile_graph(graph)
    assert isinstance(result, list)
    codes = {e.code for e in result}
    assert "unknown_block_type" in codes
    assert result[0].block_id == "b1"


def test_unknown_param_is_an_error():
    graph = {
        "schema_version": 1,
        "blocks": [_block("b1", "neighbor_sampler", params={"window": 3, "not_a_real_param": True})],
        "wires": [],
    }
    result = compile_graph(graph)
    assert isinstance(result, list)
    codes = {e.code for e in result}
    assert "invalid_params" in codes
    err = next(e for e in result if e.code == "invalid_params")
    assert err.block_id == "b1"


def test_wire_type_mismatch_is_an_error():
    graph = {
        "schema_version": 1,
        "blocks": [
            _block("b1", "facts_import", params={"path": "x.json"}),
            _block("b2", "chunker"),
        ],
        "wires": [_wire("w1", "b1", "facts", "b2", "chunks")],
    }
    result = compile_graph(graph)
    assert isinstance(result, list)
    codes = {e.code for e in result}
    assert "wire_type_mismatch" in codes
    err = next(e for e in result if e.code == "wire_type_mismatch")
    assert err.wire_id == "w1"


def test_cycle_is_detected():
    graph = {
        "schema_version": 1,
        "blocks": [
            _block("b1", "gate_clause"),
            _block("b2", "gate_joint"),
        ],
        "wires": [
            _wire("w1", "b1", "qa", "b2", "qa"),
            _wire("w2", "b2", "qa", "b1", "qa"),
        ],
    }
    result = compile_graph(graph)
    assert isinstance(result, list)
    codes = {e.code for e in result}
    assert "cycle_detected" in codes


def test_multi_in_violation_is_an_error():
    graph = {
        "schema_version": 1,
        "blocks": [
            _block("b1", "gate_clause"),
            _block("b2", "gate_joint"),
            _block("b3", "gate_loo"),
        ],
        "wires": [
            _wire("w1", "b1", "qa", "b3", "qa"),
            _wire("w2", "b2", "qa", "b3", "qa"),
        ],
    }
    result = compile_graph(graph)
    assert isinstance(result, list)
    codes = {e.code for e in result}
    assert "multi_in_not_allowed" in codes


def test_unknown_wire_endpoint_block_is_an_error():
    graph = {
        "schema_version": 1,
        "blocks": [_block("b1", "gate_clause")],
        "wires": [_wire("w1", "b1", "qa", "does_not_exist", "qa")],
    }
    result = compile_graph(graph)
    assert isinstance(result, list)
    codes = {e.code for e in result}
    assert "unknown_wire_endpoint" in codes


def test_unknown_wire_endpoint_port_is_an_error():
    graph = {
        "schema_version": 1,
        "blocks": [
            _block("b1", "gate_clause"),
            _block("b2", "gate_joint"),
        ],
        "wires": [_wire("w1", "b1", "not_a_real_port", "b2", "qa")],
    }
    result = compile_graph(graph)
    assert isinstance(result, list)
    codes = {e.code for e in result}
    assert "unknown_port" in codes


def test_locked_param_override_without_expert_mode_is_an_error():
    graph = {
        "schema_version": 1,
        "blocks": [_block("b1", "gate_clause", params={"threshold": 0.3})],
        "wires": [],
    }
    result = compile_graph(graph)
    assert isinstance(result, list)
    codes = {e.code for e in result}
    assert "locked_param_override" in codes


def test_locked_param_override_allowed_in_expert_mode():
    graph = {
        "schema_version": 1,
        "blocks": [_block("b1", "gate_clause", params={"threshold": 0.3})],
        "wires": [],
        "meta": {"expert_mode": True},
    }
    result = compile_graph(graph)
    # still "not runnable" (no qa/eval/report sink reachable beyond the gate
    # itself, which does count) but must NOT contain locked_param_override
    if isinstance(result, list):
        codes = {e.code for e in result}
        assert "locked_param_override" not in codes


def test_missing_grounding_gate_lint_warns_with_autofix():
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
    result = compile_graph(graph)
    assert isinstance(result, CompiledPlan), result
    assert any(w.code == "missing_grounding_gate" for w in result.warnings)
    warning = next(w for w in result.warnings if w.code == "missing_grounding_gate")
    assert warning.severity == "warning"
    assert warning.autofix is not None
    assert warning.autofix.get("block_type") == "gate_grounding"


def test_graph_with_grounding_gate_has_no_lint_warning():
    graph = {
        "schema_version": 1,
        "blocks": [
            _block("b1", "facts_import", params={"path": "x.json"}),
            _block("b2", "neighbor_sampler"),
            _block("b3", "qa_gen_pairs"),
            _block("b5", "gate_grounding"),
            _block("b4", "assembler"),
        ],
        "wires": [
            _wire("w1", "b1", "facts", "b2", "facts"),
            _wire("w2", "b2", "candidates", "b3", "candidates"),
            _wire("w3", "b1", "facts", "b3", "facts"),
            _wire("w4", "b3", "qa", "b5", "qa"),
            _wire("w5", "b5", "qa", "b4", "qa"),
        ],
    }
    result = compile_graph(graph)
    assert isinstance(result, CompiledPlan), result
    assert not any(w.code == "missing_grounding_gate" for w in result.warnings)


def test_graph_not_runnable_when_no_qa_eval_report_sink():
    graph = {
        "schema_version": 1,
        "blocks": [_block("b1", "facts_import", params={"path": "x.json"})],
        "wires": [],
    }
    result = compile_graph(graph)
    assert isinstance(result, list)
    codes = {e.code for e in result}
    assert "graph_not_runnable" in codes


def test_graph_runnable_with_candidates_sink_from_neighbor_sampler():
    # Mining/sampling graphs (e.g. the "sample-b" and "neighbor-sampling-*"
    # templates) stop at a "candidates" output on purpose -- the product's
    # whole point for these is to produce candidate pairs for
    # inspection/export, not to continue on to qa/eval/report. This must be
    # accepted as runnable.
    graph = {
        "schema_version": 1,
        "blocks": [
            _block("b1", "facts_import", params={"path": "x.json"}),
            _block("b2", "neighbor_sampler"),
        ],
        "wires": [_wire("w1", "b1", "facts", "b2", "facts")],
    }
    result = compile_graph(graph)
    assert isinstance(result, CompiledPlan), result


def test_graph_runnable_with_candidates_sink_from_cluster_builder():
    graph = {
        "schema_version": 1,
        "blocks": [
            _block("b1", "bridges_import", params={"path": "x.json"}),
            _block("b2", "facts_import", params={"path": "y.json"}),
            _block("b3", "cluster_builder"),
        ],
        "wires": [
            _wire("w1", "b1", "bridges", "b3", "bridges"),
            _wire("w2", "b2", "facts", "b3", "facts"),
        ],
    }
    result = compile_graph(graph)
    assert isinstance(result, CompiledPlan), result


def test_graph_runnable_with_bare_chunks_import():
    # "inspect-chunks-only": a single chunks_import block with zero wires,
    # whose whole purpose is browsing raw chunks in the Dataset Inspector.
    # This mirrors how a bare qa_import already passes today (its "qa" port
    # type is terminal) -- chunks browsing is an equally legitimate,
    # explicitly product-supported "Import & Inspect" use case and should be
    # treated the same way.
    graph = {
        "schema_version": 1,
        "blocks": [_block("b1", "chunks_import", params={"path": "x.json"})],
        "wires": [],
    }
    result = compile_graph(graph)
    assert isinstance(result, CompiledPlan), result


def test_graph_still_not_runnable_with_bare_bridges_import():
    # Unlike chunks/qa, a lone facts_import (or bridges_import) is not a
    # shipped "browse this" product surface today -- no template ships a
    # bare facts-only or bridges-only inspect graph, so this stays rejected.
    # (This is the same assertion as
    # test_graph_not_runnable_when_no_qa_eval_report_sink; kept here under an
    # explicit name to make clear the boundary is intentional, not an
    # oversight.)
    graph = {
        "schema_version": 1,
        "blocks": [_block("b1", "bridges_import", params={"path": "x.json"})],
        "wires": [],
    }
    result = compile_graph(graph)
    assert isinstance(result, list)
    codes = {e.code for e in result}
    assert "graph_not_runnable" in codes


def test_valid_full_pipeline_compiles_with_execution_order_and_cost_rollup():
    graph = {
        "schema_version": 1,
        "name": "free-spine + one paid block",
        "blocks": [
            _block("b1", "facts_import", params={"path": "facts.json"}),
            _block("b2", "chunks_import", params={"path": "chunks.json"}),
            _block("b3", "neighbor_sampler"),
            _block("b4", "qa_gen_pairs"),
            _block("b5", "gate_grounding"),
            _block("b6", "assembler"),
            _block("b7", "index_builder"),
            _block("b8", "evaluator"),
            _block("b9", "report"),
        ],
        "wires": [
            _wire("w1", "b1", "facts", "b3", "facts"),
            _wire("w2", "b3", "candidates", "b4", "candidates"),
            _wire("w3", "b1", "facts", "b4", "facts"),
            _wire("w4", "b4", "qa", "b5", "qa"),
            _wire("w5", "b5", "qa", "b6", "qa"),
            _wire("w6", "b2", "chunks", "b7", "chunks"),
            _wire("w7", "b6", "qa", "b8", "qa"),
            _wire("w8", "b7", "index", "b8", "index"),
            _wire("w9", "b1", "facts", "b8", "facts"),
            _wire("w10", "b8", "eval", "b9", "eval"),
        ],
    }
    result = compile_graph(graph)
    assert isinstance(result, CompiledPlan), result

    order = result.order
    # topological constraints
    assert order.index("b1") < order.index("b3")
    assert order.index("b3") < order.index("b4")
    assert order.index("b4") < order.index("b5")
    assert order.index("b5") < order.index("b6")
    assert order.index("b6") < order.index("b8")
    assert order.index("b7") < order.index("b8")
    assert order.index("b8") < order.index("b9")
    assert set(order) == {f"b{i}" for i in range(1, 10)}

    # cost roll-up: only b4 (qa_gen_pairs) is paid
    assert result.cost.total_calls > 0
    paid_ids = {p["block_id"] for p in result.cost.paid_blocks}
    assert paid_ids == {"b4"}

    # no structural lint warnings: gate_grounding sits before assembler
    assert not any(w.code == "missing_grounding_gate" for w in result.warnings)

    # input wiring resolved onto each node
    assert result.nodes["b6"].input_wiring["qa"] == [("b5", "qa")]
    assert set(result.nodes["b4"].input_wiring["facts"]) == {("b1", "facts")}
