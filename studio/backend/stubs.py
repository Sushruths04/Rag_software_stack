"""Stub block adapters: ``run(inputs: dict, params: dict) -> dict``.

These are placeholders for the real ``rag_gt.blocks.*`` SDK adapters the M0
engine refactor (05_BLOCK_CATALOG.md §4) will produce. Every function here is
pure, deterministic, and imports nothing from ``rag_gt`` or ``production`` —
this scaffold must run with zero GPU/API/cost. Each function returns typed
fake artifacts of the shape ``{"type": <port type id>, "ref": <str>,
"meta": {...}}`` matching the port-type system in §1 of the catalog.

Real adapters: # TODO(M0-refactor) — swap each ``run_*`` body for a call into
``rag_gt.blocks.<block_type>.run`` once the engine-side split lands.

Input convention (set by the executor, see executor.py._resolve_inputs):
  - a single-wire input port resolves to one artifact dict (or None if an
    optional port has no wire).
  - a multi-in port (PortSpec.multi=True, e.g. assembler's "qa", report's
    "eval") resolves to a list of artifact dicts.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CostEstimate:
    """Estimated cost for one PAID block invocation, computed from a single
    context dict (matches the plan's ``estimate: Callable[[dict], CostEstimate]``).
    """

    calls: int
    usd: float | None = None
    note: str = ""


def _artifact(type_id: str, ref: str, meta: dict) -> dict:
    return {"type": type_id, "ref": ref, "meta": meta}


def _meta_count(artifact: dict | None, key: str = "count", default: int = 0) -> int:
    if not artifact:
        return default
    return int(artifact.get("meta", {}).get(key, default))


def _as_list(value) -> list:
    """Normalize a resolved multi-in input (list) or single-in input (dict
    or None) into a list of artifacts."""
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


# ---------------------------------------------------------------------------
# Sources & imports
# ---------------------------------------------------------------------------


def run_pdf_source(inputs: dict, params: dict) -> dict:  # TODO(M0-refactor)
    doc_id = params.get("doc_id") or "doc"
    return {"pdf": _artifact("pdf", f"stub:pdf_source:{doc_id}", {"pages": 46, "doc_id": doc_id})}


def run_chunks_import(inputs: dict, params: dict) -> dict:  # TODO(M0-refactor)
    path = params.get("path", "")
    return {"chunks": _artifact("chunks", f"stub:chunks_import:{path}", {"count": 210})}


def run_facts_import(inputs: dict, params: dict) -> dict:  # TODO(M0-refactor)
    path = params.get("path", "")
    return {"facts": _artifact("facts", f"stub:facts_import:{path}", {"count": 118, "grounded": True})}


def run_bridges_import(inputs: dict, params: dict) -> dict:  # TODO(M0-refactor)
    path = params.get("path", "")
    return {"bridges": _artifact("bridges", f"stub:bridges_import:{path}", {"count": 172})}


def run_qa_import(inputs: dict, params: dict) -> dict:  # TODO(M0-refactor)
    path = params.get("path", "")
    return {"qa": _artifact("qa", f"stub:qa_import:{path}", {"count": 86, "multi_hop": 33})}


# ---------------------------------------------------------------------------
# Extraction & cleaning
# ---------------------------------------------------------------------------


def run_chunker(inputs: dict, params: dict) -> dict:  # TODO(M0-refactor)
    base = _meta_count(inputs.get("chunks"), "count", 210)
    strategy = params.get("strategy", "original")
    window = params.get("window", 256)
    factor = {"original": 1.0, "sentence": 1.4, "sliding_256": 1.2, "paragraph": 0.6}.get(strategy, 1.0)
    count_out = max(1, int(base * factor))
    return {
        "chunks": _artifact(
            "chunks", f"stub:chunker:{strategy}:{window}", {"count": count_out, "strategy": strategy}
        )
    }


def run_fact_extract_llm(inputs: dict, params: dict) -> dict:  # TODO(M0-refactor)
    count_in = _meta_count(inputs.get("chunks"), "count", 210)
    batch_size = params.get("batch_size", 8)
    count_out = max(1, count_in // 2)
    return {
        "facts": _artifact(
            "facts", f"stub:fact_extract_llm:{batch_size}", {"count": count_out, "grounded": False}
        )
    }


def run_fact_debris_filter(inputs: dict, params: dict) -> dict:  # TODO(M0-refactor)
    facts_in = inputs.get("facts")
    count_in = _meta_count(facts_in, "count", 118)
    threshold = params.get("symbol_density_threshold", 0.4)
    dropped = int(count_in * threshold * 0.1)
    count_out = max(0, count_in - dropped)
    grounded = bool((facts_in or {}).get("meta", {}).get("grounded", True))
    return {"facts": _artifact("facts", "stub:fact_debris_filter", {"count": count_out, "grounded": grounded})}


def run_fact_splitter(inputs: dict, params: dict) -> dict:  # TODO(M0-refactor)
    facts_in = inputs.get("facts")
    count_in = _meta_count(facts_in, "count", 118)
    max_tokens = params.get("max_tokens", 45)
    count_out = count_in + max(0, count_in // 10)
    grounded = bool((facts_in or {}).get("meta", {}).get("grounded", True))
    return {
        "facts": _artifact(
            "facts", f"stub:fact_splitter:{max_tokens}", {"count": count_out, "grounded": grounded}
        )
    }


def run_provenance_join(inputs: dict, params: dict) -> dict:  # TODO(M0-refactor)
    count_in = _meta_count(inputs.get("facts"), "count", 118)
    return {"facts": _artifact("facts", "stub:provenance_join", {"count": count_in, "grounded": True})}


# ---------------------------------------------------------------------------
# Mining & sampling
# ---------------------------------------------------------------------------


def run_bridge_miner(inputs: dict, params: dict) -> dict:  # TODO(M0-refactor)
    count_in = _meta_count(inputs.get("facts"), "count", 118)
    count_out = max(0, int(count_in * 1.4))
    return {"bridges": _artifact("bridges", "stub:bridge_miner", {"count": count_out})}


def run_bridge_quality(inputs: dict, params: dict) -> dict:  # TODO(M0-refactor)
    count_in = _meta_count(inputs.get("bridges"), "count", 172)
    idf_floor = params.get("idf_floor", 0.0)
    count_out = max(0, int(count_in * (1 - min(idf_floor, 0.5))))
    return {"bridges": _artifact("bridges", "stub:bridge_quality", {"count": count_out})}


def run_neighbor_sampler(inputs: dict, params: dict) -> dict:  # TODO(M0-refactor)
    count_in = _meta_count(inputs.get("facts"), "count", 118)
    window = params.get("window", 3)
    max_uses = params.get("max_uses_per_fact", 2)
    pairs = max(0, (count_in * max_uses) // max(1, window))
    max_pairs = params.get("max_pairs")
    if max_pairs is not None:
        pairs = min(pairs, max_pairs)
    return {
        "candidates": _artifact(
            "candidates", f"stub:neighbor_sampler:{window}", {"pairs": pairs, "clusters": 0}
        )
    }


def run_cluster_builder(inputs: dict, params: dict) -> dict:  # TODO(M0-refactor)
    bcount = _meta_count(inputs.get("bridges"), "count", 172)
    fcount = _meta_count(inputs.get("facts"), "count", 118)
    window = params.get("window", 3)
    clusters = max(0, bcount // max(1, window))
    leftover_pairs = max(0, fcount // 20)
    return {
        "candidates": _artifact(
            "candidates", f"stub:cluster_builder:{window}", {"pairs": leftover_pairs, "clusters": clusters}
        )
    }


# ---------------------------------------------------------------------------
# Generation (all PAID except demotion)
# ---------------------------------------------------------------------------


def run_qa_gen_pairs(inputs: dict, params: dict) -> dict:  # TODO(M0-refactor)
    pairs = _meta_count(inputs.get("candidates"), "pairs", 52)
    return {"qa": _artifact("qa", "stub:qa_gen_pairs", {"count": pairs, "multi_hop": 0})}


def run_qa_gen_clusters(inputs: dict, params: dict) -> dict:  # TODO(M0-refactor)
    clusters = _meta_count(inputs.get("candidates"), "clusters", 147)
    return {"qa": _artifact("qa", "stub:qa_gen_clusters", {"count": clusters, "multi_hop": clusters})}


def run_qa_gen_bridges(inputs: dict, params: dict) -> dict:  # TODO(M0-refactor)
    count_in = _meta_count(inputs.get("bridges"), "count", 172)
    return {"qa": _artifact("qa", "stub:qa_gen_bridges", {"count": count_in, "multi_hop": count_in})}


def run_demotion(inputs: dict, params: dict) -> dict:  # TODO(M0-refactor)
    bridges_count = _meta_count(inputs.get("bridges"), "count", 0)
    rejected_qa_count = _meta_count(inputs.get("qa"), "count", 0)
    return {"bridges": _artifact("bridges", "stub:demotion", {"count": bridges_count + rejected_qa_count})}


# ---------------------------------------------------------------------------
# Gates (all FREE — local NLI on GPU)
# ---------------------------------------------------------------------------


def _make_gate_stub(name: str, pass_rate: float):
    def run(inputs: dict, params: dict) -> dict:  # TODO(M0-refactor)
        qa_in = inputs.get("qa")
        count_in = _meta_count(qa_in, "count", 0)
        mh_in = _meta_count(qa_in, "multi_hop", 0)
        count_out = int(count_in * pass_rate)
        mh_out = int(mh_in * pass_rate)
        return {"qa": _artifact("qa", f"stub:{name}", {"count": count_out, "multi_hop": mh_out})}

    run.__name__ = f"run_{name}"
    return run


run_gate_clause = _make_gate_stub("gate_clause", 0.90)
run_gate_joint = _make_gate_stub("gate_joint", 0.85)
run_gate_loo = _make_gate_stub("gate_loo", 0.95)
run_gate_grounding = _make_gate_stub("gate_grounding", 1.00)
run_gate_leak = _make_gate_stub("gate_leak", 0.97)
run_gate_dedup = _make_gate_stub("gate_dedup", 0.93)


# ---------------------------------------------------------------------------
# Assembly, verification, evaluation
# ---------------------------------------------------------------------------


def run_assembler(inputs: dict, params: dict) -> dict:  # TODO(M0-refactor)
    qa_artifacts = _as_list(inputs.get("qa"))
    total = sum(_meta_count(a, "count", 0) for a in qa_artifacts)
    mh_total = sum(_meta_count(a, "multi_hop", 0) for a in qa_artifacts)
    target_total = params.get("target_total", 500)
    count_out = min(total, target_total) if target_total else total
    return {"qa": _artifact("qa", "stub:assembler", {"count": count_out, "multi_hop": mh_total})}


def run_verifier(inputs: dict, params: dict) -> dict:  # TODO(M0-refactor)
    qa_in = inputs.get("qa")
    count_in = _meta_count(qa_in, "count", 0)
    mh_in = _meta_count(qa_in, "multi_hop", 0)
    return {"qa": _artifact("qa", "stub:verifier", {"count": count_in, "multi_hop": mh_in})}


def run_index_builder(inputs: dict, params: dict) -> dict:  # TODO(M0-refactor)
    count_in = _meta_count(inputs.get("chunks"), "count", 210)
    strategy = params.get("strategy", "bm25")
    return {"index": _artifact("index", f"stub:index_builder:{strategy}", {"strategy": strategy, "docs": count_in})}


def run_evaluator(inputs: dict, params: dict) -> dict:  # TODO(M0-refactor)
    count_qa = _meta_count(inputs.get("qa"), "count", 0)
    top_k = params.get("top_k", 10)
    recall = min(0.99, 0.5 + top_k * 0.02)
    return {
        "eval": _artifact(
            "eval", f"stub:evaluator:k{top_k}", {"recall_at_k": round(recall, 3), "k": top_k, "n_qa": count_qa}
        )
    }


def run_sweep(inputs: dict, params: dict) -> dict:  # TODO(M0-refactor)
    grid = params.get("grid", {})
    n_configs = 1
    for values in grid.values():
        n_configs *= max(1, len(values))
    return {"eval": _artifact("eval", "stub:sweep", {"n_configs": n_configs, "winner_recall_at_k": 0.70})}


def run_report(inputs: dict, params: dict) -> dict:  # TODO(M0-refactor)
    eval_artifacts = _as_list(inputs.get("eval"))
    fmt = params.get("format", "html")
    return {"report": _artifact("report", f"stub:report.{fmt}", {"path": f"report.{fmt}", "n_inputs": len(eval_artifacts)})}


def run_bbox_viewer(inputs: dict, params: dict) -> dict:  # TODO(M0-refactor)
    return {"report": _artifact("report", "stub:bbox_viewer.html", {"path": "bbox_viewer.html"})}


# ---------------------------------------------------------------------------
# Utility (no ports)
# ---------------------------------------------------------------------------


def run_note(inputs: dict, params: dict) -> dict:
    return {}


def run_cost_probe(inputs: dict, params: dict) -> dict:
    return {}


# ---------------------------------------------------------------------------
# Cost estimators — single-dict-arg per the plan's
# ``estimate: Callable[[dict], CostEstimate]``; ctx = {"inputs": ..., "params": ...}.
# Call-count formulas from 05_BLOCK_CATALOG.md §3.33 (round-2 run averages):
# pairs x1.3, clusters x3.5 (the "~n_clusters x 3-5 calls" range), bridges x1.6.
#
# $ pricing: chat-call estimates are converted to USD from (a) public list
# prices per 1k tokens for the configured RAG_LLM_CHAT_MODEL and (b) the
# measured blended tokens/call of a real full-pipeline run (resnet_arxiv,
# 2026-07-10: 1,068 chat calls, 921,726 prompt + 57,856 completion tokens
# -> 863 prompt / 54 completion per call). A model that is not in the price
# table keeps usd=None — the sheet then shows its honest "no per-call
# pricing configured" fallback instead of a fabricated figure.
# ---------------------------------------------------------------------------

# USD per 1k tokens (public list prices; the RWTH endpoint itself is not
# billed per token — this is the comparable real-money figure).
_PRICE_PER_1K_USD: dict[str, dict[str, float]] = {
    "mistralai/Mistral-Small-3.2-24B-Instruct-2506": {"prompt": 0.0001, "completion": 0.0003},
    "openai/gpt-oss-20b": {"prompt": 0.0002, "completion": 0.0006},
    "openai/gpt-oss-120b": {"prompt": 0.0004, "completion": 0.0015},
}

# Measured blended averages across every chat call of the 2026-07-10
# resnet_arxiv run (extraction + QGen + AGen).
_AVG_PROMPT_TOKENS_PER_CALL = 863
_AVG_COMPLETION_TOKENS_PER_CALL = 54


def _chat_model() -> str:
    import os

    model = os.environ.get("RAG_LLM_CHAT_MODEL", "").strip()
    if not model:
        try:
            from dotenv import load_dotenv

            load_dotenv()
            model = os.environ.get("RAG_LLM_CHAT_MODEL", "").strip()
        except ImportError:
            pass
    return model


def _usd_for_chat_calls(calls: int) -> float | None:
    """USD estimate for `calls` chat completions, or None when the configured
    model has no price-table entry (never fabricate a number)."""
    if calls == 0:
        return 0.0
    prices = _PRICE_PER_1K_USD.get(_chat_model())
    if prices is None:
        return None
    per_call = (
        _AVG_PROMPT_TOKENS_PER_CALL / 1000.0 * prices["prompt"]
        + _AVG_COMPLETION_TOKENS_PER_CALL / 1000.0 * prices["completion"]
    )
    return round(calls * per_call, 4)


def estimate_fact_extract_llm(ctx: dict) -> CostEstimate:
    count_in = _meta_count(ctx.get("inputs", {}).get("chunks"), "count", 0)
    batch_size = ctx.get("params", {}).get("batch_size", 8) or 1
    calls = -(-count_in // batch_size)  # ceil division
    return CostEstimate(calls=calls, usd=_usd_for_chat_calls(calls), note="ceil(chunks / batch_size)")


def estimate_qa_gen_pairs(ctx: dict) -> CostEstimate:
    pairs = _meta_count(ctx.get("inputs", {}).get("candidates"), "pairs", 0)
    calls = round(pairs * 1.3)
    return CostEstimate(calls=calls, usd=_usd_for_chat_calls(calls), note="pairs x1.3 (round-2 avg)")


def estimate_qa_gen_clusters(ctx: dict) -> CostEstimate:
    clusters = _meta_count(ctx.get("inputs", {}).get("candidates"), "clusters", 0)
    calls = round(clusters * 3.5)
    return CostEstimate(calls=calls, usd=_usd_for_chat_calls(calls), note="clusters x3.5 (3-5 calls/cluster avg)")


def estimate_qa_gen_bridges(ctx: dict) -> CostEstimate:
    count_in = _meta_count(ctx.get("inputs", {}).get("bridges"), "count", 0)
    calls = round(count_in * 1.6)
    return CostEstimate(calls=calls, usd=_usd_for_chat_calls(calls), note="bridges x1.6 (round-2 avg)")


def estimate_verifier(ctx: dict) -> CostEstimate:
    count_in = _meta_count(ctx.get("inputs", {}).get("qa"), "count", 0)
    return CostEstimate(calls=count_in, usd=_usd_for_chat_calls(count_in), note="1 judge call per borderline QA record")


def estimate_bridge_miner(ctx: dict) -> CostEstimate:
    scorer = ctx.get("params", {}).get("cosine_scorer", "off")
    if scorer != "api":
        return CostEstimate(calls=0, usd=0.0, note="local/off cosine scorer: no API calls")
    count_in = _meta_count(ctx.get("inputs", {}).get("facts"), "count", 0)
    # Embedding calls have no measured token basis yet — usd stays None
    # rather than pricing them off the chat-call averages.
    return CostEstimate(calls=count_in, note="api cosine scorer: 1 embedding call per fact (worst case)")
