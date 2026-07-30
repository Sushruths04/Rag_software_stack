import { describe, expect, it } from "vitest";
import { BLOCK_CATALOG, CATEGORIES } from "./catalog";

describe("BLOCK_CATALOG", () => {
  it("has exactly the 33 blocks from 05_BLOCK_CATALOG.md", () => {
    expect(BLOCK_CATALOG).toHaveLength(33);
  });

  it("has unique block type ids", () => {
    const types = BLOCK_CATALOG.map((b) => b.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it("assigns every block to a known category", () => {
    const catIds = new Set(CATEGORIES.map((c) => c.id));
    for (const b of BLOCK_CATALOG) {
      expect(catIds.has(b.category)).toBe(true);
    }
  });

  it("marks every Generation-category block as paid except the free demotion router", () => {
    const generation = BLOCK_CATALOG.filter((b) => b.category === "generation");
    const paidCount = generation.filter((b) => b.cost === "paid").length;
    expect(paidCount).toBe(3); // qa_gen_pairs, qa_gen_clusters, qa_gen_bridges
    expect(generation.find((b) => b.type === "demotion")?.cost).toBe("free");
  });

  it("marks every Gates-category block as free (local NLI on GPU)", () => {
    const gates = BLOCK_CATALOG.filter((b) => b.category === "gates");
    expect(gates.every((b) => b.cost === "free")).toBe(true);
    expect(gates.length).toBe(6);
  });

  it("locks the Clause Entailment Gate threshold param (expert-mode only)", () => {
    const gate = BLOCK_CATALOG.find((b) => b.type === "gate_clause");
    expect(gate?.defaultParams.find((p) => p.key === "threshold")?.locked).toBe(true);
  });
});
