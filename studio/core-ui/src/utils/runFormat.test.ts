import { describe, expect, it } from "vitest";
import { formatArtifactBadge, isStubRef } from "./runFormat";

describe("isStubRef", () => {
  it("recognizes a stub-prefixed ref", () => {
    expect(isStubRef("stub:facts_import:x.json")).toBe(true);
  });

  it("does not flag a real filesystem path as a stub", () => {
    expect(isStubRef("C:/tmp/rag_gt_studio_live_artifacts/facts_import_ab12.json")).toBe(false);
  });
});

describe("formatArtifactBadge", () => {
  it("formats a real (non-stub) chunks artifact with no honesty suffix", () => {
    const text = formatArtifactBadge({ type: "chunks", ref: "/tmp/real/chunks_import_ab12.json", meta: { count: 210 } });
    expect(text).toBe("210 chunks");
  });

  it("formats a real facts artifact including the grounded flag", () => {
    const text = formatArtifactBadge({ type: "facts", ref: "/tmp/real/facts_import_ab12.json", meta: { count: 118, grounded: true } });
    expect(text).toBe("118 facts · grounded");
  });

  it("formats a qa artifact with multi-hop count", () => {
    const text = formatArtifactBadge({ type: "qa", ref: "/tmp/real/qa.json", meta: { count: 86, multi_hop: 33 } });
    expect(text).toBe("86 QA · 33 multi-hop");
  });

  it("formats an index artifact from strategy + docs", () => {
    const text = formatArtifactBadge({ type: "index", ref: "/tmp/real/index.json", meta: { strategy: "bm25", docs: 224 } });
    expect(text).toBe("bm25 · 224 docs");
  });

  it("formats an eval artifact from recall_at_k + k", () => {
    const text = formatArtifactBadge({ type: "eval", ref: "/tmp/real/eval.json", meta: { recall_at_k: 0.698, k: 5 } });
    expect(text).toBe("recall@5 0.698");
  });

  it("appends a (planned) honesty suffix for any stub-prefixed ref, regardless of port type", () => {
    const text = formatArtifactBadge({ type: "chunks", ref: "stub:chunker:sliding_256:256", meta: { count: 224 } });
    expect(text).toBe("224 chunks (planned)");
  });

  it("marks a stub qa artifact as planned too", () => {
    const text = formatArtifactBadge({ type: "qa", ref: "stub:qa_import:x.json", meta: { count: 86, multi_hop: 33 } });
    expect(text).toBe("86 QA · 33 multi-hop (planned)");
  });
});
