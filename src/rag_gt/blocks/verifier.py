"""Block: verifier [PAID] -- qa + facts -> qa.

Wraps ``rag_gt.validation.verify_v2.verify_v2_pairs`` verbatim (TODO.md sec.
3/8's ``verifier`` row -- note the row names the MODULE ``verify_v2``, but
the actual callable is ``verify_v2_pairs``). Per that function's own module
docstring, this is the Stage D cascade: deterministic-first verification
(per-clause entailment, joint entailment, pairwise duplicate-clause check)
with an LLM judge escalation ONLY for borderline-margin cases. This block
does not skip or shortcut any of that -- it just resolves ``llm``/``nli_fn``
the same way the other LLM-touching blocks do and passes everything through
to the real function unchanged.

``verify_v2_pairs`` does not filter -- it returns every input QA, in
original order, each annotated with a ``verify`` dict (``verdict``,
``reason``, ``faithful``, ``duplicate``, ``borderline``, ``judge_used``,
``scores``, ...), plus an aggregate ``stats`` dict. This block mirrors that:
it does not drop REJECTed records either. Whether/where a downstream node
filters on ``verify.verdict == "PASS"`` is a separate canvas decision, not
this block's job -- same separation-of-concerns argument as
``assembler.py`` not calling ``dedup_pairs`` itself.

Registry note: the stub-era ``registry.py`` entry for ``verifier`` declared
only a single ``qa`` input port, but ``verify_v2_pairs`` requires ``facts``
as a mandatory positional argument (support text for every clause- and
joint-entailment NLI call) -- there is no way to verify anything without
it. A ``facts`` input port (mirroring ``evaluator``'s existing ``qa`` +
``index`` + ``facts`` three-port pattern) was added to the ``verifier``
``BlockSpec`` in ``registry.py`` so the real adapter has something to
receive; this is the one place this task touches a file outside the
assembler/verifier block modules + wiring, and it does not change any
other block's ports.

``VerifierParams.model_role`` (default ``"verifier"``) is threaded through
to ``get_llm(role=...)`` the same way ``qa_gen_pairs``/``fact_extract_llm``
thread their own ``llm_role`` param -- just under this block's own studio
field name. ``VerifierParams.workers`` has no real counterpart in
``verify_v2_pairs`` (which takes no worker/parallelism argument at all) and
is accepted-but-inert here, the same documented pattern as
``bridge_quality``'s ``idf_floor`` / ``gate_clause``'s ``threshold``.
"""
from __future__ import annotations

from pathlib import Path

from rag_gt.blocks._common import artifact, read_list_input, write_json_artifact
from rag_gt.core.llm import get_llm
from rag_gt.validation.nli_check import nli_batch
from rag_gt.validation.verify_v2 import verify_v2_pairs


def run(inputs: dict, params: dict, artifacts_dir: Path | str | None = None) -> dict:
    """``inputs``: ``{"qa": <qa artifact>, "facts": <facts artifact>}``.

    ``params``: ``model_role`` (optional; default ``"verifier"``), ``llm``
    (optional -- FakeLLM in tests, else defaults to
    ``get_llm(params.get("model_role", "verifier"))`` -- only actually
    called for borderline cases, per the cascade's own design),
    ``nli_fn`` (optional override; default ``nli_batch``), ``settings``
    (optional override dict for ``verify_v2_pairs``' thresholds; default
    ``None`` lets it fall back to its own ``_settings()``/config load),
    ``workers`` (accepted, inert -- see module docstring).

    Returns ``{"qa": {"type": "qa", "ref": <path>, "meta": {...}}}`` where
    the payload is every input QA record with its ``verify`` field attached
    (nothing filtered out), in original order. ``meta`` includes ``count``
    (== input count, since nothing is dropped here), ``count_in``, and the
    full ``stats`` dict ``verify_v2_pairs`` returns (``n_input``,
    ``n_v1_bridge_routed``, ``n_v2_native``, ``verdicts`` histogram,
    ``reasons`` histogram, ``nli_truncation``).
    """
    qa_pairs = read_list_input(inputs.get("qa"))
    facts = read_list_input(inputs.get("facts"))

    llm = params.get("llm") or get_llm(str(params.get("model_role", "verifier")))
    nli_fn = params.get("nli_fn", nli_batch)
    settings = params.get("settings")

    result = verify_v2_pairs(qa_pairs, facts, llm=llm, nli_fn=nli_fn, settings=settings)
    verified = result["pairs"]
    stats = result["stats"]

    ref = write_json_artifact(artifacts_dir, "verifier", verified)
    meta = {
        "count": len(verified),
        "count_in": len(qa_pairs),
        **stats,
    }
    return {"qa": artifact("qa", str(ref), meta)}
