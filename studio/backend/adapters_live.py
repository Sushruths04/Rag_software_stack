"""Live block adapters: thin ``run(inputs, params) -> dict`` wrappers around
``rag_gt.blocks.*`` (05_BLOCK_CATALOG.md M0 milestone) for the 10 FREE-spine
blocks that have real engine adapters: chunks_import, facts_import,
bridges_import, qa_import, chunker, neighbor_sampler, cluster_builder,
index_builder, evaluator, report -- plus (M4b) the 3 PAID generation blocks:
qa_gen_pairs, qa_gen_clusters, qa_gen_bridges (05_BLOCK_CATALOG.md §3 items
15-17). The PAID blocks are wrapped with the exact same ``_wrap()`` closure
as the FREE ones -- they need no special LLM handling here, since each
block's own ``run()`` already resolves ``params.get("llm") or get_llm(
params.get("llm_role", "gt"))`` internally. Actually executing a PAID block
still costs real money/API calls; gating that behind an explicit user
confirmation is a studio/backend/api.py concern (POST /api/graphs/run's
``confirm_paid`` check), not this module's.

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

from rag_gt.blocks import bridges_import as _bridges_import  # noqa: E402
from rag_gt.blocks import chunker as _chunker  # noqa: E402
from rag_gt.blocks import chunks_import as _chunks_import  # noqa: E402
from rag_gt.blocks import cluster_builder as _cluster_builder  # noqa: E402
from rag_gt.blocks import evaluator as _evaluator  # noqa: E402
from rag_gt.blocks import facts_import as _facts_import  # noqa: E402
from rag_gt.blocks import index_builder as _index_builder  # noqa: E402
from rag_gt.blocks import neighbor_sampler as _neighbor_sampler  # noqa: E402
from rag_gt.blocks import qa_gen_bridges as _qa_gen_bridges  # noqa: E402
from rag_gt.blocks import qa_gen_clusters as _qa_gen_clusters  # noqa: E402
from rag_gt.blocks import qa_gen_pairs as _qa_gen_pairs  # noqa: E402
from rag_gt.blocks import qa_import as _qa_import  # noqa: E402
from rag_gt.blocks import report as _report  # noqa: E402

from studio.backend.registry import REGISTRY  # noqa: E402

LIVE_BLOCK_TYPES = frozenset(
    {
        "chunks_import",
        "facts_import",
        "bridges_import",
        "qa_import",
        "chunker",
        "neighbor_sampler",
        "cluster_builder",
        "index_builder",
        "evaluator",
        "report",
    }
)

# The 3 PAID generation blocks (M4b) -- kept separate from LIVE_BLOCK_TYPES
# so callers that specifically care about the original FREE-spine set (e.g.
# the M0 parity test against a fully-free chain) are unaffected.
PAID_LIVE_BLOCK_TYPES = frozenset({"qa_gen_pairs", "qa_gen_clusters", "qa_gen_bridges"})

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
    """Return ``{block_type: run(inputs, params) -> dict}`` for the 10 live
    FREE-spine blocks plus (M4b) the 3 live PAID generation blocks, all
    writing artifacts under one shared directory."""
    out_dir = Path(artifacts_dir) if artifacts_dir else _default_artifacts_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    return {
        "chunks_import": _wrap_chunks_import(out_dir),
        "facts_import": _wrap(_facts_import.run, out_dir),
        "bridges_import": _wrap(_bridges_import.run, out_dir),
        "qa_import": _wrap(_qa_import.run, out_dir),
        "chunker": _wrap(_chunker.run, out_dir),
        "neighbor_sampler": _wrap(_neighbor_sampler.run, out_dir),
        "cluster_builder": _wrap(_cluster_builder.run, out_dir),
        "index_builder": _wrap(_index_builder.run, out_dir),
        "evaluator": _wrap(_evaluator.run, out_dir),
        "report": _wrap(_report.run, out_dir),
        "qa_gen_pairs": _wrap(_qa_gen_pairs.run, out_dir),
        "qa_gen_clusters": _wrap(_qa_gen_clusters.run, out_dir),
        "qa_gen_bridges": _wrap(_qa_gen_bridges.run, out_dir),
    }


def _build_registry_live() -> dict:
    live_runs = build_live_adapters()
    result = dict(REGISTRY)
    for block_type in LIVE_BLOCK_TYPES | PAID_LIVE_BLOCK_TYPES:
        if block_type in live_runs and block_type in result:
            result[block_type] = replace(result[block_type], run=live_runs[block_type])
    return result


REGISTRY_LIVE: dict = _build_registry_live()
