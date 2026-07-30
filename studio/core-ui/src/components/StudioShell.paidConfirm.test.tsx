import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { PortDragProvider } from "../state/portDragContext";
import { StudioShell } from "./StudioShell";
import { hydrateFullPipeline } from "./studioTestUtils";

// Every test here calls hydrateFullPipeline(), whose contention-proof wait
// ceiling is 15000ms — vitest's 5000ms default test timeout would cut the
// hydrate off first. File-level ceiling so every caller gets the full budget.
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

function runButton() {
  return screen.getByRole("button", { name: /Run graph/ });
}

const CONFIRMATION_REQUIRED_BODY = {
  requires_confirmation: true,
  paid_blocks: ["b10", "b11"],
  estimated: [
    { block_id: "b11", type: "qa_gen_clusters", calls: 510, usd: null, note: "clusters x3.5 (3-5 calls/cluster avg)" },
    { block_id: "b10", type: "qa_gen_pairs", calls: 330, usd: null, note: "pairs x1.3 (round-2 avg)" },
  ],
};

const CONFIRMED_RUN_BODY = {
  ok: true,
  failed_block: null,
  order: ["b10", "b11"],
  events: [
    { block_id: "b10", type: "block_started", payload: {} },
    { block_id: "b10", type: "block_finished", payload: {} },
    { block_id: "b11", type: "block_started", payload: {} },
    { block_id: "b11", type: "block_finished", payload: {} },
  ],
  artifacts: {
    b10: { qa: { type: "qa", ref: "/tmp/real/qa_gen_pairs_ab12.json", meta: { n_qa: 330, n_multihop: 0 } } },
    b11: { qa: { type: "qa", ref: "/tmp/real/qa_gen_clusters_ef01.json", meta: { n_qa: 510, n_multihop: 510 } } },
  },
};

// DEMO_GRAPH (loaded by default) contains b10 (qa_gen_pairs) and b11
// (qa_gen_clusters) — both PAID — so a real Run against the live backend
// always hits the spend-confirmation gate for the default canvas.
describe("StudioShell — paid-block spend confirmation (M4b, flow F4)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the cost confirmation sheet instead of running immediately when the backend requires confirmation", async () => {
    globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/blocks") return Promise.reject(new TypeError("offline"));
      if (url === "/api/graphs/run?use_stubs=false") {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        if (body.confirm_paid !== true) return Promise.resolve(jsonResponse(CONFIRMATION_REQUIRED_BODY, 402));
        return Promise.resolve(jsonResponse(CONFIRMED_RUN_BODY));
      }
      return Promise.resolve(jsonResponse({ detail: "not found" }, 404));
    }) as unknown as typeof fetch;

    renderShell();
    await screen.findByText(/engine offline/i);
    await hydrateFullPipeline();

    fireEvent.click(runButton());

    const dialog = await screen.findByRole("dialog", { name: /confirm/i });
    expect(within(dialog).getByText(/Cluster QA Generator/)).toBeInTheDocument();
    expect(within(dialog).getByText(/~510 calls/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Neighbor QA Generator/)).toBeInTheDocument();
    expect(within(dialog).getByText(/~330 calls/)).toBeInTheDocument();

    // the run has NOT proceeded yet — no "run complete", no confirmed POST sent
    expect(screen.queryByText(/run complete/i)).not.toBeInTheDocument();
    const runCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([u]) => u === "/api/graphs/run?use_stubs=false",
    );
    expect(runCalls).toHaveLength(1);
  });

  it("confirming re-posts with confirm_paid: true and proceeds through the normal live-run animation", async () => {
    globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/blocks") return Promise.reject(new TypeError("offline"));
      if (url === "/api/graphs/run?use_stubs=false") {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        if (body.confirm_paid !== true) return Promise.resolve(jsonResponse(CONFIRMATION_REQUIRED_BODY, 402));
        return Promise.resolve(jsonResponse(CONFIRMED_RUN_BODY));
      }
      return Promise.resolve(jsonResponse({ detail: "not found" }, 404));
    }) as unknown as typeof fetch;

    renderShell();
    await screen.findByText(/engine offline/i);
    await hydrateFullPipeline();

    fireEvent.click(runButton());
    const dialog = await screen.findByRole("dialog", { name: /confirm/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /confirm/i }));

    expect(await screen.findByText(/run complete/i, {}, { timeout: 15000 })).toBeInTheDocument();

    const runCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([u]) => u === "/api/graphs/run?use_stubs=false",
    );
    expect(runCalls).toHaveLength(2);
    const secondBody = JSON.parse((runCalls[1][1] as RequestInit).body as string);
    expect(secondBody.confirm_paid).toBe(true);

    const b10 = document.querySelector('[data-block-type="qa_gen_pairs"]') as HTMLElement;
    expect(b10.className).toContain("run-done");

    // cost total reflects real paid-block involvement, phrased as an estimate
    expect(screen.getByText(/est ·.*paid block/i)).toBeInTheDocument();
  });

  it("cancelling closes the sheet, sends no confirmed request, and leaves every block un-run", async () => {
    globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/blocks") return Promise.reject(new TypeError("offline"));
      if (url === "/api/graphs/run?use_stubs=false") {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        if (body.confirm_paid !== true) return Promise.resolve(jsonResponse(CONFIRMATION_REQUIRED_BODY, 402));
        return Promise.resolve(jsonResponse(CONFIRMED_RUN_BODY));
      }
      return Promise.resolve(jsonResponse({ detail: "not found" }, 404));
    }) as unknown as typeof fetch;

    renderShell();
    await screen.findByText(/engine offline/i);
    await hydrateFullPipeline();

    fireEvent.click(runButton());
    const dialog = await screen.findByRole("dialog", { name: /confirm/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));

    expect(screen.queryByRole("dialog", { name: /confirm/i })).not.toBeInTheDocument();
    expect(await screen.findByText(/cancelled/i)).toBeInTheDocument();

    // only the original unconfirmed attempt was ever sent
    const runCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([u]) => u === "/api/graphs/run?use_stubs=false",
    );
    expect(runCalls).toHaveLength(1);

    // no block shows a run outcome — the graph is exactly as it was
    expect(document.querySelectorAll(".run-done").length).toBe(0);
    expect(document.querySelectorAll(".run-failed").length).toBe(0);
    expect(document.querySelectorAll(".run-running").length).toBe(0);
    expect(screen.queryByText(/run complete/i)).not.toBeInTheDocument();

    // Run is available again immediately (not stuck "running")
    fireEvent.click(runButton());
    await screen.findByRole("dialog", { name: /confirm/i });
  });
});
