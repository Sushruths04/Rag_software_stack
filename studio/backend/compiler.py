"""Graph compiler: ``compile_graph(graph) -> CompiledPlan | list[GraphError]``.

Implements the validation pipeline from 02_PHASE2_APP_PLAN.md's "Compiler"
section, enforcing the rules in 05_BLOCK_CATALOG.md §5:

  1. Port-type equality on every wire; multi-in allowed only where declared.
  2. No cycles (Kahn topological sort must succeed).
  3. Cost roll-up surfaces every PAID block reachable in the plan so the
     caller (UI) can gate execution on a confirmed budget — the actual
     confirm-before-run gate is an executor/UI concern, not a static error.
  4. ``gate_grounding`` must appear between any generator and ``assembler``
     (structural lint — warning, not a hard error, with an autofix hint).
  5. Threshold params marked ``locked`` in their params model (see params.py)
     are read-only outside expert mode (``graph.meta.expert_mode``).
  6. A graph is runnable iff at least one block produces a ``qa``, ``eval``,
     ``report``, ``candidates``, or ``chunks`` output (see
     ``TERMINAL_PORT_TYPES`` for why the last two were added).

On top of the six catalog rules this also validates: unknown block types,
unknown/invalid params (extra="forbid" on every params model), unknown wire
endpoints/ports, and missing wires on a REQUIRED input port (the
``PortSpec.required`` extension — see registry.py).

Cost estimation needs propagated port meta (e.g. a paid QA generator's call
count depends on how many candidate pairs the upstream sampler produced).
Since every registered ``run`` is a pure, side-effect-free stub in this
scaffold (no real LLM/API call happens regardless of a block's declared
cost class), the roll-up step dry-runs the whole compiled plan through the
stub adapters purely to gather that meta — no cost is actually incurred.
The real (post M0-refactor) PAID adapters must preserve this contract if
they want compile-time estimates; if not, roll-up degrades to using
whatever meta is available at compile time.
"""

from __future__ import annotations

import heapq
from dataclasses import dataclass, field
from typing import Literal

from pydantic import ValidationError

from studio.backend.models import Graph
from studio.backend.registry import REGISTRY, BlockSpec

GENERATOR_BLOCK_TYPES = {"qa_gen_pairs", "qa_gen_clusters", "qa_gen_bridges"}
# Port types that make a graph a meaningful, run-worthy product surface on
# their own, even with no downstream consumer wired up:
#   - qa / eval / report: the original three (rule 6 in the catalog).
#   - candidates: neighbor_sampler / cluster_builder output. Mining/sampling
#     templates (e.g. "sample-b", "neighbor-sampling-*", "cluster-builder-*")
#     deliberately stop here -- producing candidate pairs for inspection or
#     export IS the point, not a step on the way to something else.
#   - chunks: chunks_import / chunker output. A bare chunks_import (the
#     "inspect-chunks-only" template) exists purely to browse raw chunks in
#     the Dataset Inspector. This mirrors how a bare qa_import already
#     counts as runnable via the "qa" port type -- both are "just browse
#     this data" graphs with zero further processing.
# NOTE: "facts" and "bridges" are deliberately NOT included. No shipped
# template needs a bare facts_import/bridges_import graph to be runnable
# (the "Import & Inspect" templates that browse facts/bridges always pair
# them with a qa_import, which already satisfies this check), and the
# original graph_not_runnable test asserts a bare facts_import stays
# rejected. Revisit this list if a future template needs to browse facts or
# bridges alone.
TERMINAL_PORT_TYPES = {"qa", "eval", "report", "candidates", "chunks"}


@dataclass(frozen=True)
class GraphError:
    code: str
    message: str
    severity: Literal["error", "warning"] = "error"
    block_id: str | None = None
    wire_id: str | None = None
    autofix: dict | None = None


@dataclass
class PlanNode:
    block_id: str
    type: str
    spec: BlockSpec
    params: dict
    input_wiring: dict[str, list[tuple[str, str]]] = field(default_factory=dict)


@dataclass
class CostRollup:
    total_calls: int
    paid_blocks: list[dict]


@dataclass
class CompiledPlan:
    order: list[str]
    nodes: dict[str, PlanNode]
    warnings: list[GraphError]
    cost: CostRollup


def resolve_inputs(node: PlanNode, artifacts: dict[str, dict]) -> dict:
    """Turn a PlanNode's input_wiring into the ``inputs`` dict a stub/adapter
    expects: a single artifact dict for a single-in port (``None`` if
    unwired), or a list of artifact dicts for a multi-in port. Shared by the
    compiler's cost dry-run and the executor's real run."""
    resolved: dict = {}
    for port in node.spec.inputs:
        sources = node.input_wiring.get(port.name, [])
        values = [
            artifacts[from_block][from_port]
            for from_block, from_port in sources
            if from_block in artifacts and from_port in artifacts[from_block]
        ]
        resolved[port.name] = values if port.multi else (values[0] if values else None)
    return resolved


def _is_locked(field_info) -> bool:
    extra = getattr(field_info, "json_schema_extra", None)
    return isinstance(extra, dict) and bool(extra.get("locked"))


def _expert_mode(graph: Graph) -> bool:
    dumped_meta = graph.meta.model_dump()
    return bool(dumped_meta.get("expert_mode", False))


def compile_graph(graph) -> "CompiledPlan | list[GraphError]":
    if isinstance(graph, Graph):
        g = graph
    else:
        try:
            g = Graph.model_validate(graph)
        except ValidationError as exc:
            return [GraphError(code="invalid_graph_schema", message=str(exc))]

    errors: list[GraphError] = []

    # --- Phase 1: blocks — unknown type, invalid/unknown params ------------
    block_by_id: dict = {}
    validated_params: dict[str, dict] = {}
    for block in g.blocks:
        if block.id in block_by_id:
            errors.append(
                GraphError(code="duplicate_block_id", message=f"duplicate block id '{block.id}'", block_id=block.id)
            )
            continue
        block_by_id[block.id] = block

        spec = REGISTRY.get(block.type)
        if spec is None:
            errors.append(
                GraphError(
                    code="unknown_block_type",
                    message=f"block '{block.id}' has unknown type '{block.type}'",
                    block_id=block.id,
                )
            )
            continue

        try:
            parsed = spec.params.model_validate(block.params)
        except ValidationError as exc:
            errors.append(
                GraphError(
                    code="invalid_params",
                    message=f"block '{block.id}' ({block.type}): {exc}",
                    block_id=block.id,
                )
            )
            continue
        validated_params[block.id] = parsed.model_dump()

    # --- Phase 2: wires — endpoints, ports, type equality, multi-in --------
    seen_wire_ids: set[str] = set()
    incoming: dict[tuple[str, str], list[tuple[str, str, str]]] = {}
    for wire in g.wires:
        if wire.id in seen_wire_ids:
            errors.append(GraphError(code="duplicate_wire_id", message=f"duplicate wire id '{wire.id}'", wire_id=wire.id))
            continue
        seen_wire_ids.add(wire.id)

        from_block = block_by_id.get(wire.from_.block)
        to_block = block_by_id.get(wire.to.block)
        if from_block is None or to_block is None:
            bad = wire.from_.block if from_block is None else wire.to.block
            errors.append(
                GraphError(
                    code="unknown_wire_endpoint",
                    message=f"wire '{wire.id}' references unknown block '{bad}'",
                    wire_id=wire.id,
                )
            )
            continue

        from_spec = REGISTRY.get(from_block.type)
        to_spec = REGISTRY.get(to_block.type)
        if from_spec is None or to_spec is None:
            continue  # already reported as unknown_block_type

        from_port = next((p for p in from_spec.outputs if p.name == wire.from_.port), None)
        to_port = next((p for p in to_spec.inputs if p.name == wire.to.port), None)
        if from_port is None or to_port is None:
            bad = wire.from_.port if from_port is None else wire.to.port
            errors.append(
                GraphError(code="unknown_port", message=f"wire '{wire.id}' references unknown port '{bad}'", wire_id=wire.id)
            )
            continue

        if from_port.type != to_port.type:
            errors.append(
                GraphError(
                    code="wire_type_mismatch",
                    message=(
                        f"wire '{wire.id}': {wire.from_.block}.{wire.from_.port} ({from_port.type}) -> "
                        f"{wire.to.block}.{wire.to.port} ({to_port.type})"
                    ),
                    wire_id=wire.id,
                )
            )
            continue

        incoming.setdefault((wire.to.block, wire.to.port), []).append(
            (wire.from_.block, wire.from_.port, wire.id)
        )

    # multi-in violations
    for (b_id, port_name), sources in incoming.items():
        spec = REGISTRY.get(block_by_id[b_id].type)
        if spec is None:
            continue
        port = next((p for p in spec.inputs if p.name == port_name), None)
        if port is not None and not port.multi and len(sources) > 1:
            for _, _, wire_id in sources[1:]:
                errors.append(
                    GraphError(
                        code="multi_in_not_allowed",
                        message=f"port '{port_name}' on block '{b_id}' does not accept multiple wires",
                        block_id=b_id,
                        wire_id=wire_id,
                    )
                )

    # required-input-missing (only for blocks that passed phase 1)
    for b_id in validated_params:
        spec = REGISTRY[block_by_id[b_id].type]
        for port in spec.inputs:
            if port.required and (b_id, port.name) not in incoming:
                errors.append(
                    GraphError(
                        code="missing_required_input",
                        message=f"required input '{port.name}' on block '{b_id}' has no wire",
                        block_id=b_id,
                    )
                )

    # locked-param overrides outside expert mode
    expert_mode = _expert_mode(g)
    for b_id in validated_params:
        spec = REGISTRY[block_by_id[b_id].type]
        for name, field_info in spec.params.model_fields.items():
            if not _is_locked(field_info):
                continue
            default = field_info.default
            value = validated_params[b_id].get(name, default)
            if value != default and not expert_mode:
                errors.append(
                    GraphError(
                        code="locked_param_override",
                        message=f"param '{name}' on block '{b_id}' is locked outside expert mode",
                        block_id=b_id,
                    )
                )

    if errors:
        return errors

    # --- Phase 3: cycle detection + topo order (Kahn, deterministic) -------
    adjacency: dict[str, list[str]] = {b_id: [] for b_id in block_by_id}
    indegree: dict[str, int] = {b_id: 0 for b_id in block_by_id}
    preds: dict[str, list[str]] = {b_id: [] for b_id in block_by_id}
    for wire in g.wires:
        adjacency[wire.from_.block].append(wire.to.block)
        indegree[wire.to.block] += 1
        preds[wire.to.block].append(wire.from_.block)

    heap = list(b_id for b_id, d in indegree.items() if d == 0)
    heapq.heapify(heap)
    order: list[str] = []
    remaining = dict(indegree)
    while heap:
        b_id = heapq.heappop(heap)
        order.append(b_id)
        for nxt in adjacency[b_id]:
            remaining[nxt] -= 1
            if remaining[nxt] == 0:
                heapq.heappush(heap, nxt)

    if len(order) != len(block_by_id):
        return [GraphError(code="cycle_detected", message="graph contains a cycle")]

    warnings: list[GraphError] = []

    # --- Phase 4: structural lint — gate_grounding before assembler --------
    for b_id, block in block_by_id.items():
        if block.type != "assembler":
            continue
        unsatisfied = _find_ungated_generators(b_id, preds, block_by_id)
        if unsatisfied:
            warnings.append(
                GraphError(
                    code="missing_grounding_gate",
                    severity="warning",
                    block_id=b_id,
                    message=(
                        f"assembler '{b_id}' receives QA from generator(s) "
                        f"{sorted(unsatisfied)} without a gate_grounding block in between"
                    ),
                    autofix={
                        "action": "insert_block",
                        "block_type": "gate_grounding",
                        "insert_before": b_id,
                        "after_blocks": sorted(unsatisfied),
                    },
                )
            )

    # --- Phase 5: runnable check (rule 6) -----------------------------------
    runnable = any(
        any(p.type in TERMINAL_PORT_TYPES for p in REGISTRY[block.type].outputs)
        for block in block_by_id.values()
    )
    if not runnable:
        return [GraphError(code="graph_not_runnable", message="graph has no block producing qa, eval, or report output")]

    # --- Phase 6: assemble PlanNodes + cost roll-up -------------------------
    nodes: dict[str, PlanNode] = {}
    for b_id in order:
        block = block_by_id[b_id]
        spec = REGISTRY[block.type]
        input_wiring = {
            port.name: [(f, p) for f, p, _ in incoming.get((b_id, port.name), [])] for port in spec.inputs
        }
        nodes[b_id] = PlanNode(
            block_id=b_id, type=block.type, spec=spec, params=validated_params[b_id], input_wiring=input_wiring
        )

    cost = _cost_rollup(order, nodes)

    return CompiledPlan(order=order, nodes=nodes, warnings=warnings, cost=cost)


def _find_ungated_generators(assembler_id: str, preds: dict[str, list[str]], block_by_id: dict) -> set[str]:
    """Backward search from ``assembler_id`` over predecessor blocks. Returns
    the ids of generator blocks reachable without passing through a
    gate_grounding block along that path."""
    unsatisfied: set[str] = set()
    visited: set[tuple[str, bool]] = set()
    frontier = [(p, False) for p in preds.get(assembler_id, [])]
    while frontier:
        block_id, gate_seen = frontier.pop()
        state = (block_id, gate_seen)
        if state in visited:
            continue
        visited.add(state)

        block_type = block_by_id[block_id].type
        if block_type == "gate_grounding":
            gate_seen = True
        if block_type in GENERATOR_BLOCK_TYPES and not gate_seen:
            unsatisfied.add(block_id)

        for p in preds.get(block_id, []):
            frontier.append((p, gate_seen))
    return unsatisfied


def _cost_rollup(order: list[str], nodes: dict[str, PlanNode]) -> CostRollup:
    artifacts: dict[str, dict] = {}
    paid_blocks: list[dict] = []
    total_calls = 0
    for b_id in order:
        node = nodes[b_id]
        resolved = resolve_inputs(node, artifacts)
        if node.spec.estimate is not None:
            estimate = node.spec.estimate({"inputs": resolved, "params": node.params})
            total_calls += estimate.calls
            paid_blocks.append(
                {
                    "block_id": b_id,
                    "type": node.type,
                    "calls": estimate.calls,
                    "usd": estimate.usd,
                    "note": estimate.note,
                }
            )
        artifacts[b_id] = node.spec.run(resolved, node.params)
    return CostRollup(total_calls=total_calls, paid_blocks=paid_blocks)
