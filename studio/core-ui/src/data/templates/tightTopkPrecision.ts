import type { GraphDoc } from "../../types/graph";

/**
 * Template #3 (template-library spec 2026-07-11) — "How precise is my top
 * hit?" Hybrid retrieval at top_k=1 over the bundled ECMA-404 corpus: same
 * 5-block shape as Sample A, but hybrid strategy and top_k=1 for precision
 * focus. Paths are project-relative; StudioShell stamps them absolute at
 * hydration (needsSampleData).
 */
export const TIGHT_TOPK_PRECISION_TEMPLATE: GraphDoc = {
  schema_version: 1,
  name: "Tight top_k=1 precision pass",
  meta: {
    created: "2026-07-11T00:00:00Z",
    modified: "2026-07-11T00:00:00Z",
    notes: "Template library #3 — hybrid retrieval scored at top_k=1: only the single best chunk counts. Fully free.",
  },
  blocks: [
    { id: "q1", type: "qa_import", position: { x: 40, y: 40 }, params: { path: "datasets/ecma404/qa_ecma404_json_full.json" } },
    { id: "c1", type: "chunks_import", position: { x: 40, y: 220 }, params: { path: "datasets/ecma404/s2_chunks_full.json" } },
    { id: "f1", type: "facts_import", position: { x: 40, y: 400 }, params: { path: "datasets/ecma404/facts_ecma404_json_full.json" } },
    { id: "i1", type: "index_builder", position: { x: 400, y: 220 }, params: { strategy: "hybrid", embedding_source: "local" } },
    { id: "e1", type: "evaluator", position: { x: 760, y: 220 }, params: { top_k: "1" } },
  ],
  wires: [
    { id: "w1", from: { block: "c1", port: "chunks" }, to: { block: "i1", port: "chunks" } },
    { id: "w2", from: { block: "q1", port: "qa" }, to: { block: "e1", port: "qa" } },
    { id: "w3", from: { block: "i1", port: "index" }, to: { block: "e1", port: "index" } },
    { id: "w4", from: { block: "f1", port: "facts" }, to: { block: "e1", port: "facts" } },
  ],
};
