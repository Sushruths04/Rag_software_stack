import { motion } from "framer-motion";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import "./Console.css";

export interface ConsoleLine {
  id: string;
  level: "info" | "warn" | "error" | "ok";
  text: string;
  detail?: string;
}

interface ConsoleProps {
  lines: ConsoleLine[];
  costTotal?: string;
  open: boolean;
  onToggle: () => void;
}

/**
 * Bottom panel — 04_DESIGN_SYSTEM.md §2: "Console is collapsible; during a
 * run it auto-opens at 200px." §9 A15: log lines fade-slide in 12px/120ms.
 * Open state is owned by StudioShell so Run/Fail can force it open (§9 A13).
 */
export function Console({ lines, costTotal, open, onToggle }: ConsoleProps) {
  // See ToastStack for why this hook is checked directly rather than relying
  // on the global CSS prefers-reduced-motion catch-all.
  const reducedMotion = useReducedMotion();
  return (
    <section className={`console${open ? " is-open" : ""}`} aria-label="Run console">
      <header className="console__bar">
        <button className="console__toggle" onClick={onToggle} aria-expanded={open}>
          <span className={`console__chevron${open ? " is-open" : ""}`}>›</span>
          Console
          <span className="console__count mono">{lines.length}</span>
        </button>
        {costTotal && (
          <span className="console__cost mono" title="Cost meter for this run">
            {costTotal}
          </span>
        )}
      </header>
      {open && (
        <div className="console__body">
          {lines.map((line, i) => (
            <motion.div
              key={line.id}
              className={`console__line console__line--${line.level} mono`}
              data-reduced-motion={reducedMotion || undefined}
              initial={reducedMotion ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reducedMotion ? { duration: 0 } : { duration: 0.12, delay: Math.min(i, 20) * 0.01 }}
            >
              {line.detail ? (
                <details className="console__details">
                  <summary>{line.text}</summary>
                  <pre className="console__details-body">{line.detail}</pre>
                </details>
              ) : (
                line.text
              )}
            </motion.div>
          ))}
        </div>
      )}
    </section>
  );
}
