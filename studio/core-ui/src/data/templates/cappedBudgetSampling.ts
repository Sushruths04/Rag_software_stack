import type { GraphDoc } from "../../types/graph";

/**
 * Template #16 (template-library spec 2026-07-11) — "Sample candidates on
 * a hard budget." Both mining blocks side by side (sample-b's shape, on
 * bundled data), with the sampler capped at 25 pairs and one use per fact.
 * Fully free.
 */
export const CAPPED_BUDGET_SAMPLING_TEMPLATE: GraphDoc = {
  schema_version: 1,
  name: "Capped-budget sampling + clustering",
  meta: {
    created: "2026-07-11T00:00:00Z",
    modified: "2026-07-11T00:00:00Z",
    notes: "Template library #16 — budget-controlled candidates: max_pairs=25, max_uses_per_fact=1, plus default clustering. Fully free.",
  },
  blocks: [
    { id: "f1", type: "facts_import", position: { x: 40, y: 40 }, params: { path: "datasets/ecma404/facts_ecma404_json_full.json" } },
    { id: "b1", type: "bridges_import", position: { x: 40, y: 280 }, params: { path: "datasets/ecma404/bridges_ecma404_json_full.json" } },
    { id: "n1", type: "neighbor_sampler", position: { x: 400, y: 40 }, params: { max_pairs: "25", max_uses_per_fact: "1" } },
    { id: "cb1", type: "cluster_builder", position: { x: 400, y: 280 } },
  ],
  wires: [
    { id: "w1", from: { block: "f1", port: "facts" }, to: { block: "n1", port: "facts" } },
    { id: "w2", from: { block: "f1", port: "facts" }, to: { block: "cb1", port: "facts" } },
    { id: "w3", from: { block: "b1", port: "bridges" }, to: { block: "cb1", port: "bridges" } },
  ],
};
