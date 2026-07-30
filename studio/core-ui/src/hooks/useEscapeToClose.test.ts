import { renderHook } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";
import { describe, expect, it, vi } from "vitest";
import { useEscapeToClose } from "./useEscapeToClose";

describe("useEscapeToClose", () => {
  it("calls onClose on Escape while open", () => {
    const onClose = vi.fn();
    renderHook(() => useEscapeToClose(true, onClose));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does nothing while closed", () => {
    const onClose = vi.fn();
    renderHook(() => useEscapeToClose(false, onClose));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("detaches on unmount", () => {
    const onClose = vi.fn();
    const { unmount } = renderHook(() => useEscapeToClose(true, onClose));
    unmount();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
