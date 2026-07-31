"""Block registry: PortSpec, BlockSpec, REGISTRY.

Populated from 05_BLOCK_CATALOG.md §3 (33 blocks). Every block's ``run`` is a
stub adapter from ``stubs.py`` with signature
``run(inputs: dict, params: dict) -> dict`` returning typed fake artifacts —
no ``rag_gt`` import anywhere in this module or its dependencies. Real
adapters are gated on the M0 engine refactor (see stubs.py header).

``PortSpec`` extends the plan's sketch (``name``/``type``/``multi``) with a
``required`` flag so the compiler can tell a genuinely optional secondary
input (e.g. ``provenance_join``'s ``qa`` port, "source of truth" per the
catalog) from a missing mandatory wire.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Literal

from pydantic import BaseModel

from studio.backend import params as P
from studio.backend import stubs as S
from studio.backend.stubs import CostEstimate

__all__ = ["PortSpec", "BlockSpec", "CostEstimate", "REGISTRY", "build_registry"]


@dataclass(frozen=True)
class PortSpec:
    name: str
    type: str
    multi: bool = False
    required: bool = True


@dataclass(frozen=True)
class BlockSpec:
    type: str
    category: str
    cost: Literal["free", "paid"]
    inputs: tuple[PortSpec, ...]
    outputs: tuple[PortSpec, ...]
    params: type[BaseModel]
    run: Callable[[dict, dict], dict]
    estimate: Callable[[dict], CostEstimate] | None = None


def _spec(
    type_: str,
    category: str,
    cost: Literal["free", "paid"],
    inputs: tuple[PortSpec, ...],
    outputs: tuple[PortSpec, ...],
    params_model: type[BaseModel],
    run: Callable[[dict, dict], dict],
    estimate: Callable[[dict], CostEstimate] | None = None,
) -> BlockSpec:
    return BlockSpec(
        type=type_,
        category=category,
        cost=cost,
        inputs=inputs,
        outputs=outputs,
        params=params_model,
        run=run,
        estimate=estimate,
    )


_SOURCES = "sources"
_EXTRACTION = "extraction"
_MINING = "mining"
_GENERATION = "generation"
_GATES = "gates"
_ASSEMBLY = "assembly"
_UTILITY = "utility"


_BLOCKS: tuple[BlockSpec, ...] = (
    # --- Sources & imports ----------------------------------------------
    _spec(
        "pdf_source", _SOURCES, "free", (), (PortSpec("pdf", "pdf"),), P.PdfSourceParams, S.run_pdf_source
    ),
    _spec(
        "chunks_import",
        _SOURCES,
        "free",
        (),
        (PortSpec("chunks", "chunks"),),
        P.ChunksImportParams,
        S.run_chunks_import,
    ),
    _spec(
        "facts_import",
        _SOURCES,
        "free",
        (),
        (PortSpec("facts", "facts"),),
        P.FactsImportParams,
        S.run_facts_import,
    ),
    _spec(
        "bridges_import",
        _SOURCES,
        "free",
        (),
        (PortSpec("bridges", "bridges"),),
        P.BridgesImportParams,
        S.run_bridges_import,
    ),
    _spec(
        "qa_import", _SOURCES, "free", (), (PortSpec("qa", "qa"),), P.QaImportParams, S.run_qa_import
    ),
    # --- Extraction & cleaning -------------------------------------------
    _spec(
        "chunker",
        _EXTRACTION,
        "free",
        (PortSpec("chunks", "chunks"),),
        (PortSpec("chunks", "chunks"),),
        P.ChunkerParams,
        S.run_chunker,
    ),
    _spec(
        "fact_extract_llm",
        _EXTRACTION,
        "paid",
        (PortSpec("chunks", "chunks"),),
        (PortSpec("facts", "facts"),),
        P.FactExtractLlmParams,
        S.run_fact_extract_llm,
        S.estimate_fact_extract_llm,
    ),
    _spec(
        "fact_debris_filter",
        _EXTRACTION,
        "free",
        (PortSpec("facts", "facts"),),
        (PortSpec("facts", "facts"),),
        P.FactDebrisFilterParams,
        S.run_fact_debris_filter,
    ),
    _spec(
        "fact_splitter",
        _EXTRACTION,
        "free",
        (PortSpec("facts", "facts"),),
        (PortSpec("facts", "facts"),),
        P.FactSplitterParams,
        S.run_fact_splitter,
    ),
    _spec(
        "provenance_join",
        _EXTRACTION,
        "free",
        (PortSpec("facts", "facts"), PortSpec("qa", "qa", required=False)),
        (PortSpec("facts", "facts"),),
        P.ProvenanceJoinParams,
        S.run_provenance_join,
    ),
    # --- Mining & sampling -------------------------------------------------
    _spec(
        "bridge_miner",
        _MINING,
        "free",
        (PortSpec("facts", "facts"),),
        (PortSpec("bridges", "bridges"),),
        P.BridgeMinerParams,
        S.run_bridge_miner,
        S.estimate_bridge_miner,
    ),
    _spec(
        "bridge_quality",
        _MINING,
        "free",
        (PortSpec("bridges", "bridges"),),
        (PortSpec("bridges", "bridges"),),
        P.BridgeQualityParams,
        S.run_bridge_quality,
    ),
    _spec(
        "neighbor_sampler",
        _MINING,
        "free",
        (PortSpec("facts", "facts"),),
        (PortSpec("candidates", "candidates"),),
        P.NeighborSamplerParams,
        S.run_neighbor_sampler,
    ),
    _spec(
        "cluster_builder",
        _MINING,
        "free",
        (PortSpec("bridges", "bridges"), PortSpec("facts", "facts")),
        (PortSpec("candidates", "candidates"),),
        P.ClusterBuilderParams,
        S.run_cluster_builder,
    ),
    # --- Generation (all PAID except demotion) -----------------------------
    _spec(
        "qa_gen_pairs",
        _GENERATION,
        "paid",
        (PortSpec("candidates", "candidates"), PortSpec("facts", "facts")),
        (PortSpec("qa", "qa"),),
        P.QaGenPairsParams,
        S.run_qa_gen_pairs,
        S.estimate_qa_gen_pairs,
    ),
    _spec(
        "qa_gen_clusters",
        _GENERATION,
        "paid",
        (PortSpec("candidates", "candidates"), PortSpec("facts", "facts")),
        (PortSpec("qa", "qa"),),
        P.QaGenClustersParams,
        S.run_qa_gen_clusters,
        S.estimate_qa_gen_clusters,
    ),
    _spec(
        "qa_gen_bridges",
        _GENERATION,
        "paid",
        (PortSpec("bridges", "bridges"), PortSpec("facts", "facts")),
        (PortSpec("qa", "qa"),),
        P.QaGenBridgesParams,
        S.run_qa_gen_bridges,
        S.estimate_qa_gen_bridges,
    ),
    _spec(
        "demotion",
        _GENERATION,
        "free",
        (PortSpec("qa", "qa"), PortSpec("bridges", "bridges")),
        (PortSpec("bridges", "bridges"),),
        P.DemotionParams,
        S.run_demotion,
    ),
    # --- Gates (all FREE — local NLI on GPU) --------------------------------
    _spec(
        "gate_clause",
        _GATES,
        "free",
        (PortSpec("qa", "qa"),),
        (PortSpec("qa", "qa"),),
        P.GateClauseParams,
        S.run_gate_clause,
    ),
    _spec(
        "gate_joint",
        _GATES,
        "free",
        (PortSpec("qa", "qa"),),
        (PortSpec("qa", "qa"),),
        P.GateJointParams,
        S.run_gate_joint,
    ),
    _spec(
        "gate_loo",
        _GATES,
        "free",
        (PortSpec("qa", "qa"),),
        (PortSpec("qa", "qa"),),
        P.GateLooParams,
        S.run_gate_loo,
    ),
    _spec(
        "gate_grounding",
        _GATES,
        "free",
        (PortSpec("qa", "qa"),),
        (PortSpec("qa", "qa"),),
        P.GateGroundingParams,
        S.run_gate_grounding,
    ),
    _spec(
        "gate_leak",
        _GATES,
        "free",
        (PortSpec("qa", "qa"),),
        (PortSpec("qa", "qa"),),
        P.GateLeakParams,
        S.run_gate_leak,
    ),
    _spec(
        "gate_dedup",
        _GATES,
        "free",
        (PortSpec("qa", "qa"),),
        (PortSpec("qa", "qa"),),
        P.GateDedupParams,
        S.run_gate_dedup,
    ),
    # --- Assembly, verification, evaluation ---------------------------------
    _spec(
        "assembler",
        _ASSEMBLY,
        "free",
        (PortSpec("qa", "qa", multi=True),),
        (PortSpec("qa", "qa"),),
        P.AssemblerParams,
        S.run_assembler,
    ),
    _spec(
        "verifier",
        _ASSEMBLY,
        "paid",
        (PortSpec("qa", "qa"), PortSpec("facts", "facts")),
        (PortSpec("qa", "qa"),),
        P.VerifierParams,
        S.run_verifier,
        S.estimate_verifier,
    ),
    _spec(
        "index_builder",
        _ASSEMBLY,
        "free",
        (PortSpec("chunks", "chunks"),),
        (PortSpec("index", "index"),),
        P.IndexBuilderParams,
        S.run_index_builder,
    ),
    _spec(
        "evaluator",
        _ASSEMBLY,
        "free",
        (PortSpec("qa", "qa"), PortSpec("index", "index"), PortSpec("facts", "facts")),
        (PortSpec("eval", "eval"),),
        P.EvaluatorParams,
        S.run_evaluator,
    ),
    _spec(
        "sweep",
        _ASSEMBLY,
        "free",
        (PortSpec("qa", "qa"), PortSpec("chunks", "chunks")),
        (PortSpec("eval", "eval"),),
        P.SweepParams,
        S.run_sweep,
    ),
    _spec(
        "report",
        _ASSEMBLY,
        "free",
        (PortSpec("eval", "eval", multi=True),),
        (PortSpec("report", "report"),),
        P.ReportParams,
        S.run_report,
    ),
    _spec(
        "bbox_viewer",
        _ASSEMBLY,
        "free",
        (PortSpec("qa", "qa"), PortSpec("pdf", "pdf")),
        (PortSpec("report", "report"),),
        P.BboxViewerParams,
        S.run_bbox_viewer,
    ),
    # --- Utility -------------------------------------------------------------
    _spec("note", _UTILITY, "free", (), (), P.NoteParams, S.run_note),
    _spec("cost_probe", _UTILITY, "free", (), (), P.CostProbeParams, S.run_cost_probe),
)

REGISTRY: dict[str, BlockSpec] = {spec.type: spec for spec in _BLOCKS}


def build_registry(use_stubs: bool = True) -> dict[str, BlockSpec]:
    """Return a block registry dict.

    ``use_stubs=True`` (default) returns exactly ``REGISTRY`` -- stub-based,
    zero ``rag_gt`` import, unchanged -- so every existing caller (the
    compiler, the 84 stub-based tests) keeps working byte-for-byte.

    ``use_stubs=False`` swaps in real ``rag_gt.blocks.*`` adapters
    (05_BLOCK_CATALOG.md M0 milestone) for the 9 FREE-spine blocks that have
    them (chunks_import, facts_import, bridges_import, chunker,
    neighbor_sampler, cluster_builder, index_builder, evaluator, report) and
    leaves the other 24 block types as stubs.

    The live-adapter import is lazy (inside this branch only): importing
    this module -- or calling ``build_registry(True)`` / the bare default --
    never touches ``rag_gt``, preserving this module's documented "no
    rag_gt import anywhere" contract for the stub-only path. See
    ``studio/backend/adapters_live.py`` for the live adapters themselves and
    its module-level ``REGISTRY_LIVE`` convenience.
    """
    if use_stubs:
        return dict(REGISTRY)
    try:
        from studio.backend.adapters_live import REGISTRY_LIVE  # lazy: only touches rag_gt here
    except ImportError as exc:
        # Packaged builds may ship a light Python runtime without the ML
        # engine stack (torch/spacy/...) — degrade to stubs instead of
        # letting the frontend's default use_stubs=false run turn into a
        # 500. Stub results are already honestly marked "(planned)" in the
        # UI, so nothing is silently faked.
        import logging

        logging.getLogger(__name__).warning(
            "live rag_gt adapters unavailable (%s) — serving the stub registry", exc
        )
        return dict(REGISTRY)

    return dict(REGISTRY_LIVE)
