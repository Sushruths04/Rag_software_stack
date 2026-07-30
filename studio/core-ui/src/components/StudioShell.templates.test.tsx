import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { PortDragProvider } from "../state/portDragContext";
import { StudioShell } from "./StudioShell";
import { TEMPLATES } from "../data/templates";

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

describe("StudioShell — template picker (M5)", () => {
  it("shows the template picker on initial load (canvas boots empty)", async () => {
    offlineFetch();
    renderShell();
    await screen.findByText(/engine offline/i);
    expect(await screen.findByRole("dialog", { name: "Choose a template" })).toBeInTheDocument();
    expect(document.querySelectorAll(".block-node")).toHaveLength(0);
  });

  it("opens the template picker from the toolbar entry point and can be dismissed", async () => {
    offlineFetch();
    renderShell();
    await screen.findByText(/engine offline/i);

    // canvas boots empty, so the picker is already open from that effect —
    // close it first so this test's own toolbar-triggered open/dismiss is
    // exercised cleanly, not just observing the boot-time dialog.
    fireEvent.click(await screen.findByLabelText(/close template picker/i));
    expect(screen.queryByRole("dialog", { name: "Choose a template" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Start a new pipeline from a template"));
    expect(screen.getByRole("dialog", { name: "Choose a template" })).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/close template picker/i));
    expect(screen.queryByRole("dialog", { name: "Choose a template" })).not.toBeInTheDocument();
  });

  it("hydrates the canvas with the chosen template's exact block set", async () => {
    offlineFetch();
    renderShell();
    await screen.findByText(/engine offline/i);

    expect(document.querySelectorAll(".block-node")).toHaveLength(0); // boots empty

    const dialog = await screen.findByRole("dialog", { name: "Choose a template" }); // auto-opened by the empty-canvas effect
    const sampleB = TEMPLATES.find((t) => t.id === "sample-b")!;
    const card = within(dialog).getByText(sampleB.title).closest(".template-card") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: /use this template/i }));

    // dialog closes immediately; hydration happens on the canvas over time (A20)
    expect(screen.queryByRole("dialog", { name: "Choose a template" })).not.toBeInTheDocument();

    await waitFor(
      () => {
        expect(document.querySelectorAll(".block-node")).toHaveLength(sampleB.graph.blocks.length);
      },
      { timeout: 3000 },
    );

    const types = Array.from(document.querySelectorAll(".block-node"))
      .map((el) => el.getAttribute("data-block-type"))
      .sort();
    expect(types).toEqual(sampleB.graph.blocks.map((b) => b.type).sort());
    expect(await screen.findByText(sampleB.graph.name)).toBeInTheDocument();
  });

  it("shows the template picker automatically once the canvas has zero blocks", async () => {
    let savedGraph: unknown = null;
    globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/blocks") return Promise.reject(new TypeError("offline"));
      const emptyGraph = {
        schema_version: 1,
        name: "empty",
        meta: { created: "", modified: "", notes: "" },
        blocks: [],
        wires: [],
      };
      if (url === "/api/graphs" && (!init || init.method === undefined)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ graphs: [{ id: "empty-1", name: "empty", modified: "2026-07-08" }] }),
        } as Response);
      }
      if (url === "/api/graphs/empty-1") {
        savedGraph = emptyGraph;
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: "empty-1", graph: emptyGraph }) } as Response);
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: "not found" }) } as Response);
    }) as unknown as typeof fetch;

    renderShell();
    await screen.findByText(/engine offline/i);

    // canvas boots empty and the picker auto-opens from that; hydrate a
    // template first so this test actually exercises loading INTO zero
    // blocks re-triggering the invitation, not just observing it still
    // open from boot.
    const bootDialog = await screen.findByRole("dialog", { name: "Choose a template" });
    const sampleA = TEMPLATES.find((t) => t.id === "sample-a")!;
    const card = within(bootDialog).getByText(sampleA.title).closest(".template-card") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: /use this template/i }));
    await waitFor(
      () => expect(document.querySelectorAll(".block-node")).toHaveLength(sampleA.graph.blocks.length),
      { timeout: 3000 },
    );
    expect(screen.queryByRole("dialog", { name: "Choose a template" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Load/ }));
    const menu = await screen.findByRole("menu");
    await fireEvent.click(within(menu).getByText("empty"));

    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(0));
    expect(savedGraph).not.toBeNull();

    expect(await screen.findByRole("dialog", { name: "Choose a template" })).toBeInTheDocument();
  });
});
