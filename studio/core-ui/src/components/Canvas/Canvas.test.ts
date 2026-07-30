import { describe, expect, it } from "vitest";
import { CANVAS_MIN_ZOOM } from "./Canvas";
import { DEMO_GRAPH } from "../../data/demoGraph";

/**
 * Regression guard for the Task 9 golden-path bug: fitView (padding 0.15)
 * on the 22-block full pipeline template clipped the outermost nodes
 * because CANVAS_MIN_ZOOM (was 0.25) sat above the zoom fitView actually
 * needed, so React Flow clamped and left the leftmost source blocks and
 * the rightmost Report Builder cropped by ~15px. Confirmed via
 * getBoundingClientRect() against .canvas-shell during manual browser QA
 * (see task-9-report.md). This test re-derives the same math so a future
 * widening of the demo graph (or re-raising the floor) fails loudly instead
 * of silently cropping nodes again.
 */
describe("Canvas — fit-view zoom floor vs. the full pipeline template", () => {
  it("CANVAS_MIN_ZOOM is low enough to fit DEMO_GRAPH at fit-view without clipping", () => {
    const NODE_WIDTH = 240; // BlockNode.css fixed card width
    const FIT_VIEW_PADDING = 0.15; // matches every reactFlow.fitView({ padding: 0.15 }) call in StudioShell.tsx
    const REFERENCE_VIEWPORT_WIDTH = 1080; // canvas-wrap width at a 1600px window with palette (240px) + inspector open

    const xs = DEMO_GRAPH.blocks.map((b) => b.position.x);
    const worldWidth = Math.max(...xs) + NODE_WIDTH - Math.min(...xs);
    const requiredZoom = (REFERENCE_VIEWPORT_WIDTH * (1 - FIT_VIEW_PADDING)) / worldWidth;

    expect(CANVAS_MIN_ZOOM).toBeLessThanOrEqual(requiredZoom);
  });
});
