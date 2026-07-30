import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import type { FactBBox } from "../../utils/bboxOverlay";
import { bboxToOverlay } from "../../utils/bboxOverlay";
import "./PdfPageView.css";

// Vite ESM worker wiring: pdfjs-dist ships its worker as a separate module
// rather than inlining it, so it must be resolved as a URL relative to this
// module (not a bare specifier) for Vite to fingerprint and bundle it
// correctly in both `vite dev` and the production build.
//
// This is deliberately a module-level side effect, not something inside the
// component: GlobalWorkerOptions.workerSrc is app-wide, one-time pdfjs
// configuration (this is the pattern pdfjs's own Vite guidance uses), so it
// runs once when this module is first imported rather than on every mount.
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

/** Task 12: a highlight is a bbox plus an optional per-highlight color (a
 * CSS color value, e.g. "var(--port-facts)") so the dataset inspector can
 * render a QA pair's several answer-clause facts as visually distinct
 * highlights on the same page. Omitted -> the default single-highlight
 * amber used for a plain single-fact click. */
export interface Highlight extends FactBBox {
  color?: string;
}

export interface PdfPageViewProps {
  /** Absolute path, read via Tauri's fs plugin (never fetched as a URL —
   * the desktop app has no HTTP server for project files). */
  pdfPath: string;
  /** 1-based page number, matching pdfjs's own page numbering. */
  pageNo: number;
  /** Fact bboxes for this page only; the caller (Task 12's dataset
   * inspector) is responsible for filtering by page_no before passing them
   * in — this component draws whatever it is given. */
  highlights: Highlight[];
}

/** Renders one PDF page to a canvas via pdfjs-dist and layers fact bboxes on
 * top as absolutely-positioned highlight divs. The render scale is chosen
 * to fit the page to the container's width, and that same scale is reused
 * for the bbox->CSS-pixel overlay math so highlights stay aligned with the
 * canvas at any container size. */
export function PdfPageView({ pdfPath, pageNo, highlights }: PdfPageViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [scale, setScale] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Latest-wins cleanup guard, same pattern as RunHistoryPanel's
  // loadRunRecord effect: a fast pageNo/pdfPath change while a prior
  // getDocument/getPage/render chain is still in flight must not let the
  // stale response paint over the current one, and the stale document must
  // be destroyed (pdfjs documents hold worker-side memory that a GC alone
  // won't reclaim).
  useEffect(() => {
    let stale = false;
    // The loading task (not the resolved PDFDocumentProxy) is what carries
    // `.destroy()` in pdfjs's API — it owns the worker and any in-flight
    // network requests, so it's what has to be torn down on unmount/path
    // change to avoid leaking a worker per page view.
    let loadingTask: pdfjs.PDFDocumentLoadingTask | null = null;
    setScale(null);
    setError(null);

    void (async () => {
      try {
        const { readFile } = await import("@tauri-apps/plugin-fs");
        const data = await readFile(pdfPath);
        if (stale) return;

        loadingTask = pdfjs.getDocument({ data });
        const doc = await loadingTask.promise;
        if (stale) {
          // Deliberate early teardown: the document finished loading after
          // this effect was already superseded, so free the worker now
          // rather than holding it until the cleanup below runs. pdfjs's
          // destroy() is idempotent, so the cleanup calling it again on the
          // same task is harmless.
          void loadingTask.destroy();
          return;
        }

        const page = await doc.getPage(pageNo);
        if (stale) return;

        const unscaledWidth = page.getViewport({ scale: 1 }).width;
        const containerWidth = containerRef.current?.clientWidth || unscaledWidth;
        const pageScale = containerWidth / unscaledWidth;
        const viewport = page.getViewport({ scale: pageScale });

        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d") ?? null;
        if (!canvas || !ctx) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({ canvasContext: ctx, canvas, viewport }).promise;
        if (stale) return;

        setScale(pageScale);
      } catch (err) {
        if (!stale) setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      stale = true;
      if (loadingTask) void loadingTask.destroy();
    };
  }, [pdfPath, pageNo]);

  return (
    <div className="pdf-page-view" ref={containerRef}>
      <canvas ref={canvasRef} className="pdf-page-view__canvas" />
      {error && <div className="pdf-page-view__error">Failed to render page: {error}</div>}
      {scale != null &&
        highlights.map((h, i) => {
          const rect = bboxToOverlay(h, scale);
          const style: React.CSSProperties & Record<string, string | number | undefined> = {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          };
          if (h.color) style["--pdf-highlight-color"] = h.color;
          return <div key={`${h.page_no}-${h.l}-${h.t}-${h.r}-${h.b}-${i}`} className="pdf-highlight" style={style} />;
        })}
    </div>
  );
}
