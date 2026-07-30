"""GRAFT Studio backend: graph model, block registry, compiler, executor, API.

Package layout (Phase 2 plan, ``02_PHASE2_APP_PLAN.md``):
    models.py     - Graph file schema (schema_version 1): blocks/wires/meta.
    registry.py   - PortSpec / BlockSpec / REGISTRY (33 catalog blocks).
    params.py     - one Pydantic params model per block.
    stubs.py      - stub ``run(inputs, params) -> dict`` adapters (no rag_gt
                    import — real adapters are gated on the M0 engine
                    refactor another track owns).
    compiler.py   - compile_graph(graph) -> CompiledPlan | list[GraphError].
    executor.py   - topo-order execution of a CompiledPlan with a
                    content-addressed per-block cache.
    api.py        - standalone FastAPI app: GET /api/blocks,
                    POST /api/graphs/validate.

Nothing here imports ``rag_gt`` or calls any real engine/LLM/NLI.
"""
