"""Executor parity test: chains REGISTRY_LIVE's 9 live block adapters
together using real checked-in din_iso_6507_vickers data (the 05_BLOCK_
CATALOG.md wire-badge examples "118 facts" / "172 pairs" are this exact
document's real counts) and asserts studio.backend.executor.Executor
produces the same artifacts/numbers as calling the underlying rag_gt
engine functions directly.

evaluator's "qa" input has no live producer among these 9 blocks -- that is
the PAID generation stage (blocks 15-17), explicitly out of scope for this
M0 milestone. A checked-in v2 QA file for this document does exist
(data/eval_results/allpdf_qa_pairs_v2_din_iso_6507.json) but was generated
against a different iteration of the fact set than the checked-in grounded
facts file used here (its gold_fact_ids are not a subset of
facts_din_iso_6507_vickers_full.json's 118 ids -- confirmed by hand), so
using it would either silently skip real KeyErrors or misrepresent GT/fact
sync as broken. Instead, a trivial test-local "qa_source" PlanNode (not part
of REGISTRY/REGISTRY_LIVE) turns neighbor_sampler's own real candidate pairs
into v2-shaped QA records: gold_fact_ids/gold_pages come straight from the
real facts, and the "question" is the first fact's own real canonical_form
text (a deterministic, grounded stand-in for an LLM-generated question --
sufficient to exercise the real matcher/metrics pipeline correctly, which is
all a parity check needs). Every other node in the chain uses REGISTRY_
LIVE's real BlockSpec end to end.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

WORKTREE_ROOT = Path(__file__).resolve().parents[3]

# Same rationale as studio/backend/adapters_live.py's own sys.path fix: the
# `rag_gt` editable install resolves to the main repo checkout, which lacks
# this worktree's generation/*.py additions (answer_first.py, neighbor_pairs.py,
# cluster_bridge.py). Force this worktree's src/ to the front before any
# `import rag_gt...` below (including inside adapters_live, imported lazily).
_SRC = WORKTREE_ROOT / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

_DATA_ROOT = Path(os.environ.get("RAG_GT_DATA_ROOT", str(WORKTREE_ROOT)))
_CHUNKS_AVAILABLE = (
    _DATA_ROOT / "data" / "test_corpus_allpdf" / "pipeline_run"
    / "din_iso_6507_vickers_phase2" / "checkpoints" / "s2_chunks_full.json"
).exists()

pytestmark = pytest.mark.skipif(
    not _CHUNKS_AVAILABLE,
    reason="chunk data not reachable: set RAG_GT_DATA_ROOT to a checkout that has "
           "data/test_corpus_allpdf/pipeline_run/din_iso_6507_vickers_phase2/"
           "checkpoints/s2_chunks_full.json",
)

DOC_ID = "din_iso_6507_vickers"
FACTS_PATH = WORKTREE_ROOT / "data" / "eval_results" / "facts_v1_grounded" / f"facts_{DOC_ID}_full.json"
BRIDGE_PAIRS_PATH = WORKTREE_ROOT / "data" / "eval_results" / "allpdf_bridge_pairs_clean.json"

NEIGHBOR_PARAMS = {"window": 3, "min_cosine": 0.40, "max_cosine": 0.95, "max_uses_per_fact": 2}
CLUSTER_PARAMS = {"window": 3, "min_cosine": 0.40, "max_cosine": 0.95}


def _din_iso_bridge_pairs_file(tmp_path) -> Path:
    payload = json.loads(BRIDGE_PAIRS_PATH.read_text(encoding="utf-8"))
    sub = [p for p in payload["pairs"] if p.get("doc") == f"{DOC_ID}_full"]
    out = tmp_path / "bridge_pairs.json"
    out.write_text(json.dumps({"pairs": sub}), encoding="utf-8")
    return out


def _candidate_pairs_to_qa(candidate_pairs: list, facts: list) -> list:
    fact_by_id = {f["fact_id"]: f for f in facts}
    qa_pairs = []
    for i, cp in enumerate(candidate_pairs):
        fa, fb = fact_by_id.get(cp["fact_a"]), fact_by_id.get(cp["fact_b"])
        if not fa or not fb:
            continue
        qa_pairs.append(
            {
                "qa_id": f"SYN{i:05d}",
                "question": fa.get("canonical_form") or fa.get("text") or "",
                "evidence_strategy": "neighbor_pair_v2",
                "gold_fact_ids": [cp["fact_a"], cp["fact_b"]],
                "gold_pages": [fa.get("page_start"), fb.get("page_start")],
                "necessity": {"necessity_score": 1.0},
            }
        )
    return qa_pairs


def _build_plan(tmp_path):
    from studio.backend.adapters_live import REGISTRY_LIVE
    from studio.backend.compiler import CompiledPlan, CostRollup, PlanNode
    from studio.backend.registry import BlockSpec, PortSpec
    from studio.backend import params as P

    bridge_pairs_path = _din_iso_bridge_pairs_file(tmp_path)

    def _qa_source_run(inputs: dict, params: dict) -> dict:
        from rag_gt.blocks._common import artifact, read_list_input, write_json_artifact

        candidate_pairs = read_list_input(inputs.get("candidates"))
        facts = read_list_input(inputs.get("facts"))
        qa_pairs = _candidate_pairs_to_qa(candidate_pairs, facts)
        ref = write_json_artifact(tmp_path, "qa_source", qa_pairs)
        return {"qa": artifact("qa", str(ref), {"count": len(qa_pairs)})}

    qa_source_spec = BlockSpec(
        type="qa_source",
        category="sources",
        cost="free",
        inputs=(PortSpec("candidates", "candidates"), PortSpec("facts", "facts")),
        outputs=(PortSpec("qa", "qa"),),
        params=P.QaImportParams,
        run=_qa_source_run,
    )

    def node(block_id, block_type, params, wiring=None, spec=None):
        return PlanNode(
            block_id=block_id,
            type=block_type,
            spec=spec or REGISTRY_LIVE[block_type],
            params=params,
            input_wiring=wiring or {},
        )

    nodes = {
        "chunks_import": node("chunks_import", "chunks_import", {"doc_id": DOC_ID}),
        "facts_import": node("facts_import", "facts_import", {"path": str(FACTS_PATH)}),
        "bridges_import": node("bridges_import", "bridges_import", {"path": str(bridge_pairs_path)}),
        "neighbor_sampler": node(
            "neighbor_sampler", "neighbor_sampler", NEIGHBOR_PARAMS,
            wiring={"facts": [("facts_import", "facts")]},
        ),
        "cluster_builder": node(
            "cluster_builder", "cluster_builder", CLUSTER_PARAMS,
            wiring={"bridges": [("bridges_import", "bridges")], "facts": [("facts_import", "facts")]},
        ),
        "index_builder": node(
            "index_builder", "index_builder", {"strategy": "bm25", "embedding_source": "local"},
            wiring={"chunks": [("chunks_import", "chunks")]},
        ),
        "qa_source": node(
            "qa_source", "qa_source", {},
            wiring={"candidates": [("neighbor_sampler", "candidates")], "facts": [("facts_import", "facts")]},
            spec=qa_source_spec,
        ),
        "evaluator": node(
            "evaluator", "evaluator", {"top_k": 10, "match_mode": "overlap"},
            wiring={
                "qa": [("qa_source", "qa")],
                "index": [("index_builder", "index")],
                "facts": [("facts_import", "facts")],
            },
        ),
        "report": node(
            "report", "report", {"format": "md"},
            wiring={"eval": [("evaluator", "eval")]},
        ),
    }
    order = [
        "chunks_import", "facts_import", "bridges_import",
        "neighbor_sampler", "cluster_builder", "index_builder",
        "qa_source", "evaluator", "report",
    ]
    return CompiledPlan(order=order, nodes=nodes, warnings=[], cost=CostRollup(total_calls=0, paid_blocks=[]))


def test_executor_chain_matches_direct_engine_calls(tmp_path):
    from studio.backend.executor import Executor

    from rag_gt.generation.answer_first import _load_records
    from rag_gt.generation.cluster_bridge import build_clusters
    from rag_gt.generation.neighbor_pairs import sample_neighbor_pairs
    from rag_gt.rag.eval_v2 import v2_pair_to_eval
    from rag_gt.rag.loader import load_chunks
    from rag_gt.rag.matcher import match_pair
    from rag_gt.rag.metrics import aggregate, fill_metrics
    from rag_gt.rag.retriever import build_retriever

    plan = _build_plan(tmp_path)
    artifacts = Executor(plan).run()

    # --- chunks_import parity -------------------------------------------
    expected_chunks = load_chunks(DOC_ID)
    assert artifacts["chunks_import"]["chunks"]["meta"]["count"] == len(expected_chunks)

    # --- facts_import parity ---------------------------------------------
    expected_facts = _load_records(FACTS_PATH)
    assert artifacts["facts_import"]["facts"]["meta"]["count"] == len(expected_facts) == 118

    # --- bridges_import parity --------------------------------------------
    bridge_pairs_path = tmp_path / "bridge_pairs.json"
    expected_bridges = _load_records(bridge_pairs_path, "pairs")
    assert artifacts["bridges_import"]["bridges"]["meta"]["count"] == len(expected_bridges) == 172

    # --- neighbor_sampler parity --------------------------------------------
    expected_neighbor_pairs = sample_neighbor_pairs(expected_facts, doc=DOC_ID, **NEIGHBOR_PARAMS)
    assert artifacts["neighbor_sampler"]["candidates"]["meta"]["pairs"] == len(expected_neighbor_pairs)
    assert len(expected_neighbor_pairs) > 0

    # --- cluster_builder parity --------------------------------------------
    expected_clusters, expected_fallback = build_clusters(expected_bridges, expected_facts, **CLUSTER_PARAMS)
    assert artifacts["cluster_builder"]["candidates"]["meta"]["clusters"] == len(expected_clusters)
    assert artifacts["cluster_builder"]["candidates"]["meta"]["pairs"] == len(expected_fallback)

    # --- index_builder parity --------------------------------------------
    assert artifacts["index_builder"]["index"]["meta"]["docs"] == len(expected_chunks)

    # --- qa_source: real fact-grounded synthetic QA, not empty ---------------
    qa_pairs = json.loads(Path(artifacts["qa_source"]["qa"]["ref"]).read_text(encoding="utf-8"))
    assert artifacts["qa_source"]["qa"]["meta"]["count"] == len(qa_pairs) == len(expected_neighbor_pairs)

    # --- evaluator parity: full independent recompute of the matcher pipeline
    lookup = {f["fact_id"]: (f.get("canonical_form") or f.get("text") or "") for f in expected_facts}
    retriever = build_retriever(expected_chunks, strategy="bm25", embed_source="local")
    id_to_text = {c.get("chunk_id", ""): c.get("text", "") for c in expected_chunks}
    rows = []
    for pair in qa_pairs:
        eval_pair = v2_pair_to_eval(pair, lookup)
        ranked = retriever.retrieve(eval_pair["question"], top_k=10)
        rows.append(fill_metrics(match_pair(eval_pair, ranked, id_to_text)))
    expected_summary = aggregate(rows).summary()

    eval_meta = artifacts["evaluator"]["eval"]["meta"]
    assert eval_meta["n_pairs"] == len(qa_pairs)
    assert {k: v for k, v in eval_meta.items() if k != "top_k"} == expected_summary
    # Sanity: since each synthetic question IS fact_a's own text, fact_a
    # should be trivially retrievable near the top for every row.
    assert expected_summary["fact_recall@5"] > 0.0

    # --- report: one row rendered from the evaluator's real summary ----------
    report_meta = artifacts["report"]["report"]["meta"]
    assert report_meta["n_inputs"] == 1
    report_text = Path(artifacts["report"]["report"]["ref"]).read_text(encoding="utf-8")
    assert f"{expected_summary['n_pairs']}" in report_text
