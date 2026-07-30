import type { GraphDoc } from "../../types/graph";

/**
 * Template #8 (template-library spec 2026-07-11) — "What happens with
 * one-sentence chunks?" Re-chunks the bundled ECMA-404 corpus with sentence
 * strategy before indexing, then evaluates. The live chunker consumes only
 * `strategy` (window/overlap are inert in rag_gt.blocks.chunker), so no
 * other chunker params are set. Fully free.
 */
export const SENTENCE_RECHUNK_TEMPLATE: GraphDoc = {
  schema_version: 1,
  name: "Sentence-level re-chunking eval",
  meta: {
    created: "2026-07-11T00:00:00Z",
    modified: "2026-07-11T00:00:00Z",
    notes: "Template library #8 — sentence re-chunk of the bundled ECMA-404 corpus, then hybrid eval. Fully free.",
  },
  blocks: [
    { id: "q1", type: "qa_import", position: { x: 40, y: 40 }, params: { path: "datasets/ecma404/qa_ecma404_json_full.json" } },
    { id: "c1", type: "chunks_import", position: { x: 40, y: 220 }, params: { path: "datasets/ecma404/s2_chunks_full.json" } },
    { id: "f1", type: "facts_import", position: { x: 40, y: 400 }, params: { path: "datasets/ecma404/facts_ecma404_json_full.json" } },
    { id: "k1", type: "chunker", position: { x: 400, y: 220 }, params: { strategy: "sentence" } },
    { id: "i1", type: "index_builder", position: { x: 760, y: 220 }, params: { strategy: "hybrid", embedding_source: "local" } },
    { id: "e1", type: "evaluator", position: { x: 1120, y: 220 }, params: { top_k: "10" } },
  ],
  wires: [
    { id: "w1", from: { block: "c1", port: "chunks" }, to: { block: "k1", port: "chunks" } },
    { id: "w2", from: { block: "k1", port: "chunks" }, to: { block: "i1", port: "chunks" } },
    { id: "w3", from: { block: "q1", port: "qa" }, to: { block: "e1", port: "qa" } },
    { id: "w4", from: { block: "i1", port: "index" }, to: { block: "e1", port: "index" } },
    { id: "w5", from: { block: "f1", port: "facts" }, to: { block: "e1", port: "facts" } },
  ],
};
