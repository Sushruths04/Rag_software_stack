import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { WireBadge } from "./WireBadge";

describe("WireBadge", () => {
  it("renders the full badge text (count-up settles on the target number)", async () => {
    render(<WireBadge text="553 facts · grounded" portType="facts" />);
    expect(await screen.findByText("553 facts · grounded", {}, { timeout: 1000 })).toBeInTheDocument();
  });

  it("renders non-numeric badge text unchanged", () => {
    render(<WireBadge text="recall@5 0.698" portType="eval" />);
    expect(screen.getByText("recall@5 0.698")).toBeInTheDocument();
  });

  it("renders a pending/dimmed state before the upstream block has run", () => {
    const { container } = render(<WireBadge text="qa" portType="qa" pending />);
    expect(container.querySelector(".wire-badge--pending")).toBeTruthy();
  });

  it("reaches the target count under StrictMode double-effects", async () => {
    render(
      <StrictMode>
        <WireBadge text="86 QA · draft" portType="qa" />
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByText("86 QA · draft")).toBeInTheDocument(), {
      timeout: 2000,
    });
  });

  it("re-animates to the new target when the badge text changes", async () => {
    const { rerender } = render(<WireBadge text="10 chunks" portType="chunks" />);
    await waitFor(() => expect(screen.getByText("10 chunks")).toBeInTheDocument(), { timeout: 2000 });
    rerender(<WireBadge text="42 chunks" portType="chunks" />);
    await waitFor(() => expect(screen.getByText("42 chunks")).toBeInTheDocument(), { timeout: 2000 });
  });
});
