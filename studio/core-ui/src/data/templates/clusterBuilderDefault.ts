import type { GraphDoc } from "../../types/graph";

/**
 * Template #14 (template-library spec 2026-07-11) — "Build 2+2 clusters
 * from bridges." Default cluster builder joining the bundled ECMA-404
 * bridge pairs with neighboring facts. Fully free.
 */
export const CLUSTER_BUILDER_DEFAULT_TEMPLATE: GraphDoc = {
  schema_version: 1,
  name: "Cluster builder (2+2), defaults",
  meta: {
    created: "2026-07-11T00:00:00Z",
    modified: "2026-07-11T00:00:00Z",
    notes: "Template library #14 — default 2+2 cluster building over the bundled ECMA-404 facts + mined bridge pairs. Fully free.",
  },
  blocks: [
    { id: "f1", type: "facts_import", position: { x: 40, y: 40 }, params: { path: "datasets/ecma404/facts_ecma404_json_full.json" } },
    { id: "b1", type: "bridges_import", position: { x: 40, y: 280 }, params: { path: "datasets/ecma404/bridges_ecma404_json_full.json" } },
    { id: "cb1", type: "cluster_builder", position: { x: 400, y: 160 } },
  ],
  wires: [
    { id: "w1", from: { block: "f1", port: "facts" }, to: { block: "cb1", port: "facts" } },
    { id: "w2", from: { block: "b1", port: "bridges" }, to: { block: "cb1", port: "bridges" } },
  ],
};
