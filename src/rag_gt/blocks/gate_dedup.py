"""Block: gate_dedup [FREE] -- qa -> qa.

Wraps ``rag_gt.generation.dataset_budget.dedup_pairs`` verbatim (TODO.md
sec. 3/8's ``gate_dedup`` row) -- the only one of the 6 gate blocks in this
task that is genuinely separable from ``gate_qa_group``'s fused clause/
joint/loo/grounding filtering (see ``gate_clause.py``'s module docstring for
why those four are identity pass-throughs instead).

``dedup_pairs`` runs two independent passes, both scoped per document and
both keeping the record with more evidence units (answer clauses), tie-
broken by higher min clause NLI:

(a) shared-evidence collapse -- records in the same doc whose sorted
    ``gold_fact_ids`` set is identical collapse to one survivor. Always
    runs.
(b) near-dupe question collapse -- records in the same doc whose question
    EMBEDDINGS have cosine similarity at or above ``cosine_threshold``
    collapse to one survivor. Requires an ``embed_fn``; skipped entirely
    when ``embed_fn`` is ``None`` (``dedup_pairs``'s own documented
    behavior, not a limitation added here).

embed_fn decision: this block passes ``embed_fn=None``, so only pass (a)
runs today. This matches the ONLY existing precedent in this block layer --
``neighbor_sampler.py`` (M0 slice) explicitly documents "No embed_fn is
threaded through yet (no embedding-provider block exists in this M0
slice)... matching [the real function]'s own behaviour when embed_fn=None."
There is no embedding-provider block, and no other ``rag_gt.blocks.*``
adapter wires a real embedder either (``rag_gt.generation.answer_first_v2``
only builds one, ``_local_embed_fn``, behind its own CLI's explicit
``--embed`` flag -- off by default there too, and it loads a real
sentence-transformer model, which is a real runtime/dependency cost this
FREE, deterministic gate should not silently take on as its default). If a
future embedding-provider block is added to the canvas, this is where its
output would get threaded through as ``embed_fn`` to enable pass (b).

``cosine_threshold``: never loosened from ``dedup_pairs``'s own real
default (0.92) unless the studio ``near_dupe_cosine`` param (locked to 0.92
in ``GateDedupParams``) explicitly carries a different value.
"""
from __future__ import annotations

from pathlib import Path

from rag_gt.blocks._common import artifact, read_list_input, write_json_artifact
from rag_gt.generation.dataset_budget import dedup_pairs


def run(inputs: dict, params: dict, artifacts_dir: Path | str | None = None) -> dict:
    """``inputs``: ``{"qa": <qa artifact>}``.

    ``params``: ``near_dupe_cosine`` (optional float override for
    ``dedup_pairs``'s ``cosine_threshold``; default 0.92, matching both the
    real function's own default and the studio ``GateDedupParams`` field),
    ``embed_fn`` (optional test/future override; default None -- see module
    docstring for why pass (b) is skipped by default).

    Returns ``{"qa": {"type": "qa", "ref": <path>, "meta": {...}}}`` where
    the payload is the deduped qa list. ``meta`` reports ``count`` (kept),
    ``count_in`` (before this gate), and the raw ``dedup_pairs`` stats dict
    (``n_dupes_dropped_evidence``, ``n_dupes_dropped_question``).
    """
    items = read_list_input(inputs.get("qa"))
    cosine_threshold = float(params.get("near_dupe_cosine", 0.92))
    embed_fn = params.get("embed_fn")

    kept, stats = dedup_pairs(items, embed_fn=embed_fn, cosine_threshold=cosine_threshold)

    ref = write_json_artifact(artifacts_dir, "gate_dedup", kept)
    meta = {
        "count": len(kept),
        "count_in": len(items),
        **stats,
    }
    return {"qa": artifact("qa", str(ref), meta)}
