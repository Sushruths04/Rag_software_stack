import "@testing-library/jest-dom/vitest";

// jsdom has no ResizeObserver; @xyflow/react needs one to measure nodes.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error -- test-environment polyfill
window.ResizeObserver = window.ResizeObserver ?? ResizeObserverStub;

// jsdom has no DOMMatrix; pdfjs-dist (pulled in transitively wherever
// PdfPageView / the dataset inspector is imported) references it at module
// evaluation time, so its mere import — even in a test that never renders a
// PDF — throws without this stub. The dataset inspector's own tests fully
// mock PdfPageView, so this only has to satisfy pdfjs's import-time
// reference, not do real matrix math.
if (!(globalThis as { DOMMatrix?: unknown }).DOMMatrix) {
  class DOMMatrixStub {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    constructor(_init?: unknown) {}
    scale() { return this; }
    translate() { return this; }
    multiply() { return this; }
  }
  // @ts-expect-error -- test-environment polyfill
  globalThis.DOMMatrix = DOMMatrixStub;
}

// jsdom has no matchMedia; theme + reduced-motion hooks call it at import time.
if (!window.matchMedia) {
  // @ts-expect-error -- test-environment polyfill
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
