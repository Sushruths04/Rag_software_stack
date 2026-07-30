import type { GraphDoc } from "../../types/graph";

/**
 * Template #1 (template-library spec 2026-07-11) — "Is plain BM25 good
 * enough?" Pure lexical baseline over the bundled ECMA-404 corpus: same
 * 5-block shape as Sample A, but bm25 strategy and explicit overlap match
 * mode. Paths are project-relative; StudioShell stamps them absolute at
 * hydration (needsSampleData).
 */
export const BM25_BASELINE_TEMPLATE: GraphDoc = {
  schema_version: 1,
  name: "BM25 baseline retrieval check",
  meta: {
    created: "2026-07-11T00:00:00Z",
    modified: "2026-07-11T00:00:00Z",
    notes: "Template library #1 — pure BM25 baseline on the bundled ECMA-404 corpus. Fully free.",
  },
  blocks: [
    { id: "q1", type: "qa_import", position: { x: 40, y: 40 }, params: { path: "datasets/ecma404/qa_ecma404_json_full.json" } },
    { id: "c1", type: "chunks_import", position: { x: 40, y: 220 }, params: { path: "datasets/ecma404/s2_chunks_full.json" } },
    { id: "f1", type: "facts_import", position: { x: 40, y: 400 }, params: { path: "datasets/ecma404/facts_ecma404_json_full.json" } },
    { id: "i1", type: "index_builder", position: { x: 400, y: 220 }, params: { strategy: "bm25", embedding_source: "local" } },
    { id: "e1", type: "evaluator", position: { x: 760, y: 220 }, params: { top_k: "10", match_mode: "overlap" } },
  ],
  wires: [
    { id: "w1", from: { block: "c1", port: "chunks" }, to: { block: "i1", port: "chunks" } },
    { id: "w2", from: { block: "q1", port: "qa" }, to: { block: "e1", port: "qa" } },
    { id: "w3", from: { block: "i1", port: "index" }, to: { block: "e1", port: "index" } },
    { id: "w4", from: { block: "f1", port: "facts" }, to: { block: "e1", port: "facts" } },
  ],
};
