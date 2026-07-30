import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { PortType } from "../../types/graph";
import { PORT_VAR, PORT_BADGE_VAR } from "../../theme/portColors";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import "./WireBadge.css";

interface WireBadgeProps {
  text: string;
  portType: PortType;
  /** static type-name chip before the upstream block has run (04 §4) */
  pending?: boolean;
}

const LEADING_NUMBER = /^(\d[\d,]*)(.*)$/;

/**
 * The wire midpoint chip — the DEEPCRAFT "16000 Hz" signature moment (04 §4).
 * When the text starts with a number, it rolls up from 0 on mount (04 §9 A12
 * "Badge count-up: number rolls 0->N over 400ms (odometer style), chip
 * scales 1->1.06->1").
 */
export function WireBadge({ text, portType, pending }: WireBadgeProps) {
  const reducedMotion = useReducedMotion();
  const match = text.match(LEADING_NUMBER);
  const target = match ? parseInt(match[1].replace(/,/g, ""), 10) : null;
  const suffix = match ? match[2] : text;
  const [display, setDisplay] = useState<number>(target === null || reducedMotion ? (target ?? 0) : 0);

  useEffect(() => {
    if (target === null) return;
    if (reducedMotion) {
      setDisplay(target);
      return;
    }
    const duration = 400;
    let raf = 0;
    let start: number | null = null;
    const tick = (now: number) => {
      if (start === null) start = now;
      const t = Math.min(1, (now - start) / duration);
      setDisplay(Math.round(target * t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    // Restart-safe (StrictMode mounts effects twice; a run can also update
    // the badge text): every (re)run animates 0 -> target and cleanup only
    // cancels the in-flight frame — no once-only guard that can strand the
    // display at 0 when the first pass is cancelled.
    setDisplay(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, reducedMotion]);

  const label = target === null ? text : `${display.toLocaleString()}${suffix}`;

  return (
    <motion.div
      className={`wire-badge mono${pending ? " wire-badge--pending" : ""}`}
      style={{
        ["--port-color" as string]: `var(${PORT_VAR[portType]})`,
        ["--port-badge-bg" as string]: `var(${PORT_BADGE_VAR[portType]})`,
      }}
      initial={reducedMotion ? false : { scale: 1 }}
      animate={reducedMotion ? undefined : { scale: [1, 1.06, 1] }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      {label}
    </motion.div>
  );
}
