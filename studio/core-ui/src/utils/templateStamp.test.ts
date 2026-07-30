import { describe, expect, it } from "vitest";
import type { GraphDoc } from "../types/graph";
import { stampTemplateGraph } from "./templateStamp";

const GRAPH: GraphDoc = {
  schema_version: 1,
  name: "t",
  meta: { created: "c", modified: "m", notes: "" },
  blocks: [
    { id: "b1", type: "chunks_import", position: { x: 0, y: 0 }, params: { path: "datasets/ecma404/s2_chunks_full.json" } },
    { id: "b2", type: "index_builder", position: { x: 1, y: 1 }, params: { strategy: "bm25", embedding_source: "local" } },
    { id: "b3", type: "qa_import", position: { x: 2, y: 2 }, params: { path: "data/eval_results/some_other.json" } },
    { id: "b4", type: "neighbor_sampler", position: { x: 3, y: 3 } },
  ],
  wires: [],
};

const fakeResolve = async (rel: string) => `C:\\proj\\${rel.replace(/\//g, "\\")}`;

describe("stampTemplateGraph", () => {
  it("rewrites only datasets/-relative path params, via the resolver", async () => {
    const out = await stampTemplateGraph(GRAPH, fakeResolve);
    expect(out.blocks[0].params?.path).toBe("C:\\proj\\datasets\\ecma404\\s2_chunks_full.json");
    expect(out.blocks[1].params).toEqual({ strategy: "bm25", embedding_source: "local" });
    expect(out.blocks[2].params?.path).toBe("data/eval_results/some_other.json");
    expect(out.blocks[3].params).toBeUndefined();
  });

  it("does not mutate the input graph and preserves everything else", async () => {
    const out = await stampTemplateGraph(GRAPH, fakeResolve);
    expect(GRAPH.blocks[0].params?.path).toBe("datasets/ecma404/s2_chunks_full.json");
    expect(out).not.toBe(GRAPH);
    expect(out.name).toBe("t");
    expect(out.wires).toEqual([]);
  });

  it("leaves the path untouched when the resolver returns null (browser mode)", async () => {
    const out = await stampTemplateGraph(GRAPH, async () => null);
    expect(out.blocks[0].params?.path).toBe("datasets/ecma404/s2_chunks_full.json");
  });
});
