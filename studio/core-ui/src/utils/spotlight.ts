import type { MouseEvent } from "react";

/**
 * Spotlight hover (inspired by 21st.dev's Spotlight Card): stamps the
 * pointer's position into --spot-x/--spot-y custom properties so CSS can
 * render a radial accent highlight that follows the cursor. The visual
 * itself lives entirely in CSS (TemplatePicker.css `.template-card::before`)
 * in the existing --acc token — this helper only updates two variables per
 * move, no re-render, no animation loop (so there is nothing for
 * prefers-reduced-motion to pause; the glow only moves when the pointer
 * does).
 */
export function trackSpotlight(e: MouseEvent<HTMLElement>) {
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  el.style.setProperty("--spot-x", `${e.clientX - rect.left}px`);
  el.style.setProperty("--spot-y", `${e.clientY - rect.top}px`);
}
