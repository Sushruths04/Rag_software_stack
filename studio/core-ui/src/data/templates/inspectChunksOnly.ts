import type { GraphDoc } from "../../types/graph";

/**
 * Template #17 (template-library spec 2026-07-11) — "Just inspect my
 * chunks." A single Chunks Import and nothing else: open the Dataset
 * Inspector and browse. Zero wires, zero processing. Fully free.
 */
export const INSPECT_CHUNKS_ONLY_TEMPLATE: GraphDoc = {
  schema_version: 1,
  name: "Just inspect my chunks",
  meta: {
    created: "2026-07-11T00:00:00Z",
    modified: "2026-07-11T00:00:00Z",
    notes: "Template library #17 — chunks_import only, for Dataset Inspector browsing. Fully free.",
  },
  blocks: [
    { id: "c1", type: "chunks_import", position: { x: 40, y: 40 }, params: { path: "datasets/ecma404/s2_chunks_full.json" } },
  ],
  wires: [],
};
