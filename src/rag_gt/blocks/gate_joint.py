"""Block: gate_joint [FREE] -- qa -> qa.

This gate is a no-op by design: clause/joint/necessity/grounding filtering
already happens inside qa_gen_pairs/qa_gen_clusters/qa_gen_bridges via
gate_qa_group before a `qa` artifact ever exists. This node exists in the
canvas for documentation/future-decomposition purposes; disabling or
reordering it has no effect on filtering today.

Longer version: the joint-necessity NLI check this node's name refers to
(each single fact must NOT already entail the answer alone -- score below
``single_max``/0.50 -- and the facts concatenated together MUST entail it --
score at or above ``joint_min``/0.85) lives inside
``rag_gt.generation.answer_first_v2.gate_qa_group``, run against ``drafts``
and ``facts_by_id`` that only exist during ``qa_gen_pairs``/
``qa_gen_clusters``/``qa_gen_bridges`` execution, immediately before those
blocks' own ``qa`` artifact is produced (see ``gate_clause.py``'s module
docstring for the full architecture note -- it applies identically here).
By the time a ``qa`` artifact reaches this node, that decision has already
been made and the facts/drafts context needed to redo it no longer exists.
This block's studio params model (``GateJointParams``, ``single_fact_max``/
``joint_min`` locked to 0.50/0.85) is accepted but inert, for the same
reason ``gate_clause``'s ``threshold`` param is inert.

Do not "finish" this block by inventing a second, redundant joint check --
identity is the correct, final behavior until a real engine refactor
decomposes ``gate_qa_group`` into independently-callable steps.
"""
from __future__ import annotations

from pathlib import Path

from rag_gt.blocks._common import artifact, read_list_input, write_json_artifact


def run(inputs: dict, params: dict, artifacts_dir: Path | str | None = None) -> dict:
    """``inputs``: ``{"qa": <qa artifact>}``.

    ``params``: accepted but ignored (see module docstring) -- includes the
    studio ``single_fact_max``/``joint_min`` params, which have no effect.

    Returns ``{"qa": {"type": "qa", "ref": <path>, "meta": {...}}}`` where
    the payload is the input qa list, unchanged. ``meta`` reports ``count``
    and ``passthrough: True`` so a run trace makes clear no filtering
    happened at this node.
    """
    items = read_list_input(inputs.get("qa"))
    ref = write_json_artifact(artifacts_dir, "gate_joint", items)
    meta = {
        "count": len(items),
        "passthrough": True,
        "note": "identity pass-through; joint-necessity filtering already "
                "happened upstream inside qa_gen_pairs/qa_gen_clusters/"
                "qa_gen_bridges via gate_qa_group -- see module docstring",
    }
    return {"qa": artifact("qa", str(ref), meta)}
