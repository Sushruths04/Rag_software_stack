"""Block: gate_grounding [FREE] -- qa -> qa.

This gate is a no-op by design: clause/joint/necessity/grounding filtering
already happens inside qa_gen_pairs/qa_gen_clusters/qa_gen_bridges via
gate_qa_group before a `qa` artifact ever exists. This node exists in the
canvas for documentation/future-decomposition purposes; disabling or
reordering it has no effect on filtering today.

Longer version: the ``require_chunk_ids=True`` grounding check (every fact
backing an answer must resolve a real chunk id -- ``record["grounding_complete"]``,
rejected as ``ungrounded_chunk_ids``) runs inside
``rag_gt.generation.answer_first_v2.gate_qa_group``, immediately before the
``qa`` record for an accepted candidate is appended to the block's output
(see ``gate_clause.py``'s module docstring for the full architecture note).
``qa_gen_pairs``/``qa_gen_clusters`` default ``require_chunk_ids=True``;
``qa_gen_bridges`` defaults it to ``False`` to match
``build_answer_first_pairs``'s own default -- either way, the decision is
already baked into whatever ``qa`` artifact reaches this node. This is an
engine-side HARD rule (TODO.md sec. 3's ``gate_grounding`` row: "must stay
strict when wired, never a soft warning") -- but there is nothing left here
to make strict or soft, since the grounding check already ran, upstream,
with whatever strictness the generating block was configured for.

Do not "finish" this block by re-deriving grounding_complete and filtering
on it here -- doing so would silently second-guess a decision the upstream
block already made with its own (possibly different) require_chunk_ids
setting, which is worse than a documented no-op. Identity is the correct,
final behavior until a real engine refactor decomposes ``gate_qa_group``
into independently-callable steps.
"""
from __future__ import annotations

from pathlib import Path

from rag_gt.blocks._common import artifact, read_list_input, write_json_artifact


def run(inputs: dict, params: dict, artifacts_dir: Path | str | None = None) -> dict:
    """``inputs``: ``{"qa": <qa artifact>}``.

    ``params``: accepted but ignored (see module docstring) -- this gate has
    no studio-side threshold params (``GateGroundingParams`` is empty).

    Returns ``{"qa": {"type": "qa", "ref": <path>, "meta": {...}}}`` where
    the payload is the input qa list, unchanged. ``meta`` reports ``count``
    and ``passthrough: True`` so a run trace makes clear no filtering
    happened at this node.
    """
    items = read_list_input(inputs.get("qa"))
    ref = write_json_artifact(artifacts_dir, "gate_grounding", items)
    meta = {
        "count": len(items),
        "passthrough": True,
        "note": "identity pass-through; require_chunk_ids grounding "
                "filtering already happened upstream inside qa_gen_pairs/"
                "qa_gen_clusters/qa_gen_bridges via gate_qa_group -- see "
                "module docstring",
    }
    return {"qa": artifact("qa", str(ref), meta)}
