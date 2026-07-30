import { describe, expect, it } from "vitest";
import { mergeLiveBlocks } from "./liveCatalog";
import { BLOCK_BY_TYPE } from "../data/catalog";
import type { ApiBlockSpec } from "../api/client";

function apiBlock(overrides: Partial<ApiBlockSpec> = {}): ApiBlockSpec {
  return {
    type: "neighbor_sampler",
    category: "mining",
    cost: "free",
    inputs: [{ name: "facts", type: "facts", multi: false, required: true }],
    outputs: [{ name: "candidates", type: "candidates", multi: false, required: true }],
    params_schema: { properties: { window: { default: 3, title: "window" } } },
    locked_params: [],
    estimate: false,
    ...overrides,
  };
}

describe("mergeLiveBlocks", () => {
  it("uses live ports/category/cost as authoritative, and borrows display text from the static catalog for a known type", () => {
    const [merged] = mergeLiveBlocks([apiBlock()]);
    const staticSpec = BLOCK_BY_TYPE["neighbor_sampler"];

    expect(merged.type).toBe("neighbor_sampler");
    expect(merged.category).toBe("mining");
    expect(merged.cost).toBe("free");
    expect(merged.inputs).toEqual([{ name: "facts", type: "facts", multi: false, optional: false }]);
    expect(merged.outputs).toEqual([{ name: "candidates", type: "candidates", multi: false, optional: false }]);
    // display text borrowed from the static catalog entry for this type
    expect(merged.label).toBe(staticSpec.label);
    expect(merged.purpose).toBe(staticSpec.purpose);
  });

  it("falls back to a generated label/params for a type not present in the static catalog", () => {
    const [merged] = mergeLiveBlocks([
      apiBlock({
        type: "brand_new_block",
        category: "utility",
        params_schema: { properties: { threshold: { default: 0.5, title: "threshold" } } },
        locked_params: ["threshold"],
      }),
    ]);

    expect(merged.type).toBe("brand_new_block");
    expect(merged.label).toBe("brand_new_block");
    expect(merged.purpose).toBe("");
    expect(merged.defaultParams).toEqual([
      { key: "threshold", label: "threshold", value: "0.5", locked: true, isDefault: true },
    ]);
  });

  it("marks a required=false input port as optional", () => {
    const [merged] = mergeLiveBlocks([
      apiBlock({
        type: "provenance_join",
        inputs: [
          { name: "facts", type: "facts", multi: false, required: true },
          { name: "qa", type: "qa", multi: false, required: false },
        ],
      }),
    ]);
    expect(merged.inputs.find((p) => p.name === "qa")?.optional).toBe(true);
    expect(merged.inputs.find((p) => p.name === "facts")?.optional).toBe(false);
  });

  it("does not mutate the static BLOCK_CATALOG data", () => {
    const before = JSON.stringify(BLOCK_BY_TYPE["neighbor_sampler"]);
    mergeLiveBlocks([apiBlock()]);
    expect(JSON.stringify(BLOCK_BY_TYPE["neighbor_sampler"])).toBe(before);
  });
});
