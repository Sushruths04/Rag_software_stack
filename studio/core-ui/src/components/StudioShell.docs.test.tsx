import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { PortDragProvider } from "../state/portDragContext";
import { StudioShell } from "./StudioShell";

afterEach(cleanup);

function renderShell() {
  return render(
    <ReactFlowProvider>
      <PortDragProvider>
        <StudioShell />
      </PortDragProvider>
    </ReactFlowProvider>,
  );
}

describe("StudioShell — documentation trigger", () => {
  it("does not show the documentation dialog until the Docs button is clicked", () => {
    renderShell();
    expect(screen.queryByRole("dialog", { name: "Documentation" })).not.toBeInTheDocument();
  });

  it("opens the documentation panel from the Docs button and closes it again", () => {
    renderShell();
    fireEvent.click(screen.getByTitle("Open the block guide (what every block does, with examples)"));
    expect(screen.getByRole("dialog", { name: "Documentation" })).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Close documentation"));
    expect(screen.queryByRole("dialog", { name: "Documentation" })).not.toBeInTheDocument();
  });
});
