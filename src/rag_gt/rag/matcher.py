"""CP3 — Fact containment checker (token overlap, >=60%).

fact_hit(fact, chunk_texts)  → bool
match_pair(pair, ranked_results, retriever, top_k) → MatchResult

Uses the same _tokenize and >=60% token overlap rule as evaluate.py
(_text_covered / _fact_chunk_ids) to ensure comparable semantics.

match_pair_exact(pair, ranked_results, fact_chunk_ids, top_k) → MatchResult
    Exact chunk-ID matcher (catalog Phase-1 P1.4, match_mode="exact-id" in
    rag_gt.blocks.evaluator / studio/backend/params.py::EvaluatorParams). A
    fact counts as covered only when a retrieved chunk_id is exactly equal to
    one of the fact's gold chunk_id(s) -- no partial-overlap credit, unlike
    match_pair's >=60% token-overlap rule. A fact's gold set can contain more
    than one chunk_id (a fact spanning >1 supporting span); the fact is
    scored as a hit if ANY retrieved chunk_id is in that set, mirroring
    match_pair's own per-fact semantics (fact_hit/fact_overlap also accept
    any single covering chunk, not all of them).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from rag_gt.core.config import load_config

# ---------------------------------------------------------------------------
# Tokenizer (identical to evaluate.py)
# ---------------------------------------------------------------------------

_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _tokenize(text: str) -> List[str]:
    return _TOKEN_RE.findall(text.lower())


# ---------------------------------------------------------------------------
# Core containment check
# ---------------------------------------------------------------------------

OVERLAP_THRESHOLD = float(
    load_config()["multigold_evaluation"]["match_overlap_min"]
)


def fact_hit(fact: dict, chunk_texts: List[str]) -> bool:
    """Return True if >=60% of the fact's tokens appear in any single chunk."""
    text = (fact.get("canonical_form") or fact.get("text") or "").strip()
    if not text:
        return False
    fact_toks = set(_tokenize(text))
    if not fact_toks:
        return False
    for ct in chunk_texts:
        chunk_toks = set(_tokenize(ct))
        if len(fact_toks & chunk_toks) / len(fact_toks) >= OVERLAP_THRESHOLD:
            return True
    return False


def fact_overlap(fact: dict, chunk_text: str) -> float:
    """Return the token overlap fraction (0..1) between fact and a single chunk."""
    text = (fact.get("canonical_form") or fact.get("text") or "").strip()
    if not text:
        return 0.0
    fact_toks = set(_tokenize(text))
    if not fact_toks:
        return 0.0
    chunk_toks = set(_tokenize(chunk_text))
    return len(fact_toks & chunk_toks) / len(fact_toks)


# ---------------------------------------------------------------------------
# MatchResult — output of match_pair
# ---------------------------------------------------------------------------

@dataclass
class FactMatch:
    fact_id: str
    fact_text: str
    hit: bool                         # covered in top_k
    first_hit_rank: Optional[int]     # 1-indexed rank of first covering chunk; None if miss
    best_overlap: float               # best overlap fraction across all retrieved chunks


@dataclass
class MatchResult:
    question: str
    pair_type: str
    depth: int
    page_spread: int
    necessity_score: float
    n_facts: int
    retrieved_chunk_ids: List[str]    # ordered by rank
    fact_matches: List[FactMatch]
    relevant_ranks: List[int] = field(default_factory=list)

    # Derived per-question metrics (filled by metrics.py)
    fact_recall_at_k: Dict[int, float] = field(default_factory=dict)  # k -> recall
    precision_at_k: Dict[int, float] = field(default_factory=dict)    # k -> relevant chunks / k
    precision_rw_at_k: Dict[int, float] = field(default_factory=dict) # k -> rank-weighted precision
    hit_at_k: Dict[int, int] = field(default_factory=dict)            # k -> 0/1
    mrr: float = 0.0
    ndcg_at_k: Dict[int, float] = field(default_factory=dict)         # k -> ndcg
    coverage: float = 0.0  # fact_recall over all retrieved (like evaluate.py)


# ---------------------------------------------------------------------------
# match_pair
# ---------------------------------------------------------------------------

def match_pair(
    pair: dict,
    ranked_results: List[Tuple[str, float]],   # [(chunk_id, score)] from retriever
    id_to_text: Dict[str, str],                # chunk_id -> text
    top_k_values: List[int] = (1, 3, 5, 10),
) -> MatchResult:
    """Match a GT pair against retrieval results.

    ranked_results should be sorted by descending score (rank 1 = first entry).
    id_to_text must cover all chunk_ids in ranked_results.
    """
    facts = pair.get("facts", [])
    ranked_ids = [cid for cid, _ in ranked_results]

    fact_matches: List[FactMatch] = []
    relevant_ranks: set[int] = set()
    for fact in facts:
        first_hit_rank: Optional[int] = None
        best_overlap = 0.0
        for rank, cid in enumerate(ranked_ids, start=1):
            chunk_text = id_to_text.get(cid, "")
            ov = fact_overlap(fact, chunk_text)
            if ov > best_overlap:
                best_overlap = ov
            if ov >= OVERLAP_THRESHOLD and first_hit_rank is None:
                first_hit_rank = rank
            if ov >= OVERLAP_THRESHOLD:
                relevant_ranks.add(rank)

        fm = FactMatch(
            fact_id=fact.get("fact_id", ""),
            fact_text=(fact.get("canonical_form") or fact.get("text") or ""),
            hit=first_hit_rank is not None,
            first_hit_rank=first_hit_rank,
            best_overlap=best_overlap,
        )
        fact_matches.append(fm)

    return MatchResult(
        question=pair.get("question", ""),
        pair_type=pair.get("pair_type", "unknown"),
        depth=pair.get("depth", len(facts)),
        page_spread=pair.get("page_spread", 0),
        necessity_score=pair.get("necessity_score", 0.0),
        n_facts=len(facts),
        retrieved_chunk_ids=ranked_ids,
        fact_matches=fact_matches,
        relevant_ranks=sorted(relevant_ranks),
    )


# ---------------------------------------------------------------------------
# match_pair_exact -- exact chunk-ID matcher (catalog Phase-1 P1.4)
# ---------------------------------------------------------------------------

def _gold_chunk_ids(fact_id: str, fact_chunk_ids: Dict[str, List[str]]) -> set:
    """Return the set of gold chunk_id(s) for a fact_id, coerced to str.

    fact_chunk_ids maps fact_id -> a list of one or more gold chunk_ids (a
    fact normally has exactly one, from its single supporting chunk, but the
    list shape supports facts grounded across more than one chunk).
    """
    ids = fact_chunk_ids.get(str(fact_id)) or []
    return {str(cid) for cid in ids if cid}


def match_pair_exact(
    pair: dict,
    ranked_results: List[Tuple[str, float]],   # [(chunk_id, score)] from retriever
    fact_chunk_ids: Dict[str, List[str]],      # fact_id -> gold chunk_id(s)
    top_k_values: List[int] = (1, 3, 5, 10),
) -> MatchResult:
    """Match a GT pair against retrieval results using exact chunk-ID equality.

    Unlike match_pair (>=60% token overlap between fact text and chunk text),
    a fact only counts as covered when a retrieved chunk_id is exactly equal
    to one of the fact's gold chunk_id(s) looked up from fact_chunk_ids --
    no partial credit for a near-miss chunk that merely shares vocabulary
    with the fact.

    fact_chunk_ids must cover the fact_ids referenced by pair["facts"]; a
    fact_id with no entry (or an empty entry) is treated as un-groundable and
    always scores a miss, never a crash.
    """
    facts = pair.get("facts", [])
    ranked_ids = [cid for cid, _ in ranked_results]

    fact_matches: List[FactMatch] = []
    relevant_ranks: set[int] = set()
    for fact in facts:
        gold_ids = _gold_chunk_ids(fact.get("fact_id", ""), fact_chunk_ids)
        first_hit_rank: Optional[int] = None
        best_overlap = 0.0  # binary for exact-id: 1.0 on an exact match, else 0.0

        if gold_ids:
            for rank, cid in enumerate(ranked_ids, start=1):
                if cid in gold_ids:
                    best_overlap = 1.0
                    if first_hit_rank is None:
                        first_hit_rank = rank
                    relevant_ranks.add(rank)

        fm = FactMatch(
            fact_id=fact.get("fact_id", ""),
            fact_text=(fact.get("canonical_form") or fact.get("text") or ""),
            hit=first_hit_rank is not None,
            first_hit_rank=first_hit_rank,
            best_overlap=best_overlap,
        )
        fact_matches.append(fm)

    return MatchResult(
        question=pair.get("question", ""),
        pair_type=pair.get("pair_type", "unknown"),
        depth=pair.get("depth", len(facts)),
        page_spread=pair.get("page_spread", 0),
        necessity_score=pair.get("necessity_score", 0.0),
        n_facts=len(facts),
        retrieved_chunk_ids=ranked_ids,
        fact_matches=fact_matches,
        relevant_ranks=sorted(relevant_ranks),
    )


# ---------------------------------------------------------------------------
# Smoke test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("=== CP3 Matcher Smoke Test ===")

    from rag_gt.rag.loader import load_chunks, load_gt_pairs
    from rag_gt.rag.retriever import BM25Retriever

    doc_id = "ecma404_json"
    chunks = load_chunks(doc_id)
    pairs = load_gt_pairs(doc_id)
    retriever = BM25Retriever(chunks)
    id_to_text = {c["chunk_id"]: c["text"] for c in chunks}

    hits = 0
    for pair in pairs[:5]:
        results = retriever.retrieve(pair["question"], top_k=10)
        mr = match_pair(pair, results, id_to_text)
        n_hit = sum(1 for fm in mr.fact_matches if fm.hit)
        hits += n_hit
        print(f"\nQ: {pair['question'][:70]}")
        print(f"  type={mr.pair_type} depth={mr.depth}")
        for fm in mr.fact_matches:
            symbol = "HIT" if fm.hit else "MISS"
            print(f"  [{symbol}] rank={fm.first_hit_rank} overlap={fm.best_overlap:.2f} "
                  f"| {fm.fact_text[:60]}")
    print(f"\nFact hits in first 5 pairs: {hits}")
