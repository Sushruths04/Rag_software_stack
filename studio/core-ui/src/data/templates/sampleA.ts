import type { GraphDoc } from "../../types/graph";

/**
 * Sample A — "How good is retrieval on my existing dataset?"
 * (studio/core-ui/src/content/BLOCK_GUIDE.md §10). Fully free, ~5 minutes:
 * re-evaluate an already-shipped dataset against a freshly built index with
 * zero API calls. Same block list, params, and wiring as the guide's numbered
 * steps 1-5, including its exact example file paths.
 */
export const SAMPLE_A_TEMPLATE: GraphDoc = {
  schema_version: 1,
  name: "Evaluate an existing dataset (free)",
  meta: {
    created: "2026-07-08T00:00:00Z",
    modified: "2026-07-08T00:00:00Z",
    notes: "BLOCK_GUIDE.md §10 Sample A — fully free, ~5 minutes.",
  },
  blocks: [
    {
      id: "a1",
      type: "qa_import",
      position: { x: 40, y: 40 },
      params: { path: "data/eval_results/allpdf_v2_gt_r3/final/din_iso_6507_vickers_full.json" },
    },
    {
      id: "a2",
      type: "chunks_import",
      position: { x: 40, y: 220 },
      params: {
        path: "data/test_corpus_allpdf/pipeline_run/din_iso_6507_vickers_phase2/checkpoints/s2_chunks_full.json",
      },
    },
    {
      id: "a3",
      type: "facts_import",
      position: { x: 40, y: 400 },
      params: { path: "data/eval_results/facts_v1_grounded/facts_din_iso_6507_vickers_full.json" },
    },
    {
      id: "a4",
      type: "index_builder",
      position: { x: 400, y: 220 },
      params: { strategy: "hybrid", embedding_source: "local" },
    },
    {
      id: "a5",
      type: "evaluator",
      position: { x: 760, y: 220 },
      params: { top_k: "10" },
    },
  ],
  wires: [
    { id: "aw1", from: { block: "a2", port: "chunks" }, to: { block: "a4", port: "chunks" } },
    { id: "aw2", from: { block: "a1", port: "qa" }, to: { block: "a5", port: "qa" } },
    { id: "aw3", from: { block: "a4", port: "index" }, to: { block: "a5", port: "index" } },
    { id: "aw4", from: { block: "a3", port: "facts" }, to: { block: "a5", port: "facts" } },
  ],
};
