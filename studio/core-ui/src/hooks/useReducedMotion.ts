import { useEffect, useState } from "react";

/**
 * JS-driven counterpart to the CSS `prefers-reduced-motion` block in
 * theme/tokens.css — used by Framer Motion components (04 §9 global rule:
 * "ALL animations collapse to instant state changes under
 * prefers-reduced-motion; the information must survive without motion").
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
