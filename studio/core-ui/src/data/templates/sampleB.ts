import type { GraphDoc } from "../../types/graph";

/**
 * Sample B — "Turn my facts into candidate question material"
 * (studio/core-ui/src/content/BLOCK_GUIDE.md §10). Fully free: shows the
 * sampling side of the pipeline without touching generation at all. Same
 * block list, params, and wiring as the guide's numbered steps 1-4.
 */
export const SAMPLE_B_TEMPLATE: GraphDoc = {
  schema_version: 1,
  name: "Sample your facts into candidates (free)",
  meta: {
    created: "2026-07-08T00:00:00Z",
    modified: "2026-07-08T00:00:00Z",
    notes: "BLOCK_GUIDE.md §10 Sample B — fully free.",
  },
  blocks: [
    {
      id: "b1",
      type: "facts_import",
      position: { x: 40, y: 40 },
      params: { path: "data/eval_results/facts_v1_grounded/facts_din_iso_6507_vickers_full.json" },
    },
    {
      id: "b2",
      type: "bridges_import",
      position: { x: 40, y: 280 },
      params: { path: "data/eval_results/allpdf_bridge_pairs_clean.json" },
    },
    {
      id: "b3",
      type: "neighbor_sampler",
      position: { x: 400, y: 40 },
    },
    {
      id: "b4",
      type: "cluster_builder",
      position: { x: 400, y: 280 },
    },
  ],
  wires: [
    { id: "bw1", from: { block: "b1", port: "facts" }, to: { block: "b3", port: "facts" } },
    { id: "bw2", from: { block: "b1", port: "facts" }, to: { block: "b4", port: "facts" } },
    { id: "bw3", from: { block: "b2", port: "bridges" }, to: { block: "b4", port: "bridges" } },
  ],
};
