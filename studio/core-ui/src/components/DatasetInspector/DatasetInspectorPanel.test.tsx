import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DatasetInspectorPanel } from "./DatasetInspectorPanel";

/**
 * Verification for Task 12 without a real desktop shell: an in-memory fake
 * filesystem stands in for the Tauri fs/path modules useDesktopProject talks
 * to (same approach as useDesktopProject.test.ts), and PdfPageView is mocked
 * to a plain <div> that echoes the pageNo + highlights props it receives, so
 * a fact/QA click's effect is assertable as data-attributes rather than
 * needing a real canvas/pdfjs render.
 */

// Records the last props PdfPageView was rendered with, for prop-level
// assertions. A vi.hoisted box because the vi.mock factory is hoisted above
// this file's top-level statements.
const { lastProps } = vi.hoisted(() => ({
  lastProps: { current: null as null | { pdfPath: string; pageNo: number; highlights: Array<{ page_no: number; color?: string }> } },
}));

vi.mock("./PdfPageView", () => ({
  PdfPageView: (props: { pdfPath: string; pageNo: number; highlights: Array<{ page_no: number; color?: string }> }) => {
    lastProps.current = props;
    return (
      <div
        data-testid="pdf-page-view"
        data-pdf-path={props.pdfPath}
        data-page-no={props.pageNo}
        data-highlight-count={props.highlights.length}
        data-colors={props.highlights.map((h) => h.color ?? "").join("|")}
      />
    );
  },
}));

const files = new Map<string, string>();
const dirs = new Set<string>();
let dialogQueue: Array<string | string[] | null> = [];

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/path", () => ({
  appLocalDataDir: async () => "/appdata",
  join: async (...parts: string[]) => parts.join("/"),
  resolveResource: async (p: string) => `/resources/${p}`,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: async () => dialogQueue.shift() ?? null,
  save: async () => dialogQueue.shift() ?? null,
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async (path: string) => files.has(path) || dirs.has(path),
  readTextFile: async (path: string) => {
    if (!files.has(path)) throw new Error(`not found: ${path}`);
    return files.get(path)!;
  },
  writeTextFile: async (path: string, content: string) => {
    files.set(path, content);
  },
  mkdir: async (path: string) => {
    dirs.add(path);
  },
  readDir: async () => [],
  copyFile: async (from: string, to: string) => {
    files.set(to, files.has(from) ? files.get(from)! : `<copied:${from}>`);
  },
}));

const PROJECT_DIR = "/proj";

function seedProject(corpus: unknown[]) {
  files.set(`${PROJECT_DIR}/project.json`, JSON.stringify({ name: "p", created: "t", corpus }));
}

// Two facts on two different pages; the first spans two pages so the
// multi-page page-chip path is exercised.
const FACT_A = {
  fact_id: "ecma404_json_F000027",
  canonical_form: "A JSON value is an object, array, number, string, true, false, or null.",
  page_start: 9,
  bboxes: [
    { page_no: 9, l: 10, t: 20, r: 60, b: 40, coord_origin: "TOPLEFT" },
    { page_no: 9, l: 5, t: 5, r: 15, b: 15, coord_origin: "TOPLEFT" },
    { page_no: 10, l: 1, t: 1, r: 2, b: 2, coord_origin: "TOPLEFT" },
  ],
};
const FACT_B = {
  fact_id: "ecma404_json_F000031",
  text: "An object is an unordered set of name/value pairs.",
  page_start: 12,
  bboxes: [{ page_no: 12, l: 3, t: 3, r: 8, b: 8, coord_origin: "TOPLEFT" }],
};

function seedFactsFile(rel: string, facts: unknown[]) {
  files.set(`${PROJECT_DIR}/${rel}`, JSON.stringify(facts));
}
function seedQaFile(rel: string, qa: unknown) {
  files.set(`${PROJECT_DIR}/${rel}`, JSON.stringify(qa));
}

beforeEach(() => {
  files.clear();
  dirs.clear();
  dialogQueue = [];
  lastProps.current = null;
  vi.clearAllMocks();
});

describe("DatasetInspectorPanel", () => {
  it("does not render its dialog until open is true", () => {
    seedProject([]);
    const { container } = render(<DatasetInspectorPanel open={false} onClose={() => {}} projectDir={PROJECT_DIR} />);
    expect(container.querySelector(".dataset-inspector__overlay")).toBeNull();
  });

  it("lists corpus entries from project.json and auto-selects the first", async () => {
    seedProject([
      { id: "ecma404", label: "ecma404", pdf: "datasets/ecma404/ecma404.pdf", facts: "datasets/ecma404/facts.json" },
      { id: "iso15609", label: "iso15609", pdf: "datasets/iso/iso.pdf" },
    ]);
    seedFactsFile("datasets/ecma404/facts.json", [FACT_A, FACT_B]);
    render(<DatasetInspectorPanel open onClose={() => {}} projectDir={PROJECT_DIR} />);

    const picker = (await screen.findByLabelText("Corpus entry")) as HTMLSelectElement;
    expect(picker.value).toBe("ecma404");
    expect(await screen.findByText("ecma404_json_F000027")).toBeInTheDocument();
  });

  it("passes the right pageNo + highlights into PdfPageView when a fact is clicked", async () => {
    seedProject([{ id: "ecma404", label: "ecma404", pdf: "datasets/ecma404/ecma404.pdf", facts: "datasets/ecma404/facts.json" }]);
    seedFactsFile("datasets/ecma404/facts.json", [FACT_A, FACT_B]);
    render(<DatasetInspectorPanel open onClose={() => {}} projectDir={PROJECT_DIR} />);

    fireEvent.click(await screen.findByText("ecma404_json_F000027"));

    const view = await screen.findByTestId("pdf-page-view");
    // page 9 is FACT_A's first page; only page-9 bboxes are handed to the view
    expect(view.getAttribute("data-page-no")).toBe("9");
    expect(view.getAttribute("data-highlight-count")).toBe("2");
    expect(view.getAttribute("data-pdf-path")).toBe("/proj/datasets/ecma404/ecma404.pdf");
    // a plain single-fact click carries no per-fact color override
    expect(lastProps.current?.highlights.every((h) => !h.color)).toBe(true);

    // FACT_A spans pages 9 and 10 -> a multi-page chip row is offered
    expect(screen.getByRole("button", { name: "Page 10" })).toBeInTheDocument();
  });

  it("QA chip click-through selects the fact and drives PdfPageView", async () => {
    seedProject([
      { id: "ecma404", label: "ecma404", pdf: "datasets/ecma404/ecma404.pdf", facts: "datasets/ecma404/facts.json", qa: "datasets/ecma404/qa.json" },
    ]);
    seedFactsFile("datasets/ecma404/facts.json", [FACT_A, FACT_B]);
    seedQaFile("datasets/ecma404/qa.json", [
      { qa_id: "QA1", hop_type: "multi", question: "What can a JSON value be?", answer_clauses: [{ fact_id: FACT_A.fact_id }, { fact_id: FACT_B.fact_id }] },
    ]);
    render(<DatasetInspectorPanel open onClose={() => {}} projectDir={PROJECT_DIR} />);

    // switch to the QA tab
    fireEvent.click(await screen.findByRole("tab", { name: "QA pairs" }));
    // selecting the pair overlays ALL its facts (multi-fact, per-fact colors)
    fireEvent.click(await screen.findByText("QA1"));

    await waitFor(() => expect(lastProps.current).not.toBeNull());
    // active page defaults to the first page any clause fact appears on (9)
    expect(lastProps.current?.pageNo).toBe(9);
    // each clause fact drawn on page 9 gets a distinct CSS-token color
    const colors = lastProps.current!.highlights.map((h) => h.color);
    expect(colors.every((c) => typeof c === "string" && c.startsWith("var(--port-"))).toBe(true);

    // now the chip click-through: clicking FACT_B's chip narrows to just that
    // fact (single-fact select), whose page is 12
    fireEvent.click(screen.getByRole("button", { name: FACT_B.fact_id }));
    await waitFor(() => expect(lastProps.current?.pageNo).toBe(12));
    expect(lastProps.current?.highlights).toHaveLength(1);
  });

  it("shows an honest empty state when the entry has no facts artifact", async () => {
    seedProject([{ id: "pdfonly", label: "pdfonly", pdf: "datasets/pdfonly/doc.pdf" }]);
    render(<DatasetInspectorPanel open onClose={() => {}} projectDir={PROJECT_DIR} />);

    expect(await screen.findByText("this corpus has no facts file attached")).toBeInTheDocument();
    // switching to QA shows its own honest line, never a crash
    fireEvent.click(screen.getByRole("tab", { name: "QA pairs" }));
    expect(await screen.findByText("this corpus has no qa file attached")).toBeInTheDocument();
  });

  it("shows a no-corpus empty state and never crashes when the project has zero entries", async () => {
    seedProject([]);
    render(<DatasetInspectorPanel open onClose={() => {}} projectDir={PROJECT_DIR} />);
    expect(await screen.findByText(/no corpus imported yet/i)).toBeInTheDocument();
  });

  it("closes via the close button", async () => {
    seedProject([]);
    const onClose = vi.fn();
    render(<DatasetInspectorPanel open onClose={onClose} projectDir={PROJECT_DIR} />);
    fireEvent.click(await screen.findByLabelText("Close dataset inspector"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders a dangling answer-clause fact_id as a non-clickable missing chip", async () => {
    seedProject([
      { id: "ecma404", label: "ecma404", pdf: "datasets/ecma404/ecma404.pdf", facts: "datasets/ecma404/facts.json", qa: "datasets/ecma404/qa.json" },
    ]);
    seedFactsFile("datasets/ecma404/facts.json", [FACT_A]);
    seedQaFile("datasets/ecma404/qa.json", [
      { qa_id: "QA1", hop_type: "single", question: "q", answer_clauses: [{ fact_id: "does_not_exist" }] },
    ]);
    render(<DatasetInspectorPanel open onClose={() => {}} projectDir={PROJECT_DIR} />);

    fireEvent.click(await screen.findByRole("tab", { name: "QA pairs" }));
    fireEvent.click(await screen.findByText("QA1"));
    // the missing fact renders as text, not a clickable button
    const missing = await screen.findByText("does_not_exist");
    expect(missing.tagName).toBe("SPAN");
  });
});
