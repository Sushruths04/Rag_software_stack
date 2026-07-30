import { describe, it, expect } from "vitest";
import { buildCompositeFromSelection, buildExpansionIndex, compositeToBlockSpec, expandComposites } from "./composite";
import { BLOCK_BY_TYPE } from "../data/catalog";
import type { GraphBlockNode, GraphDoc, GraphWire } from "../types/graph";

function block(id: string, type: string): GraphBlockNode {
  return { id, type, position: { x: 0, y: 0 }, params: {} };
}
function wire(id: string, fromBlock: string, fromPort: string, toBlock: string, toPort: string): GraphWire {
  return { id, from: { block: fromBlock, port: fromPort }, to: { block: toBlock, port: toPort } };
}

// A real 2-block chain from the actual catalog: chunks_import -> chunker,
// matching demo-graph wiring so the port names are real, not invented.
const blocks = [block("a1", "chunks_import"), block("a2", "chunker")];
const wires = [wire("w1", "a1", "chunks", "a2", "chunks")];

describe("buildCompositeFromSelection", () => {
  it("keeps only inner wires and exposes unfilled inputs / unconsumed outputs", () => {
    const def = buildCompositeFromSelection(["a1", "a2"], blocks, wires, BLOCK_BY_TYPE, "my-composite", "My Composite");

    expect(def.blocks.map((b) => b.id)).toEqual(["a1", "a2"]);
    expect(def.wires.map((w) => w.id)).toEqual(["w1"]);
    // a1.chunks feeds a2 internally -> a2's chunks input is NOT exposed
    expect(def.exposedInputs.some((p) => p.block === "a2" && p.port === "chunks")).toBe(false);
    // a2's chunks output goes nowhere inside the selection -> exposed
    expect(def.exposedOutputs).toContainEqual(expect.objectContaining({ block: "a2", port: "chunks" }));
  });

  it("excludes a wire that crosses the selection boundary from the inner wire set", () => {
    const outside = block("a3", "fact_extract_llm");
    const boundaryWire = wire("w2", "a2", "chunks", "a3", "chunks");
    const def = buildCompositeFromSelection(["a1", "a2"], [...blocks, outside], [...wires, boundaryWire], BLOCK_BY_TYPE, "c1", "C1");
    expect(def.wires.map((w) => w.id)).toEqual(["w1"]);
    // still exposed as an output even though something outside DOES consume it
    expect(def.exposedOutputs).toContainEqual(expect.objectContaining({ block: "a2", port: "chunks" }));
  });
});

describe("compositeToBlockSpec", () => {
  it("names ports <block>.<port> so expandComposites can reverse them", () => {
    const def = buildCompositeFromSelection(["a1", "a2"], blocks, wires, BLOCK_BY_TYPE, "my-composite", "My Composite");
    const spec = compositeToBlockSpec(def, "free");
    expect(spec.type).toBe("my-composite");
    expect(spec.category).toBe("composite");
    expect(spec.outputs.map((p) => p.name)).toContain("a2.chunks");
    // chunks_import (a1) has no declared inputs and a2's chunks input is fed
    // internally by a1 -> this composite exposes zero inputs, one output.
    expect(spec.inputs).toEqual([]);
  });
});

describe("buildExpansionIndex", () => {
  it("maps every expanded inner-block id back to its composite instance id, and nothing else", () => {
    const def = buildCompositeFromSelection(["a1", "a2"], blocks, wires, BLOCK_BY_TYPE, "my-composite", "My Composite");
    const doc: GraphDoc = {
      schema_version: 1,
      name: "g",
      meta: { created: "t", modified: "t", notes: "" },
      blocks: [block("inst1", "my-composite"), block("plain", "fact_extract_llm")],
      wires: [],
    };
    const index = buildExpansionIndex(doc, { "my-composite": def });
    expect(index).toEqual({ inst1__a1: "inst1", inst1__a2: "inst1" });
  });
});

describe("expandComposites", () => {
  it("replaces a composite instance with its inner blocks/wires, namespaced by instance id", () => {
    const def = buildCompositeFromSelection(["a1", "a2"], blocks, wires, BLOCK_BY_TYPE, "my-composite", "My Composite");
    const doc: GraphDoc = {
      schema_version: 1,
      name: "g",
      meta: { created: "t", modified: "t", notes: "" },
      blocks: [block("inst1", "my-composite")],
      wires: [],
    };

    const expanded = expandComposites(doc, { "my-composite": def });
    expect(expanded.blocks.map((b) => b.id).sort()).toEqual(["inst1__a1", "inst1__a2"]);
    expect(expanded.wires).toHaveLength(1);
    expect(expanded.wires[0]).toMatchObject({ from: { block: "inst1__a1", port: "chunks" }, to: { block: "inst1__a2", port: "chunks" } });
  });

  it("rewires an external wire touching a composite's exposed port to the correct inner block+port", () => {
    const def = buildCompositeFromSelection(["a1", "a2"], blocks, wires, BLOCK_BY_TYPE, "my-composite", "My Composite");
    const consumer = block("downstream", "fact_extract_llm");
    const doc: GraphDoc = {
      schema_version: 1,
      name: "g",
      meta: { created: "t", modified: "t", notes: "" },
      blocks: [block("inst1", "my-composite"), consumer],
      wires: [wire("ext", "inst1", "a2.chunks", "downstream", "chunks")],
    };

    const expanded = expandComposites(doc, { "my-composite": def });
    const externalWire = expanded.wires.find((w) => w.id === "ext")!;
    expect(externalWire.from).toEqual({ block: "inst1__a2", port: "chunks" });
    expect(externalWire.to).toEqual({ block: "downstream", port: "chunks" });
  });

  it("expands two instances of the same composite independently, no id collisions", () => {
    const def = buildCompositeFromSelection(["a1", "a2"], blocks, wires, BLOCK_BY_TYPE, "my-composite", "My Composite");
    const doc: GraphDoc = {
      schema_version: 1,
      name: "g",
      meta: { created: "t", modified: "t", notes: "" },
      blocks: [block("inst1", "my-composite"), block("inst2", "my-composite")],
      wires: [],
    };
    const expanded = expandComposites(doc, { "my-composite": def });
    expect(expanded.blocks).toHaveLength(4);
    expect(new Set(expanded.blocks.map((b) => b.id)).size).toBe(4);
  });

  it("leaves non-composite blocks and wires untouched", () => {
    const doc: GraphDoc = {
      schema_version: 1,
      name: "g",
      meta: { created: "t", modified: "t", notes: "" },
      blocks,
      wires,
    };
    const expanded = expandComposites(doc, {});
    expect(expanded).toEqual(doc);
  });
});

describe("compositeCost", () => {
  it("derives 'paid' when any inner block's spec is paid, 'free' otherwise", async () => {
    const { compositeCost } = await import("./composite");
    const freeDef = buildCompositeFromSelection(["a1", "a2"], blocks, wires, BLOCK_BY_TYPE, "c-free", "Free");
    expect(compositeCost(freeDef, BLOCK_BY_TYPE)).toBe("free");

    const paidBlocks = [block("p1", "chunker"), block("p2", "fact_extract_llm")];
    const paidWires = [wire("w1", "p1", "chunks", "p2", "chunks")];
    const paidDef = buildCompositeFromSelection(["p1", "p2"], paidBlocks, paidWires, BLOCK_BY_TYPE, "c-paid", "Paid");
    expect(compositeCost(paidDef, BLOCK_BY_TYPE)).toBe("paid");
  });

  it("treats unknown inner block types as free rather than crashing", async () => {
    const { compositeCost } = await import("./composite");
    const def = buildCompositeFromSelection(["x1"], [block("x1", "retired_type")], [], BLOCK_BY_TYPE, "c-x", "X");
    expect(compositeCost(def, BLOCK_BY_TYPE)).toBe("free");
  });
});

describe("refreshCompositeInstances", () => {
  it("swaps stale instance specs for the new one and drops wires to removed exposed ports", async () => {
    const { refreshCompositeInstances } = await import("./composite");
    const oldDef = buildCompositeFromSelection(["a1", "a2"], blocks, wires, BLOCK_BY_TYPE, "my-composite", "Mine");
    const oldSpec = compositeToBlockSpec(oldDef, "free");
    // new def: a1 was deleted inside the composite -> exposed port a1.* gone,
    // a2.chunks now also exposed as an input (nothing feeds it internally)
    const newDef = buildCompositeFromSelection(["a2"], [block("a2", "chunker")], [], BLOCK_BY_TYPE, "my-composite", "Mine");
    const newSpec = compositeToBlockSpec(newDef, "free");

    const instanceNode = {
      id: "inst1",
      type: "block",
      position: { x: 0, y: 0 },
      data: { spec: oldSpec, node: { id: "inst1", type: "my-composite", position: { x: 0, y: 0 }, params: {} } },
    };
    const otherNode = {
      id: "down",
      type: "block",
      position: { x: 10, y: 0 },
      data: { spec: BLOCK_BY_TYPE["fact_extract_llm"], node: { id: "down", type: "fact_extract_llm", position: { x: 10, y: 0 }, params: {} } },
    };
    const keepEdge = { id: "e-keep", source: "inst1", sourceHandle: "a2.chunks", target: "down", targetHandle: "chunks" };
    // a1 no longer exists inside the composite -> this wire has no port to attach to
    const dropEdge = { id: "e-drop", source: "inst1", sourceHandle: "a1.chunks", target: "down", targetHandle: "chunks" };

    const result = refreshCompositeInstances(
      [instanceNode, otherNode] as never,
      [keepEdge, dropEdge] as never,
      newDef,
      newSpec,
    );

    const refreshed = result.nodes.find((n) => n.id === "inst1")!;
    expect((refreshed.data as { spec: { outputs: Array<{ name: string }> } }).spec.outputs.map((p) => p.name)).toContain("a2.chunks");
    expect((refreshed.data as { spec: { outputs: Array<{ name: string }> } }).spec.outputs.map((p) => p.name)).not.toContain("a1.chunks");
    // non-instance nodes untouched
    expect(result.nodes.find((n) => n.id === "down")).toBe(otherNode);
    expect(result.edges.map((e) => e.id)).toEqual(["e-keep"]);
    expect(result.droppedWireIds).toEqual(["e-drop"]);
  });
});
