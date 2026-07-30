import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ToastStack } from "./Toast";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

describe("ToastStack", () => {
  it("renders up to the last 3 toasts", () => {
    stubMatchMedia(false);
    render(
      <ToastStack
        toasts={[
          { id: "1", text: "one" },
          { id: "2", text: "two" },
          { id: "3", text: "three" },
          { id: "4", text: "four" },
        ]}
      />,
    );
    expect(screen.queryByText("one")).not.toBeInTheDocument();
    expect(screen.getByText("two")).toBeInTheDocument();
    expect(screen.getByText("four")).toBeInTheDocument();
  });

  // 04_DESIGN_SYSTEM.md §9 global rule: "ALL animations collapse to instant
  // state changes under prefers-reduced-motion" — this applies to Framer
  // Motion just as much as CSS keyframes; the global CSS catch-all in
  // theme/tokens.css only reaches CSS transitions/animations, not
  // JS-driven Framer Motion props, so each motion component must check the
  // hook itself.
  it("skips its entrance motion under prefers-reduced-motion", () => {
    stubMatchMedia(true);
    render(<ToastStack toasts={[{ id: "1", text: "reduced-motion toast" }]} />);
    const toast = screen.getByText("reduced-motion toast");
    expect(toast).toHaveAttribute("data-reduced-motion", "true");
  });

  it("does not mark toasts reduced when motion is not reduced", () => {
    stubMatchMedia(false);
    render(<ToastStack toasts={[{ id: "1", text: "full-motion toast" }]} />);
    const toast = screen.getByText("full-motion toast");
    expect(toast).not.toHaveAttribute("data-reduced-motion");
  });
});
