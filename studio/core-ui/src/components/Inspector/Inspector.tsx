import { categoryMeta } from "../../data/catalog";
import type { BlockSpec, GraphBlockNode } from "../../types/graph";
import { mergeParams } from "../../utils/params";
import "./Inspector.css";

interface InspectorProps {
  spec: BlockSpec | null;
  node: GraphBlockNode | null;
  onParamChange?: (key: string, value: string) => void;
}

/**
 * Right rail — 04_DESIGN_SYSTEM.md §2: "Inspector replaces modal dialogs
 * entirely — click a block, edit params in place." Param edit form is
 * generated from the block's catalog spec (stand-in for the JSON-schema the
 * real `GET /api/blocks` endpoint will serve, per 02_PHASE2_APP_PLAN.md M2).
 */
export function Inspector({ spec, node, onParamChange }: InspectorProps) {
  if (!spec || !node) {
    return (
      <aside className="inspector inspector--empty" aria-label="Inspector">
        <p>Select a block to inspect its parameters, ports, and run meta.</p>
      </aside>
    );
  }

  const cat = categoryMeta(spec.category);
  const params = mergeParams(spec, node.params);

  return (
    <aside className="inspector" aria-label="Inspector">
      <header className="inspector__header" style={{ ["--cat-tint" as string]: `var(${cat.tintVar})` }}>
        <span className="inspector__tint" />
        <div>
          <div className="inspector__title">{spec.label}</div>
          <div className="inspector__subtitle mono">{spec.type}</div>
        </div>
      </header>

      <p className="inspector__purpose">{spec.purpose}</p>

      {spec.cost === "paid" && (
        <div className="inspector__cost">
          <span className="paid-chip">$</span>
          <span>PAID block — requires budget confirmation before running.</span>
        </div>
      )}

      <section className="inspector__section">
        <h4>Parameters</h4>
        {params.length === 0 && <p className="inspector__muted">No parameters.</p>}
        {params.map((p) => (
          <label className="inspector__field" key={p.key}>
            <span className="inspector__field-label">
              {p.label}
              {p.locked && <span className="param-lock">lock</span>}
            </span>
            <input
              className="mono"
              value={p.value}
              disabled={p.locked}
              onChange={(e) => onParamChange?.(p.key, e.target.value)}
            />
          </label>
        ))}
      </section>

      <section className="inspector__section">
        <h4>Ports</h4>
        <div className="inspector__ports">
          <div>
            <div className="inspector__ports-label">in</div>
            {spec.inputs.length === 0 && <div className="inspector__muted">none</div>}
            {spec.inputs.map((p) => (
              <div key={p.name} className="inspector__port-row mono">
                <span className={`inspector__port-dot port-${p.type}`} /> {p.name}
                {p.optional ? " (optional)" : ""}
              </div>
            ))}
          </div>
          <div>
            <div className="inspector__ports-label">out</div>
            {spec.outputs.length === 0 && <div className="inspector__muted">none</div>}
            {spec.outputs.map((p) => (
              <div key={p.name} className="inspector__port-row mono">
                <span className={`inspector__port-dot port-${p.type}`} /> {p.name}
              </div>
            ))}
          </div>
        </div>
      </section>

      {node.runMeta?.metaLine && (
        <section className="inspector__section">
          <h4>Last run</h4>
          <p className="inspector__meta mono">{node.runMeta.metaLine}</p>
        </section>
      )}

      <footer className="inspector__backing mono">{spec.backing}</footer>
    </aside>
  );
}
