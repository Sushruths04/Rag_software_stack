import { describe, it, expect } from "vitest";
import { buildRunReportHtml, buildProvenanceManifest, sha256Hex } from "./runReport";
import type { RunRecord } from "../hooks/useDesktopProject";

function record(ok = true): RunRecord {
  return {
    id: "2026-07-09T00-00-00-000Z",
    timestamp: "2026-07-09T00:00:00.000Z",
    graph: { schema_version: 1, name: "My Graph", blocks: [], wires: [], meta: { created: "t", modified: "t", notes: "" } },
    ok,
    failedBlock: ok ? null : "b2",
    order: ["b1", "b2"],
    artifacts: {
      b1: { chunks: { type: "chunks", ref: "chunks:abc123", meta: { count: 12 } } },
    },
  };
}

describe("sha256Hex", () => {
  it("produces a stable 64-char lowercase hex digest", async () => {
    const hash = await sha256Hex("hello");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex("hello")).toBe(hash);
    expect(await sha256Hex("world")).not.toBe(hash);
  });
});

describe("buildProvenanceManifest", () => {
  it("hashes the run record content and each artifact's ref/meta, not raw bytes", async () => {
    const manifest = await buildProvenanceManifest(record(), "2026-07-09T01:00:00.000Z");
    expect(manifest.runId).toBe("2026-07-09T00-00-00-000Z");
    expect(manifest.runContentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.artifactHashes.b1.chunks).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes the run content hash when the run outcome differs", async () => {
    const okManifest = await buildProvenanceManifest(record(true), "t");
    const failManifest = await buildProvenanceManifest(record(false), "t");
    expect(okManifest.runContentHash).not.toBe(failManifest.runContentHash);
  });
});

describe("buildRunReportHtml", () => {
  it("is fully self-contained: no external script/link/image requests", async () => {
    const html = await buildRunReportHtml(record(), "2026-07-09T01:00:00.000Z");
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/https?:\/\//i);
  });

  it("renders the graph name, run status, block order, and artifact refs", async () => {
    const html = await buildRunReportHtml(record(true), "t");
    expect(html).toContain("My Graph");
    expect(html).toContain("✓ ok");
    expect(html).toContain("chunks:abc123");
    expect(html).toContain("b1");
    expect(html).toContain("b2");
  });

  it("shows the failure detail on a failed run instead of a false ok", async () => {
    const html = await buildRunReportHtml(record(false), "t");
    expect(html).toContain("✗ failed at b2");
    expect(html).not.toContain("✓ ok");
  });

  it("escapes HTML-significant characters in graph/artifact content", async () => {
    const r = record();
    r.graph.name = '<img src=x onerror=alert(1)>';
    const html = await buildRunReportHtml(r, "t");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("embeds a machine-readable provenance manifest with no unescaped closing script tag", async () => {
    // runId lands RAW inside the embedded JSON manifest (unlike artifact
    // refs, which only ever contribute to a hash) -- this is the field
    // that actually exercises the </script escape guard.
    const r = record();
    r.id = "run-</script><script>alert(1)</script>";
    const html = await buildRunReportHtml(r, "t");
    expect(html).not.toMatch(/<\/script><script>alert\(1\)/);
    expect(html).toContain('"runId": "run-<\\/script><script>alert(1)<\\/script>"');
  });
});
