import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Console } from "./Console";

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

const oneLine = [{ id: "l1", level: "info" as const, text: "hello console" }];

describe("Console", () => {
  it("renders its lines when open", () => {
    stubMatchMedia(false);
    render(<Console lines={oneLine} open onToggle={vi.fn()} />);
    expect(screen.getByText("hello console")).toBeInTheDocument();
  });

  // See Toast.test.tsx for why this must be checked per motion component,
  // not assumed from the global CSS reduced-motion catch-all.
  it("skips per-line entrance motion under prefers-reduced-motion", () => {
    stubMatchMedia(true);
    render(<Console lines={oneLine} open onToggle={vi.fn()} />);
    const line = screen.getByText("hello console");
    expect(line).toHaveAttribute("data-reduced-motion", "true");
  });

  it("does not mark lines reduced when motion is not reduced", () => {
    stubMatchMedia(false);
    render(<Console lines={oneLine} open onToggle={vi.fn()} />);
    const line = screen.getByText("hello console");
    expect(line).not.toHaveAttribute("data-reduced-motion");
  });

  it("renders a line's detail behind an expandable details element", () => {
    render(
      <Console
        lines={[{ id: "1", level: "error", text: "request rejected — 28 validation errors (details below)", detail: "full dump here" }]}
        open
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText(/request rejected/)).toBeInTheDocument();
    expect(screen.getByText("full dump here")).toBeInTheDocument(); // inside <details>, present but collapsed
  });
});
