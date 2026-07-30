"""Tests for the executor: topo-order stub execution, per-block status
events, and the content-addressed cache (skip unchanged blocks, re-run only
downstream of an edited block).
"""

import pytest

from studio.backend.compiler import compile_graph, CompiledPlan
from studio.backend.executor import Executor, BlockEvent


def _block(id_, type_, params=None, x=0, y=0):
    return {"id": id_, "type": type_, "position": {"x": x, "y": y}, "params": params or {}}


def _wire(id_, from_block, from_port, to_block, to_port):
    return {
        "id": id_,
        "from": {"block": from_block, "port": from_port},
        "to": {"block": to_block, "port": to_port},
    }


def _pipeline_graph(neighbor_window=3):
    return {
        "schema_version": 1,
        "blocks": [
            _block("b1", "facts_import", params={"path": "facts.json"}),
            _block("b2", "neighbor_sampler", params={"window": neighbor_window}),
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


def _compiled(neighbor_window=3) -> CompiledPlan:
    result = compile_graph(_pipeline_graph(neighbor_window))
    assert isinstance(result, CompiledPlan), result
    return result


def test_runs_blocks_in_topological_order_and_produces_artifacts():
    plan = _compiled()
    executor = Executor(plan)
    artifacts = executor.run()

    assert list(artifacts.keys()) == plan.order
    assert artifacts["b1"]["facts"]["type"] == "facts"
    assert artifacts["b5"]["qa"]["type"] == "qa"


def test_emits_started_and_finished_events_for_every_block_on_first_run():
    plan = _compiled()
    executor = Executor(plan)
    executor.run()

    started = [e.block_id for e in executor.events if e.type == "block_started"]
    finished = [e.block_id for e in executor.events if e.type == "block_finished"]
    assert started == plan.order
    assert finished == plan.order
    # started strictly precedes finished for each block, and events overall
    # respect topological order
    assert [e.block_id for e in executor.events if e.type in ("block_started", "block_finished")] == [
        b for b in plan.order for _ in range(2)
    ]


def test_block_finished_events_carry_elapsed_seconds():
    """Per-block wall-clock timing is the run's observability backbone: the
    UI's timeline and the run record's stage breakdown both read it from the
    ``block_finished`` payload."""
    plan = _compiled()
    executor = Executor(plan)
    executor.run()

    finished = [e for e in executor.events if e.type == "block_finished"]
    assert finished, "expected at least one finished event"
    for event in finished:
        elapsed = event.payload.get("elapsed_sec")
        assert isinstance(elapsed, float) and elapsed >= 0.0


def test_failed_block_event_also_carries_elapsed_seconds():
    import dataclasses

    plan = _compiled()
    b3 = plan.nodes["b3"]

    def _boom(inputs, params):
        raise RuntimeError("kaput")

    plan.nodes["b3"] = dataclasses.replace(b3, spec=dataclasses.replace(b3.spec, run=_boom))
    executor = Executor(plan)
    with pytest.raises(RuntimeError):
        executor.run()

    failed = [e for e in executor.events if e.type == "block_failed"]
    assert len(failed) == 1
    elapsed = failed[0].payload.get("elapsed_sec")
    assert isinstance(elapsed, float) and elapsed >= 0.0


def test_second_run_with_same_plan_and_shared_cache_is_all_cache_hits():
    plan = _compiled()
    cache: dict = {}
    Executor(plan, cache=cache).run()

    executor2 = Executor(plan, cache=cache)
    executor2.run()

    skipped = [e.block_id for e in executor2.events if e.type == "block_skipped_cache"]
    assert skipped == plan.order
    assert not any(e.type in ("block_started", "block_finished") for e in executor2.events)


def test_editing_one_block_param_reruns_only_that_block_and_downstream():
    cache: dict = {}
    plan1 = _compiled(neighbor_window=3)
    Executor(plan1, cache=cache).run()

    # simulate editing b2's "window" param and recompiling
    plan2 = _compiled(neighbor_window=7)
    executor2 = Executor(plan2, cache=cache)
    executor2.run()

    skipped = {e.block_id for e in executor2.events if e.type == "block_skipped_cache"}
    reran = {e.block_id for e in executor2.events if e.type == "block_finished"}

    # b1 (upstream of the edit, unaffected) is a cache hit
    assert "b1" in skipped
    # b2 (the edited block) and everything downstream of it must re-run
    assert reran == {"b2", "b3", "b4", "b5"}
    assert skipped.isdisjoint(reran)


def test_cache_key_depends_on_upstream_artifact_not_just_own_params():
    """A block must re-run if its resolved *input artifact* changes, even
    when its own params and type are unchanged — the cache key is
    hash(own type + own params + input artifact hashes), not just
    hash(own type + own params). Force b1 to emit a distinguishable
    artifact (simulating a different facts file being imported) and check
    that the change ripples downstream through every block whose stub
    output actually depends on the changed meta."""
    cache: dict = {}
    plan1 = _compiled(neighbor_window=3)
    Executor(plan1, cache=cache).run()

    plan2 = _compiled(neighbor_window=3)
    different_output = {
        "facts": {"type": "facts", "ref": "stub:facts_import:other", "meta": {"count": 999, "grounded": True}}
    }
    # b1 has no input ports (it's a source), so its cache key is
    # hash(type + params) alone with no artifact hashes to chain through —
    # changing only the run function (Python object identity) is invisible
    # to a content-addressed cache by design. Also bump a param so the key
    # genuinely changes and the new run function actually executes.
    plan2.nodes["b1"].params = dict(plan2.nodes["b1"].params, path="different_facts.json")
    plan2.nodes["b1"].spec = _replace_run(plan2.nodes["b1"].spec, lambda inputs, params: different_output)

    executor2 = Executor(plan2, cache=cache)
    executor2.run()

    reran = {e.block_id for e in executor2.events if e.type == "block_finished"}
    assert reran == {"b1", "b2", "b3", "b4", "b5"}


def test_block_failure_emits_failed_event_and_stops_downstream_execution():
    plan = _compiled()

    def boom(inputs, params):
        raise RuntimeError("stub blew up")

    plan.nodes["b3"].spec = _replace_run(plan.nodes["b3"].spec, boom)

    executor = Executor(plan)
    with pytest.raises(RuntimeError):
        executor.run()

    finished = [e.block_id for e in executor.events if e.type == "block_finished"]
    failed = [e.block_id for e in executor.events if e.type == "block_failed"]
    assert finished == ["b1", "b2"]
    assert failed == ["b3"]
    assert "b4" not in [e.block_id for e in executor.events]
    assert "b5" not in [e.block_id for e in executor.events]


def _replace_run(spec, new_run):
    import dataclasses

    return dataclasses.replace(spec, run=new_run)


def test_cache_key_is_a_pure_function_of_type_params_and_input_hashes():
    plan = _compiled()
    executor = Executor(plan)
    node = plan.nodes["b2"]
    key1 = executor._cache_key(node, {"facts": {"type": "facts", "ref": "x", "meta": {"count": 1}}})
    key2 = executor._cache_key(node, {"facts": {"type": "facts", "ref": "x", "meta": {"count": 1}}})
    key3 = executor._cache_key(node, {"facts": {"type": "facts", "ref": "x", "meta": {"count": 2}}})
    assert key1 == key2
    assert key1 != key3
