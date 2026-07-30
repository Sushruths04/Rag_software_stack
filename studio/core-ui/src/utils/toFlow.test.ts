import { describe, expect, it } from "vitest";
import { graphToFlow, toGraphDoc } from "./toFlow";
import type { GraphDoc } from "../types/graph";

const doc: GraphDoc = {
  schema_version: 1,
  name: "roundtrip graph",
  meta: { created: "2026-07-01T00:00:00Z", modified: "2026-07-01T00:00:00Z", notes: "test" },
  blocks: [
    { id: "b1", type: "facts_import", position: { x: 12, y: 34 }, params: { path: "facts.json" } },
    { id: "b2", type: "neighbor_sampler", position: { x: 300.5, y: -20 }, params: {} },
  ],
  wires: [{ id: "w1", from: { block: "b1", port: "facts" }, to: { block: "b2", port: "facts" } }],
};

describe("toGraphDoc / graphToFlow round trip", () => {
  it("graphToFlow -> toGraphDoc reproduces the original GraphDoc exactly", () => {
    const { nodes, edges } = graphToFlow(doc);
    const rebuilt = toGraphDoc(nodes, edges, doc.name, doc.meta);
    expect(rebuilt).toEqual(doc);
  });

  it("preserves fractional/negative positions and per-node param overrides", () => {
    const { nodes, edges } = graphToFlow(doc);
    const rebuilt = toGraphDoc(nodes, edges, doc.name, doc.meta);
    const b1 = rebuilt.blocks.find((b) => b.id === "b1")!;
    const b2 = rebuilt.blocks.find((b) => b.id === "b2")!;
    expect(b1.position).toEqual({ x: 12, y: 34 });
    expect(b1.params).toEqual({ path: "facts.json" });
    expect(b2.position).toEqual({ x: 300.5, y: -20 });
  });

  it("preserves wire connections including source/target ports", () => {
    const { nodes, edges } = graphToFlow(doc);
    const rebuilt = toGraphDoc(nodes, edges, doc.name, doc.meta);
    expect(rebuilt.wires).toEqual(doc.wires);
  });

  it("graphToFlow accepts a custom blockByType lookup (for the live registry)", () => {
    const customSpec = {
      type: "facts_import",
      category: "sources" as const,
      cost: "free" as const,
      label: "Custom Facts",
      subtitle: "custom",
      purpose: "custom purpose",
      inputs: [],
      outputs: [{ name: "facts", type: "facts" as const }],
      defaultParams: [],
      backing: "custom",
    };
    const { nodes } = graphToFlow(doc, { facts_import: customSpec, neighbor_sampler: customSpec });
    const node = nodes.find((n) => n.id === "b1")!;
    expect((node.data as { spec: typeof customSpec }).spec.label).toBe("Custom Facts");
  });
});

describe("graphToFlow — unknown block types (bundle import / retired catalog entries)", () => {
  const unknownDoc: GraphDoc = {
    schema_version: 1,
    name: "g",
    meta: { created: "t", modified: "t", notes: "" },
    blocks: [{ id: "b1", type: "retired_block", position: { x: 0, y: 0 }, params: { k: "v" } }],
    wires: [],
  };

  it("substitutes a placeholder spec instead of spec: undefined so BlockNode cannot crash", () => {
    const { nodes } = graphToFlow(unknownDoc, {});
    const data = nodes[0].data as { spec: { type: string; label: string; inputs: unknown[]; outputs: unknown[] } };
    expect(data.spec).toBeDefined();
    expect(data.spec.type).toBe("retired_block");
    expect(data.spec.label.toLowerCase()).toContain("unknown");
    expect(data.spec.inputs).toEqual([]);
    expect(data.spec.outputs).toEqual([]);
  });

  it("round-trips an unknown-type block through toGraphDoc without corrupting its type or params", () => {
    const { nodes, edges } = graphToFlow(unknownDoc, {});
    const rebuilt = toGraphDoc(nodes, edges, unknownDoc.name, unknownDoc.meta);
    expect(rebuilt.blocks[0].type).toBe("retired_block");
    expect(rebuilt.blocks[0].params).toEqual({ k: "v" });
  });
});
