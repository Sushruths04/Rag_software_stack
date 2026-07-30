import { describe, it, expect } from "vitest";
import { buildSessionExportBundle, checkBundleCompatibility, SESSION_BUNDLE_SCHEMA_VERSION } from "./sessionBundle";
import type { BlockSpec, GraphDoc } from "../types/graph";

function block(type: string, label: string): BlockSpec {
  return {
    type,
    category: "sources",
    cost: "free",
    label,
    subtitle: "",
    purpose: "",
    inputs: [],
    outputs: [],
    defaultParams: [],
    backing: `engine:${type}`,
  };
}

function graph(types: string[]): GraphDoc {
  return {
    schema_version: 1,
    name: "g",
    meta: { created: "t", modified: "t", notes: "" },
    blocks: types.map((t, i) => ({ id: `n${i}`, type: t, position: { x: 0, y: 0 }, params: {} })),
    wires: [],
  };
}

describe("buildSessionExportBundle", () => {
  it("pins a snapshot of only type/category/cost/label, not the full spec", () => {
    const catalog = [block("pdf_import", "PDF Source")];
    const bundle = buildSessionExportBundle(graph(["pdf_import"]), catalog, "2026-07-09T00:00:00.000Z");
    expect(bundle.exportSchemaVersion).toBe(SESSION_BUNDLE_SCHEMA_VERSION);
    expect(bundle.blockCatalogSnapshot).toEqual([{ type: "pdf_import", category: "sources", cost: "free", label: "PDF Source" }]);
    expect(bundle.session.name).toBe("g");
  });
});

describe("checkBundleCompatibility", () => {
  it("returns null when every used block type is present with an unchanged label", () => {
    const catalog = [block("pdf_import", "PDF Source")];
    const bundle = buildSessionExportBundle(graph(["pdf_import"]), catalog, "t");
    expect(checkBundleCompatibility(bundle, catalog)).toBeNull();
  });

  it("flags a block type the graph uses that no longer exists in the current catalog", () => {
    const catalog = [block("pdf_import", "PDF Source")];
    const bundle = buildSessionExportBundle(graph(["pdf_import", "retired_block"]), catalog, "t");
    const warning = checkBundleCompatibility(bundle, catalog);
    expect(warning?.missingTypes).toEqual(["retired_block"]);
    expect(warning?.changedLabels).toEqual([]);
  });

  it("flags a relabeled block without treating it as missing", () => {
    const exportCatalog = [block("pdf_import", "PDF Source")];
    const bundle = buildSessionExportBundle(graph(["pdf_import"]), exportCatalog, "t");
    const currentCatalog = [block("pdf_import", "PDF Source (renamed)")];
    const warning = checkBundleCompatibility(bundle, currentCatalog);
    expect(warning?.missingTypes).toEqual([]);
    expect(warning?.changedLabels).toEqual([{ type: "pdf_import", from: "PDF Source", to: "PDF Source (renamed)" }]);
  });

  it("does not flag a catalog entry the graph never actually uses", () => {
    const exportCatalog = [block("pdf_import", "PDF Source"), block("chunker", "Chunker")];
    const bundle = buildSessionExportBundle(graph(["pdf_import"]), exportCatalog, "t");
    // chunker's label changes in the current catalog, but the graph never used it -> not a warning
    const currentCatalog = [block("pdf_import", "PDF Source"), block("chunker", "Re-chunker")];
    expect(checkBundleCompatibility(bundle, currentCatalog)).toBeNull();
  });
});

describe("session bundles carry composite definitions (portability fix)", () => {
  const compositeDef = {
    id: "composite-abc",
    label: "My Composite",
    blocks: [{ id: "a1", type: "chunker", position: { x: 0, y: 0 }, params: {} }],
    wires: [],
    exposedInputs: [],
    exposedOutputs: [{ block: "a1", port: "chunks", type: "chunks" as const, label: "chunks" }],
  };

  it("embeds only the composite defs the session actually uses", () => {
    const unusedDef = { ...compositeDef, id: "composite-unused" };
    const catalog = [block("composite-abc", "My Composite")];
    const bundle = buildSessionExportBundle(graph(["composite-abc"]), catalog, "t", [compositeDef, unusedDef]);
    expect(bundle.composites).toEqual([compositeDef]);
  });

  it("does not flag a composite type as missing when its def travels with the bundle", () => {
    const catalog = [block("composite-abc", "My Composite")];
    const bundle = buildSessionExportBundle(graph(["composite-abc"]), catalog, "t", [compositeDef]);
    // importing project has NO composite-abc in its own catalog
    expect(checkBundleCompatibility(bundle, [])).toBeNull();
  });

  it("still flags a composite type as missing when no def travels (old bundles)", () => {
    const catalog = [block("composite-abc", "My Composite")];
    const bundle = buildSessionExportBundle(graph(["composite-abc"]), catalog, "t");
    expect(checkBundleCompatibility(bundle, [])?.missingTypes).toEqual(["composite-abc"]);
  });
});
