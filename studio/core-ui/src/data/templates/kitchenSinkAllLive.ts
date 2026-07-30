import type { GraphDoc } from "../../types/graph";

/**
 * Template #20 (template-library spec 2026-07-11) — "Show me every live
 * block at once." All 10 live block types in one graph: re-chunk → index →
 * evaluate → report, plus both mining chains. The "see everything at once"
 * reference layout. Fully free.
 */
export const KITCHEN_SINK_ALL_LIVE_TEMPLATE: GraphDoc = {
  schema_version: 1,
  name: "Kitchen sink — every live block",
  meta: {
    created: "2026-07-11T00:00:00Z",
    modified: "2026-07-11T00:00:00Z",
    notes: "Template library #20 — all 10 live blocks in one graph over the bundled ECMA-404 corpus. Fully free.",
  },
  blocks: [
    { id: "c1", type: "chunks_import", position: { x: 40, y: 40 }, params: { path: "datasets/ecma404/s2_chunks_full.json" } },
    { id: "k1", type: "chunker", position: { x: 400, y: 40 }, params: { strategy: "original" } },
    { id: "i1", type: "index_builder", position: { x: 760, y: 40 }, params: { strategy: "hybrid", embedding_source: "local" } },
    { id: "q1", type: "qa_import", position: { x: 40, y: 220 }, params: { path: "datasets/ecma404/qa_ecma404_json_full.json" } },
    { id: "f1", type: "facts_import", position: { x: 40, y: 400 }, params: { path: "datasets/ecma404/facts_ecma404_json_full.json" } },
    { id: "b1", type: "bridges_import", position: { x: 40, y: 580 }, params: { path: "datasets/ecma404/bridges_ecma404_json_full.json" } },
    { id: "n1", type: "neighbor_sampler", position: { x: 400, y: 400 } },
    { id: "cb1", type: "cluster_builder", position: { x: 400, y: 580 } },
    { id: "e1", type: "evaluator", position: { x: 1120, y: 220 }, params: { top_k: "10" } },
    { id: "r1", type: "report", position: { x: 1480, y: 220 }, params: { format: "html" } },
  ],
  wires: [
    { id: "w1", from: { block: "c1", port: "chunks" }, to: { block: "k1", port: "chunks" } },
    { id: "w2", from: { block: "k1", port: "chunks" }, to: { block: "i1", port: "chunks" } },
    { id: "w3", from: { block: "q1", port: "qa" }, to: { block: "e1", port: "qa" } },
    { id: "w4", from: { block: "i1", port: "index" }, to: { block: "e1", port: "index" } },
    { id: "w5", from: { block: "f1", port: "facts" }, to: { block: "e1", port: "facts" } },
    { id: "w6", from: { block: "e1", port: "eval" }, to: { block: "r1", port: "eval" } },
    { id: "w7", from: { block: "f1", port: "facts" }, to: { block: "n1", port: "facts" } },
    { id: "w8", from: { block: "f1", port: "facts" }, to: { block: "cb1", port: "facts" } },
    { id: "w9", from: { block: "b1", port: "bridges" }, to: { block: "cb1", port: "bridges" } },
  ],
};
