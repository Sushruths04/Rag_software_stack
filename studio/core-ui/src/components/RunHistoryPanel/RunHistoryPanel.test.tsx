import { describe, expect, it } from "vitest";
import { render, waitFor, screen, fireEvent } from "@testing-library/react";
import { RunHistoryPanel } from "./RunHistoryPanel";
import type { RunRecord } from "../../hooks/useDesktopProject";

// ids must be timestamp-shaped (the real production format, e.g.
// "2026-07-09T00-05-00-000Z") -- RunHistoryPanel's own formatId() runs
// every id through `new Date(...)`, and JS's lenient Date parsing does NOT
// reliably reject arbitrary non-timestamp strings, so an opaque fixture id
// like "run-3" can silently render as a garbled date instead of literal
// text. Generating real ISO-shaped ids sidesteps that entirely.
function runId(n: number): string {
  const iso = new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
  return iso.replace(/:/g, "-").replace(/\./g, "-");
}

function record(id: string): RunRecord {
  return {
    id,
    timestamp: "2026-07-09T00:00:00.000Z",
    graph: { schema_version: 1, name: "g", blocks: [], wires: [], meta: { created: "t", modified: "t", notes: "" } },
    ok: true,
    failedBlock: null,
    order: [],
    artifacts: {},
  };
}

describe("RunHistoryPanel — B-M7 list cap (04_DESIGN_SYSTEM.md perf pass: virtualized history lists)", () => {
  it("renders every run when the count is under the cap, with no truncation note", async () => {
    const ids = Array.from({ length: 5 }, (_, i) => runId(i));
    const { container } = render(
      <RunHistoryPanel
        open
        onClose={() => {}}
        listRunRecords={async () => ids}
        loadRunRecord={async (_p, _t, id) => record(id)}
        projectDir="/proj"
        tabId="main"
      />,
    );
    await waitFor(() => expect(container.querySelectorAll(".run-history__item")).toHaveLength(5));
    expect(screen.queryByText(/most recent of/)).not.toBeInTheDocument();
  });

  it("caps rendering to the 100 most recent runs and shows a truncation note when there are more", async () => {
    const ids = Array.from({ length: 240 }, (_, i) => runId(i)); // already newest-first, per listRunRecords' own contract
    const { container } = render(
      <RunHistoryPanel
        open
        onClose={() => {}}
        listRunRecords={async () => ids}
        loadRunRecord={async (_p, _t, id) => record(id)}
        projectDir="/proj"
        tabId="main"
      />,
    );
    await waitFor(() => expect(container.querySelectorAll(".run-history__item")).toHaveLength(100));
    expect(screen.getByText("showing the 100 most recent of 240 runs")).toBeInTheDocument();
    // the cap keeps the NEWEST entries (the front of the already-sorted
    // list), not an arbitrary slice
    const shownIds = [...container.querySelectorAll(".run-history__item")].map((el) => el.getAttribute("title"));
    expect(shownIds).toContain(ids[0]);
    expect(shownIds).not.toContain(ids[150]);
  });
});

describe("RunHistoryPanel — stale-response guard", () => {
  it("ignores a loadRunRecord response that resolves after a newer selection", async () => {
    const ids = [runId(1), runId(0)]; // newest first, per listRunRecords contract
    const pending = new Map<string, (r: RunRecord | null) => void>();
    const loadRunRecord = (_p: string, _t: string, id: string) =>
      new Promise<RunRecord | null>((resolve) => pending.set(id, resolve));

    render(
      <RunHistoryPanel
        open
        onClose={() => {}}
        listRunRecords={async () => ids}
        loadRunRecord={loadRunRecord}
        projectDir="/proj"
        tabId="main"
      />,
    );

    // the panel auto-selects ids[0]; its load is still pending
    await waitFor(() => expect(pending.has(ids[0])).toBe(true));
    // user clicks the second run before the first load resolves
    fireEvent.click(screen.getByTitle(ids[1]));
    await waitFor(() => expect(pending.has(ids[1])).toBe(true));

    // the NEWER selection resolves first with a distinctive record...
    pending.get(ids[1])!({ ...record(ids[1]), order: [] });
    await screen.findByText("0 blocks");

    // ...then the STALE response for the first selection arrives late
    pending.get(ids[0])!({ ...record(ids[0]), order: ["b1", "b2"] });
    await new Promise((r) => setTimeout(r, 25));
    expect(screen.queryByText("2 blocks")).not.toBeInTheDocument();
    expect(screen.getByText("0 blocks")).toBeInTheDocument();
  });
});
