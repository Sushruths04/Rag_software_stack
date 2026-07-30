import { memo } from "react";
import { motion } from "framer-motion";
import type { NodeProps } from "@xyflow/react";
import type { BlockSpec, GraphBlockNode, RunState } from "../../types/graph";
import { categoryMeta } from "../../data/catalog";
import { mergeParams } from "../../utils/params";
import { Port } from "../Port/Port";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import "./BlockNode.css";

export interface BlockNodeData extends Record<string, unknown> {
  spec: BlockSpec;
  node: GraphBlockNode;
}

function monogram(label: string): string {
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function runLabel(state: RunState): string {
  switch (state) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "done":
      return "done";
    case "failed":
      return "failed";
    default:
      return "";
  }
}

/**
 * BlockNode — 04_DESIGN_SYSTEM.md §3 node anatomy: category tint header bar,
 * monogram icon, title/subtitle, PAID chip, param rows (left labels / mono
 * values), typed ports left (in) / right (out), post-run meta line, and the
 * run-state visual language (§9 A7 select / A9 running / A11 done / A13
 * failed).
 */
function BlockNodeImpl({ data, selected }: NodeProps) {
  const { spec, node } = data as unknown as BlockNodeData;
  const cat = categoryMeta(spec.category);
  const params = mergeParams(spec, node.params);
  const state: RunState = node.runState ?? "idle";
  const reducedMotion = useReducedMotion();

  const mountAnimation = reducedMotion
    ? { initial: { opacity: 1, scale: 1 }, animate: { opacity: 1, scale: 1 } }
    : {
        initial: { opacity: 0.6, scale: 0.85 },
        animate: { opacity: 1, scale: [0.85, 1.02, 1] },
        transition: { duration: 0.26, ease: [0.22, 1, 0.36, 1] as const },
      };

  return (
    <motion.div
      className={`block-node run-${state}${selected ? " is-selected" : ""}`}
      style={{ ["--cat-tint" as string]: `var(${cat.tintVar})` }}
      data-block-type={spec.type}
      {...mountAnimation}
    >
      {state === "running" && (
        <svg className="run-active-outline" aria-hidden="true">
          <rect x="1" y="1" rx="9" ry="9" />
        </svg>
      )}

      <div className="block-node__tint-bar" />

      <header className="block-node__header">
        <span className="block-node__icon">{monogram(spec.label)}</span>
        <div className="block-node__titles">
          <div className="block-node__title">{spec.label}</div>
          <div className="block-node__subtitle">
            {spec.subtitle}
            {spec.cost === "paid" && (
              <span className="paid-chip" title="Makes LLM/API calls — requires budget confirmation before running">
                $
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="block-node__ports">
        <div className="block-node__ports-col">
          {spec.inputs.map((p) => (
            <Port key={p.name} id={p.name} label={p.name} type={p.type} side="in" multi={p.multi} optional={p.optional} />
          ))}
        </div>
        <div className="block-node__ports-col">
          {spec.outputs.map((p) => (
            <Port key={p.name} id={p.name} label={p.name} type={p.type} side="out" multi={p.multi} />
          ))}
        </div>
      </div>

      {params.length > 0 && (
        <div className="block-node__params">
          {params.map((p) => (
            <div className="param-row" key={p.key}>
              <span className="param-row__label">{p.label}</span>
              <span className={`param-row__value mono${p.isDefault ? " is-default" : ""}`}>
                {p.locked && (
                  <span className="param-lock" title="Locked outside expert mode">
                    lock
                  </span>
                )}
                {p.value || "—"}
              </span>
            </div>
          ))}
        </div>
      )}

      {state === "failed" && node.runMeta?.error ? (
        <div className="block-node__meta block-node__meta--error mono typewriter">{node.runMeta.error}</div>
      ) : node.runMeta?.metaLine ? (
        <div className="block-node__meta mono">{node.runMeta.metaLine}</div>
      ) : (
        state !== "idle" && <div className="block-node__meta mono block-node__meta--muted">{runLabel(state)}…</div>
      )}
    </motion.div>
  );
}

export const BlockNode = memo(BlockNodeImpl);
