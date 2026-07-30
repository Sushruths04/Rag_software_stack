import type { GraphDoc } from "../../types/graph";

/**
 * Template #12 (template-library spec 2026-07-11) — "Sample only tight neighbor pairs."
 * A one-fact window and tight cosine band — fewer, more-related candidate pairs than the defaults.
 * The cosine band takes effect once an embedder is wired into the live sampler; window applies today. Fully free.
 */
export const NEIGHBOR_SAMPLING_TIGHT_TEMPLATE: GraphDoc = {
  schema_version: 1,
  name: "Small-window, tight-cosine sampling",
  meta: {
    created: "2026-07-11T00:00:00Z",
    modified: "2026-07-11T00:00:00Z",
    notes: "Template library #12 — window=1 sampling with a tight cosine band (0.5-0.9). The cosine band takes effect once an embedder is wired into the live sampler; window applies today. Fully free.",
  },
  blocks: [
    { id: "f1", type: "facts_import", position: { x: 40, y: 40 }, params: { path: "datasets/ecma404/facts_ecma404_json_full.json" } },
    { id: "n1", type: "neighbor_sampler", position: { x: 400, y: 40 }, params: { window: "1", min_cosine: "0.5", max_cosine: "0.9" } },
  ],
  wires: [{ id: "w1", from: { block: "f1", port: "facts" }, to: { block: "n1", port: "facts" } }],
};
