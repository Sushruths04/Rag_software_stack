"""Block: assembler [FREE] -- qa (multi-in) -> qa.

TODO.md sec. 3/8's own row for this block points at
``rag_gt.generation.answer_first_v2.build_v2_pairs`` as "already split into
composable steps... just not exposed as a block." On inspection,
``build_v2_pairs`` is the CLI orchestrator ``qa_gen_pairs``/``qa_gen_clusters``/
``qa_gen_bridges`` were themselves extracted FROM (sampling + drafting +
scoring + demotion + fallback all fused in one function) -- not a clean
assembler boundary. Since those three blocks already independently produce
separate ``qa`` artifacts, and this block's own ``qa`` input port is declared
``multi=True`` (a LIST of qa artifacts, one per upstream ``qa_gen_*``/gate
chain wired into it on a given canvas), the assembler's real job is narrower
than "redo build_v2_pairs": merge N qa lists into one, then apply the
``target_total`` budget cap -- matching the existing stub's own behavior
(``count_out = min(total, target_total)``), just operating on real records
instead of fake meta counts.

Budget-cap strategy (see ``rag_gt.generation.dataset_budget`` for the two
helpers this reuses):

  - ``allocate_singles(counts, budget)`` is PUBLIC (no leading underscore),
    has its own module docstring describing exactly this job ("the
    remaining budget goes to single-hop pairs proportionally to each
    document's own single yield... document size self-adjusts"), and is
    already unit-tested on its own in ``tests/test_dataset_budget.py``. It
    is not currently called from ``build_v2_pairs`` or any CLI script --
    but it is public, documented, and designed for exactly this
    cross-document proportional-allocation problem, which is precisely
    what merging N qa streams (often one per document) and capping to a
    global ``target_total`` requires. Used here to split the available
    budget across each qa record's own ``doc`` field.

  - ``_keep_rank(qa)`` (leading underscore -- module-private, zero import
    sites anywhere else in the codebase, including inside
    ``build_v2_pairs`` itself) ranks by evidence-unit count then min clause
    NLI. It is reused here -- despite the underscore -- specifically
    because it is the ONLY existing "which QA record is the better one to
    keep" signal anywhere in this codebase; it is the exact criterion
    ``dedup_pairs`` (in the SAME module) already uses to pick a survivor
    when two records collide. Inventing a brand-new ranking heuristic with
    no basis in the real code would be worse than reusing the one real
    signal that already exists, even though it crosses a private-name
    boundary. If this coupling is judged unacceptable later, the fallback
    is a two-line change: drop the ``sorted(..., key=_keep_rank)`` call and
    keep each doc's first N records in encounter order instead (stable
    concatenation order) -- ``_cap_indices_by_doc`` isolates that decision
    to one spot.

``AssemblerParams.keep_all_multi_hop`` (default ``True``, already declared in
``studio/backend/params.py`` even though the old stub never read a real
``hop_type`` field) mirrors ``dataset_budget``'s own module docstring:
"Multi-hop pairs... are always kept in full... the remaining budget goes to
single-hop pairs." When set, multi-hop records (``hop_type != "single"``,
the same test ``qa_gen_pairs.py`` already uses for its own ``n_multihop``
meta count) bypass the cap entirely; only single-hop records are subject to
``_cap_indices_by_doc``. When ``False``, the cap applies to the full merged
pool regardless of hop type.

This block does NOT call ``dedup_pairs`` -- that is ``gate_dedup``'s job
(already wired). Assembler and gate_dedup are separate canvas nodes a user
wires in whatever order they choose; double-deduping here would be
redundant and would silently second-guess a gate the user placed elsewhere.

qa_id renumbering: each ``qa_gen_*`` block numbers its own output
independently (``qa_gen_pairs.py`` assigns ``V2Q00001``, ``V2Q00002``, ...
starting fresh per run -- see its own ``run()``), so merging N streams can
and typically will produce duplicate ``qa_id`` values across streams. The
studio's own static block catalog (``studio/core-ui/src/data/catalog.ts``,
already written before this task, independent confirmation of intended
scope) describes this block's purpose as "Merges QA streams, applies
target-total cap, renumbers qa_ids" -- so after merging and capping, this
block reassigns ``qa_id`` sequentially (``V2Q00001``, ``V2Q00002``, ... in
final output order) on a shallow copy of each surviving record, leaving all
other fields untouched.
"""
from __future__ import annotations

from pathlib import Path
from typing import Mapping, Sequence

from rag_gt.blocks._common import artifact, read_list_input, write_json_artifact
from rag_gt.generation.dataset_budget import _keep_rank, allocate_singles


def _is_multi_hop(qa: Mapping[str, object]) -> bool:
    return str(qa.get("hop_type", "single")) != "single"


def _cap_indices_by_doc(items: Sequence[Mapping[str, object]], indices: list[int], budget: int) -> list[int]:
    """Return the subset of ``indices`` (into ``items``) to keep, capped at
    ``budget`` total. Budget is split across each item's ``doc`` field via
    ``allocate_singles`` (proportional to each doc's own supply); within a
    doc whose allotment is below its supply, the survivors are the
    top-ranked ones by ``_keep_rank`` (higher evidence-unit count, then
    higher min clause NLI). Returned in ascending original-index order so
    callers can filter the source list and preserve relative order."""
    if budget <= 0 or not indices:
        return []

    by_doc: dict[str, list[int]] = {}
    for i in indices:
        by_doc.setdefault(str(items[i].get("doc", "")), []).append(i)

    counts = {doc: len(idxs) for doc, idxs in by_doc.items()}
    alloc = allocate_singles(counts, budget)

    kept: list[int] = []
    for doc, idxs in by_doc.items():
        n = alloc.get(doc, 0)
        if n >= len(idxs):
            kept.extend(idxs)
        else:
            ranked = sorted(idxs, key=lambda i: _keep_rank(items[i]), reverse=True)
            kept.extend(ranked[:n])
    kept.sort()
    return kept


def run(inputs: dict, params: dict, artifacts_dir: Path | str | None = None) -> dict:
    """``inputs``: ``{"qa": [<qa artifact>, ...]}`` -- multi-in port, always a
    list per the executor's ``resolve_inputs`` convention (matching
    ``report.py``'s ``inputs.get("eval") or []`` handling of its own
    multi-in ``eval`` port).

    ``params``: ``target_total`` (default 500; falsy/``None`` means no cap,
    matching the old stub's ``count_out = min(total, target_total) if
    target_total else total``), ``keep_all_multi_hop`` (default ``True``,
    see module docstring).

    Returns ``{"qa": {"type": "qa", "ref": <path>, "meta": {...}}}`` where
    the payload is the merged (and possibly capped) qa list, with every
    record's ``qa_id`` reassigned sequentially (``V2Q00001``, ...) in final
    output order to avoid collisions across independently-numbered upstream
    streams (see module docstring). ``meta`` reports ``count`` (final),
    ``count_before_cap``, ``count_after_cap``,
    ``multi_hop`` (final multi-hop count), ``n_sources`` and
    ``per_source_counts`` (one entry per input qa artifact, in wiring
    order), ``target_total``, and ``keep_all_multi_hop``.
    """
    qa_artifacts = inputs.get("qa") or []

    merged: list[dict] = []
    per_source_counts: list[int] = []
    for art in qa_artifacts:
        items = read_list_input(art)
        per_source_counts.append(len(items))
        merged.extend(items)

    total_before = len(merged)
    target_total = params.get("target_total", 500)
    keep_all_multi_hop = bool(params.get("keep_all_multi_hop", True))

    if not target_total or int(target_total) >= total_before:
        kept = merged
    else:
        target_total = int(target_total)
        if keep_all_multi_hop:
            multi_idx = [i for i, qa in enumerate(merged) if _is_multi_hop(qa)]
            single_idx = [i for i, qa in enumerate(merged) if not _is_multi_hop(qa)]
            singles_budget = max(0, target_total - len(multi_idx))
            kept_single_idx = _cap_indices_by_doc(merged, single_idx, singles_budget)
            kept_idx = sorted(multi_idx + kept_single_idx)
        else:
            kept_idx = _cap_indices_by_doc(merged, list(range(total_before)), target_total)
        kept = [merged[i] for i in kept_idx]

    kept = [dict(qa, qa_id=f"V2Q{i:05d}") for i, qa in enumerate(kept, start=1)]

    n_multi_hop_out = sum(1 for qa in kept if _is_multi_hop(qa))
    ref = write_json_artifact(artifacts_dir, "assembler", kept)
    meta = {
        "count": len(kept),
        "count_before_cap": total_before,
        "count_after_cap": len(kept),
        "multi_hop": n_multi_hop_out,
        "n_sources": len(qa_artifacts),
        "per_source_counts": per_source_counts,
        "target_total": target_total,
        "keep_all_multi_hop": keep_all_multi_hop,
    }
    return {"qa": artifact("qa", str(ref), meta)}
