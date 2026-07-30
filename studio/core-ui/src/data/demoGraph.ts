/**
 * Static demo graph — "Full GT pipeline (v2)" template shape, per the M5
 * milestone in 02_PHASE2_APP_PLAN.md ("reproduces scripts/run_v2_fullcorpus.py
 * as a graph — proof the block decomposition is complete"). All run states
 * are "done" with plausible mock meta/badges so the canvas is visually
 * verifiable with zero backend calls.
 *
 * Shape: PDF Source -> Chunker / Facts -> Bridge Miner -> Neighbor Sampler +
 * Cluster Builder -> Gates -> Assembler -> Index + Evaluator -> Report.
 */
import type { GraphDoc } from "../types/graph";

export const DEMO_GRAPH: GraphDoc = {
  schema_version: 1,
  name: "Full GT pipeline (v2)",
  meta: {
    created: "2026-06-01T09:00:00Z",
    modified: "2026-07-07T10:00:00Z",
    notes: "Static demo — din_iso_6507_vickers, mock run, no backend calls.",
  },
  blocks: [
    // ---- sources -------------------------------------------------------
    { id: "b1", type: "pdf_source", position: { x: 0, y: 340 }, runState: "done",
      params: { path: "din_iso_6507.pdf", doc_id: "din_iso_6507_vickers" },
      runMeta: { metaLine: "46 pages", portBadges: { pdf: "46 pages" } } },
    { id: "b2", type: "chunks_import", position: { x: 0, y: 0 }, runState: "done",
      runMeta: { metaLine: "210 chunks", portBadges: { chunks: "210 chunks" } } },
    { id: "b3", type: "facts_import", position: { x: 0, y: 680 }, runState: "done",
      runMeta: { metaLine: "553 facts · grounded", portBadges: { facts: "553 facts · grounded" } } },

    // ---- extraction & cleaning -----------------------------------------
    { id: "b4", type: "chunker", position: { x: 420, y: 0 }, runState: "done",
      params: { strategy: "sliding_256" },
      runMeta: { metaLine: "224 chunks", portBadges: { chunks: "224 chunks" } } },
    { id: "b5", type: "fact_debris_filter", position: { x: 420, y: 680 }, runState: "done",
      runMeta: { metaLine: "553 → 531 facts", portBadges: { facts: "531 facts · grounded" } } },

    // ---- mining & sampling ----------------------------------------------
    { id: "b6", type: "bridge_miner", position: { x: 840, y: 540 }, runState: "done",
      runMeta: { metaLine: "172 bridges mined", portBadges: { bridges: "172 pairs" } } },
    { id: "b7", type: "neighbor_sampler", position: { x: 840, y: 860 }, runState: "done",
      runMeta: { metaLine: "52 pairs sampled", portBadges: { candidates: "52 pairs" } } },
    { id: "b8", type: "bridge_quality", position: { x: 1260, y: 540 }, runState: "done",
      runMeta: { metaLine: "172 → 147 bridges", portBadges: { bridges: "147 pairs" } } },
    { id: "b9", type: "cluster_builder", position: { x: 1260, y: 860 }, runState: "done",
      runMeta: { metaLine: "147 clusters · 25 fallback", portBadges: { candidates: "147 clusters · 25 fallback" } } },

    // ---- generation (paid) -----------------------------------------------
    { id: "b10", type: "qa_gen_pairs", position: { x: 1680, y: 860 }, runState: "done",
      runMeta: { metaLine: "86 QA drafted", portBadges: { qa: "86 QA · draft" } } },
    { id: "b11", type: "qa_gen_clusters", position: { x: 1680, y: 540 }, runState: "done",
      runMeta: { metaLine: "147 QA drafted", portBadges: { qa: "147 QA · draft" } } },

    // ---- gates (neighbor path) --------------------------------------------
    { id: "b12", type: "gate_clause", position: { x: 2100, y: 860 }, runState: "done",
      runMeta: { metaLine: "86 → 79 · rejected 7", portBadges: { qa: "79 QA" } } },
    { id: "b13", type: "gate_joint", position: { x: 2520, y: 860 }, runState: "done",
      runMeta: { metaLine: "79 → 71 · rejected 8", portBadges: { qa: "71 QA" } } },
    { id: "b14", type: "gate_dedup", position: { x: 2940, y: 860 }, runState: "done",
      runMeta: { metaLine: "71 → 68 · rejected 3", portBadges: { qa: "68 QA · 22 multi-hop" } } },

    // ---- gates (cluster path) ----------------------------------------------
    { id: "b15", type: "gate_clause", position: { x: 2100, y: 540 }, runState: "done",
      runMeta: { metaLine: "147 → 129 · rejected 18", portBadges: { qa: "129 QA" } } },
    { id: "b16", type: "gate_loo", position: { x: 2520, y: 540 }, runState: "done",
      runMeta: { metaLine: "129 → 109 · rejected 20", portBadges: { qa: "109 QA" } } },
    { id: "b17", type: "gate_grounding", position: { x: 2940, y: 540 }, runState: "done",
      runMeta: { metaLine: "109 → 101 · rejected 8", portBadges: { qa: "101 QA · 101 multi-hop" } } },

    // ---- assembly, index, eval, report --------------------------------------
    { id: "b18", type: "assembler", position: { x: 3360, y: 700 }, runState: "done",
      params: { target_total: "336" },
      runMeta: { metaLine: "336 QA · 123 multi-hop", portBadges: { qa: "336 QA · 123 multi-hop" } } },
    { id: "b19", type: "index_builder", position: { x: 840, y: 0 }, runState: "done",
      params: { strategy: "bm25" },
      runMeta: { metaLine: "bm25 · 224 docs", portBadges: { index: "bm25 · 224 docs" } } },
    { id: "b20", type: "bbox_viewer", position: { x: 3780, y: 940 }, runState: "done",
      runMeta: { metaLine: "336 QA · bbox linked", portBadges: { report: "evidence.html" } } },
    { id: "b21", type: "evaluator", position: { x: 3780, y: 340 }, runState: "done",
      params: { top_k: "5" },
      runMeta: { metaLine: "recall@5 0.698 · f1_rw 0.611", portBadges: { eval: "recall@5 0.698" } } },
    { id: "b22", type: "report", position: { x: 4200, y: 340 }, runState: "done",
      runMeta: { metaLine: "report.html written", portBadges: { report: "report.html" } } },
  ],
  wires: [
    { id: "w1", from: { block: "b2", port: "chunks" }, to: { block: "b4", port: "chunks" }, badge: "210 chunks" },
    { id: "w2", from: { block: "b4", port: "chunks" }, to: { block: "b19", port: "chunks" }, badge: "224 chunks" },
    { id: "w3", from: { block: "b3", port: "facts" }, to: { block: "b5", port: "facts" }, badge: "553 facts · grounded" },
    { id: "w4", from: { block: "b5", port: "facts" }, to: { block: "b6", port: "facts" }, badge: "531 facts · grounded" },
    { id: "w5", from: { block: "b5", port: "facts" }, to: { block: "b7", port: "facts" }, badge: "531 facts · grounded" },
    { id: "w6", from: { block: "b6", port: "bridges" }, to: { block: "b8", port: "bridges" }, badge: "172 pairs" },
    { id: "w7", from: { block: "b8", port: "bridges" }, to: { block: "b9", port: "bridges" }, badge: "147 pairs" },
    { id: "w8", from: { block: "b5", port: "facts" }, to: { block: "b9", port: "facts" }, badge: "531 facts · grounded", weight: "heavy" },
    { id: "w9", from: { block: "b7", port: "candidates" }, to: { block: "b10", port: "candidates" }, badge: "52 pairs" },
    { id: "w10", from: { block: "b5", port: "facts" }, to: { block: "b10", port: "facts" }, badge: "531 facts · grounded" },
    { id: "w11", from: { block: "b9", port: "candidates" }, to: { block: "b11", port: "candidates" }, badge: "147 clusters · 25 fallback" },
    { id: "w12", from: { block: "b5", port: "facts" }, to: { block: "b11", port: "facts" }, badge: "531 facts · grounded" },
    { id: "w13", from: { block: "b10", port: "qa" }, to: { block: "b12", port: "qa" }, badge: "86 QA · draft" },
    { id: "w14", from: { block: "b12", port: "qa" }, to: { block: "b13", port: "qa" }, badge: "79 QA" },
    { id: "w15", from: { block: "b13", port: "qa" }, to: { block: "b14", port: "qa" }, badge: "71 QA" },
    { id: "w16", from: { block: "b11", port: "qa" }, to: { block: "b15", port: "qa" }, badge: "147 QA · draft" },
    { id: "w17", from: { block: "b15", port: "qa" }, to: { block: "b16", port: "qa" }, badge: "129 QA" },
    { id: "w18", from: { block: "b16", port: "qa" }, to: { block: "b17", port: "qa" }, badge: "109 QA" },
    { id: "w19", from: { block: "b14", port: "qa" }, to: { block: "b18", port: "qa" }, badge: "68 QA · 22 multi-hop" },
    { id: "w20", from: { block: "b17", port: "qa" }, to: { block: "b18", port: "qa" }, badge: "101 QA · 101 multi-hop" },
    { id: "w21", from: { block: "b18", port: "qa" }, to: { block: "b21", port: "qa" }, badge: "336 QA · 123 multi-hop", weight: "heavy" },
    { id: "w22", from: { block: "b19", port: "index" }, to: { block: "b21", port: "index" }, badge: "bm25 · 224 docs" },
    { id: "w23", from: { block: "b5", port: "facts" }, to: { block: "b21", port: "facts" }, badge: "531 facts · grounded" },
    { id: "w24", from: { block: "b21", port: "eval" }, to: { block: "b22", port: "eval" }, badge: "recall@5 0.698" },
    { id: "w25", from: { block: "b18", port: "qa" }, to: { block: "b20", port: "qa" }, badge: "336 QA" },
    { id: "w26", from: { block: "b1", port: "pdf" }, to: { block: "b20", port: "pdf" }, badge: "46 pages" },
  ],
};
