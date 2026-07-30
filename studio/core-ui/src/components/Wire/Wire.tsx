import { useMemo } from "react";
import { EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import type { PortType } from "../../types/graph";
import { PORT_VAR } from "../../theme/portColors";
import { WireBadge } from "./WireBadge";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import "./Wire.css";

export interface WireData extends Record<string, unknown> {
  portType: PortType;
  badge?: string;
  typeName: string;
  weight?: "normal" | "heavy";
  /** true for one hand-off after Canvas marks it (04 §9 A10 data-flow dots) */
  flowing?: boolean;
  /** true for ~300ms right after the wire is connected (04 §9 A5) */
  justConnected?: boolean;
}

/**
 * Wire — 04_DESIGN_SYSTEM.md §4/§8.4: 2px bezier in the SOURCE port's color
 * at 75% idle opacity, 3px for heavy payloads (06 Blender lesson). Carries
 * the wire-badge chip at the midpoint (EdgeLabelRenderer, since it is an
 * HTML chip, not SVG text) and the two transient animations: A5 connect-snap
 * pulse and A10 data-flow dots.
 */
export function Wire({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps) {
  const reducedMotion = useReducedMotion();
  const d = data as WireData | undefined;
  const portType = d?.portType ?? "facts";
  const weight = d?.weight ?? "normal";

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const dotDelays = useMemo(() => [0, 150, 300], []);

  return (
    <>
      <path
        className={`wire-path${selected ? " is-selected" : ""}${weight === "heavy" ? " is-heavy" : ""}`}
        d={path}
        style={{ ["--port-color" as string]: `var(${PORT_VAR[portType]})` }}
        fill="none"
        markerEnd="url(#wire-arrow)"
      />

      {!reducedMotion && d?.justConnected && (
        // A5 wire connect snap: one luminous pulse travels source -> sink, 300ms
        <circle r={4} className="wire-connect-pulse" style={{ ["--port-color" as string]: `var(${PORT_VAR[portType]})` }}>
          <animateMotion dur="300ms" fill="freeze" path={path} />
          <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.8;1" dur="300ms" fill="freeze" />
        </circle>
      )}

      {!reducedMotion && d?.flowing && (
        // A10 data flow: 3 dots travel the wire, staggered 150ms, once per hand-off
        <g className="wire-flow-dots" style={{ ["--port-color" as string]: `var(${PORT_VAR[portType]})` }}>
          {dotDelays.map((delay, i) => (
            <circle r={3} key={i} className="wire-flow-dot">
              <animateMotion dur="900ms" begin={`${delay}ms`} fill="freeze" path={path} />
              <animate attributeName="opacity" values="0;0.9;0.9;0" keyTimes="0;0.08;0.75;1" dur="900ms" begin={`${delay}ms`} fill="freeze" />
            </circle>
          ))}
        </g>
      )}

      <EdgeLabelRenderer>
        <div
          className="wire-badge-anchor"
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          <WireBadge text={d?.badge ?? d?.typeName ?? portType} portType={portType} pending={!d?.badge} />
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
