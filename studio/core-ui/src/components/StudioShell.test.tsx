import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactFlowProvider } from "@xyflow/react";
import { PortDragProvider } from "../state/portDragContext";
import { StudioShell } from "./StudioShell";
import { hydrateFullPipeline } from "./studioTestUtils";
import type { GraphDoc } from "../types/graph";

// Every test that calls hydrateFullPipeline() may legitimately spend up to
// its 15000ms contention-proof hydrate ceiling before its own waits even
// start, so vitest's 5000ms default test timeout would cut those tests off
// first. File-level ceiling; individual tests only override it upward.
vi.setConfig({ testTimeout: 20000 });

function renderShell() {
  return render(
    <ReactFlowProvider>
      <PortDragProvider>
        <StudioShell />
      </PortDragProvider>
    </ReactFlowProvider>,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function paletteEl(): HTMLElement {
  return document.querySelector(".palette") as HTMLElement;
}

/** Stub params_schema shared by the fake live blocks used below. */
const emptySchema = { properties: {} };

describe("StudioShell — clean boot", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("boots with an empty canvas and the template picker open (no demo graph)", async () => {
    renderShell();
    expect(screen.queryByText("Full GT pipeline (v2)")).not.toBeInTheDocument();
    expect(await screen.findByRole("dialog", { name: "Choose a template" })).toBeInTheDocument();
    expect(document.querySelectorAll(".react-flow__node")).toHaveLength(0);
  });
});

describe("StudioShell — live registry (M1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("populates the palette from the live registry when the backend is reachable", async () => {
    globalThis.fetch = vi.fn((url: string) => {
      if (url === "/api/blocks") {
        return Promise.resolve(
          jsonResponse({
            blocks: [
              {
                type: "only_live_block",
                category: "utility",
                cost: "free",
                inputs: [],
                outputs: [],
                params_schema: emptySchema,
                locked_params: [],
                estimate: false,
              },
            ],
          }),
        );
      }
      return Promise.resolve(jsonResponse({ detail: "not found" }, 404));
    }) as unknown as typeof fetch;

    renderShell();

    expect(await within(paletteEl()).findByText("only_live_block")).toBeInTheDocument();
    // the static-only catalog block must not appear — proves the palette
    // is now driven by the fetched registry, not the bundled catalog.
    expect(within(paletteEl()).queryByText("PDF Source")).not.toBeInTheDocument();
    expect(await screen.findByText(/live block registry loaded/i)).toBeInTheDocument();
  });

  it("falls back to the static catalog without crashing when the backend is unreachable", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    renderShell();

    expect(await within(paletteEl()).findByText("PDF Source")).toBeInTheDocument();
    expect(await screen.findByText(/engine offline/i)).toBeInTheDocument();
  });
});

describe("StudioShell — Validate against the backend compiler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls the backend and renders returned errors and warnings distinctly", async () => {
    globalThis.fetch = vi.fn((url: string) => {
      if (url === "/api/blocks") return Promise.reject(new TypeError("offline"));
      if (url === "/api/graphs/validate") {
        return Promise.resolve(
          jsonResponse({
            valid: false,
            order: [],
            errors: [{ code: "wire_type_mismatch", message: "wire w1: types differ", severity: "error" }],
            warnings: [
              {
                code: "missing_grounding_gate",
                message: "assembler b18 receives ungated QA",
                severity: "warning",
                autofix: { action: "insert_block", block_type: "gate_grounding" },
              },
            ],
            cost: null,
          }),
        );
      }
      return Promise.resolve(jsonResponse({ detail: "not found" }, 404));
    }) as unknown as typeof fetch;

    renderShell();
    await screen.findByText(/engine offline/i); // wait for mount fetch to settle

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Validate" }));

    expect((await screen.findAllByText(/wire w1: types differ/)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/assembler b18 receives ungated QA/)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/autofix: insert gate_grounding/)).length).toBeGreaterThan(0);

    // error and warning lines are visually distinct console levels
    const errorLine = screen.getByText(/error: wire w1: types differ/, { selector: ".console__line" });
    const warnLine = screen.getByText(/lint: assembler b18/, { selector: ".console__line" });
    expect(errorLine).toHaveClass("console__line--error");
    expect(warnLine).toHaveClass("console__line--warn");
  });

  it("falls back to local-only validation when the backend is unreachable", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    renderShell();
    await screen.findByText(/engine offline/i);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Validate" }));

    expect(await screen.findByText(/using local-only validation/i)).toBeInTheDocument();
    expect(await screen.findByText(/validate \(local-only\)/i)).toBeInTheDocument();
  });
});

describe("StudioShell — Save/Load persistence (M2)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("round-trips node params and the full block/wire set through Save then Load", async () => {
    let savedBody: GraphDoc | null = null;

    globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/blocks") return Promise.reject(new TypeError("offline"));

      if (url === "/api/graphs" && init?.method === "POST") {
        savedBody = JSON.parse(init.body as string) as GraphDoc;
        return Promise.resolve(jsonResponse({ id: "saved-1", graph: savedBody }));
      }
      if (url === "/api/graphs") {
        return Promise.resolve(
          jsonResponse({
            graphs: savedBody ? [{ id: "saved-1", name: savedBody.name, modified: savedBody.meta.modified }] : [],
          }),
        );
      }
      if (url === "/api/graphs/saved-1") {
        return Promise.resolve(jsonResponse({ id: "saved-1", graph: savedBody }));
      }
      return Promise.resolve(jsonResponse({ detail: "not found" }, 404));
    }) as unknown as typeof fetch;

    renderShell();
    await screen.findByText(/engine offline/i);
    await hydrateFullPipeline();

    const user = userEvent.setup();

    // select the demo graph's index_builder node and edit its "strategy" param
    const indexBuilderNode = document.querySelector('[data-block-type="index_builder"]') as HTMLElement;
    fireEvent.click(indexBuilderNode);
    const strategyInput = await screen.findByDisplayValue("bm25");
    await user.clear(strategyInput);
    await user.type(strategyInput, "faiss_custom_test");

    // Save
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/saved graph/i);

    expect(savedBody).not.toBeNull();
    const saved = savedBody as unknown as GraphDoc;
    expect(saved.blocks).toHaveLength(22);
    expect(saved.wires).toHaveLength(26);
    const savedIndexBlock = saved.blocks.find((b) => b.id === "b19")!;
    expect(savedIndexBlock.params?.strategy).toBe("faiss_custom_test");

    // dirty the canvas after saving — Load must fully replace this, not merge
    const canvasWrap = document.querySelector(".studio-shell__canvas-wrap") as HTMLElement;
    const dataTransfer = { getData: () => "note", setData: () => {}, dropEffect: "copy" };
    fireEvent.drop(canvasWrap, { dataTransfer, clientX: 500, clientY: 500 });
    expect(document.querySelectorAll(".block-node")).toHaveLength(23);

    // Load the saved graph back
    await user.click(screen.getByRole("button", { name: /Load/ }));
    const menu = await screen.findByRole("menu");
    const savedEntry = await within(menu).findByText(saved.name);
    await user.click(savedEntry);

    await screen.findByText(/loaded graph/i);

    // canvas is fully replaced by the loaded graph — back to 22 blocks
    expect(document.querySelectorAll(".block-node")).toHaveLength(22);

    // the edited param survived the round trip
    const reloadedIndexBuilder = document.querySelector('[data-block-type="index_builder"]') as HTMLElement;
    fireEvent.click(reloadedIndexBuilder);
    expect(await screen.findByDisplayValue("faiss_custom_test")).toBeInTheDocument();
  });

  it("shows a failure toast/console line when save fails", async () => {
    globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/blocks") return Promise.reject(new TypeError("offline"));
      if (url === "/api/graphs" && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ detail: "disk full" }, 500));
      }
      return Promise.resolve(jsonResponse({ detail: "not found" }, 404));
    }) as unknown as typeof fetch;

    renderShell();
    await screen.findByText(/engine offline/i);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect((await screen.findAllByText(/save failed/i)).length).toBeGreaterThan(0);
  });
});

describe("StudioShell — Run against the backend executor (M3)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function runButton() {
    return screen.getByRole("button", { name: /Run graph/ });
  }

  /** DEMO_GRAPH wire w1: b2 (chunks_import) --chunks--> b4 (chunker). Real
   * backend runs are exercised against just this 2-block slice of the demo
   * graph's own real wiring, keeping the animation short (~1s of real
   * sleep()-paced choreography) without inventing a graph shape the app
   * wouldn't produce. Real timers are used throughout (not vi.useFakeTimers)
   * — the mocked-fetch promise chain and the sleep() timers interleave in a
   * way fake timers don't reliably flush in one shot; findBy*'s own polling
   * comfortably absorbs the ~1s of real wall-clock animation time instead. */
  function mockRunEndpoint(body: unknown, status = 200) {
    return (url: string) => {
      if (url === "/api/blocks") return Promise.reject(new TypeError("offline"));
      if (url === "/api/graphs/run?use_stubs=false") return Promise.resolve(jsonResponse(body, status));
      return Promise.resolve(jsonResponse({ detail: "not found" }, 404));
    };
  }

  it("replays a successful live run with real (non-stub) artifact meta and marks blocks done", async () => {
    globalThis.fetch = vi.fn(
      mockRunEndpoint({
        ok: true,
        failed_block: null,
        order: ["b2", "b4"],
        events: [
          { block_id: "b2", type: "block_started", payload: {} },
          { block_id: "b2", type: "block_finished", payload: {} },
          { block_id: "b4", type: "block_started", payload: {} },
          { block_id: "b4", type: "block_finished", payload: {} },
        ],
        artifacts: {
          b2: { chunks: { type: "chunks", ref: "/tmp/real/chunks_import_ab12.json", meta: { count: 210, doc_id: "din_iso_6507_vickers" } } },
          b4: { chunks: { type: "chunks", ref: "/tmp/real/chunker_ef01.json", meta: { count: 224, strategy: "sliding_256" } } },
        },
      }),
    ) as unknown as typeof fetch;

    renderShell();
    await screen.findByText(/engine offline/i);
    await hydrateFullPipeline();

    fireEvent.click(runButton());
    expect(await screen.findByText(/run complete/i, {}, { timeout: 15000 })).toBeInTheDocument();

    const b2 = document.querySelector('[data-block-type="chunks_import"]') as HTMLElement;
    const b4 = document.querySelector('[data-block-type="chunker"]') as HTMLElement;
    expect(b2.className).toContain("run-done");
    expect(b4.className).toContain("run-done");
    expect(within(b2).getByText("210 chunks")).toBeInTheDocument();
    expect(within(b4).getByText("224 chunks")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("(planned)");
  });

  it("shows per-block elapsed seconds from block_finished events in the console", async () => {
    globalThis.fetch = vi.fn(
      mockRunEndpoint({
        ok: true,
        failed_block: null,
        order: ["b2", "b4"],
        events: [
          { block_id: "b2", type: "block_started", payload: {} },
          { block_id: "b2", type: "block_finished", payload: { elapsed_sec: 2.3456 } },
          { block_id: "b4", type: "block_started", payload: {} },
          { block_id: "b4", type: "block_finished", payload: { elapsed_sec: 0.0021 } },
        ],
        artifacts: {
          b2: { chunks: { type: "chunks", ref: "/tmp/real/chunks_import_ab12.json", meta: { count: 210, doc_id: "din_iso_6507_vickers" } } },
          b4: { chunks: { type: "chunks", ref: "/tmp/real/chunker_ef01.json", meta: { count: 224, strategy: "sliding_256" } } },
        },
      }),
    ) as unknown as typeof fetch;

    renderShell();
    await screen.findByText(/engine offline/i);

    fireEvent.click(runButton());
    expect(await screen.findByText(/run complete/i, {}, { timeout: 5000 })).toBeInTheDocument();

    expect(screen.getByText(/2\.35s/)).toBeInTheDocument();
    // Sub-10ms blocks still get a non-zero readable duration, not "0.00s".
    expect(document.body.textContent).not.toContain("0.00s");
  });

  it("marks a stub-prefixed artifact as planned/not-real even inside an otherwise-live run", async () => {
    globalThis.fetch = vi.fn(
      mockRunEndpoint({
        ok: true,
        failed_block: null,
        order: ["b2", "b4"],
        events: [
          { block_id: "b2", type: "block_started", payload: {} },
          { block_id: "b2", type: "block_finished", payload: {} },
          { block_id: "b4", type: "block_started", payload: {} },
          { block_id: "b4", type: "block_finished", payload: {} },
        ],
        artifacts: {
          // b2 has no live adapter reachable in this scenario and stays a stub.
          b2: { chunks: { type: "chunks", ref: "stub:chunks_import:x", meta: { count: 210 } } },
          b4: { chunks: { type: "chunks", ref: "/tmp/real/chunker_ef01.json", meta: { count: 224, strategy: "sliding_256" } } },
        },
      }),
    ) as unknown as typeof fetch;

    renderShell();
    await screen.findByText(/engine offline/i);
    await hydrateFullPipeline();

    fireEvent.click(runButton());
    const b2 = document.querySelector('[data-block-type="chunks_import"]') as HTMLElement;
    expect(await within(b2).findByText("210 chunks (planned)", {}, { timeout: 5000 })).toBeInTheDocument();

    const b4 = document.querySelector('[data-block-type="chunker"]') as HTMLElement;
    expect(await within(b4).findByText("224 chunks", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(within(b4).queryByText(/planned/)).not.toBeInTheDocument();
  });

  it("stops the animation on a block_failed event, marks that block failed, and toasts the real error", async () => {
    globalThis.fetch = vi.fn(
      mockRunEndpoint({
        ok: false,
        failed_block: "b4",
        order: ["b2", "b4"],
        events: [
          { block_id: "b2", type: "block_started", payload: {} },
          { block_id: "b2", type: "block_finished", payload: {} },
          { block_id: "b4", type: "block_started", payload: {} },
          { block_id: "b4", type: "block_failed", payload: { error: "chunks.json not found" } },
        ],
        artifacts: {
          b2: { chunks: { type: "chunks", ref: "/tmp/real/chunks_import_ab12.json", meta: { count: 210 } } },
        },
      }),
    ) as unknown as typeof fetch;

    renderShell();
    await screen.findByText(/engine offline/i);
    await hydrateFullPipeline();

    fireEvent.click(runButton());

    expect(await screen.findByText(/chunks\.json not found/, { selector: ".toast" }, { timeout: 15000 })).toBeInTheDocument();

    // The toast and the failed-class state update are pushed back-to-back,
    // but React can commit them in separate batches under CPU contention —
    // poll for the class instead of asserting it synchronously.
    const b4 = document.querySelector('[data-block-type="chunker"]') as HTMLElement;
    await waitFor(() => expect(b4.className).toContain("run-failed"), { timeout: 15000 });
    expect(within(b4).getByText(/chunks\.json not found/)).toBeInTheDocument();

    const errorLine = screen.getByText(/chunker failed/i, { selector: ".console__line" });
    expect(errorLine).toHaveClass("console__line--error");
  });

  it("surfaces a real HTTP rejection (e.g. 400) as an error instead of silently running the simulated demo", async () => {
    globalThis.fetch = vi.fn((url: string) => {
      if (url === "/api/blocks") return Promise.reject(new TypeError("offline"));
      if (url === "/api/graphs/run?use_stubs=false") {
        return Promise.resolve(
          jsonResponse(
            { valid: false, order: [], errors: [{ code: "graph_not_runnable", message: "graph is not runnable" }], warnings: [], cost: null },
            400,
          ),
        );
      }
      return Promise.resolve(jsonResponse({ detail: "not found" }, 404));
    }) as unknown as typeof fetch;

    renderShell();
    await screen.findByText(/engine offline/i);
    await hydrateFullPipeline();

    fireEvent.click(runButton());

    // the real rejection must be shown to the user...
    const toast = await screen.findByText(/run rejected/i, { selector: ".toast" }, { timeout: 5000 });
    expect(toast).toBeInTheDocument();
    // ...with the HTTP status code stripped from the user-facing copy (the
    // raw "HTTP 400: ..." original survives only inside the <details> dump).
    expect(toast.textContent).not.toMatch(/HTTP/i);
    const summaryEl = await screen.findByText(/run rejected — .*graph is not runnable/i);
    expect(summaryEl.textContent).not.toMatch(/HTTP/i);
    const errorLine = summaryEl.closest(".console__line") as HTMLElement;
    expect(errorLine).toHaveClass("console__line--error");

    // ...and the fake/simulated demo must NEVER run for a real rejection.
    expect(screen.queryByText(/showing a simulated run instead/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/run complete/i)).not.toBeInTheDocument();

    // nodes must be reset back to idle, not left stuck "queued" forever.
    const b2 = document.querySelector('[data-block-type="chunks_import"]') as HTMLElement;
    expect(b2.className).not.toContain("run-queued");
  });

  it("falls back to the unchanged simulated demo run when the backend is unreachable", async () => {
    globalThis.fetch = vi.fn((url: string) => {
      if (url === "/api/blocks") return Promise.reject(new TypeError("offline"));
      if (url === "/api/graphs/run?use_stubs=false") return Promise.reject(new TypeError("Failed to fetch"));
      return Promise.resolve(jsonResponse({ detail: "not found" }, 404));
    }) as unknown as typeof fetch;

    renderShell();
    await screen.findByText(/engine offline/i);
    await hydrateFullPipeline();

    fireEvent.click(runButton());

    expect(await screen.findByText(/showing a simulated run instead/i, {}, { timeout: 5000 })).toBeInTheDocument();
    // full DEMO_GRAPH (22 blocks) simulated animation — proof the untouched
    // fallback path ran end to end, unaffected by the new live-run code.
    expect(await screen.findByText(/run complete/i, {}, { timeout: 20000 })).toBeInTheDocument();

    const evaluatorNode = document.querySelector('[data-block-type="evaluator"]') as HTMLElement;
    expect(evaluatorNode.className).toContain("run-done");
    expect(within(evaluatorNode).getByText("recall@5 0.698 · f1_rw 0.611")).toBeInTheDocument();
    expect(screen.getByText(/\$0\.95 spent/)).toBeInTheDocument();
  }, 25000);
});
