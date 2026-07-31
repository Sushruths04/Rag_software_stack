"""Unit tests for rag_gt.rag.matcher: match_pair (token-overlap) and
match_pair_exact (exact chunk-ID, catalog Phase-1 P1.4 / evaluator's
match_mode="exact-id").

match_pair_exact is the counterpart added so retrieval evaluation can score
a fact as covered only when a retrieved chunk_id is exactly equal to one of
the fact's gold chunk_id(s) -- no partial credit for lexical overlap with
the wrong chunk. The contrast test below reproduces a scenario where
match_pair (overlap) WOULD score a hit off a near-duplicate chunk that
merely shares vocabulary with the fact, while match_pair_exact correctly
scores it a miss because the true source chunk was never retrieved.
"""
from __future__ import annotations

from rag_gt.rag.matcher import match_pair, match_pair_exact

FACT_TEXT = "The sky is blue during a clear day."

PAIR = {
    "question": "What color is the sky?",
    "pair_type": "single",
    "facts": [{"fact_id": "F1", "text": FACT_TEXT, "canonical_form": FACT_TEXT}],
}


def test_match_pair_exact_hit_on_exact_chunk_id():
    ranked = [("c1", 1.0), ("c2", 0.5)]
    fact_chunk_ids = {"F1": ["c1"]}

    mr = match_pair_exact(PAIR, ranked, fact_chunk_ids)

    assert mr.fact_matches[0].hit is True
    assert mr.fact_matches[0].first_hit_rank == 1
    assert mr.fact_matches[0].best_overlap == 1.0
    assert mr.relevant_ranks == [1]


def test_match_pair_exact_no_partial_credit_for_lexical_near_miss():
    """Reproduce the whole point of exact-id mode: a chunk that heavily
    overlaps lexically with the fact but is NOT the fact's gold chunk must
    not count, even though overlap-mode match_pair WOULD score it a hit.
    """
    near_dupe_text = (
        "It was a bright and blue clear day in the sky, not a cloud anywhere."
    )
    id_to_text = {"c2": near_dupe_text, "c3": "Completely unrelated filler text."}
    ranked = [("c2", 1.0), ("c3", 0.5)]  # the true gold chunk "c1" is never retrieved
    fact_chunk_ids = {"F1": ["c1"]}

    overlap_mr = match_pair(PAIR, ranked, id_to_text)
    exact_mr = match_pair_exact(PAIR, ranked, fact_chunk_ids)

    # Sanity check the contrast actually holds: overlap mode gives credit...
    assert overlap_mr.fact_matches[0].hit is True
    assert overlap_mr.fact_matches[0].best_overlap >= 0.6
    # ...exact-id mode does not, because "c1" (the real source) was never
    # retrieved -- c2's lexical similarity earns it nothing under exact-id.
    assert exact_mr.fact_matches[0].hit is False
    assert exact_mr.fact_matches[0].first_hit_rank is None
    assert exact_mr.fact_matches[0].best_overlap == 0.0
    assert exact_mr.relevant_ranks == []


def test_match_pair_exact_empty_ranked_results_is_a_clean_miss():
    fact_chunk_ids = {"F1": ["c1"]}

    mr = match_pair_exact(PAIR, [], fact_chunk_ids)

    assert mr.retrieved_chunk_ids == []
    assert mr.fact_matches[0].hit is False
    assert mr.fact_matches[0].first_hit_rank is None
    assert mr.relevant_ranks == []


def test_match_pair_exact_missing_gold_mapping_is_a_miss_not_a_crash():
    """A fact_id absent from fact_chunk_ids (e.g. an ungrounded fact) must
    not raise -- it is simply un-groundable and always scores a miss.
    """
    ranked = [("c1", 1.0)]
    fact_chunk_ids: dict = {}  # F1 has no entry at all

    mr = match_pair_exact(PAIR, ranked, fact_chunk_ids)

    assert mr.fact_matches[0].hit is False
    assert mr.fact_matches[0].first_hit_rank is None


def test_match_pair_exact_any_of_multiple_gold_chunk_ids_counts():
    """A fact grounded across >1 supporting chunk (fact_chunk_ids maps to a
    list of >1 id) is a hit if ANY of its gold chunk_ids is retrieved --
    mirrors match_pair's own per-fact "any covering chunk suffices" rule.
    """
    ranked = [("c9", 1.0), ("c2", 0.5)]
    fact_chunk_ids = {"F1": ["c1", "c2"]}  # c1 never retrieved, c2 is

    mr = match_pair_exact(PAIR, ranked, fact_chunk_ids)

    assert mr.fact_matches[0].hit is True
    assert mr.fact_matches[0].first_hit_rank == 2
