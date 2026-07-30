import { describe, expect, it } from "vitest";
import { BLOCK_BY_TYPE } from "../catalog";
import { DEMO_GRAPH } from "../demoGraph";
import { topoOrder, validateGraph } from "../../utils/graphAlgorithms";
import { SAMPLE_A_TEMPLATE, SAMPLE_B_TEMPLATE, SAMPLE_C_TEMPLATE, TEMPLATES, TEMPLATE_CATEGORIES } from "./index";
import type { GraphDoc } from "../../types/graph";

function portTypeOf(graph: GraphDoc) {
  return (blockId: string, port: string, side: "in" | "out") => {
    const block = graph.blocks.find((b) => b.id === blockId);
    const spec = block && BLOCK_BY_TYPE[block.type];
    const list = side === "in" ? spec?.inputs : spec?.outputs;
    return list?.find((p) => p.name === port)?.type ?? null;
  };
}

function expectStructurallyValid(graph: GraphDoc) {
  for (const b of graph.blocks) {
    expect(BLOCK_BY_TYPE[b.type], `unknown block type ${b.type}`).toBeDefined();
  }
  const result = validateGraph(graph, portTypeOf(graph));
  expect(result.errors).toEqual([]);
  expect(result.ok).toBe(true);
  const order = topoOrder(graph);
  expect(order).not.toBeNull();
  expect(order).toHaveLength(graph.blocks.length);
}

const LIVE_BLOCK_TYPES = new Set([
  "chunks_import",
  "facts_import",
  "bridges_import",
  "qa_import",
  "chunker",
  "neighbor_sampler",
  "cluster_builder",
  "index_builder",
  "evaluator",
  "report",
]);

describe("TEMPLATES registry", () => {
  it("keeps ids, titles, and descriptions unique (cards are looked up by text)", () => {
    for (const key of ["id", "title", "description"] as const) {
      const values = TEMPLATES.map((t) => t[key]);
      expect(new Set(values).size, `duplicate ${key}`).toBe(values.length);
    }
  });

  it("every template declares a known category and a boolean needsSampleData", () => {
    for (const t of TEMPLATES) {
      expect(TEMPLATE_CATEGORIES, `${t.id} category`).toContain(t.category);
      expect(typeof t.needsSampleData, `${t.id} needsSampleData`).toBe("boolean");
    }
  });

  it("the three original samples keep needsSampleData=false and their categories", () => {
    const byId = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));
    expect(byId["sample-a"].category).toBe("Retrieval & Eval");
    expect(byId["sample-b"].category).toBe("Mining & Sampling");
    expect(byId["sample-c"].category).toBe("Full Pipeline");
    for (const id of ["sample-a", "sample-b", "sample-c"]) {
      expect(byId[id].needsSampleData, id).toBe(false);
    }
  });

  it("every template graph is schema_version 1 and structurally valid (free of type mismatches/cycles)", () => {
    for (const t of TEMPLATES) {
      expect(t.graph.schema_version).toBe(1);
      expectStructurallyValid(t.graph);
    }
  });

  it("needsSampleData templates use only live blocks and bundled ecma404 paths", () => {
    for (const t of TEMPLATES.filter((x) => x.needsSampleData)) {
      for (const b of t.graph.blocks) {
        expect(LIVE_BLOCK_TYPES.has(b.type), `${t.id}: ${b.type} is not a live block`).toBe(true);
        const p = b.params?.path;
        if (p !== undefined) {
          expect(p, `${t.id}/${b.id} path must be project-relative bundled data`).toMatch(/^datasets\/ecma404\//);
        }
      }
    }
  });

  it("carries copy taken verbatim from BLOCK_GUIDE.md §10 for the original three", () => {
    const byId = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));
    expect(byId["sample-a"].title).toBe("How good is retrieval on my existing dataset?");
    expect(byId["sample-a"].description).toBe("The fastest way to get a real number out of the studio right now.");
    expect(byId["sample-b"].title).toBe("Turn my facts into candidate question material");
    expect(byId["sample-b"].description).toBe("Shows the sampling side of the pipeline without touching generation at all.");
    expect(byId["sample-c"].title).toBe("The full v2 pipeline shape");
    expect(byId["sample-c"].description).toBe("The full 22-block GT pipeline pre-wired end to end — sources through mining, generation, and gates to evaluation and report.");
  });

  it("ships exactly 23 templates in home-screen order with the spec category totals", () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual([
      "sample-a", "sample-b", "sample-c",
      "bm25-baseline", "hybrid-eval", "tight-topk-precision", "wide-topk-exploratory",
      "exact-id-match-mode", "small-chunk-rechunk", "large-chunk-rechunk", "sentence-rechunk",
      "bm25-html-report", "hybrid-md-report-ci",
      "neighbor-sampling-default", "neighbor-sampling-tight", "neighbor-sampling-wide",
      "cluster-builder-default", "cluster-builder-tight", "capped-budget-sampling",
      "inspect-chunks-only", "inspect-facts-and-qa", "inspect-everything",
      "kitchen-sink-all-live",
    ]);
    const count = (cat: string) => TEMPLATES.filter((t) => t.category === cat).length;
    expect(count("Retrieval & Eval")).toBe(11); // 10 new + sample-a
    expect(count("Mining & Sampling")).toBe(7); // 6 new + sample-b
    expect(count("Import & Inspect")).toBe(3);
    expect(count("Full Pipeline")).toBe(2); // kitchen sink + sample-c
  });
});

describe("SAMPLE_A_TEMPLATE — \"How good is retrieval on my existing dataset?\"", () => {
  it("matches the exact 5-block shape from BLOCK_GUIDE.md §10 Sample A", () => {
    const types = SAMPLE_A_TEMPLATE.blocks.map((b) => b.type).sort();
    expect(types).toEqual(["chunks_import", "evaluator", "facts_import", "index_builder", "qa_import"].sort());
  });

  it("points at the exact example file paths documented in §10 Sample A", () => {
    const qa = SAMPLE_A_TEMPLATE.blocks.find((b) => b.type === "qa_import")!;
    const chunks = SAMPLE_A_TEMPLATE.blocks.find((b) => b.type === "chunks_import")!;
    const facts = SAMPLE_A_TEMPLATE.blocks.find((b) => b.type === "facts_import")!;
    expect(qa.params?.path).toBe("data/eval_results/allpdf_v2_gt_r3/final/din_iso_6507_vickers_full.json");
    expect(chunks.params?.path).toBe(
      "data/test_corpus_allpdf/pipeline_run/din_iso_6507_vickers_phase2/checkpoints/s2_chunks_full.json",
    );
    expect(facts.params?.path).toBe("data/eval_results/facts_v1_grounded/facts_din_iso_6507_vickers_full.json");
  });

  it("wires exactly as §10 Sample A describes: chunks->index, then qa+index+facts->evaluator", () => {
    const chunks = SAMPLE_A_TEMPLATE.blocks.find((b) => b.type === "chunks_import")!;
    const index = SAMPLE_A_TEMPLATE.blocks.find((b) => b.type === "index_builder")!;
    const evaluator = SAMPLE_A_TEMPLATE.blocks.find((b) => b.type === "evaluator")!;
    const qa = SAMPLE_A_TEMPLATE.blocks.find((b) => b.type === "qa_import")!;
    const facts = SAMPLE_A_TEMPLATE.blocks.find((b) => b.type === "facts_import")!;

    const wireExists = (fromBlock: string, fromPort: string, toBlock: string, toPort: string) =>
      SAMPLE_A_TEMPLATE.wires.some(
        (w) => w.from.block === fromBlock && w.from.port === fromPort && w.to.block === toBlock && w.to.port === toPort,
      );

    expect(wireExists(chunks.id, "chunks", index.id, "chunks")).toBe(true);
    expect(wireExists(qa.id, "qa", evaluator.id, "qa")).toBe(true);
    expect(wireExists(index.id, "index", evaluator.id, "index")).toBe(true);
    expect(wireExists(facts.id, "facts", evaluator.id, "facts")).toBe(true);
    expect(SAMPLE_A_TEMPLATE.wires).toHaveLength(4);
  });

  it("uses hybrid/local index settings as documented", () => {
    const index = SAMPLE_A_TEMPLATE.blocks.find((b) => b.type === "index_builder")!;
    expect(index.params?.strategy).toBe("hybrid");
    expect(index.params?.embedding_source).toBe("local");
  });
});

describe("SAMPLE_B_TEMPLATE — \"Turn my facts into candidate question material\"", () => {
  it("matches the exact 4-block shape from BLOCK_GUIDE.md §10 Sample B", () => {
    const types = SAMPLE_B_TEMPLATE.blocks.map((b) => b.type).sort();
    expect(types).toEqual(["bridges_import", "cluster_builder", "facts_import", "neighbor_sampler"].sort());
  });

  it("points at the exact example file paths documented in §10 Sample B", () => {
    const facts = SAMPLE_B_TEMPLATE.blocks.find((b) => b.type === "facts_import")!;
    const bridges = SAMPLE_B_TEMPLATE.blocks.find((b) => b.type === "bridges_import")!;
    expect(facts.params?.path).toBe("data/eval_results/facts_v1_grounded/facts_din_iso_6507_vickers_full.json");
    expect(bridges.params?.path).toBe("data/eval_results/allpdf_bridge_pairs_clean.json");
  });

  it("wires facts into both samplers and bridges into the cluster builder, per §10 Sample B", () => {
    const facts = SAMPLE_B_TEMPLATE.blocks.find((b) => b.type === "facts_import")!;
    const bridges = SAMPLE_B_TEMPLATE.blocks.find((b) => b.type === "bridges_import")!;
    const neighbor = SAMPLE_B_TEMPLATE.blocks.find((b) => b.type === "neighbor_sampler")!;
    const cluster = SAMPLE_B_TEMPLATE.blocks.find((b) => b.type === "cluster_builder")!;

    const wireExists = (fromBlock: string, fromPort: string, toBlock: string, toPort: string) =>
      SAMPLE_B_TEMPLATE.wires.some(
        (w) => w.from.block === fromBlock && w.from.port === fromPort && w.to.block === toBlock && w.to.port === toPort,
      );

    expect(wireExists(facts.id, "facts", neighbor.id, "facts")).toBe(true);
    expect(wireExists(facts.id, "facts", cluster.id, "facts")).toBe(true);
    expect(wireExists(bridges.id, "bridges", cluster.id, "bridges")).toBe(true);
    expect(SAMPLE_B_TEMPLATE.wires).toHaveLength(3);
  });
});

describe("SAMPLE_C_TEMPLATE — the full v2 pipeline shape", () => {
  it("is the built-in demo graph itself, not a duplicate copy", () => {
    expect(SAMPLE_C_TEMPLATE).toBe(DEMO_GRAPH);
  });
});
