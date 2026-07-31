"""Block: gate_clause [FREE] -- qa -> qa.

This gate is a no-op by design: clause/joint/necessity/grounding filtering
already happens inside qa_gen_pairs/qa_gen_clusters/qa_gen_bridges via
gate_qa_group before a `qa` artifact ever exists. This node exists in the
canvas for documentation/future-decomposition purposes; disabling or
reordering it has no effect on filtering today.

Longer version, for whoever is tempted to assume this is an unimplemented
stub and "finish" it: ``rag_gt.generation.answer_first_v2.gate_qa_group``
(aliased ``_score_group``, exposed as ``gate_neighbor_pairs``/
``gate_clusters``) is ONE fused function that needs ``pairs``
(candidates), ``facts_by_id``, and ``drafts`` -- none of which exist any
more by the time execution reaches a downstream ``qa -> qa`` gate node in a
canvas graph. All three real QA-generation blocks (``qa_gen_pairs.py``,
``qa_gen_clusters.py``, ``qa_gen_bridges.py``) already call this fused gate
(or ``build_answer_first_pairs``, which fuses the same way) internally,
before their ``qa`` artifact is ever produced. So the clause-level NLI check
(entailment of each answer clause by its own source fact, threshold 0.65 in
the engine's own settings -- see ``TODO.md`` sec. 3's ``gate_clause`` row)
has ALWAYS already run by the time this node's input ``qa`` artifact exists.
There is no drafts/facts_by_id context left here to redo it, and no
threshold left to apply a second time -- the ``threshold`` param on this
block's studio params model (``GateClauseParams``, locked to 0.65) is
accepted but inert for the same reason ``bridge_quality``'s ``idf_floor``
param is inert: kept only so an old graph JSON referencing this param
doesn't fail to validate.

Once assembler/verifier (a separate task) or a future engine refactor
genuinely decomposes ``gate_qa_group`` into independently-callable
clause/joint/loo/grounding steps operating on an already-assembled ``qa``
record, this block is where that real clause check would move. Until then,
identity is the only correct behavior -- returning anything other than the
unmodified input would silently double-filter or invent a fake second
filtering pass with no real signal behind it.
"""
from __future__ import annotations

from pathlib import Path

from rag_gt.blocks._common import artifact, read_list_input, write_json_artifact


def run(inputs: dict, params: dict, artifacts_dir: Path | str | None = None) -> dict:
    """``inputs``: ``{"qa": <qa artifact>}``.

    ``params``: accepted but ignored (see module docstring) -- includes the
    studio ``threshold`` param, which has no effect.

    Returns ``{"qa": {"type": "qa", "ref": <path>, "meta": {...}}}`` where
    the payload is the input qa list, unchanged. ``meta`` reports ``count``
    and ``passthrough: True`` so a run trace makes clear no filtering
    happened at this node.
    """
    items = read_list_input(inputs.get("qa"))
    ref = write_json_artifact(artifacts_dir, "gate_clause", items)
    meta = {
        "count": len(items),
        "passthrough": True,
        "note": "identity pass-through; clause filtering already happened "
                "upstream inside qa_gen_pairs/qa_gen_clusters/qa_gen_bridges "
                "via gate_qa_group -- see module docstring",
    }
    return {"qa": artifact("qa", str(ref), meta)}
