import type { GraphDoc } from "../../types/graph";

/**
 * Template #19 (template-library spec 2026-07-11) — "Inspect the full raw
 * dataset." All four import blocks loaded at once — every source type
 * browsable in the Dataset Inspector. Zero wires, zero processing. Fully
 * free.
 */
export const INSPECT_EVERYTHING_TEMPLATE: GraphDoc = {
  schema_version: 1,
  name: "Inspect the full raw dataset",
  meta: {
    created: "2026-07-11T00:00:00Z",
    modified: "2026-07-11T00:00:00Z",
    notes: "Template library #19 — all four import blocks, for Dataset Inspector browsing. Fully free.",
  },
  blocks: [
    { id: "c1", type: "chunks_import", position: { x: 40, y: 40 }, params: { path: "datasets/ecma404/s2_chunks_full.json" } },
    { id: "f1", type: "facts_import", position: { x: 40, y: 220 }, params: { path: "datasets/ecma404/facts_ecma404_json_full.json" } },
    { id: "q1", type: "qa_import", position: { x: 40, y: 400 }, params: { path: "datasets/ecma404/qa_ecma404_json_full.json" } },
    { id: "b1", type: "bridges_import", position: { x: 40, y: 580 }, params: { path: "datasets/ecma404/bridges_ecma404_json_full.json" } },
  ],
  wires: [],
};
