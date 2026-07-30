import "./Toolbar.css";
import type { ThemeChoice } from "../../hooks/useTheme";

export interface SavedGraphEntry {
  id: string;
  name: string;
  modified: string;
}

interface ToolbarProps {
  graphName: string;
  onRun: () => void;
  onAutoLayout: () => void;
  onValidate: () => void;
  onFit: () => void;
  onSave: () => void;
  /** Whether the Load dropdown is open. Lifted to StudioShell so the desktop
   * shell's native "Open Project" menu item can drive the same state a
   * toolbar click would (see useDesktopMenuCommands). */
  loadMenuOpen: boolean;
  /** Toggles the Load dropdown; StudioShell (re-)fetches the list on open. */
  onToggleLoadMenu: () => void;
  onLoadGraph: (id: string) => void;
  savedGraphs: SavedGraphEntry[];
  validation: { ok: boolean; message: string } | null;
  theme: ThemeChoice;
  onToggleTheme: () => void;
  /** Opens the template picker (M5) — the discoverable entry point alongside Save/Load. */
  onOpenTemplatePicker: () => void;
}

/**
 * Top toolbar — 04_DESIGN_SYSTEM.md §2 layout frame + §5 keyboard shortcuts
 * (Ctrl+Enter run, F fit view). Copy follows §6: buttons say what they do.
 */
export function Toolbar({
  graphName,
  onRun,
  onAutoLayout,
  onValidate,
  onFit,
  onSave,
  loadMenuOpen,
  onToggleLoadMenu,
  onLoadGraph,
  savedGraphs,
  validation,
  theme,
  onToggleTheme,
  onOpenTemplatePicker,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="toolbar__identity">
        <span className="toolbar__logo">
          GRAFT <span>Block Studio</span>
        </span>
        <span className="toolbar__divider" />
        <span className="toolbar__graph-name mono">{graphName}</span>
      </div>

      <div className="toolbar__actions">
        {validation && (
          <span className={`toolbar__validation${validation.ok ? " ok" : " warn"}`}>
            {validation.ok ? "✓" : "!"} {validation.message}
          </span>
        )}
        <button onClick={onOpenTemplatePicker} title="Start a new pipeline from a template">
          New from template
        </button>
        <button onClick={onValidate} title="Check port types, cycles, and structural lints">
          Validate
        </button>
        <button onClick={onAutoLayout} title="Comb the graph into topological columns (ELK stand-in)">
          Auto-layout
        </button>
        <button onClick={onFit} title="Fit view (F)">
          Fit view
        </button>
        <button onClick={onSave} title="Save the current graph to the backend">
          Save
        </button>
        <div className="toolbar__load">
          <button onClick={onToggleLoadMenu} title="Load a previously saved graph" aria-expanded={loadMenuOpen}>
            Load {loadMenuOpen ? "▴" : "▾"}
          </button>
          {loadMenuOpen && (
            <ul className="toolbar__load-menu" role="menu">
              {savedGraphs.length === 0 && <li className="toolbar__load-menu-empty">No saved graphs</li>}
              {savedGraphs.map((g) => (
                <li key={g.id}>
                  <button role="menuitem" onClick={() => onLoadGraph(g.id)}>
                    <span className="toolbar__load-menu-name">{g.name || "(untitled)"}</span>
                    <span className="toolbar__load-menu-date mono">{g.modified.slice(0, 10)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button className="primary" onClick={onRun} title="Run graph (Ctrl+Enter)">
          ▶ Run graph
        </button>
        <button className="toolbar__theme" onClick={onToggleTheme} title="Toggle light / dark theme">
          {theme === "dark" ? "Dark" : "Light"}
        </button>
      </div>
    </header>
  );
}
