"""Standalone FastAPI app for the block-studio backend scaffold.

02_PHASE2_APP_PLAN.md calls for these under ``production/backend/app``
eventually; this scaffold keeps its own app object so it can be developed
and tested with zero dependency on ``production/``. Wiring it into the real
app (mounting the router, sharing the run store / WebSocket channel) is a
follow-up once the M0 engine refactor lands and the registry's ``run``
callables stop being stubs.

Endpoints:
    GET  /health               - liveness probe for the desktop sidecar.
    GET  /api/blocks           - serialized registry (palette + inspector
                                  forms are generated from this).
    POST /api/graphs/validate  - compiler result: valid/errors/warnings/
                                  order/cost.
    POST /api/graphs/run       - compile + run a graph synchronously,
                                  returning the full ordered event list and
                                  final artifacts in one response.
    POST /api/graphs           - save a graph, return its assigned id.
    GET  /api/graphs           - list saved graphs (id/name/modified only).
    GET  /api/graphs/{id}      - load a saved graph, 404 if unknown.

Run locally:  uvicorn studio.backend.api:app --reload --port 8100
"""

from __future__ import annotations

import dataclasses
from dataclasses import asdict
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from studio.backend import graph_store
from studio.backend.compiler import CompiledPlan, compile_graph
from studio.backend.executor import Executor
from studio.backend.models import Graph
from studio.backend.registry import REGISTRY, build_registry

app = FastAPI(title="GRAFT Studio Backend (Phase 2 scaffold)", version="0.1.0")

# B-M2: the desktop shell's webview calls this server on a DIFFERENT origin
# (its own asset origin vs. this sidecar's 127.0.0.1:<negotiated port>), so
# the browser enforces CORS on every request. Wildcard origins are an
# acceptable local-only tradeoff: this server binds to 127.0.0.1 and is
# never exposed beyond the machine it runs on.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    """Polled by the desktop shell's sidecar supervisor to detect readiness."""
    return {"status": "ok"}


def get_graphs_dir() -> Path:
    """FastAPI dependency for the graphs storage directory.

    Overridden in tests (``app.dependency_overrides[get_graphs_dir] = ...``)
    to point at a ``tmp_path`` so persistence tests never write into the
    real ``studio/backend/data/graphs/`` directory.
    """
    return graph_store.DEFAULT_GRAPHS_DIR


def _is_locked(field_info) -> bool:
    extra = getattr(field_info, "json_schema_extra", None)
    return isinstance(extra, dict) and bool(extra.get("locked"))


def _serialize_port(port) -> dict:
    return {"name": port.name, "type": port.type, "multi": port.multi, "required": port.required}


def _serialize_block(block_type: str) -> dict:
    spec = REGISTRY[block_type]
    locked_params = [name for name, f in spec.params.model_fields.items() if _is_locked(f)]
    return {
        "type": spec.type,
        "category": spec.category,
        "cost": spec.cost,
        "inputs": [_serialize_port(p) for p in spec.inputs],
        "outputs": [_serialize_port(p) for p in spec.outputs],
        "params_schema": spec.params.model_json_schema(),
        "locked_params": locked_params,
        "estimate": spec.estimate is not None,
    }


def serialize_registry() -> dict:
    return {"blocks": [_serialize_block(t) for t in REGISTRY]}


@app.get("/api/blocks")
def get_blocks() -> dict:
    return serialize_registry()


@app.post("/api/graphs/validate")
def validate_graph(graph: dict) -> dict:
    result = compile_graph(graph)
    if isinstance(result, CompiledPlan):
        return {
            "valid": True,
            "order": result.order,
            "errors": [],
            "warnings": [asdict(w) for w in result.warnings],
            "cost": asdict(result.cost),
        }
    return {
        "valid": False,
        "order": [],
        "errors": [asdict(e) for e in result],
        "warnings": [],
        "cost": None,
    }


def _apply_live_registry(plan: CompiledPlan) -> None:
    """Swap in the 9 live block adapters (see adapters_live.py) for a
    compiled plan's nodes, in place. Only reached when ``use_stubs=False``
    is explicitly requested by the caller, so the default stub path never
    imports ``rag_gt`` — matching registry.build_registry's own documented
    "lazy live import" contract. Block types with no live adapter (e.g.
    qa_import) are left as their original stub spec, so their artifacts stay
    honestly "stub:"-prefixed even inside an otherwise-live run.
    """
    live_registry = build_registry(use_stubs=False)
    for node in plan.nodes.values():
        live_spec = live_registry.get(node.type)
        if live_spec is not None:
            node.spec = dataclasses.replace(node.spec, run=live_spec.run)


@app.post("/api/graphs/run", response_model=None)
def run_graph(payload: dict, use_stubs: bool = True) -> dict | JSONResponse:
    """Compile the graph in ``payload`` and run it synchronously against a
    fresh, request-scoped Executor (no cache sharing across HTTP calls — see
    02_PHASE2_APP_PLAN.md M3; a persistent cross-request cache needs a
    session concept this milestone doesn't have).

    ``payload`` is the graph document (schema_version/blocks/wires/meta,
    exactly as before) plus one optional sibling field, ``confirm_paid``
    (default ``false`` when absent) — kept as a body field rather than a
    query param like ``use_stubs`` because it is spend-confirmation state
    the caller must explicitly opt into per 05_BLOCK_CATALOG.md §2 ("The
    runner requires an explicit user confirm before executing any PAID
    block") and 04_DESIGN_SYSTEM.md flow F4. It is popped off before the
    remaining dict is handed to ``compile_graph`` (the ``Graph`` model is
    ``extra="forbid"`` and knows nothing about it).

    Spend gate (only reachable for ``use_stubs=false`` — a stub-only run
    never costs anything, so it is never gated, matching the pre-existing
    behavior every stub-registry test already relies on): if the compiled
    plan's cost roll-up lists any PAID block and ``confirm_paid`` is not
    ``true``, the block is NOT executed. The response is a 402 ("Payment
    Required" — chosen over a 200-with-a-flag or a 409 because this really
    is "you must pay/confirm spend before this proceeds", and over a 400
    because the request is well-formed, just incomplete without a second,
    explicit round-trip) with
    ``{"requires_confirmation": true, "paid_blocks": [...block ids...],
    "estimated": [...one {block_id, type, calls, usd, note} per paid
    block...]}``, using the same ``CostRollup`` the compiler always computes
    (cheaply — it dry-runs the STUB registry regardless of ``use_stubs``,
    see compiler.py's ``_cost_rollup`` docstring, so this check never costs
    anything or touches a real LLM even when it fires). ``usd`` is ``null``
    for the current qa_gen_* estimators (they only know a call count, not a
    $/call price) — left honestly ``null`` rather than fabricated.

    A block raising during execution is not a 500: the exception is caught,
    the events collected up to and including the ``block_failed`` event are
    still returned, and the top-level response reports
    ``{"ok": false, "failed_block": "<id>"}``. An invalid graph (cycle,
    unknown block, etc.) is a 400 whose ``detail`` reuses the exact error
    shape ``/api/graphs/validate`` already returns.
    """
    payload = dict(payload)
    confirm_paid = bool(payload.pop("confirm_paid", False))
    graph = payload

    result = compile_graph(graph)
    if not isinstance(result, CompiledPlan):
        raise HTTPException(
            status_code=400,
            detail={
                "valid": False,
                "order": [],
                "errors": [asdict(e) for e in result],
                "warnings": [],
                "cost": None,
            },
        )

    plan = result
    if not use_stubs and plan.cost.paid_blocks and not confirm_paid:
        return JSONResponse(
            status_code=402,
            content={
                "requires_confirmation": True,
                "paid_blocks": [b["block_id"] for b in plan.cost.paid_blocks],
                "estimated": plan.cost.paid_blocks,
            },
        )

    if not use_stubs:
        _apply_live_registry(plan)

    executor = Executor(plan, cache={})
    failed_block: str | None = None
    try:
        executor.run()
    except Exception:  # noqa: BLE001 - surfaced via events + ok:false, not a 500
        failed_events = [e for e in executor.events if e.type == "block_failed"]
        failed_block = failed_events[-1].block_id if failed_events else None

    return {
        "ok": failed_block is None,
        "failed_block": failed_block,
        "order": plan.order,
        "events": [asdict(e) for e in executor.events],
        "artifacts": executor.artifacts,
    }


@app.post("/api/graphs")
def save_graph(graph: Graph, graphs_dir: Path = Depends(get_graphs_dir)) -> dict:
    graph_id = graph_store.save_graph(graph, graphs_dir)
    return {"id": graph_id, "graph": graph.model_dump(by_alias=True)}


@app.get("/api/graphs")
def list_graphs(graphs_dir: Path = Depends(get_graphs_dir)) -> dict:
    return {"graphs": graph_store.list_graphs(graphs_dir)}


@app.get("/api/graphs/{graph_id}")
def load_graph(graph_id: str, graphs_dir: Path = Depends(get_graphs_dir)) -> dict:
    graph = graph_store.load_graph(graph_id, graphs_dir)
    if graph is None:
        raise HTTPException(status_code=404, detail=f"graph '{graph_id}' not found")
    return {"id": graph_id, "graph": graph.model_dump(by_alias=True)}
