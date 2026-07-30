import { describe, expect, it } from "vitest";
import type { GraphDoc } from "../../types/graph";
import { TEMPLATES } from "./index";

// Exported (like the helpers below) so the file stays lint-clean while
// Tasks 6-11 incrementally add the describes that consume each of them.
export const CHUNKS = "datasets/ecma404/s2_chunks_full.json";
export const FACTS = "datasets/ecma404/facts_ecma404_json_full.json";
export const QA = "datasets/ecma404/qa_ecma404_json_full.json";
export const BRIDGES = "datasets/ecma404/bridges_ecma404_json_full.json";

export function byId(id: string) {
  const t = TEMPLATES.find((x) => x.id === id);
  expect(t, `template ${id} missing from TEMPLATES`).toBeDefined();
  return t!;
}

export function blockOfType(graph: GraphDoc, type: string) {
  const blocks = graph.blocks.filter((b) => b.type === type);
  expect(blocks, `expected exactly one ${type}`).toHaveLength(1);
  return blocks[0];
}

export function wireExists(graph: GraphDoc, fromType: string, fromPort: string, toType: string, toPort: string) {
  const from = blockOfType(graph, fromType);
  const to = blockOfType(graph, toType);
  return graph.wires.some(
    (w) => w.from.block === from.id && w.from.port === fromPort && w.to.block === to.id && w.to.port === toPort,
  );
}

/** The plain 5-block eval shape (spec templates #1-#5). */
function expectEval5Shape(graph: GraphDoc) {
  expect(graph.blocks.map((b) => b.type).sort()).toEqual(
    ["chunks_import", "evaluator", "facts_import", "index_builder", "qa_import"].sort(),
  );
  expect(wireExists(graph, "chunks_import", "chunks", "index_builder", "chunks")).toBe(true);
  expect(wireExists(graph, "qa_import", "qa", "evaluator", "qa")).toBe(true);
  expect(wireExists(graph, "index_builder", "index", "evaluator", "index")).toBe(true);
  expect(wireExists(graph, "facts_import", "facts", "evaluator", "facts")).toBe(true);
  expect(graph.wires).toHaveLength(4);
  expect(blockOfType(graph, "chunks_import").params?.path).toBe(CHUNKS);
  expect(blockOfType(graph, "facts_import").params?.path).toBe(FACTS);
  expect(blockOfType(graph, "qa_import").params?.path).toBe(QA);
}

interface Eval5Case {
  id: string;
  index: { strategy: string; embedding_source: string };
  evaluator: Record<string, string>;
}

const EVAL_CASES: Eval5Case[] = [
  { id: "bm25-baseline", index: { strategy: "bm25", embedding_source: "local" }, evaluator: { top_k: "10", match_mode: "overlap" } },
  { id: "hybrid-eval", index: { strategy: "hybrid", embedding_source: "local" }, evaluator: { top_k: "10" } },
  { id: "tight-topk-precision", index: { strategy: "hybrid", embedding_source: "local" }, evaluator: { top_k: "1" } },
  { id: "wide-topk-exploratory", index: { strategy: "hybrid", embedding_source: "local" }, evaluator: { top_k: "50" } },
  { id: "exact-id-match-mode", index: { strategy: "hybrid", embedding_source: "local" }, evaluator: { top_k: "10", match_mode: "exact-id" } },
];

describe("Retrieval & Eval core five (#1-#5)", () => {
  for (const c of EVAL_CASES) {
    it(`${c.id}: eval-5 shape with its distinguishing params`, () => {
      const t = byId(c.id);
      expect(t.category).toBe("Retrieval & Eval");
      expect(t.needsSampleData).toBe(true);
      expectEval5Shape(t.graph);
      expect(blockOfType(t.graph, "index_builder").params).toEqual(c.index);
      expect(blockOfType(t.graph, "evaluator").params).toEqual(c.evaluator);
    });
  }
});

const RECHUNK_CASES = [
  { id: "small-chunk-rechunk", strategy: "sliding_256" },
  { id: "large-chunk-rechunk", strategy: "paragraph" },
  { id: "sentence-rechunk", strategy: "sentence" },
];

describe("Re-chunking trio (#6-#8)", () => {
  for (const c of RECHUNK_CASES) {
    it(`${c.id}: eval chain with a ${c.strategy} chunker in front of the index`, () => {
      const t = byId(c.id);
      const g = t.graph;
      expect(t.category).toBe("Retrieval & Eval");
      expect(t.needsSampleData).toBe(true);
      expect(g.blocks.map((b) => b.type).sort()).toEqual(
        ["chunker", "chunks_import", "evaluator", "facts_import", "index_builder", "qa_import"].sort(),
      );
      expect(wireExists(g, "chunks_import", "chunks", "chunker", "chunks")).toBe(true);
      expect(wireExists(g, "chunker", "chunks", "index_builder", "chunks")).toBe(true);
      expect(wireExists(g, "qa_import", "qa", "evaluator", "qa")).toBe(true);
      expect(wireExists(g, "index_builder", "index", "evaluator", "index")).toBe(true);
      expect(wireExists(g, "facts_import", "facts", "evaluator", "facts")).toBe(true);
      expect(g.wires).toHaveLength(5);
      // Spec correction 2: strategy ONLY — the live chunker ignores window/overlap.
      expect(blockOfType(g, "chunker").params).toEqual({ strategy: c.strategy });
      expect(blockOfType(g, "index_builder").params).toEqual({ strategy: "hybrid", embedding_source: "local" });
      expect(blockOfType(g, "evaluator").params).toEqual({ top_k: "10" });
    });
  }
});

const REPORT_CASES = [
  {
    id: "bm25-html-report",
    index: { strategy: "bm25", embedding_source: "local" },
    report: { format: "html" },
  },
  {
    id: "hybrid-md-report-ci",
    index: { strategy: "hybrid", embedding_source: "local" },
    report: { format: "md", include_per_doc_ci: "true" },
  },
];

describe("Report pair (#9-#10)", () => {
  for (const c of REPORT_CASES) {
    it(`${c.id}: eval chain finished with a ${c.report.format} report`, () => {
      const t = byId(c.id);
      const g = t.graph;
      expect(t.category).toBe("Retrieval & Eval");
      expect(t.needsSampleData).toBe(true);
      expect(g.blocks.map((b) => b.type).sort()).toEqual(
        ["chunks_import", "evaluator", "facts_import", "index_builder", "qa_import", "report"].sort(),
      );
      expect(wireExists(g, "chunks_import", "chunks", "index_builder", "chunks")).toBe(true);
      expect(wireExists(g, "qa_import", "qa", "evaluator", "qa")).toBe(true);
      expect(wireExists(g, "index_builder", "index", "evaluator", "index")).toBe(true);
      expect(wireExists(g, "facts_import", "facts", "evaluator", "facts")).toBe(true);
      expect(wireExists(g, "evaluator", "eval", "report", "eval")).toBe(true);
      expect(g.wires).toHaveLength(5);
      expect(blockOfType(g, "index_builder").params).toEqual(c.index);
      expect(blockOfType(g, "evaluator").params).toEqual({ top_k: "10" });
      expect(blockOfType(g, "report").params).toEqual(c.report);
    });
  }
});

const SAMPLING_CASES: { id: string; sampler: Record<string, string> | undefined }[] = [
  { id: "neighbor-sampling-default", sampler: undefined },
  { id: "neighbor-sampling-tight", sampler: { window: "1", min_cosine: "0.5", max_cosine: "0.9" } },
  { id: "neighbor-sampling-wide", sampler: { window: "8", min_cosine: "0.3", max_cosine: "0.98" } },
];

describe("Neighbor-sampling trio (#11-#13)", () => {
  for (const c of SAMPLING_CASES) {
    it(`${c.id}: facts -> neighbor_sampler and nothing else`, () => {
      const t = byId(c.id);
      const g = t.graph;
      expect(t.category).toBe("Mining & Sampling");
      expect(t.needsSampleData).toBe(true);
      expect(g.blocks.map((b) => b.type).sort()).toEqual(["facts_import", "neighbor_sampler"]);
      expect(wireExists(g, "facts_import", "facts", "neighbor_sampler", "facts")).toBe(true);
      expect(g.wires).toHaveLength(1);
      expect(blockOfType(g, "facts_import").params?.path).toBe(FACTS);
      expect(blockOfType(g, "neighbor_sampler").params).toEqual(c.sampler);
    });
  }
});

describe("Cluster + budget trio (#14-#16)", () => {
  const CLUSTER_CASES: { id: string; cluster: Record<string, string> | undefined }[] = [
    { id: "cluster-builder-default", cluster: undefined },
    { id: "cluster-builder-tight", cluster: { min_cosine: "0.6", max_cosine: "0.85" } },
  ];
  for (const c of CLUSTER_CASES) {
    it(`${c.id}: facts + bridges -> cluster_builder`, () => {
      const t = byId(c.id);
      const g = t.graph;
      expect(t.category).toBe("Mining & Sampling");
      expect(t.needsSampleData).toBe(true);
      expect(g.blocks.map((b) => b.type).sort()).toEqual(["bridges_import", "cluster_builder", "facts_import"]);
      expect(wireExists(g, "facts_import", "facts", "cluster_builder", "facts")).toBe(true);
      expect(wireExists(g, "bridges_import", "bridges", "cluster_builder", "bridges")).toBe(true);
      expect(g.wires).toHaveLength(2);
      expect(blockOfType(g, "facts_import").params?.path).toBe(FACTS);
      expect(blockOfType(g, "bridges_import").params?.path).toBe(BRIDGES);
      expect(blockOfType(g, "cluster_builder").params).toEqual(c.cluster);
    });
  }

  it("capped-budget-sampling: sample-b shape with hard sampler caps", () => {
    const t = byId("capped-budget-sampling");
    const g = t.graph;
    expect(t.category).toBe("Mining & Sampling");
    expect(t.needsSampleData).toBe(true);
    expect(g.blocks.map((b) => b.type).sort()).toEqual(
      ["bridges_import", "cluster_builder", "facts_import", "neighbor_sampler"].sort(),
    );
    expect(wireExists(g, "facts_import", "facts", "neighbor_sampler", "facts")).toBe(true);
    expect(wireExists(g, "facts_import", "facts", "cluster_builder", "facts")).toBe(true);
    expect(wireExists(g, "bridges_import", "bridges", "cluster_builder", "bridges")).toBe(true);
    expect(g.wires).toHaveLength(3);
    expect(blockOfType(g, "neighbor_sampler").params).toEqual({ max_pairs: "25", max_uses_per_fact: "1" });
    expect(blockOfType(g, "cluster_builder").params).toBeUndefined();
  });
});

describe("Import & Inspect trio (#17-#19)", () => {
  const INSPECT_CASES = [
    { id: "inspect-chunks-only", types: ["chunks_import"] },
    { id: "inspect-facts-and-qa", types: ["facts_import", "qa_import"] },
    { id: "inspect-everything", types: ["bridges_import", "chunks_import", "facts_import", "qa_import"] },
  ];
  const PATH_BY_TYPE: Record<string, string> = {
    chunks_import: CHUNKS,
    facts_import: FACTS,
    qa_import: QA,
    bridges_import: BRIDGES,
  };
  for (const c of INSPECT_CASES) {
    it(`${c.id}: import blocks only, zero wires, bundled paths`, () => {
      const t = byId(c.id);
      const g = t.graph;
      expect(t.category).toBe("Import & Inspect");
      expect(t.needsSampleData).toBe(true);
      expect(g.blocks.map((b) => b.type).sort()).toEqual([...c.types].sort());
      expect(g.wires).toHaveLength(0);
      for (const type of c.types) {
        expect(blockOfType(g, type).params?.path).toBe(PATH_BY_TYPE[type]);
      }
    });
  }
});

describe("Kitchen sink (#20)", () => {
  it("contains every live block type exactly once, wired into three chains", () => {
    const t = byId("kitchen-sink-all-live");
    const g = t.graph;
    expect(t.category).toBe("Full Pipeline");
    expect(t.needsSampleData).toBe(true);
    expect(g.blocks.map((b) => b.type).sort()).toEqual(
      [
        "bridges_import", "chunker", "chunks_import", "cluster_builder", "evaluator",
        "facts_import", "index_builder", "neighbor_sampler", "qa_import", "report",
      ].sort(),
    );
    expect(wireExists(g, "chunks_import", "chunks", "chunker", "chunks")).toBe(true);
    expect(wireExists(g, "chunker", "chunks", "index_builder", "chunks")).toBe(true);
    expect(wireExists(g, "qa_import", "qa", "evaluator", "qa")).toBe(true);
    expect(wireExists(g, "index_builder", "index", "evaluator", "index")).toBe(true);
    expect(wireExists(g, "facts_import", "facts", "evaluator", "facts")).toBe(true);
    expect(wireExists(g, "evaluator", "eval", "report", "eval")).toBe(true);
    expect(wireExists(g, "facts_import", "facts", "neighbor_sampler", "facts")).toBe(true);
    expect(wireExists(g, "facts_import", "facts", "cluster_builder", "facts")).toBe(true);
    expect(wireExists(g, "bridges_import", "bridges", "cluster_builder", "bridges")).toBe(true);
    expect(g.wires).toHaveLength(9);
    expect(blockOfType(g, "chunker").params).toEqual({ strategy: "original" });
    expect(blockOfType(g, "index_builder").params).toEqual({ strategy: "hybrid", embedding_source: "local" });
    expect(blockOfType(g, "evaluator").params).toEqual({ top_k: "10" });
    expect(blockOfType(g, "report").params).toEqual({ format: "html" });
  });
});

describe("Hidden templates (#21+)", () => {
  it("hidden templates stay in the registry but out of the gallery", () => {
    const exactId = byId("exact-id-match-mode");
    expect(exactId.hidden).toBe(true);
    expect(TEMPLATES).toHaveLength(23); // frozen registry unchanged
  });
});
