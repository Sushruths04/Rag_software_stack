"""One Pydantic params model per catalog block (05_BLOCK_CATALOG.md §3).

Every model uses ``extra="forbid"`` so the compiler's "unknown param" check
(§5 rule, plus 02_PHASE2_APP_PLAN.md's "unknown block/param errors") is just
"does ``model.model_validate(block.params)`` raise".

Threshold params called out in the catalog as LOCKED ("read-only outside
expert mode", §5 rule 5) are marked with ``json_schema_extra={"locked": True}``
so both the registry-serialization endpoint and the compiler can find them
generically without a hardcoded field-name list.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


def _locked(default: float) -> Any:
    return Field(default, json_schema_extra={"locked": True})


class _StrictParams(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --- Sources & imports -------------------------------------------------


class PdfSourceParams(_StrictParams):
    path: str = ""
    display_name: str = ""
    doc_id: str = ""


class ChunksImportParams(_StrictParams):
    path: str = "pipeline_run/<doc>_phase2/checkpoints/s2_chunks_full.json"


class FactsImportParams(_StrictParams):
    path: str = "data/eval_results/facts_v1_grounded/facts_<doc>.json"


class BridgesImportParams(_StrictParams):
    path: str = ""


class QaImportParams(_StrictParams):
    path: str = ""


# --- Extraction & cleaning ----------------------------------------------


class ChunkerParams(_StrictParams):
    strategy: Literal["original", "sentence", "sliding_256", "paragraph"] = "original"
    window: int = 256
    overlap: int = 32


class FactExtractLlmParams(_StrictParams):
    model_role: str = "extractor"
    batch_size: int = 8


class FactDebrisFilterParams(_StrictParams):
    symbol_density_threshold: float = 0.4
    drop_equations: bool = True
    drop_figure_keys: bool = True


class FactSplitterParams(_StrictParams):
    max_tokens: int = 45


class ProvenanceJoinParams(_StrictParams):
    verified_gt_path: str = ""


# --- Mining & sampling ----------------------------------------------------


class BridgeMinerParams(_StrictParams):
    bridge_types: list[str] = Field(default_factory=lambda: ["shared_entity"])
    min_page_spread: int = 1
    cosine_scorer: Literal["off", "local", "api"] = "off"


class BridgeQualityParams(_StrictParams):
    stoplist: list[str] = Field(default_factory=list)
    idf_floor: float = 0.0


class NeighborSamplerParams(_StrictParams):
    window: int = 3
    min_cosine: float = 0.40
    max_cosine: float = 0.95
    max_uses_per_fact: int = 2
    max_pairs: int | None = None


class ClusterBuilderParams(_StrictParams):
    window: int = 3
    min_cosine: float = 0.40
    max_cosine: float = 0.95


# --- Generation (all PAID, except demotion which routes rejects) --------


class QaGenPairsParams(_StrictParams):
    doc: str = ""
    model_role: str = "generator"
    workers: int = 4
    cache_path: str = ""


class QaGenClustersParams(_StrictParams):
    doc: str = ""
    question_attempts: int = 3
    workers: int = 4


class QaGenBridgesParams(_StrictParams):
    model_role: str = "generator"
    workers: int = 4
    cache_path: str = ""


class DemotionParams(_StrictParams):
    pass


# --- Gates (all FREE — local NLI on GPU) ---------------------------------


class GateClauseParams(_StrictParams):
    threshold: float = _locked(0.65)


class GateJointParams(_StrictParams):
    single_fact_max: float = _locked(0.50)
    joint_min: float = _locked(0.85)


class GateLooParams(_StrictParams):
    pass


class GateGroundingParams(_StrictParams):
    pass


class GateLeakParams(_StrictParams):
    pass


class GateDedupParams(_StrictParams):
    near_dupe_cosine: float = _locked(0.92)


# --- Assembly, verification, evaluation ----------------------------------


class AssemblerParams(_StrictParams):
    target_total: int = 500
    keep_all_multi_hop: bool = True


class VerifierParams(_StrictParams):
    model_role: str = "verifier"
    workers: int = 4


class IndexBuilderParams(_StrictParams):
    strategy: Literal["bm25", "hybrid"] = "bm25"
    embedding_source: Literal["local", "api"] = "local"


class EvaluatorParams(_StrictParams):
    top_k: int = 10
    match_mode: Literal["overlap", "exact-id"] = "overlap"


class SweepParams(_StrictParams):
    grid: dict[str, list[Any]] = Field(default_factory=dict)


class ReportParams(_StrictParams):
    format: Literal["md", "html"] = "html"
    include_per_doc_ci: bool = False


class BboxViewerParams(_StrictParams):
    pass


# --- Utility ---------------------------------------------------------------


class NoteParams(_StrictParams):
    text: str = ""


class CostProbeParams(_StrictParams):
    target_block_id: str = ""
