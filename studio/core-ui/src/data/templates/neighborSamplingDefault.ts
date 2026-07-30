import type { GraphDoc } from "../../types/graph";

/**
 * Template #11 (template-library spec 2026-07-11) — "Sample neighbor pairs
 * from my facts." The default neighbor-window sampler over the bundled
 * ECMA-404 facts: candidate fact pairs, no generation involved. Fully free.
 */
export const NEIGHBOR_SAMPLING_DEFAULT_TEMPLATE: GraphDoc = {
  schema_version: 1,
  name: "Neighbor-window sampling",
  meta: {
    created: "2026-07-11T00:00:00Z",
    modified: "2026-07-11T00:00:00Z",
    notes: "Template library #11 — default neighbor-pair sampling over the bundled ECMA-404 facts. Fully free.",
  },
  blocks: [
    { id: "f1", type: "facts_import", position: { x: 40, y: 40 }, params: { path: "datasets/ecma404/facts_ecma404_json_full.json" } },
    { id: "n1", type: "neighbor_sampler", position: { x: 400, y: 40 } },
  ],
  wires: [{ id: "w1", from: { block: "f1", port: "facts" }, to: { block: "n1", port: "facts" } }],
};
