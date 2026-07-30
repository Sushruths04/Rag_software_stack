import { describe, expect, it } from "vitest";
import { bboxToOverlay, pagesOf } from "./bboxOverlay";
import type { FactBBox } from "./bboxOverlay";

/**
 * Task 11: pure bbox->CSS-pixel math for the PdfPageView overlay.
 *
 * Fact bboxes are TOPLEFT-origin PDF points: {l, t, r, b} measured with
 * (0,0) at the top-left of the page and y increasing downward. pdfjs
 * canvases are drawn with the same top-left, y-down convention at a given
 * render scale, so converting a bbox to an overlay rect is a straight
 * multiply-by-scale with NO y-flip (unlike PDF's native bottom-left
 * coordinate space, which this pipeline never produces).
 */
describe("bboxToOverlay", () => {
  it("scales a TOPLEFT bbox to CSS pixels with no y-flip", () => {
    const b: FactBBox = { page_no: 9, l: 70.8, t: 567.8, r: 431.0, b: 578.9, coord_origin: "TOPLEFT" };
    const overlay = bboxToOverlay(b, 2);
    expect(overlay.left).toBeCloseTo(141.6, 2);
    expect(overlay.top).toBeCloseTo(1135.6, 2);
    expect(overlay.width).toBeCloseTo(720.4, 2);
    expect(overlay.height).toBeCloseTo(22.2, 2);
  });

  it("uses scale 1 as an identity mapping of width/height", () => {
    const b: FactBBox = { page_no: 1, l: 0, t: 0, r: 100, b: 50 };
    const overlay = bboxToOverlay(b, 1);
    expect(overlay).toEqual({ left: 0, top: 0, width: 100, height: 50 });
  });
});

describe("pagesOf", () => {
  it("returns sorted unique page numbers", () => {
    const bboxes: FactBBox[] = [
      { page_no: 3, l: 0, t: 0, r: 1, b: 1 },
      { page_no: 1, l: 0, t: 0, r: 1, b: 1 },
      { page_no: 3, l: 5, t: 5, r: 6, b: 6 },
      { page_no: 2, l: 0, t: 0, r: 1, b: 1 },
    ];
    expect(pagesOf(bboxes)).toEqual([1, 2, 3]);
  });

  it("returns an empty array for no bboxes", () => {
    expect(pagesOf([])).toEqual([]);
  });
});
