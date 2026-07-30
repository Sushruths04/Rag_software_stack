import type { KeyboardEvent } from "react";
import { Handle, Position } from "@xyflow/react";
import type { PortType } from "../../types/graph";
import { PORT_VAR } from "../../theme/portColors";
import { usePortDrag } from "../../state/portDragContext";
import "./Port.css";

interface PortProps {
  /** unique within the node + side, used as the React Flow Handle id */
  id: string;
  label: string;
  type: PortType;
  side: "in" | "out";
  /** stacked-square shape = multi-in capable (04 §8.4 shape channel) */
  multi?: boolean;
  optional?: boolean;
}

/**
 * 04_DESIGN_SYSTEM.md §7 "arrows cycle ports": with focus on a port handle,
 * Arrow keys move focus to the node's next/previous port (document order:
 * inputs then outputs), wrapping at both ends. The event is consumed so
 * React Flow's own arrow-key behavior (pan / move node) never double-fires.
 * Deliberately scoped to handles — arrows on a focused NODE still move the
 * node, which is React Flow's built-in and expected behavior.
 */
function cyclePortFocus(e: KeyboardEvent<HTMLElement>) {
  const dir =
    e.key === "ArrowDown" || e.key === "ArrowRight"
      ? 1
      : e.key === "ArrowUp" || e.key === "ArrowLeft"
        ? -1
        : 0;
  if (dir === 0) return;
  const target = e.target as HTMLElement;
  const node = target.closest(".block-node");
  if (!node) return;
  const handles = Array.from(node.querySelectorAll<HTMLElement>(".port-handle"));
  const i = handles.indexOf(target);
  if (i === -1 || handles.length < 2) return;
  e.preventDefault();
  e.stopPropagation();
  handles[(i + dir + handles.length) % handles.length].focus();
}

/**
 * One port row inside a BlockNode: a typed color dot (04 §8.4) wrapping a
 * React Flow Handle, plus its label and (once run) its badge text. Shape
 * channel is independent of color (06 Blender lesson): circle = single
 * connection, stacked-square = multi-in.
 */
export function Port({ id, label, type, side, multi, optional }: PortProps) {
  const { draggingType } = usePortDrag();

  let affordance: "idle" | "legal" | "illegal" = "idle";
  if (draggingType) {
    affordance = draggingType === type ? "legal" : "illegal";
  }

  return (
    <div className={`port-row port-row--${side}`}>
      {side === "in" && (
        <span
          className={`port-dot port-dot--${multi ? "multi" : "single"} port-dot--${affordance}`}
          data-port-type={type}
          style={{ ["--port-color" as string]: `var(${PORT_VAR[type]})` }}
        />
      )}
      <span className="port-label">
        {label}
        {optional && <span className="port-optional"> (optional)</span>}
      </span>
      {side === "out" && (
        <span
          className={`port-dot port-dot--${multi ? "multi" : "single"} port-dot--${affordance}`}
          data-port-type={type}
          style={{ ["--port-color" as string]: `var(${PORT_VAR[type]})` }}
        />
      )}
      <Handle
        id={id}
        type={side === "in" ? "target" : "source"}
        position={side === "in" ? Position.Left : Position.Right}
        className="port-handle"
        tabIndex={0}
        onKeyDown={cyclePortFocus}
        aria-label={`${side === "in" ? "input" : "output"} port ${label}, type ${type}`}
      />
    </div>
  );
}
