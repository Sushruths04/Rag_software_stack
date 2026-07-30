import type { GraphDoc } from "../../types/graph";

/**
 * Template #13 (template-library spec 2026-07-11) — "Sample as many neighbor pairs as possible."
 * An eight-fact window and permissive cosine band — the broadest candidate sweep the sampler supports.
 * The cosine band takes effect once an embedder is wired into the live sampler; window applies today. Fully free.
 */
export const NEIGHBOR_SAMPLING_WIDE_TEMPLATE: GraphDoc = {
  schema_version: 1,
  name: "Large-window, wide-cosine sampling",
  meta: {
    created: "2026-07-11T00:00:00Z",
    modified: "2026-07-11T00:00:00Z",
    notes: "Template library #13 — window=8 sampling with a permissive cosine band (0.3-0.98). The cosine band takes effect once an embedder is wired into the live sampler; window applies today. Fully free.",
  },
  blocks: [
    { id: "f1", type: "facts_import", position: { x: 40, y: 40 }, params: { path: "datasets/ecma404/facts_ecma404_json_full.json" } },
    { id: "n1", type: "neighbor_sampler", position: { x: 400, y: 40 }, params: { window: "8", min_cosine: "0.3", max_cosine: "0.98" } },
  ],
  wires: [{ id: "w1", from: { block: "f1", port: "facts" }, to: { block: "n1", port: "facts" } }],
};
