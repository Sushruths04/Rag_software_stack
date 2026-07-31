"""Block: evaluator [FREE] -- qa + index + facts -> eval.

Wraps rag_gt.rag.eval_v2.v2_pair_to_eval + rag_gt.rag.matcher.match_pair /
match_pair_exact + rag_gt.rag.metrics.fill_metrics/aggregate verbatim
(05_BLOCK_CATALOG.md §3.28). The retriever is rebuilt from the index
artifact's manifest (see rag_gt.blocks.index_builder) by calling
build_retriever again on the referenced chunks.

match_mode="overlap" (default) scores a fact as covered when a retrieved
chunk has >=60% token overlap with the fact text (rag_gt.rag.matcher.
match_pair). match_mode="exact-id" (catalog Phase-1 P1.4) instead scores a
fact as covered only when a retrieved chunk_id exactly equals the fact's
gold chunk_id -- no partial-overlap credit -- via
rag_gt.rag.matcher.match_pair_exact. Any other match_mode string is not a
recognised mode and still raises rather than silently falling back to
token-overlap matching.
"""
from __future__ import annotations

import dataclasses
from pathlib import Path

from rag_gt.blocks._common import artifact, read_json_artifact, read_list_input, write_json_artifact
from rag_gt.rag.eval_v2 import v2_pair_to_eval
from rag_gt.rag.matcher import match_pair, match_pair_exact
from rag_gt.rag.metrics import aggregate, fill_metrics
from rag_gt.rag.retriever import build_retriever

_KNOWN_MATCH_MODES = ("overlap", "exact-id")


def run(inputs: dict, params: dict, artifacts_dir: Path | str | None = None) -> dict:
    match_mode = str(params.get("match_mode") or "overlap")
    if match_mode not in _KNOWN_MATCH_MODES:
        raise NotImplementedError(
            f"evaluator match_mode={match_mode!r} is not implemented in "
            f"rag_gt.rag.matcher; supported modes are {_KNOWN_MATCH_MODES!r}."
        )
    top_k = int(params.get("top_k", 10))

    facts = read_list_input(inputs.get("facts"))
    fact_text_by_id = {
        str(f.get("fact_id")): str(f.get("canonical_form") or f.get("text") or "")
        for f in facts
    }
    # Gold chunk_id(s) per fact, used only by match_mode="exact-id". A fact
    # normally carries a single flattened "chunk_id" (see facts_v1_grounded
    # schema); "chunk_ids" (plural) is accepted too for facts grounded across
    # more than one supporting chunk.
    fact_chunk_ids = {
        str(f.get("fact_id")): (
            [str(f["chunk_id"])] if f.get("chunk_id") else [str(c) for c in f.get("chunk_ids") or []]
        )
        for f in facts
    }

    index_artifact = inputs.get("index")
    manifest = read_json_artifact(index_artifact["ref"])
    chunks = read_json_artifact(manifest["chunks_ref"])
    retriever = build_retriever(
        chunks, strategy=manifest["strategy"], embed_source=manifest.get("embed_source", "local")
    )
    id_to_text = {c.get("chunk_id", ""): c.get("text", "") for c in chunks}

    qa_pairs = read_list_input(inputs.get("qa"))
    rows = []
    for pair in qa_pairs:
        eval_pair = v2_pair_to_eval(pair, fact_text_by_id)
        ranked = retriever.retrieve(eval_pair["question"], top_k=top_k)
        if match_mode == "exact-id":
            rows.append(fill_metrics(match_pair_exact(eval_pair, ranked, fact_chunk_ids)))
        else:
            rows.append(fill_metrics(match_pair(eval_pair, ranked, id_to_text)))

    agg = aggregate(rows)
    summary = agg.summary()
    by_pair_type = {pt: a.summary() for pt, a in sorted(agg.by_pair_type.items())}

    payload = {
        "top_k": top_k,
        "summary": summary,
        "by_pair_type": by_pair_type,
        "rows": [dataclasses.asdict(r) for r in rows],
    }
    ref = write_json_artifact(artifacts_dir, "evaluator", payload)
    return {"eval": artifact("eval", str(ref), {**summary, "top_k": top_k})}
