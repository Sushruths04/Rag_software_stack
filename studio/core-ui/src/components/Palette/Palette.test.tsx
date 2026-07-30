import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Palette } from "./Palette";
import { CATEGORIES, BLOCK_CATALOG } from "../../data/catalog";
import type { BlockSpec } from "../../types/graph";

describe("Palette", () => {
  it("renders every category group and block from the catalog", () => {
    render(<Palette />);
    // "composite" ("My blocks") is deliberately absent here: composites are
    // project-local, never part of the static BLOCK_CATALOG, so its group
    // section is correctly hidden by Palette's empty-category skip.
    for (const cat of CATEGORIES.filter((c) => BLOCK_CATALOG.some((b) => b.category === c.id))) {
      expect(screen.getByText(cat.label)).toBeInTheDocument();
    }
    expect(screen.queryByText("My blocks")).not.toBeInTheDocument();
    // spot-check a few representative blocks across categories
    expect(screen.getByText("PDF Source")).toBeInTheDocument();
    expect(screen.getByText("Cluster Builder 2+2")).toBeInTheDocument();
    expect(screen.getByText("Retrieval Evaluator")).toBeInTheDocument();
    expect(screen.getAllByRole("button").length).toBeGreaterThanOrEqual(BLOCK_CATALOG.length);
  });

  it("renders the composite category once a composite-type block is passed in", () => {
    const composite: BlockSpec = {
      type: "composite-abc",
      category: "composite",
      cost: "free",
      label: "My Composite",
      subtitle: "composite · 2 blocks",
      purpose: "test composite",
      inputs: [],
      outputs: [],
      defaultParams: [],
      backing: "composite:composite-abc",
    };
    render(<Palette blocks={[...BLOCK_CATALOG, composite]} />);
    expect(screen.getByText("My blocks")).toBeInTheDocument();
    expect(screen.getByText("My Composite")).toBeInTheDocument();
  });

  it("filters blocks by search query", () => {
    render(<Palette />);
    const input = screen.getByLabelText("Search blocks");
    fireEvent.change(input, { target: { value: "cluster" } });
    expect(screen.getByText("Cluster Builder 2+2")).toBeInTheDocument();
    expect(screen.queryByText("PDF Source")).not.toBeInTheDocument();
  });

  it("shows a $ chip on PAID blocks and not on FREE blocks", () => {
    render(<Palette />);
    const paidItem = screen.getByText("Neighbor QA Generator").closest(".palette-item");
    const freeItem = screen.getByText("PDF Source").closest(".palette-item");
    expect(paidItem?.querySelector(".palette-item__paid")).toBeTruthy();
    expect(freeItem?.querySelector(".palette-item__paid")).toBeFalsy();
  });

  it("shows an empty message when no block matches the query", () => {
    render(<Palette />);
    const input = screen.getByLabelText("Search blocks");
    fireEvent.change(input, { target: { value: "zzz-does-not-exist" } });
    expect(screen.getByText(/No blocks match/)).toBeInTheDocument();
  });
});
