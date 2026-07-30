import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { PortDragProvider } from "../state/portDragContext";
import { StudioShell } from "./StudioShell";
import { hydrateFullPipeline } from "./studioTestUtils";

// Every test here calls hydrateFullPipeline(), whose contention-proof wait
// ceiling is 15000ms — vitest's 5000ms default test timeout would cut the
// hydrate off first. File-level ceiling so every caller gets the full budget.
vi.setConfig({ testTimeout: 20000 });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderShell() {
  return render(
    <ReactFlowProvider>
      <PortDragProvider>
        <StudioShell />
      </PortDragProvider>
    </ReactFlowProvider>,
  );
}

function offlineFetch() {
  globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
}

describe("StudioShell — keyboard shortcuts (04_DESIGN_SYSTEM.md §6)", () => {
  it("Ctrl+D duplicates the selected block at an offset position with a new id", async () => {
    offlineFetch();
    renderShell();
    await screen.findByText(/engine offline/i);
    await hydrateFullPipeline();

    expect(document.querySelectorAll(".block-node")).toHaveLength(22);

    const indexBuilderNode = document.querySelector('[data-block-type="index_builder"]') as HTMLElement;
    fireEvent.click(indexBuilderNode);
    await screen.findByDisplayValue("bm25"); // Inspector confirms selection landed

    const shell = document.querySelector(".studio-shell") as HTMLElement;
    fireEvent.keyDown(shell, { key: "d", ctrlKey: true });

    expect(document.querySelectorAll(".block-node")).toHaveLength(23);
    const duplicates = document.querySelectorAll('[data-block-type="index_builder"]');
    expect(duplicates).toHaveLength(2);
  });

  it("does nothing on Ctrl+D when no block is selected", async () => {
    offlineFetch();
    renderShell();
    await screen.findByText(/engine offline/i);
    await hydrateFullPipeline();

    const shell = document.querySelector(".studio-shell") as HTMLElement;
    fireEvent.keyDown(shell, { key: "d", ctrlKey: true });

    expect(document.querySelectorAll(".block-node")).toHaveLength(22);
  });

  it("Del removes the selected block and its attached wires", async () => {
    offlineFetch();
    renderShell();
    await screen.findByText(/engine offline/i);
    await hydrateFullPipeline();

    expect(document.querySelectorAll(".block-node")).toHaveLength(22);

    const indexBuilderNode = document.querySelector('[data-block-type="index_builder"]') as HTMLElement;
    fireEvent.click(indexBuilderNode);
    await screen.findByDisplayValue("bm25");

    fireEvent.keyDown(document, { key: "Delete", code: "Delete" });

    // React Flow's deleteElements() resolves asynchronously
    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(21));
    expect(document.querySelector('[data-block-type="index_builder"]')).toBeNull();
    // its attached wires (index_builder -> evaluator, chunker -> index_builder) are gone too
    expect(document.querySelectorAll(".wire-path").length).toBeLessThan(26);
  });
});
