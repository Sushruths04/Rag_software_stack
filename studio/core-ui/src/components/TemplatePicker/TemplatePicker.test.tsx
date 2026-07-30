import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TemplatePicker } from "./TemplatePicker";
import { TEMPLATES } from "../../data/templates";

afterEach(cleanup);

describe("TemplatePicker", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<TemplatePicker open={false} onClose={vi.fn()} onUseTemplate={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one card per visible template with its title, tag, and description, when open", () => {
    render(<TemplatePicker open onClose={vi.fn()} onUseTemplate={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Choose a template" });
    const visible = TEMPLATES.filter((t) => !t.hidden);
    for (const t of visible) {
      const card = within(dialog).getByText(t.title).closest(".template-card") as HTMLElement;
      expect(card).toBeInTheDocument();
      expect(within(card).getByText(t.tag)).toBeInTheDocument();
      expect(within(card).getByText(t.description)).toBeInTheDocument();
      expect(within(card).getByRole("button", { name: /use this template/i })).toBeInTheDocument();
    }
  });

  it("does not render hidden templates", () => {
    render(<TemplatePicker open onClose={vi.fn()} onUseTemplate={vi.fn()} />);
    expect(screen.queryByText("Score retrieval by exact chunk ID")).not.toBeInTheDocument();
  });

  it("calls onUseTemplate with the matching template when its card's action is clicked", () => {
    const onUseTemplate = vi.fn();
    render(<TemplatePicker open onClose={vi.fn()} onUseTemplate={onUseTemplate} />);
    const sampleB = TEMPLATES.find((t) => t.id === "sample-b")!;
    const card = screen.getByText(sampleB.title).closest(".template-card") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: /use this template/i }));
    expect(onUseTemplate).toHaveBeenCalledTimes(1);
    expect(onUseTemplate).toHaveBeenCalledWith(sampleB);
  });

  it("calls onClose when the close control is activated", () => {
    const onClose = vi.fn();
    render(<TemplatePicker open onClose={onClose} onUseTemplate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/close/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uses the exact empty-state invitation copy from 04_DESIGN_SYSTEM.md §6", () => {
    render(<TemplatePicker open onClose={vi.fn()} onUseTemplate={vi.fn()} />);
    expect(screen.getByText("Drag a PDF Source here, or start from a template.")).toBeInTheDocument();
  });

  it("tracks the pointer on a card via --spot-x/--spot-y custom properties (spotlight hover)", () => {
    render(<TemplatePicker open onClose={vi.fn()} onUseTemplate={vi.fn()} />);
    const card = screen.getByText(TEMPLATES[0].title).closest(".template-card") as HTMLElement;

    fireEvent.mouseMove(card, { clientX: 120, clientY: 45 });

    // jsdom rects are 0x0 at 0,0 so the offsets equal the client coords
    expect(card.style.getPropertyValue("--spot-x")).toBe("120px");
    expect(card.style.getPropertyValue("--spot-y")).toBe("45px");
  });

  it("groups cards under the four category headings", () => {
    render(<TemplatePicker open onClose={vi.fn()} onUseTemplate={vi.fn()} />);
    for (const cat of ["Retrieval & Eval", "Mining & Sampling", "Import & Inspect", "Full Pipeline"]) {
      expect(screen.getByRole("heading", { name: cat })).toBeInTheDocument();
    }
  });

  it("filters cards (and empty categories) as the user types, and shows a no-match message", () => {
    render(<TemplatePicker open onClose={vi.fn()} onUseTemplate={vi.fn()} />);
    const input = screen.getByLabelText("Search templates");

    fireEvent.change(input, { target: { value: "BM25 good enough" } });
    expect(screen.getByText("Is plain BM25 good enough?")).toBeInTheDocument();
    expect(screen.queryByText("Just inspect my chunks")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Import & Inspect" })).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "zzz-no-such-template" } });
    expect(screen.getByText(/No templates match/)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByText("Just inspect my chunks")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<TemplatePicker open onClose={onClose} onUseTemplate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
