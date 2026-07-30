/**
 * LIVE end-to-end smoke for the 20 bundled-data templates (template-library
 * spec 2026-07-11, "Testing" §: real run, not just Validate). Opt-in:
 * skipped entirely unless SMOKE_BASE_URL is set, so `npm test` stays
 * offline/hermetic. Each template graph gets its datasets/ paths stamped to
 * the committed sample-data files (the same rewrite StudioShell performs at
 * hydration) and is POSTed to /api/graphs/run?use_stubs=false. Passing
 * means: ok:true, no failed block, one artifact per block, and no artifact
 * ref beginning with "stub:" (the stub registry's marker) — for all 20
 * templates except `exact-id-match-mode`, which is asserted to FAIL for a
 * known, documented reason (see the dedicated test below): its evaluator
 * block requests match_mode="exact-id", and rag_gt.blocks.evaluator raises
 * NotImplementedError for any match_mode other than "overlap" (catalog
 * Phase-1 P1.4 — the exact-id matcher does not exist yet). That is a
 * pre-existing, intentional engine gap, not a regression, so this template
 * is excluded from the "real run succeeds" loop and covered by its own
 * expected-failure test instead. If the engine gap is ever closed, that
 * test will start failing ("why is this suddenly passing?") and should be
 * flipped back into the normal success loop below.
 *
 * Run (PowerShell, from studio/core-ui/):
 *   $env:SMOKE_BASE_URL = "http://127.0.0.1:8100"
 *   npx vitest run src/data/templates/templates.smoke.test.ts
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stampTemplateGraph } from "../../utils/templateStamp";
import { TEMPLATES } from "./index";

const BASE_URL = process.env.SMOKE_BASE_URL ?? "";
const SAMPLE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../desktop/src-tauri/sample-data/ecma404",
);

interface RunResponse {
  ok: boolean;
  failed_block: string | null;
  order: string[];
  events: { type: string; block_id?: string; [k: string]: unknown }[];
  artifacts: Record<string, Record<string, { type: string; ref: string; meta: Record<string, unknown> }>>;
}

describe.runIf(BASE_URL !== "")("live template smoke (SMOKE_BASE_URL set)", () => {
  const live = TEMPLATES.filter((t) => t.needsSampleData);
  // Known-broken by design (catalog Phase-1 P1.4, see header docstring):
  // evaluator's match_mode="exact-id" is not implemented in the engine yet.
  const KNOWN_UNRUNNABLE_ID = "exact-id-match-mode";
  const runnable = live.filter((t) => t.id !== KNOWN_UNRUNNABLE_ID);

  it("covers exactly the 20 bundled-data templates", () => {
    expect(live).toHaveLength(20);
  });

  for (const t of runnable) {
    it(
      `${t.id}: real run succeeds on every block`,
      async () => {
        const graph = await stampTemplateGraph(t.graph, async (rel) =>
          path.join(SAMPLE_DIR, rel.replace(/^datasets\/ecma404\//, "")),
        );
        const res = await fetch(`${BASE_URL}/api/graphs/run?use_stubs=false`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(graph),
        });
        expect(res.status, `${t.id}: HTTP ${res.status}`).toBe(200);
        const body = (await res.json()) as RunResponse;
        expect(body.failed_block, `${t.id} failed at block ${body.failed_block}`).toBeNull();
        expect(body.ok).toBe(true);
        expect(body.order).toHaveLength(t.graph.blocks.length);
        // one real (non-stub) artifact set per block:
        expect(Object.keys(body.artifacts).sort()).toEqual(t.graph.blocks.map((b) => b.id).sort());
        for (const [blockId, ports] of Object.entries(body.artifacts)) {
          for (const [port, art] of Object.entries(ports)) {
            expect(
              art.ref.startsWith("stub:"),
              `${t.id}/${blockId}.${port} returned stub output: ${art.ref}`,
            ).toBe(false);
          }
        }
        const failures = body.events.filter((e) => e.type === "block_failed");
        expect(failures, `${t.id} block_failed events`).toEqual([]);
      },
      300_000, // hybrid/local embedding runs are slow; 5 min per template
    );
  }

  it(
    `${KNOWN_UNRUNNABLE_ID}: real run is EXPECTED to fail — evaluator match_mode="exact-id" ` +
      "is unimplemented in the engine (catalog Phase-1 P1.4). This test documents and locks " +
      "in that known-broken state: if it ever starts passing, the engine gap has been closed " +
      "and this template should be moved back into the success loop above.",
    async () => {
      const t = live.find((x) => x.id === KNOWN_UNRUNNABLE_ID);
      expect(t, `${KNOWN_UNRUNNABLE_ID} missing from TEMPLATES`).toBeDefined();
      const graph = await stampTemplateGraph(t!.graph, async (rel) =>
        path.join(SAMPLE_DIR, rel.replace(/^datasets\/ecma404\//, "")),
      );
      const res = await fetch(`${BASE_URL}/api/graphs/run?use_stubs=false`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(graph),
      });
      expect(res.status, `${KNOWN_UNRUNNABLE_ID}: HTTP ${res.status}`).toBe(200);
      const body = (await res.json()) as RunResponse;
      // The point of this test: this run does NOT succeed, and it fails at
      // the evaluator block specifically (block id "e1" in this template's
      // graph — the only block that touches match_mode), not somewhere
      // unrelated.
      const evaluatorBlockId = t!.graph.blocks.find((b) => b.type === "evaluator")!.id;
      expect(body.ok, `${KNOWN_UNRUNNABLE_ID} unexpectedly reported ok:true`).toBe(false);
      expect(body.failed_block).toBe(evaluatorBlockId);
      const failures = body.events.filter((e) => e.type === "block_failed" && e.block_id === evaluatorBlockId);
      expect(failures.length, `${KNOWN_UNRUNNABLE_ID} expected a block_failed event for evaluator`).toBeGreaterThan(0);
    },
    300_000,
  );
});
