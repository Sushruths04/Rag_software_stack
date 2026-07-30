import type { CorpusEntry, SessionDoc } from "../hooks/useDesktopProject";

// Task 10 replaced the ad-hoc SampleCorpusEntry shape with the typed
// CorpusEntry registry entry (id/label/pdf + optional chunks/facts/qa) — the
// sample project's entry happens to populate all three optional fields, so
// re-exporting the real type here keeps one definition instead of two
// structurally-identical ones drifting apart.
export type { CorpusEntry as SampleCorpusEntry } from "../hooks/useDesktopProject";

/**
 * Sample project — the ecma404 bundle staged as a Tauri resource (Task 7,
 * `studio/desktop/src-tauri/sample-data/ecma404/`). This factory is pure: it
 * takes the four *stamped* absolute file paths a caller has already copied
 * into a real project folder and returns two ready-to-save session docs, one
 * free and one paid. It has no I/O and no Tauri dependency so it can be
 * unit-tested directly; Task 9 wires it into the "create sample project"
 * flow that does the actual file copy and session-save.
 */
export interface SampleDataPaths {
  pdf: string;
  chunks: string;
  facts: string;
  qa: string;
}

/** The 5 data filenames staged under sample-data/ecma404/ (the Task 7
 * originals plus the mined bridges file added by the template-library
 * work) — deliberately excludes LICENSE_NOTE.md, which is provenance
 * text, not pipeline data. */
export const SAMPLE_FILES: readonly string[] = [
  "ecma404_json.pdf",
  "s2_chunks_full.json",
  "facts_ecma404_json_full.json",
  "qa_ecma404_json_full.json",
  "bridges_ecma404_json_full.json",
];

const NOW = "2026-07-11T00:00:00Z";

function meta(notes: string) {
  return { created: NOW, modified: NOW, notes };
}

/**
 * "How good is retrieval on the sample dataset?" — fully free, ~5 minutes.
 * Same 5-block shape, positions, and param convention as
 * `src/data/templates/sampleA.ts`, substituting the stamped sample paths.
 */
function buildEvalDemo(p: SampleDataPaths): SessionDoc {
  return {
    schema_version: 1,
    name: "Sample: evaluate retrieval (free)",
    meta: meta(
      "Sample project demo — re-evaluates the shipped ecma404 QA set against a " +
        "freshly built index. Fully free, zero API calls.",
    ),
    blocks: [
      { id: "e1", type: "qa_import", position: { x: 40, y: 40 }, params: { path: p.qa } },
      { id: "e2", type: "chunks_import", position: { x: 40, y: 220 }, params: { path: p.chunks } },
      { id: "e3", type: "facts_import", position: { x: 40, y: 400 }, params: { path: p.facts } },
      {
        id: "e4",
        type: "index_builder",
        position: { x: 400, y: 220 },
        params: { strategy: "hybrid", embedding_source: "local" },
      },
      { id: "e5", type: "evaluator", position: { x: 760, y: 220 }, params: { top_k: "10" } },
    ],
    wires: [
      { id: "ew1", from: { block: "e2", port: "chunks" }, to: { block: "e4", port: "chunks" } },
      { id: "ew2", from: { block: "e1", port: "qa" }, to: { block: "e5", port: "qa" } },
      { id: "ew3", from: { block: "e4", port: "index" }, to: { block: "e5", port: "index" } },
      { id: "ew4", from: { block: "e3", port: "facts" }, to: { block: "e5", port: "facts" } },
    ],
  };
}

/**
 * "Generate new draft questions from the sample facts" — PAID, raises the
 * cost-confirm sheet before it runs. facts_import feeds the Neighbor Pair
 * Sampler (`neighbor_sampler`, in: `facts`, out: `candidates` — verified
 * against `src/data/catalog.ts` and `src/content/BLOCK_GUIDE.md` §4) whose
 * candidates, plus the same facts, feed the Neighbor QA Generator
 * (`qa_gen_pairs`, in: `candidates` + `facts`, out: `qa`).
 */
function buildGenerationDemo(p: SampleDataPaths): SessionDoc {
  return {
    schema_version: 1,
    name: "Sample: generate draft QA (paid)",
    meta: meta(
      "Sample project demo — samples neighbor fact pairs from the shipped ecma404 " +
        "facts and drafts new questions from them. PAID: this run calls a language " +
        "model and raises the cost-confirm sheet before it starts.",
    ),
    blocks: [
      { id: "g1", type: "facts_import", position: { x: 40, y: 40 }, params: { path: p.facts } },
      { id: "g2", type: "neighbor_sampler", position: { x: 400, y: 40 } },
      {
        id: "g3",
        type: "qa_gen_pairs",
        position: { x: 760, y: 40 },
        params: { doc: "ecma404_json_full" },
      },
    ],
    wires: [
      { id: "gw1", from: { block: "g1", port: "facts" }, to: { block: "g2", port: "facts" } },
      { id: "gw2", from: { block: "g1", port: "facts" }, to: { block: "g3", port: "facts" } },
      { id: "gw3", from: { block: "g2", port: "candidates" }, to: { block: "g3", port: "candidates" } },
    ],
  };
}

export function buildSampleSessions(p: SampleDataPaths): { evalDemo: SessionDoc; generationDemo: SessionDoc } {
  return { evalDemo: buildEvalDemo(p), generationDemo: buildGenerationDemo(p) };
}

/** Project-relative corpus registry entry for the sample project's manifest —
 * forward-slash, relative to the project root (`datasets/ecma404/...`), not
 * the absolute stamped paths `buildSampleSessions` consumes. */
export function sampleCorpusEntry(): CorpusEntry {
  return {
    id: "ecma404",
    label: "ECMA-404 (The JSON Data Interchange Syntax)",
    pdf: "datasets/ecma404/ecma404_json.pdf",
    chunks: "datasets/ecma404/s2_chunks_full.json",
    facts: "datasets/ecma404/facts_ecma404_json_full.json",
    qa: "datasets/ecma404/qa_ecma404_json_full.json",
  };
}
