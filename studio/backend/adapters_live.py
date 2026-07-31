"""Live block adapters: thin ``run(inputs, params) -> dict`` wrappers around
``rag_gt.blocks.*`` (05_BLOCK_CATALOG.md M0 milestone) for the 19 FREE-spine
blocks that have real engine adapters: chunks_import, facts_import,
bridges_import, qa_import, chunker, bridge_miner, bridge_quality,
neighbor_sampler, cluster_builder, index_builder, evaluator, report,
gate_clause, gate_joint, gate_loo, gate_grounding, gate_leak, gate_dedup,
assembler -- plus 5 PAID blocks: (M4b) the 3 generation blocks qa_gen_pairs,
qa_gen_clusters, qa_gen_bridges (05_BLOCK_CATALOG.md §3 items 15-17),
fact_extract_llm (Stage 3 SFU extraction, 05_BLOCK_CATALOG.md §3 item 7 /
TODO.md §3), and verifier (Stage D cascade, TODO.md §3/§8's last row).
bridge_miner/bridge_quality (TODO.md §3/§8) are deterministic,
$0, no-LLM blocks -- see rag_gt/blocks/bridge_miner.py's module docstring
for why they wrap rag_gt.graph.bridge_index/bridge_linker, NOT
rag_gt.allpdf.pipeline._build_graph's LLM-based TypedSFG classifier. The
6 gate_* blocks (TODO.md §3/§8) are also deterministic, $0, no-LLM: 4 of
them (gate_clause/gate_joint/gate_loo/gate_grounding) are pure identity
pass-throughs by design -- see rag_gt/blocks/gate_clause.py's module
docstring for the full "already filtered upstream inside gate_qa_group"
architecture note -- and 2 do real work (gate_leak wraps a new standalone
answer_first_v2.qa_bridge_hidden check; gate_dedup wraps
dataset_budget.dedup_pairs). assembler (TODO.md §3/§8, this task) is also
deterministic/$0: it merges the N qa artifact lists wired into its multi-in
``qa`` port and applies dataset_budget.allocate_singles + a min-viable
ranking (see rag_gt/blocks/assembler.py's own module docstring) to cap to
``target_total``. verifier (TODO.md §3/§8, this task) is PAID because its
Stage D cascade (rag_gt.validation.verify_v2.verify_v2_pairs) escalates
borderline cases to a real LLM judge -- deterministic-only batches never
touch the LLM, but the block is still classified PAID since a given run's
mix of borderline cases is not known ahead of time. All PAID blocks are
wrapped with the exact same ``_wrap()`` closure as the FREE ones -- they need
no special LLM handling here, since each block's own ``run()`` already
resolves ``params.get("llm") or get_llm(...)`` (role name varies per block:
``params.get("llm_role", "gt")`` for the generation/extraction blocks,
``params.get("model_role", "verifier")`` for verifier) internally. Actually
executing a PAID block still costs real money/API calls; gating that behind
an explicit user confirmation is a studio/backend/api.py concern (POST
/api/graphs/run's ``confirm_paid`` check), not this module's.

Kept in its own module, separate from ``registry.py``/``stubs.py``, so that
importing the stub-only ``REGISTRY`` never touches ``rag_gt`` --
``registry.build_registry(use_stubs=False)`` only imports this module (and
therefore only imports ``rag_gt``) when the live registry is actually
requested. ``REGISTRY_LIVE`` below is the module-level convenience the M0
task asked for; it lives here rather than in ``registry.py`` specifically so
that importing ``registry.py`` alone stays free of any ``rag_gt`` import,
matching the "84 stub-based tests, zero rag_gt imports" baseline this
scaffold was built to preserve.

Each ``rag_gt.blocks.<x>.run`` takes ``(inputs, params, artifacts_dir=None)``
-- one extra keyword arg vs. the registry's ``Callable[[dict, dict], dict]``
contract, for where output artifacts get written. ``build_live_adapters``
binds one shared ``artifacts_dir`` (so a full run's outputs land in one
place) and returns plain 2-arg closures matching ``BlockSpec.run``.

Params bridging: every wrapped block's studio Pydantic params model
(``params.py``) matches its ``rag_gt.blocks.<x>.run`` params dict 1:1 by
field name, EXCEPT ``chunks_import``: the catalog's ``ChunksImportParams``
declares a ``path`` pattern
(``pipeline_run/<doc>_phase2/checkpoints/s2_chunks_full.json``) for UI
display, while the real engine loader
(``rag_gt.rag.loader.load_chunks``) takes a ``doc_id`` and resolves the path
itself via its own doc-directory map. ``_wrap_chunks_import`` bridges the
two with an explicit-path-first precedence: if ``params["path"]`` is set and
points at a file that actually exists (e.g. a project-local corpus outside
the doc-directory map, as studio graphs increasingly pass), it is forwarded
to ``chunks_import.run`` verbatim; otherwise ``_doc_id_from_chunks_path``
recovers a ``doc_id`` from the ``<doc>_phase2`` path segment (or from an
explicit ``params["doc_id"]``) and the doc-directory-map path is used
instead. ``qa_import``'s params model already declares ``path`` 1:1 with the
engine's ``rag_gt.blocks.qa_import.run``, so it needs no bridging and is
wrapped with the same plain ``_wrap()`` as the rest.
"""
from __future__ import annotations

import re
import sys
import tempfile
from dataclasses import replace
from pathlib import Path
from typing import Callable

# rag_gt is editable-installed against the MAIN repo checkout, not this
# worktree (see src/rag_gt/rag/loader.py's own RAG_GT_DATA_ROOT override for
# the analogous large-data problem). Force this worktree's own src/ to the
# front of sys.path before the first `import rag_gt...` below so
# `rag_gt.blocks.*` resolves to the modules just added in this worktree,
# not whatever `rag_gt` happens to already be installed as.
_WORKTREE_ROOT = Path(__file__).resolve().parent.parent.parent
_SRC = _WORKTREE_ROOT / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from rag_gt.blocks import assembler as _assembler  # noqa: E402
from rag_gt.blocks import bridge_miner as _bridge_miner  # noqa: E402
from rag_gt.blocks import bridge_quality as _bridge_quality  # noqa: E402
from rag_gt.blocks import bridges_import as _bridges_import  # noqa: E402
from rag_gt.blocks import chunker as _chunker  # noqa: E402
from rag_gt.blocks import chunks_import as _chunks_import  # noqa: E402
from rag_gt.blocks import cluster_builder as _cluster_builder  # noqa: E402
from rag_gt.blocks import evaluator as _evaluator  # noqa: E402
from rag_gt.blocks import fact_extract_llm as _fact_extract_llm  # noqa: E402
from rag_gt.blocks import facts_import as _facts_import  # noqa: E402
from rag_gt.blocks import gate_clause as _gate_clause  # noqa: E402
from rag_gt.blocks import gate_dedup as _gate_dedup  # noqa: E402
from rag_gt.blocks import gate_grounding as _gate_grounding  # noqa: E402
from rag_gt.blocks import gate_joint as _gate_joint  # noqa: E402
from rag_gt.blocks import gate_leak as _gate_leak  # noqa: E402
from rag_gt.blocks import gate_loo as _gate_loo  # noqa: E402
from rag_gt.blocks import index_builder as _index_builder  # noqa: E402
from rag_gt.blocks import neighbor_sampler as _neighbor_sampler  # noqa: E402
from rag_gt.blocks import qa_gen_bridges as _qa_gen_bridges  # noqa: E402
from rag_gt.blocks import qa_gen_clusters as _qa_gen_clusters  # noqa: E402
from rag_gt.blocks import qa_gen_pairs as _qa_gen_pairs  # noqa: E402
from rag_gt.blocks import qa_import as _qa_import  # noqa: E402
from rag_gt.blocks import report as _report  # noqa: E402
from rag_gt.blocks import verifier as _verifier  # noqa: E402

from studio.backend.registry import REGISTRY  # noqa: E402

LIVE_BLOCK_TYPES = frozenset(
    {
        "chunks_import",
        "facts_import",
        "bridges_import",
        "qa_import",
        "chunker",
        "bridge_miner",
        "bridge_quality",
        "neighbor_sampler",
        "cluster_builder",
        "index_builder",
        "evaluator",
        "report",
        "gate_clause",
        "gate_joint",
        "gate_loo",
        "gate_grounding",
        "gate_leak",
        "gate_dedup",
        "assembler",
    }
)

# The PAID blocks -- kept separate from LIVE_BLOCK_TYPES so callers that
# specifically care about the original FREE-spine set (e.g. the M0 parity
# test against a fully-free chain) are unaffected. qa_gen_pairs/clusters/
# bridges are the 3 M4b generation blocks; fact_extract_llm (05_BLOCK_CATALOG.md
# sec. 3 item 7, TODO.md sec. 3 row 1 of the block-by-block real-wiring plan)
# is Stage 3 SFU extraction -- also PAID since it makes real LLM calls (one
# segmenter call plus one rewrite + one self-containment call per span).
PAID_LIVE_BLOCK_TYPES = frozenset(
    {"qa_gen_pairs", "qa_gen_clusters", "qa_gen_bridges", "fact_extract_llm", "verifier"}
)

_PHASE2_DIR_RE = re.compile(r"([^/\\]+)_phase2[/\\]")


def _doc_id_from_chunks_path(path: str) -> str:
    m = _PHASE2_DIR_RE.search(path.replace("\\", "/") + "/")
    return m.group(1) if m else path


def _default_artifacts_dir() -> Path:
    d = Path(tempfile.gettempdir()) / "rag_gt_studio_live_artifacts"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _wrap(block_run: Callable, artifacts_dir: Path) -> Callable[[dict, dict], dict]:
    def run(inputs: dict, params: dict) -> dict:
        return block_run(inputs, params, artifacts_dir=artifacts_dir)

    return run


def _wrap_chunks_import(artifacts_dir: Path) -> Callable[[dict, dict], dict]:
    def run(inputs: dict, params: dict) -> dict:
        p = str(params.get("path", ""))
        if p and Path(p).is_file():
            return _chunks_import.run(inputs, {"path": p}, artifacts_dir=artifacts_dir)
        doc_id = params.get("doc_id") or _doc_id_from_chunks_path(p)
        return _chunks_import.run(inputs, {"doc_id": doc_id}, artifacts_dir=artifacts_dir)

    return run


def build_live_adapters(artifacts_dir: Path | str | None = None) -> dict[str, Callable[[dict, dict], dict]]:
    """Return ``{block_type: run(inputs, params) -> dict}`` for the 19 live
    FREE-spine blocks plus the 5 live PAID blocks, all writing artifacts
    under one shared directory."""
    out_dir = Path(artifacts_dir) if artifacts_dir else _default_artifacts_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    return {
        "chunks_import": _wrap_chunks_import(out_dir),
        "facts_import": _wrap(_facts_import.run, out_dir),
        "bridges_import": _wrap(_bridges_import.run, out_dir),
        "qa_import": _wrap(_qa_import.run, out_dir),
        "chunker": _wrap(_chunker.run, out_dir),
        "bridge_miner": _wrap(_bridge_miner.run, out_dir),
        "bridge_quality": _wrap(_bridge_quality.run, out_dir),
        "neighbor_sampler": _wrap(_neighbor_sampler.run, out_dir),
        "cluster_builder": _wrap(_cluster_builder.run, out_dir),
        "index_builder": _wrap(_index_builder.run, out_dir),
        "evaluator": _wrap(_evaluator.run, out_dir),
        "report": _wrap(_report.run, out_dir),
        "gate_clause": _wrap(_gate_clause.run, out_dir),
        "gate_joint": _wrap(_gate_joint.run, out_dir),
        "gate_loo": _wrap(_gate_loo.run, out_dir),
        "gate_grounding": _wrap(_gate_grounding.run, out_dir),
        "gate_leak": _wrap(_gate_leak.run, out_dir),
        "gate_dedup": _wrap(_gate_dedup.run, out_dir),
        "assembler": _wrap(_assembler.run, out_dir),
        "qa_gen_pairs": _wrap(_qa_gen_pairs.run, out_dir),
        "qa_gen_clusters": _wrap(_qa_gen_clusters.run, out_dir),
        "qa_gen_bridges": _wrap(_qa_gen_bridges.run, out_dir),
        "fact_extract_llm": _wrap(_fact_extract_llm.run, out_dir),
        "verifier": _wrap(_verifier.run, out_dir),
    }


def _build_registry_live() -> dict:
    live_runs = build_live_adapters()
    result = dict(REGISTRY)
    for block_type in LIVE_BLOCK_TYPES | PAID_LIVE_BLOCK_TYPES:
        if block_type in live_runs and block_type in result:
            result[block_type] = replace(result[block_type], run=live_runs[block_type])
    return result


REGISTRY_LIVE: dict = _build_registry_live()
