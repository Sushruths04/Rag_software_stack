import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { Port } from "./Port";
import { PortDragProvider, usePortDrag } from "../../state/portDragContext";
import { useEffect } from "react";

function DragTypeSetter({ type }: { type: "facts" | "bridges" }) {
  const { setDraggingType } = usePortDrag();
  useEffect(() => {
    setDraggingType(type);
  }, [type, setDraggingType]);
  return null;
}

function renderPort(ui: React.ReactElement) {
  return render(
    <ReactFlowProvider>
      <PortDragProvider>{ui}</PortDragProvider>
    </ReactFlowProvider>,
  );
}

describe("Port", () => {
  it("renders its label and a colored dot for the given type", () => {
    renderPort(<Port id="facts" label="facts" type="facts" side="in" />);
    expect(screen.getByText("facts")).toBeInTheDocument();
    expect(document.querySelector(".port-dot")).toBeTruthy();
  });

  it("renders the stacked-square shape class when multi is set", () => {
    const { container } = renderPort(<Port id="qa" label="qa" type="qa" side="in" multi />);
    expect(container.querySelector(".port-dot--multi")).toBeTruthy();
  });

  it("renders the single circle shape class by default", () => {
    const { container } = renderPort(<Port id="qa" label="qa" type="qa" side="in" />);
    expect(container.querySelector(".port-dot--single")).toBeTruthy();
  });

  it("marks itself legal when the dragging type matches its own type", () => {
    const { container } = render(
      <ReactFlowProvider>
        <PortDragProvider>
          <DragTypeSetter type="facts" />
          <Port id="facts" label="facts" type="facts" side="in" />
        </PortDragProvider>
      </ReactFlowProvider>,
    );
    expect(container.querySelector(".port-dot--legal")).toBeTruthy();
  });

  it("marks itself illegal when a different type is being dragged", () => {
    const { container } = render(
      <ReactFlowProvider>
        <PortDragProvider>
          <DragTypeSetter type="bridges" />
          <Port id="facts" label="facts" type="facts" side="in" />
        </PortDragProvider>
      </ReactFlowProvider>,
    );
    expect(container.querySelector(".port-dot--illegal")).toBeTruthy();
  });

  it("is keyboard-reachable — 04_DESIGN_SYSTEM.md §7 accessibility floor (Tab cycles ports)", () => {
    const { container } = renderPort(<Port id="facts" label="facts" type="facts" side="in" />);
    const handle = container.querySelector(".port-handle") as HTMLElement;
    expect(handle.getAttribute("tabindex")).toBe("0");
  });
});
