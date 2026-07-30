import type { GraphDoc } from "../../types/graph";

/**
 * Template #15 (template-library spec 2026-07-11) — "Build clusters with a
 * tight cosine band." Cluster builder with stricter admission (min_cosine 0.6,
 * max_cosine 0.85) than the defaults over bundled ECMA-404 facts + bridges.
 * Fully free.
 */
export const CLUSTER_BUILDER_TIGHT_TEMPLATE: GraphDoc = {
  schema_version: 1,
  name: "Cluster builder, tight cosine band",
  meta: {
    created: "2026-07-11T00:00:00Z",
    modified: "2026-07-11T00:00:00Z",
    notes: "Template library #15 — cluster building with stricter admission (min_cosine 0.6, max_cosine 0.85). The cosine band takes effect once an embedder is wired into the live builder. Fully free.",
  },
  blocks: [
    { id: "f1", type: "facts_import", position: { x: 40, y: 40 }, params: { path: "datasets/ecma404/facts_ecma404_json_full.json" } },
    { id: "b1", type: "bridges_import", position: { x: 40, y: 280 }, params: { path: "datasets/ecma404/bridges_ecma404_json_full.json" } },
    { id: "cb1", type: "cluster_builder", position: { x: 400, y: 160 }, params: { min_cosine: "0.6", max_cosine: "0.85" } },
  ],
  wires: [
    { id: "w1", from: { block: "f1", port: "facts" }, to: { block: "cb1", port: "facts" } },
    { id: "w2", from: { block: "b1", port: "bridges" }, to: { block: "cb1", port: "bridges" } },
  ],
};
