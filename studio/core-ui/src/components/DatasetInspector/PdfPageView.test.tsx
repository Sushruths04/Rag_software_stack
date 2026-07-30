import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import * as pdfjs from "pdfjs-dist";
import { PdfPageView } from "./PdfPageView";
import type { FactBBox } from "../../utils/bboxOverlay";

const getDocumentMock = vi.mocked(pdfjs.getDocument);

/**
 * pdfjs-dist must never actually load in jsdom (no real canvas/worker
 * support here) — vi.mock keeps it out of the test bundle entirely, same
 * as the brief requires. The Tauri fs plugin is mocked too, since this
 * component reads the PDF bytes through `readFile`, never `fetch`.
 *
 * vi.hoisted is needed because vi.mock factories are hoisted above this
 * file's own top-level statements, so any mock state the factories close
 * over has to be created inside vi.hoisted to avoid a TDZ reference error.
 */
const { destroyMocks, race } = vi.hoisted(() => {
  const destroyMocks: Array<ReturnType<typeof import("vitest").vi.fn>> = [];
  // Shared control surface for the overlapping-race test. When `manual` is
  // on, each getDocument() call parks on a deferred whose resolver is pushed
  // to `resolvers` so the test can decide exactly when (and in what order)
  // each in-flight load "completes". `renderedPages` records the pageNo of
  // every canvas render that actually fired, so the test can prove a stale
  // first-load never paints over a newer one.
  const race = {
    manual: false,
    resolvers: [] as Array<() => void>,
    renderedPages: [] as number[],
  };
  return { destroyMocks, race };
});

vi.mock("pdfjs-dist", () => {
  const makePage = (pageNo: number) => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 200 * scale, height: 100 * scale }),
    // Records which page was actually painted to the canvas, then resolves.
    render: () => {
      race.renderedPages.push(pageNo);
      return { promise: Promise.resolve() };
    },
  });
  const getDocument = vi.fn(() => {
    const destroy = vi.fn(async () => {});
    destroyMocks.push(destroy);
    const doc = { getPage: vi.fn(async (n: number) => makePage(n)) };
    // pdfjs's `.destroy()` lives on the loading task returned by
    // getDocument(), not on the resolved PDFDocumentProxy — see
    // PdfPageView.tsx's loadingTask.destroy() cleanup.
    if (race.manual) {
      // Park until the test resolves this specific load, so two loads can be
      // held in flight at once and completed in a controlled order.
      const promise = new Promise((resolve) => {
        race.resolvers.push(() => resolve(doc));
      });
      return { promise, destroy };
    }
    return { promise: Promise.resolve(doc), destroy };
  });
  return { GlobalWorkerOptions: {}, getDocument };
});

vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  destroyMocks.length = 0;
  race.manual = false;
  race.resolvers.length = 0;
  race.renderedPages.length = 0;
  vi.clearAllMocks();
  // jsdom ships no real canvas backend; the component calls
  // canvas.getContext("2d") directly (not through pdfjs, which is mocked),
  // so it needs a stub context object or the render call short-circuits.
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({})) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  // jsdom reports clientWidth 0 for every element; pin it so
  // containerWidth / unscaledWidth (200) resolves to a deterministic scale.
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 400 });
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

describe("PdfPageView", () => {
  const highlights: FactBBox[] = [
    { page_no: 3, l: 10, t: 20, r: 60, b: 40, coord_origin: "TOPLEFT" },
    { page_no: 3, l: 5, t: 5, r: 15, b: 15, coord_origin: "TOPLEFT" },
  ];

  it("renders a canvas and one overlay div per highlight, positioned via bboxToOverlay", async () => {
    const { container } = render(<PdfPageView pdfPath="/abs/doc.pdf" pageNo={3} highlights={highlights} />);

    await waitFor(() => {
      expect(container.querySelectorAll(".pdf-highlight")).toHaveLength(2);
    });

    expect(container.querySelector("canvas")).not.toBeNull();

    // containerWidth (stubbed 400) / unscaled viewport width (200) => scale 2,
    // matching bboxToOverlay's own multiply-by-scale, no-y-flip math.
    const divs = container.querySelectorAll<HTMLDivElement>(".pdf-highlight");
    expect(divs[0].style.left).toBe("20px");
    expect(divs[0].style.top).toBe("40px");
    expect(divs[0].style.width).toBe("100px");
    expect(divs[0].style.height).toBe("40px");

    expect(divs[1].style.left).toBe("10px");
    expect(divs[1].style.top).toBe("10px");
    expect(divs[1].style.width).toBe("20px");
    expect(divs[1].style.height).toBe("20px");
  });

  it("destroys the pdf document on unmount", async () => {
    const { unmount, container } = render(<PdfPageView pdfPath="/abs/doc.pdf" pageNo={1} highlights={[]} />);
    await waitFor(() => expect(container.querySelector("canvas")).not.toBeNull());

    expect(destroyMocks).toHaveLength(1);
    unmount();
    expect(destroyMocks[0]).toHaveBeenCalledTimes(1);
  });

  it("fires cleanup (destroys the previous document) on a settled prop change", async () => {
    // Non-overlapping case: the first load fully completes before pdfPath
    // changes, so this only proves the effect's cleanup runs on prop change,
    // not that it wins a genuine in-flight race — that is the next test.
    const { rerender, container } = render(<PdfPageView pdfPath="/abs/a.pdf" pageNo={1} highlights={[]} />);
    await waitFor(() => expect(container.querySelector("canvas")).not.toBeNull());
    expect(destroyMocks).toHaveLength(1);
    const firstDestroy = destroyMocks[0];

    rerender(<PdfPageView pdfPath="/abs/b.pdf" pageNo={1} highlights={[]} />);
    await waitFor(() => expect(destroyMocks).toHaveLength(2));

    expect(firstDestroy).toHaveBeenCalledTimes(1);
  });

  it("latest-wins: a stale in-flight load cannot paint over the newer page", async () => {
    // Genuine overlapping race. Both loads are held pending via `race.manual`
    // deferreds, so the SECOND (page 2) change happens while the FIRST
    // (page 1) load is still in flight. We then complete page 2 first, and
    // only afterwards complete the now-stale page 1 — the guard must discard
    // page 1 so the canvas ends up showing page 2's content, never page 1's.
    race.manual = true;

    const { rerender, container } = render(<PdfPageView pdfPath="/abs/doc.pdf" pageNo={1} highlights={[]} />);
    // Wait until the first load has reached getDocument() (i.e. it is parked
    // on its deferred, genuinely in flight) before changing the page.
    await waitFor(() => expect(getDocumentMock).toHaveBeenCalledTimes(1));

    rerender(<PdfPageView pdfPath="/abs/doc.pdf" pageNo={2} highlights={[]} />);
    // Now the second load is also in flight; two deferreds are outstanding.
    await waitFor(() => expect(getDocumentMock).toHaveBeenCalledTimes(2));
    expect(race.resolvers).toHaveLength(2);

    // Complete the NEWER load (page 2) first: it renders to the canvas.
    race.resolvers[1]();
    await waitFor(() => expect(race.renderedPages).toContain(2));

    // Now complete the STALE older load (page 1). Its chain must hit the
    // stale guard, destroy its task, and return WITHOUT rendering.
    race.resolvers[0]();
    // Flush any microtasks the stale chain might still run.
    await Promise.resolve();
    await Promise.resolve();

    expect(container.querySelector("canvas")).not.toBeNull();
    // The decisive assertion: page 1 was never painted — only page 2.
    expect(race.renderedPages).toEqual([2]);
    // The stale page-1 load was torn down (no leaked worker); the active
    // page-2 load, still mounted and in use, was not destroyed.
    expect(destroyMocks).toHaveLength(2);
    expect(destroyMocks[0]).toHaveBeenCalled();
    expect(destroyMocks[1]).not.toHaveBeenCalled();
  });
});
