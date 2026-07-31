"""Block: gate_loo [FREE] -- qa -> qa.

This gate is a no-op by design: clause/joint/necessity/grounding filtering
already happens inside qa_gen_pairs/qa_gen_clusters/qa_gen_bridges via
gate_qa_group before a `qa` artifact ever exists. This node exists in the
canvas for documentation/future-decomposition purposes; disabling or
reordering it has no effect on filtering today.

Longer version: leave-one-out necessity (drop one fact at a time and check
the answer is no longer fully entailed -- ``leave_one_out_necessity``/
``leave_one_out_necessity_batch`` in ``rag_gt.allpdf.necessity``) is called
from inside ``rag_gt.generation.answer_first_v2.gate_qa_group`` as
``necessity_fn``, again against ``drafts``/``facts_by_id`` that only exist
during ``qa_gen_pairs``/``qa_gen_clusters``/``qa_gen_bridges`` execution
(see ``gate_clause.py``'s module docstring for the full architecture note).
A candidate that fails LOO necessity is rejected as ``loo_failed`` inside
that same upstream call, before its ``qa`` record is ever assembled -- so
every record that reaches THIS node already has ``necessity.passed: True``
recorded on it (see ``_qa_record``'s ``necessity`` field). There is no
drafts/facts_by_id context left at this point to re-run LOO, and nothing
left to gate on that has not already been decided.

Do not "finish" this block by inventing a second LOO pass -- identity is
the correct, final behavior until a real engine refactor decomposes
``gate_qa_group`` into independently-callable steps.
"""
from __future__ import annotations

from pathlib import Path

from rag_gt.blocks._common import artifact, read_list_input, write_json_artifact


def run(inputs: dict, params: dict, artifacts_dir: Path | str | None = None) -> dict:
    """``inputs``: ``{"qa": <qa artifact>}``.

    ``params``: accepted but ignored (see module docstring) -- this gate has
    no studio-side threshold params (``GateLooParams`` is empty).

    Returns ``{"qa": {"type": "qa", "ref": <path>, "meta": {...}}}`` where
    the payload is the input qa list, unchanged. ``meta`` reports ``count``
    and ``passthrough: True`` so a run trace makes clear no filtering
    happened at this node.
    """
    items = read_list_input(inputs.get("qa"))
    ref = write_json_artifact(artifacts_dir, "gate_loo", items)
    meta = {
        "count": len(items),
        "passthrough": True,
        "note": "identity pass-through; leave-one-out necessity filtering "
                "already happened upstream inside qa_gen_pairs/"
                "qa_gen_clusters/qa_gen_bridges via gate_qa_group -- see "
                "module docstring",
    }
    return {"qa": artifact("qa", str(ref), meta)}
