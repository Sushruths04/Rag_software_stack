import { AnimatePresence, motion } from "framer-motion";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import "./Toast.css";

export interface ToastMessage {
  id: string;
  text: string;
  kind?: "info" | "warn" | "error";
}

interface ToastStackProps {
  toasts: ToastMessage[];
}

/**
 * 04_DESIGN_SYSTEM.md §9 A22: "slide-up+fade 200ms, hold 4s, fade 300ms; max
 * 3 stacked." Used for illegal wire drops (§5 "types differ") and other
 * transient messages.
 */
export function ToastStack({ toasts }: ToastStackProps) {
  const visible = toasts.slice(-3);
  // 04 §9 global rule: Framer Motion isn't reached by the CSS
  // prefers-reduced-motion catch-all (theme/tokens.css only zeroes CSS
  // transitions/animations), so each motion component checks the hook itself.
  const reducedMotion = useReducedMotion();
  return (
    <div className="toast-stack" aria-live="polite">
      <AnimatePresence>
        {visible.map((t) => (
          <motion.div
            key={t.id}
            className={`toast toast--${t.kind ?? "info"}`}
            data-reduced-motion={reducedMotion || undefined}
            initial={reducedMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, transition: { duration: 0.3 } }}
            transition={reducedMotion ? { duration: 0 } : { duration: 0.2 }}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
