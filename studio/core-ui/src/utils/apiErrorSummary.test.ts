import { describe, expect, it } from "vitest";
import { summarizeApiError } from "./apiErrorSummary";

describe("summarizeApiError", () => {
  it("condenses a pydantic validation dump to a count + detail", () => {
    const raw = 'HTTP 400: {"detail":{"valid":false,"errors":[{"code":"invalid_graph_schema","message":"28 validation errors for Graph\\nwires.0.badge\\n Extra inputs are not permitted..."}]}}';
    const { summary, detail } = summarizeApiError(raw);
    expect(summary).toBe("request rejected — 28 validation errors (details below)");
    expect(detail).toContain("Extra inputs are not permitted");
    expect(summary.length).toBeLessThan(80);
  });

  it("passes short messages through untouched", () => {
    expect(summarizeApiError("graph has a cycle")).toEqual({ summary: "graph has a cycle" });
  });

  it("strips the HTTP status prefix from short backend rejections", () => {
    const { summary, detail } = summarizeApiError("HTTP 400: graph is not runnable");
    expect(summary).toBe("graph is not runnable");
    expect(summary).not.toMatch(/HTTP/);
    expect(detail).toBe("HTTP 400: graph is not runnable");
  });

  it("truncates long non-pydantic messages and keeps the full text as detail", () => {
    const raw = "x".repeat(400);
    const { summary, detail } = summarizeApiError(raw);
    expect(summary.length).toBeLessThanOrEqual(160);
    expect(detail).toBe(raw);
  });
});
