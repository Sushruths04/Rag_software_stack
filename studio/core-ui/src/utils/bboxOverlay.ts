// Task 11: pure bbox->CSS-pixel math shared by PdfPageView and (Task 12) the
// dataset inspector. Kept dependency-free of pdfjs/DOM so it can be unit
// tested without a canvas or a real PDF document.

/** Fact bbox as produced by the pipeline's source-span mapping: TOPLEFT-origin
 * PDF points, i.e. (0,0) is the page's top-left corner and y increases
 * downward. This is the same convention pdfjs uses when it renders a page
 * canvas at a given scale, so no y-flip is needed when converting to an
 * on-screen overlay rect (unlike PDF's native bottom-left coordinate space). */
export interface FactBBox {
  page_no: number;
  l: number;
  t: number;
  r: number;
  b: number;
  coord_origin?: string;
}

/** CSS-pixel rect for an absolutely-positioned highlight `<div>` layered over
 * the page canvas. */
export interface OverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Converts a TOPLEFT-origin PDF-point bbox to a CSS-pixel overlay rect at
 * the given render scale (the same scale passed to pdfjs's
 * `page.getViewport({ scale })`). Pure multiply-by-scale: width = r-l,
 * height = b-t, no y-flip. */
export function bboxToOverlay(b: FactBBox, scale: number): OverlayRect {
  return {
    left: b.l * scale,
    top: b.t * scale,
    width: (b.r - b.l) * scale,
    height: (b.b - b.t) * scale,
  };
}

/** Sorted, deduplicated list of page numbers referenced by a set of bboxes. */
export function pagesOf(bboxes: FactBBox[]): number[] {
  return [...new Set(bboxes.map((b) => b.page_no))].sort((a, c) => a - c);
}
