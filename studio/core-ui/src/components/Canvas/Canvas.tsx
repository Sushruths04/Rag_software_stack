import { ReactFlow, Background, BackgroundVariant, MiniMap, Controls, type ReactFlowProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { BlockNode } from "../BlockNode/BlockNode";
import { Wire } from "../Wire/Wire";
import "./Canvas.css";

const nodeTypes = { block: BlockNode };
const edgeTypes = { wire: Wire };

/**
 * Task 9 golden-path check: at fit-view (padding 0.15) the 22-block full
 * pipeline template (demoGraph.ts, x range 0-4200 + 240px node width = 4440
 * world px) needs ~0.207 zoom to fit an 1080px-wide canvas viewport
 * (1600px window, palette 240px + inspector open) without clipping the
 * outermost nodes. The previous 0.25 floor sat above that, so fitView
 * clamped to 0.25 and silently cropped the leftmost source blocks and the
 * rightmost Report Builder by ~15px each — verified via
 * getBoundingClientRect() against .canvas-shell during manual QA. Lowered
 * with headroom for smaller demo windows; see Canvas.test.ts for the
 * regression guard.
 */
export const CANVAS_MIN_ZOOM = 0.15;

interface CanvasProps extends ReactFlowProps {
  /** View menu "Toggle Minimap" (desktop shell) also drives this. Defaults to visible. */
  showMiniMap?: boolean;
}

/**
 * Thin React Flow wrapper — grid (04 §1 canvas tokens), minimap, controls.
 * All graph state and interaction logic live in StudioShell; this component
 * stays a dumb presentational layer so it is easy to unit test in isolation.
 */
export function Canvas({ showMiniMap = true, ...props }: CanvasProps) {
  return (
    <div className="canvas-shell">
      <ReactFlow
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        minZoom={CANVAS_MIN_ZOOM}
        maxZoom={2}
        defaultEdgeOptions={{ type: "wire" }}
        proOptions={{ hideAttribution: true }}
        {...props}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--canvas-grid)" />
        {showMiniMap && (
          <MiniMap
            className="canvas-minimap"
            pannable
            zoomable
            nodeColor="#4c655f"
            nodeStrokeColor="#17e2b6"
            nodeStrokeWidth={2}
            maskColor="var(--minimap-mask)"
          />
        )}
        <Controls className="canvas-controls" showInteractive={false} />
        <svg width="0" height="0">
          <defs>
            <marker id="wire-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="var(--line-2)" />
            </marker>
          </defs>
        </svg>
      </ReactFlow>
    </div>
  );
}
