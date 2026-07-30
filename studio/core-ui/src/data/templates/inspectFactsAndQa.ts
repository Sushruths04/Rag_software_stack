import type { GraphDoc } from "../../types/graph";

/**
 * Template #18 (template-library spec 2026-07-11) — "Browse facts and QA
 * together." Two import blocks side by side for Dataset Inspector
 * browsing. Zero wires, zero processing. Fully free.
 */
export const INSPECT_FACTS_AND_QA_TEMPLATE: GraphDoc = {
  schema_version: 1,
  name: "Browse facts and QA together",
  meta: {
    created: "2026-07-11T00:00:00Z",
    modified: "2026-07-11T00:00:00Z",
    notes: "Template library #18 — facts_import + qa_import, for Dataset Inspector browsing. Fully free.",
  },
  blocks: [
    { id: "f1", type: "facts_import", position: { x: 40, y: 40 }, params: { path: "datasets/ecma404/facts_ecma404_json_full.json" } },
    { id: "q1", type: "qa_import", position: { x: 40, y: 220 }, params: { path: "datasets/ecma404/qa_ecma404_json_full.json" } },
  ],
  wires: [],
};
