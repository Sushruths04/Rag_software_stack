import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { PortType } from "../types/graph";

/**
 * Tracks the type of the port currently being dragged from, so every Port
 * instance on the canvas can render the compatible/incompatible affordance
 * from 04_DESIGN_SYSTEM.md §9 A3 ("compatible ports: halo pulse 8px @35%,
 * 900ms loop; incompatible: fade to 25% over 150ms") without prop-drilling
 * through BlockNode -> Canvas.
 */
interface PortDragState {
  draggingType: PortType | null;
  setDraggingType: (t: PortType | null) => void;
}

const PortDragContext = createContext<PortDragState>({
  draggingType: null,
  setDraggingType: () => {},
});

export function PortDragProvider({ children }: { children: ReactNode }) {
  const [draggingType, setDraggingType] = useState<PortType | null>(null);
  const value = useMemo(() => ({ draggingType, setDraggingType }), [draggingType]);
  return <PortDragContext.Provider value={value}>{children}</PortDragContext.Provider>;
}

export function usePortDrag(): PortDragState {
  return useContext(PortDragContext);
}
