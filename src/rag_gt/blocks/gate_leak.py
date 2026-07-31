"""Block: gate_leak [FREE] -- qa -> qa.

Unlike its four siblings (``gate_clause``/``gate_joint``/``gate_loo``/
``gate_grounding`` -- all identity pass-throughs, see their module
docstrings for why), this gate does REAL, separable work: it wraps
``rag_gt.generation.answer_first_v2.qa_bridge_hidden``, a new standalone
post-assembly check that did not exist before this task (TODO.md sec. 3/8's
``gate_leak`` row).

Every OTHER bridge-leak check in the engine runs during LLM drafting, as
part of a retry loop (``_draft_question``/``_draft_with_retries`` calling
``bridge_is_hidden`` against a not-yet-accepted question draft, grepped as
``invalid_or_bridge_leak`` in ``answer_first_v2.py``). That retry loop has
already run and finished by the time a ``qa`` artifact exists, same as the
other four gates' upstream filtering -- so this block is NOT redoing that
work. What it adds is a genuinely new, independent check: given an
ALREADY-ASSEMBLED ``qa`` record (from any source -- ``qa_gen_pairs``,
``qa_gen_clusters``, ``qa_gen_bridges``, ``qa_import``, or a hand-edited
canvas artifact), does the bridge phrase recorded on ``bridge_entity``
still appear in the record's own ``question`` text? This can catch a
leak the drafting-time loop missed (or one introduced downstream, e.g. by
a manual edit or an import from another pipeline run) -- a real, if small,
second line of defense, not a re-application of the same decision.

``qa_bridge_hidden`` reuses ``bridge_is_hidden``'s exact substring-match
rule verbatim (normalized-form padded match, compact-form match for
punctuation/spacing variants, short-all-alpha-prefix match for plural/
possessive forms) -- this module never invents new matching logic.
"""
from __future__ import annotations

from pathlib import Path

from rag_gt.blocks._common import artifact, read_list_input, write_json_artifact
from rag_gt.generation.answer_first_v2 import qa_bridge_hidden


def run(inputs: dict, params: dict, artifacts_dir: Path | str | None = None) -> dict:
    """``inputs``: ``{"qa": <qa artifact>}``.

    ``params``: none (``GateLeakParams`` is empty).

    Returns ``{"qa": {"type": "qa", "ref": <path>, "meta": {...}}}`` where
    the payload is every input record for which ``qa_bridge_hidden`` is
    True (kept), in original order. ``meta`` reports ``count`` (kept),
    ``count_in`` (before this gate), and ``dropped_leak`` (how many were
    dropped for a leaked bridge phrase).
    """
    items = read_list_input(inputs.get("qa"))
    kept = [item for item in items if qa_bridge_hidden(item)]
    dropped = len(items) - len(kept)

    ref = write_json_artifact(artifacts_dir, "gate_leak", kept)
    meta = {
        "count": len(kept),
        "count_in": len(items),
        "dropped_leak": dropped,
    }
    return {"qa": artifact("qa", str(ref), meta)}
