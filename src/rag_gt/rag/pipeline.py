"""CP5 — End-to-end RAG evaluation orchestrator.

Usage:
    python -m rag_gt.rag.pipeline --doc-id ecma404_json
    python -m rag_gt.rag.pipeline --doc-id din_iso_15609_welding_procedure \
        --strategy bm25 --chunk-strategy sentence --top-k 10

Arguments:
    --doc-id          One of the 13 known doc_ids (required)
    --strategy        Retriever: bm25 | hybrid (default: bm25)
    --chunk-strategy  Chunking: original | sentence | sliding_256 | paragraph
                      (default: original)
    --top-k           Max chunks to retrieve per query (default: 10)
    --out             Path to write JSON results (optional)
    --verbose         Print per-pair details

Returns (stdout):
    JSON with aggregate metrics + per-pair breakdown.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

from rag_gt.rag.loader import load_chunks, load_gt_pairs, rechunk, ALL_DOC_IDS
from rag_gt.rag.retriever import BM25Retriever, HybridRetriever, build_retriever
from rag_gt.rag.matcher import match_pair, MatchResult
from rag_gt.rag.metrics import fill_metrics, aggregate, AggregateMetrics


# ---------------------------------------------------------------------------
# Core evaluation function (importable by batch runner)
# ---------------------------------------------------------------------------

def evaluate_doc(
    doc_id: str,
    retriever_strategy: str = "bm25",
    chunk_strategy: str = "original",
    top_k: int = 10,
    verbose: bool = False,
    pairs: Optional[List[dict]] = None,
    chunks: Optional[List[dict]] = None,
) -> Dict:
    """Evaluate one document with given strategies.

    ``pairs``/``chunks``: pre-loaded GT pairs and chunks. When supplied the
    13-doc corpus map is bypassed entirely and ``doc_id`` is just a label —
    this is how documents outside the thesis corpus get evaluated (load them
    with ``load_gt_pairs_from`` / ``load_chunks_from``).

    Returns a dict with:
        doc_id, chunk_strategy, retriever_strategy, top_k,
        n_chunks, n_pairs, wall_sec,
        aggregate: {summary dict},
        per_pair: [{per-question result dict}]
    """
    t0 = time.time()

    # Load
    if pairs is None:
        pairs = load_gt_pairs(doc_id)
    raw_chunks = load_chunks(doc_id) if chunks is None else chunks
    chunks = rechunk(raw_chunks, chunk_strategy)

    if not pairs:
        return {
            "doc_id": doc_id,
            "chunk_strategy": chunk_strategy,
            "retriever_strategy": retriever_strategy,
            "top_k": top_k,
            "n_chunks": len(chunks),
            "n_pairs": 0,
            "wall_sec": round(time.time() - t0, 2),
            "aggregate": {"n_pairs": 0},
            "per_pair": [],
        }

    # Build retriever
    retriever = build_retriever(chunks, strategy=retriever_strategy)
    id_to_text: Dict[str, str] = {
        c.get("chunk_id", ""): c.get("text", "") for c in chunks
    }

    # Evaluate each pair
    match_results: List[MatchResult] = []
    per_pair_output: List[dict] = []

    for idx, pair in enumerate(pairs):
        ranked = retriever.retrieve(pair["question"], top_k=top_k)
        mr = match_pair(pair, ranked, id_to_text)
        fill_metrics(mr)
        match_results.append(mr)

        if verbose:
            _print_pair(idx, mr)

        # Compact per-pair output
        pair_out = {
            "question": mr.question[:120],
            "pair_type": mr.pair_type,
            "depth": mr.depth,
            "page_spread": mr.page_spread,
            "necessity_score": mr.necessity_score,
            "n_facts": mr.n_facts,
            "mrr": round(mr.mrr, 4),
            "coverage": round(mr.coverage, 4),
        }
        for k, v in mr.fact_recall_at_k.items():
            pair_out[f"fact_recall@{k}"] = round(v, 4)
        for k, v in mr.hit_at_k.items():
            pair_out[f"hit@{k}"] = v
        for k, v in mr.ndcg_at_k.items():
            pair_out[f"ndcg@{k}"] = round(v, 4)

        # Fact-level hits
        pair_out["fact_hits"] = [
            {
                "fact_id": fm.fact_id,
                "hit": fm.hit,
                "first_hit_rank": fm.first_hit_rank,
                "best_overlap": round(fm.best_overlap, 3),
            }
            for fm in mr.fact_matches
        ]
        per_pair_output.append(pair_out)

    agg = aggregate(match_results)

    # By-type breakdown
    type_breakdown = {}
    for pt, sub_agg in sorted(agg.by_pair_type.items()):
        type_breakdown[pt] = sub_agg.summary()

    return {
        "doc_id": doc_id,
        "chunk_strategy": chunk_strategy,
        "retriever_strategy": retriever_strategy,
        "top_k": top_k,
        "n_chunks": len(chunks),
        "n_pairs": agg.n_pairs,
        "wall_sec": round(time.time() - t0, 2),
        "aggregate": agg.summary(),
        "by_pair_type": type_breakdown,
        "per_pair": per_pair_output,
    }


def _print_pair(idx: int, mr: MatchResult) -> None:
    fr5 = mr.fact_recall_at_k.get(5, 0.0)
    print(f"  [{idx:03d}] {mr.pair_type} depth={mr.depth} "
          f"fr@5={fr5:.2f} mrr={mr.mrr:.3f} | {mr.question[:60]}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="No-API RAG evaluation: evaluate one document's GT pairs "
                    "with BM25 retrieval and token-overlap fact matching."
    )
    p.add_argument("--doc-id", required=True,
                   help=f"Document ID. One of: {', '.join(ALL_DOC_IDS)}")
    p.add_argument("--strategy", default="bm25",
                   choices=["bm25", "hybrid"],
                   help="Retriever strategy (default: bm25)")
    p.add_argument("--chunk-strategy", default="original",
                   choices=["original", "sentence", "sliding_256", "paragraph"],
                   help="Chunking strategy (default: original)")
    p.add_argument("--top-k", type=int, default=10,
                   help="Top-K chunks to retrieve per question (default: 10)")
    p.add_argument("--out", type=Path, default=None,
                   help="Write JSON results to this file")
    p.add_argument("--verbose", action="store_true",
                   help="Print per-pair details to stderr")
    p.add_argument("--pairs-file", type=Path, default=None,
                   help="Explicit GT pairs file (JSONL or JSON array). With "
                        "--chunks-file, bypasses the built-in corpus map so "
                        "any document can be evaluated.")
    p.add_argument("--chunks-file", type=Path, default=None,
                   help="Explicit chunks file (s2_chunks_full.json shape).")
    return p


def main(argv: Optional[List[str]] = None) -> None:
    args = _build_parser().parse_args(argv)

    explicit_files = args.pairs_file is not None and args.chunks_file is not None
    if (args.pairs_file is None) != (args.chunks_file is None):
        print("ERROR: --pairs-file and --chunks-file must be given together",
              file=sys.stderr)
        sys.exit(1)

    if not explicit_files and args.doc_id not in ALL_DOC_IDS:
        print(f"ERROR: unknown doc_id {args.doc_id!r}", file=sys.stderr)
        print(f"Known: {ALL_DOC_IDS} (or pass --pairs-file/--chunks-file)",
              file=sys.stderr)
        sys.exit(1)

    print(f"[pipeline] doc_id={args.doc_id} chunk={args.chunk_strategy} "
          f"retriever={args.strategy} top_k={args.top_k}", file=sys.stderr)

    pairs = chunks = None
    if explicit_files:
        from rag_gt.rag.loader import load_chunks_from, load_gt_pairs_from
        pairs = load_gt_pairs_from(args.pairs_file, doc_id=args.doc_id)
        # Pair files carry pairs for exactly one doc more often than not; if
        # doc_id filtering leaves nothing, fall back to the whole file.
        if not pairs:
            pairs = load_gt_pairs_from(args.pairs_file)
        chunks = load_chunks_from(args.chunks_file)

    result = evaluate_doc(
        doc_id=args.doc_id,
        retriever_strategy=args.strategy,
        chunk_strategy=args.chunk_strategy,
        top_k=args.top_k,
        verbose=args.verbose,
        pairs=pairs,
        chunks=chunks,
    )

    agg = result["aggregate"]
    print(
        f"[pipeline] done: n_pairs={result['n_pairs']} "
        f"n_chunks={result['n_chunks']} "
        f"fact_recall@5={agg.get('fact_recall@5', 0):.3f} "
        f"hit@5={agg.get('hit@5', 0):.3f} "
        f"mrr={agg.get('mrr', 0):.3f} "
        f"coverage={agg.get('coverage', 0):.3f} "
        f"({result['wall_sec']:.1f}s)",
        file=sys.stderr,
    )

    out_json = json.dumps(result, indent=2)

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(out_json, encoding="utf-8")
        print(f"[pipeline] results written to {args.out}", file=sys.stderr)

    print(out_json)


if __name__ == "__main__":
    main()
