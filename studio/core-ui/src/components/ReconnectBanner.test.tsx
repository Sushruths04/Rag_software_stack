import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ReconnectBanner } from "./ReconnectBanner";

afterEach(() => {
  cleanup();
});

describe("ReconnectBanner", () => {
  it("renders nothing when the engine status is unknown (browser/tests)", () => {
    render(<ReconnectBanner status={{ status: "unknown" }} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders nothing when the engine is ready", () => {
    render(<ReconnectBanner status={{ status: "ready", port: 8100 }} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a starting message while the engine is booting", () => {
    render(<ReconnectBanner status={{ status: "starting", port: 8100 }} />);
    expect(screen.getByRole("status")).toHaveTextContent(/starting the local engine/i);
  });

  it("shows the failure message when the engine failed to start", () => {
    render(<ReconnectBanner status={{ status: "failed", message: "port already in use" }} />);
    expect(screen.getByRole("status")).toHaveTextContent(/engine unavailable — port already in use/i);
  });
});
