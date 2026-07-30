import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import { BlockNode, type BlockNodeData } from "./BlockNode";
import { BLOCK_BY_TYPE } from "../../data/catalog";
import { PortDragProvider } from "../../state/portDragContext";

function renderNode(overrides: Partial<BlockNodeData["node"]> = {}, selected = false) {
  const spec = BLOCK_BY_TYPE["cluster_builder"];
  const data: BlockNodeData = {
    spec,
    node: { id: "b9", type: spec.type, position: { x: 0, y: 0 }, runState: "idle", ...overrides },
  };
  const props = { data, selected, id: "b9" } as unknown as NodeProps;
  return render(
    <ReactFlowProvider>
      <PortDragProvider>
        <BlockNode {...props} />
      </PortDragProvider>
    </ReactFlowProvider>,
  );
}

describe("BlockNode", () => {
  it("renders title, subtitle, ports, and default params from the catalog spec", () => {
    renderNode();
    expect(screen.getByText("Cluster Builder 2+2")).toBeInTheDocument();
    expect(screen.getByText(/sampling · FREE/)).toBeInTheDocument();
    expect(screen.getByText("bridges")).toBeInTheDocument();
    expect(screen.getByText("facts")).toBeInTheDocument();
    expect(screen.getByText("candidates")).toBeInTheDocument();
    expect(screen.getByText("window")).toBeInTheDocument();
  });

  it("shows the PAID $ chip for a paid block and not for a free one", () => {
    const spec = BLOCK_BY_TYPE["qa_gen_pairs"];
    const data: BlockNodeData = { spec, node: { id: "b10", type: spec.type, position: { x: 0, y: 0 }, runState: "idle" } };
    const props = { data, selected: false, id: "b10" } as unknown as NodeProps;
    render(
      <ReactFlowProvider>
        <PortDragProvider>
          <BlockNode {...props} />
        </PortDragProvider>
      </ReactFlowProvider>,
    );
    expect(document.querySelector(".paid-chip")).toBeTruthy();
  });

  it("renders the post-run meta line when runMeta is present", () => {
    renderNode({ runState: "done", runMeta: { metaLine: "147 clusters · 25 fallback" } });
    expect(screen.getByText("147 clusters · 25 fallback")).toBeInTheDocument();
  });

  it("applies the is-selected class when selected", () => {
    const { container } = renderNode({}, true);
    expect(container.querySelector(".block-node.is-selected")).toBeTruthy();
  });

  it("applies the run-failed class and shows the error line", () => {
    renderNode({ runState: "failed", runMeta: { error: "grounding check failed: no chunk_ids" } });
    expect(document.querySelector(".block-node.run-failed")).toBeTruthy();
    expect(screen.getByText("grounding check failed: no chunk_ids")).toBeInTheDocument();
  });
});

describe("port keyboard navigation (04_DESIGN_SYSTEM.md §7: arrows cycle ports)", () => {
  function portHandles(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>(".port-handle"));
  }

  it("ArrowDown cycles focus forward through the node's ports, wrapping at the end", () => {
    renderNode();
    const handles = portHandles();
    expect(handles.length).toBe(3); // cluster_builder: bridges, facts in; candidates out
    handles[0].focus();
    fireEvent.keyDown(handles[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(handles[1]);
    fireEvent.keyDown(handles[1], { key: "ArrowDown" });
    expect(document.activeElement).toBe(handles[2]);
    fireEvent.keyDown(handles[2], { key: "ArrowDown" });
    expect(document.activeElement).toBe(handles[0]);
  });

  it("ArrowUp cycles focus backward, wrapping from the first port to the last", () => {
    renderNode();
    const handles = portHandles();
    handles[0].focus();
    fireEvent.keyDown(handles[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(handles[2]);
  });

  it("ArrowRight/ArrowLeft behave like ArrowDown/ArrowUp", () => {
    renderNode();
    const handles = portHandles();
    handles[0].focus();
    fireEvent.keyDown(handles[0], { key: "ArrowRight" });
    expect(document.activeElement).toBe(handles[1]);
    fireEvent.keyDown(handles[1], { key: "ArrowLeft" });
    expect(document.activeElement).toBe(handles[0]);
  });

  it("consumes the arrow event so React Flow does not also pan/move", () => {
    renderNode();
    const handles = portHandles();
    handles[0].focus();
    // fireEvent returns false when preventDefault() was called by a handler
    const notPrevented = fireEvent.keyDown(handles[0], { key: "ArrowDown" });
    expect(notPrevented).toBe(false);
  });

  it("leaves non-arrow keys alone", () => {
    renderNode();
    const handles = portHandles();
    handles[0].focus();
    const notPrevented = fireEvent.keyDown(handles[0], { key: "Enter" });
    expect(notPrevented).toBe(true);
    expect(document.activeElement).toBe(handles[0]);
  });
});
