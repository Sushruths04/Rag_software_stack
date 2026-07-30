import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DocumentationPanel } from "./DocumentationPanel";

afterEach(cleanup);

describe("DocumentationPanel", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<DocumentationPanel open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the guide's table of contents and section headings when open", () => {
    render(<DocumentationPanel open onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Documentation" });
    expect(dialog).toBeInTheDocument();
    // "2. Sources & Imports" legitimately appears twice: once as a TOC link,
    // once as the section heading itself -- scope each check to its panel.
    const toc = dialog.querySelector(".docs-panel__toc") as HTMLElement;
    const content = dialog.querySelector(".docs-panel__content") as HTMLElement;
    expect(within(toc).getByText("2. Sources & Imports")).toBeInTheDocument();
    expect(within(content).getByText("2. Sources & Imports")).toBeInTheDocument();
    expect(
      within(content).getByText("6. Gates (all FREE — deterministic checks on local hardware)"),
    ).toBeInTheDocument();
  });

  it("renders known block names and a worked example from the real content", () => {
    render(<DocumentationPanel open onClose={vi.fn()} />);
    // "Neighbor Pair Sampler" is cross-referenced from multiple sections
    // (its own heading, sample pipelines, the intro) -- assert at least one
    // match rather than assuming uniqueness.
    expect(screen.getAllByText(/Neighbor Pair Sampler/).length).toBeGreaterThan(0);
    // "recall@5 0.698" appears both in the §1 port-type example table and in
    // the Retrieval Evaluator's own worked example -- assert presence, not
    // uniqueness, same reasoning as above.
    expect(screen.getAllByText(/recall@5 0.698/).length).toBeGreaterThan(0);
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<DocumentationPanel open onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close documentation"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("filters content by search query while keeping section headings visible", () => {
    render(<DocumentationPanel open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search documentation"), { target: { value: "Vickers microhardness" } });
    expect(screen.getByText(/Vickers microhardness/)).toBeInTheDocument();
    expect(screen.getAllByText("2. Sources & Imports").length).toBeGreaterThan(0); // headings survive filtering
  });
});
