import { describe, expect, it } from "vitest";
import { DEMO_GRAPH } from "./demoGraph";
import { BLOCK_BY_TYPE } from "./catalog";
import { topoOrder } from "../utils/graphAlgorithms";
import { validateGraph } from "../utils/graphAlgorithms";

function portTypeOf(blockId: string, port: string, side: "in" | "out") {
  const block = DEMO_GRAPH.blocks.find((b) => b.id === blockId);
  const spec = block && BLOCK_BY_TYPE[block.type];
  const list = side === "in" ? spec?.inputs : spec?.outputs;
  return list?.find((p) => p.name === port)?.type ?? null;
}

describe("DEMO_GRAPH (Full GT pipeline v2)", () => {
  it("references only block types that exist in the catalog", () => {
    for (const b of DEMO_GRAPH.blocks) {
      expect(BLOCK_BY_TYPE[b.type], `unknown block type ${b.type}`).toBeDefined();
    }
  });

  it("wires only to ports that actually exist on their block spec", () => {
    for (const w of DEMO_GRAPH.wires) {
      expect(portTypeOf(w.from.block, w.from.port, "out"), `${w.id} source port missing`).not.toBeNull();
      expect(portTypeOf(w.to.block, w.to.port, "in"), `${w.id} target port missing`).not.toBeNull();
    }
  });

  it("has no type mismatches or cycles (05_BLOCK_CATALOG.md §5 rules 1-2)", () => {
    const result = validateGraph(DEMO_GRAPH, portTypeOf);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("is a valid DAG with a topological order covering every block", () => {
    const order = topoOrder(DEMO_GRAPH);
    expect(order).not.toBeNull();
    expect(order).toHaveLength(DEMO_GRAPH.blocks.length);
  });

  it("every block is marked done with a meta line, for a fully mock-verifiable canvas", () => {
    for (const b of DEMO_GRAPH.blocks) {
      expect(b.runState).toBe("done");
      expect(b.runMeta?.metaLine).toBeTruthy();
    }
  });

  it("carries the three signature sample badges called out in the brief", () => {
    const badges = DEMO_GRAPH.wires.map((w) => w.badge);
    expect(badges).toContain("553 facts · grounded");
    expect(badges.some((b) => b?.includes("123 multi-hop"))).toBe(true);
    expect(badges).toContain("recall@5 0.698");
  });

  it("no two blocks overlap at fit-view (min clearance 380x300)", () => {
    const W = 380;
    const H = 300;
    const blocks = DEMO_GRAPH.blocks;
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i];
        const b = blocks[j];
        const clear =
          Math.abs(a.position.x - b.position.x) >= W || Math.abs(a.position.y - b.position.y) >= H;
        expect(clear, `${a.id} (${a.position.x},${a.position.y}) overlaps ${b.id} (${b.position.x},${b.position.y})`).toBe(true);
      }
    }
  });
});
