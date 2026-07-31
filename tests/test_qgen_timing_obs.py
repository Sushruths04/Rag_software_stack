"""Stage-7 timing observability must cover the single-fact QGen path.

Found on the 2026-07-10 resnet_arxiv run: Stage 7 took 188s but reported
qgen_total=0.0s, because only the two-fact path appended to qgen_times while
the run's chains were almost all single-fact.
"""

from types import SimpleNamespace

from rag_gt.allpdf import pipeline as pl
from rag_gt.core.types import Fact, FactChain


def _fact(fid: str) -> Fact:
    return Fact(
        fact_id=fid,
        text="The vacuum chamber pressure limit is 3 pascal during bake-out.",
        raw_text="The vacuum chamber pressure limit is 3 pascal during bake-out.",
        canonical_form="The vacuum chamber pressure limit is 3 pascal during bake-out.",
        self_containment_score=1.0,
        self_containment_known=True,
        role="descriptive",
        weight=0.5,
        supporting_spans=[],
    )


def test_single_fact_qgen_timing_is_recorded(monkeypatch):
    from rag_gt.generation import questions as qmod
    from rag_gt.generation import answers as amod
    from rag_gt.allpdf import grounding as gmod

    monkeypatch.setattr(
        qmod, "generate_question",
        lambda facts, llm, **kw: "What is the vacuum chamber pressure limit?",
    )
    monkeypatch.setattr(
        amod, "generate_answer",
        lambda q, facts, llm, **kw: "3 pascal during bake-out.",
    )
    monkeypatch.setattr(amod, "is_abstention", lambda a: False)
    monkeypatch.setattr(gmod, "is_grounded", lambda a, facts: True)

    fact = _fact("doc_F000001")
    chains = [FactChain(fact_ids=[fact.fact_id])]
    pairs = pl._run_qgen(chains, {fact.fact_id: fact}, llm=object(), answer_llm=object())

    assert len(pairs) == 1
    obs = pl._run_qgen.last_obs
    # One timed QGen call and one timed AGen call must be visible in the obs,
    # even though the only chain was single-fact.
    assert obs["n_qgen_calls"] == 1
    assert obs["n_agen_calls"] == 1
    assert obs["qgen_total_sec"] >= 0.0
    assert obs["agen_total_sec"] >= 0.0
