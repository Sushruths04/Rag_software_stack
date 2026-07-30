import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBlocks, listGraphs, loadGraph, runGraph, saveGraph, validateGraph } from "./client";
import type { GraphDoc } from "../types/graph";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const sampleGraph: GraphDoc = {
  schema_version: 1,
  name: "g",
  meta: { created: "", modified: "", notes: "" },
  blocks: [{ id: "b1", type: "facts_import", position: { x: 0, y: 0 }, params: {} }],
  wires: [],
};

describe("api client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ---- getBlocks ----------------------------------------------------------
  it("getBlocks returns ok:true with the parsed body on success", async () => {
    const body = { blocks: [{ type: "facts_import" }] };
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(body));

    const result = await getBlocks();

    expect(result).toEqual({ ok: true, data: body });
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/blocks", expect.any(Object));
  });

  it("getBlocks fails gracefully (does not throw) when the backend is unreachable", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await getBlocks();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Failed to fetch");
  });

  it("getBlocks fails gracefully on a non-2xx response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ detail: "boom" }, 500));

    const result = await getBlocks();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("500");
  });

  // ---- validateGraph --------------------------------------------------------
  it("validateGraph posts the graph and returns the compiler result", async () => {
    const responseBody = {
      valid: true,
      order: ["b1"],
      errors: [],
      warnings: [],
      cost: { total_calls: 0, paid_blocks: [] },
    };
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(responseBody));

    const result = await validateGraph(sampleGraph);

    expect(result).toEqual({ ok: true, data: responseBody });
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("/api/graphs/validate");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body)).toEqual(sampleGraph);
  });

  it("validateGraph falls back gracefully when the backend is unreachable", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await validateGraph(sampleGraph);

    expect(result.ok).toBe(false);
  });

  // ---- saveGraph / loadGraph / listGraphs -----------------------------------
  it("saveGraph posts the graph and returns id + graph", async () => {
    const responseBody = { id: "abc123", graph: sampleGraph };
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(responseBody));

    const result = await saveGraph(sampleGraph);

    expect(result).toEqual({ ok: true, data: responseBody });
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("/api/graphs");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body)).toEqual(sampleGraph);
  });

  it("loadGraph fetches by id and returns the graph", async () => {
    const responseBody = { id: "abc123", graph: sampleGraph };
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(responseBody));

    const result = await loadGraph("abc123");

    expect(result).toEqual({ ok: true, data: responseBody });
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/graphs/abc123", expect.any(Object));
  });

  it("loadGraph returns ok:false on a 404", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ detail: "not found" }, 404));

    const result = await loadGraph("missing-id");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("404");
  });

  it("listGraphs returns the graph summaries", async () => {
    const responseBody = { graphs: [{ id: "a", name: "A", modified: "2026-07-01T00:00:00Z" }] };
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(responseBody));

    const result = await listGraphs();

    expect(result).toEqual({ ok: true, data: responseBody });
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/graphs", expect.any(Object));
  });

  it("listGraphs fails gracefully when the backend is unreachable", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await listGraphs();

    expect(result.ok).toBe(false);
  });

  // ---- runGraph -------------------------------------------------------------
  it("runGraph posts the graph to /api/graphs/run?use_stubs=true by default", async () => {
    const responseBody = {
      ok: true,
      failed_block: null,
      order: ["b1"],
      events: [{ block_id: "b1", type: "block_finished", payload: { meta: {} } }],
      artifacts: { b1: { facts: { type: "facts", ref: "stub:facts_import:x", meta: { count: 5 } } } },
    };
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(responseBody));

    const result = await runGraph(sampleGraph);

    expect(result).toEqual({ ok: true, data: responseBody });
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("/api/graphs/run?use_stubs=true");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body)).toEqual(sampleGraph);
  });

  it("runGraph posts to use_stubs=false when requested", async () => {
    const responseBody = { ok: true, failed_block: null, order: [], events: [], artifacts: {} };
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(responseBody));

    await runGraph(sampleGraph, { useStubs: false });

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("/api/graphs/run?use_stubs=false");
  });

  it("runGraph returns ok:false for a compiler-rejected (400) graph without throwing, marked as a REACHABLE rejection (not a network error)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse(
        { valid: false, order: [], errors: [{ code: "cycle_detected", message: "graph contains a cycle" }], warnings: [], cost: null },
        400,
      ),
    );

    const result = await runGraph(sampleGraph);

    expect(result.ok).toBe(false);
    if (!result.ok && !result.requiresConfirmation) {
      expect(result.error).toContain("400");
      // The backend responded (even if with a rejection) — this must NOT be
      // reported as a network-level failure, or the caller will wrongly run
      // the simulated/offline demo instead of surfacing the real rejection.
      expect(result.networkError).toBe(false);
    } else {
      throw new Error("expected a plain ok:false result, not requiresConfirmation");
    }
  });

  it("runGraph fails gracefully when the backend is unreachable, marked as a genuine network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await runGraph(sampleGraph);

    expect(result.ok).toBe(false);
    if (!result.ok && !result.requiresConfirmation) {
      expect(result.networkError).toBe(true);
    } else {
      throw new Error("expected a plain ok:false result, not requiresConfirmation");
    }
  });

  // ---- runGraph: paid-block spend confirmation (M4b) -----------------------
  it("runGraph does not post a confirm_paid field by default (byte-identical body)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ ok: true, failed_block: null, order: [], events: [], artifacts: {} }),
    );

    await runGraph(sampleGraph);

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(call[1].body)).toEqual(sampleGraph);
  });

  it("runGraph posts confirm_paid: true when confirmPaid is requested", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ ok: true, failed_block: null, order: [], events: [], artifacts: {} }),
    );

    await runGraph(sampleGraph, { useStubs: false, confirmPaid: true });

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("/api/graphs/run?use_stubs=false");
    expect(JSON.parse(call[1].body)).toEqual({ ...sampleGraph, confirm_paid: true });
  });

  it("runGraph surfaces a 402 as a structured requiresConfirmation result, not a generic error", async () => {
    const responseBody = {
      requires_confirmation: true,
      paid_blocks: ["b10", "b11"],
      estimated: [
        { block_id: "b11", type: "qa_gen_clusters", calls: 510, usd: null, note: "clusters x3.5" },
        { block_id: "b10", type: "qa_gen_pairs", calls: 330, usd: null, note: "pairs x1.3" },
      ],
    };
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(responseBody, 402));

    const result = await runGraph(sampleGraph, { useStubs: false });

    expect(result.ok).toBe(false);
    if (!result.ok && result.requiresConfirmation) {
      expect(result.paidBlocks).toEqual(["b10", "b11"]);
      expect(result.estimated).toHaveLength(2);
      expect(result.estimated[0].type).toBe("qa_gen_clusters");
    } else {
      throw new Error("expected requiresConfirmation result");
    }
  });

  // ---- display-only wire field stripping (badge/weight) ----------------------
  // The backend Wire model is extra="forbid"; toGraphDoc puts badge/weight on
  // every wire for canvas display, so any graph POSTed as-is with badged
  // wires gets rejected with a wall of extra_forbidden errors (observed: 28
  // errors running the demo graph). client.ts must strip them before POSTing
  // — local .ragsession saves (toGraphDoc directly) are NOT affected.
  const BADGED_GRAPH = {
    schema_version: 1,
    name: "t",
    meta: { created: "", modified: "", notes: "" },
    blocks: [
      { id: "a", type: "chunks_import", position: { x: 0, y: 0 }, params: {} },
      { id: "b", type: "index_builder", position: { x: 0, y: 0 }, params: {} },
    ],
    wires: [
      { id: "w1", from: { block: "a", port: "chunks" }, to: { block: "b", port: "chunks" }, badge: "210 chunks", weight: "heavy" },
    ],
  } as unknown as GraphDoc;

  it("runGraph strips display-only wire fields (badge, weight) from the POST body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ ok: true, failed_block: null, order: [], events: [], artifacts: {} }),
    );

    await runGraph(BADGED_GRAPH, { useStubs: true });

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.wires[0]).not.toHaveProperty("badge");
    expect(body.wires[0]).not.toHaveProperty("weight");
    expect(body.wires[0].from).toEqual({ block: "a", port: "chunks" });
  });

  it("validateGraph strips display-only wire fields from the POST body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ valid: true, order: [], errors: [], warnings: [], cost: null }),
    );

    await validateGraph(BADGED_GRAPH);

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.wires[0]).not.toHaveProperty("badge");
    expect(body.wires[0]).not.toHaveProperty("weight");
  });

  it("saveGraph strips display-only wire fields from the POST body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ id: "abc123", graph: BADGED_GRAPH }),
    );

    await saveGraph(BADGED_GRAPH);

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.wires[0]).not.toHaveProperty("badge");
    expect(body.wires[0]).not.toHaveProperty("weight");
  });
});
