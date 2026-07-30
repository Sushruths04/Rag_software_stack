import type { SessionTabMeta } from "../StudioShell";
import "./SessionTabs.css";

export interface SessionTabsProps {
  tabs: SessionTabMeta[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onRequestClose: (id: string) => void;
  onNew: () => void;
}

/**
 * Project-mode-only tab bar (B-M1). Rendered above the canvas whenever a
 * project is open, one tab per session file. Dirty tabs show a dot instead
 * of an immediate close-x so an accidental click can't silently drop
 * unsaved work — StudioShell's onRequestClose routes dirty tabs through a
 * confirm dialog first.
 */
export function SessionTabs({ tabs, activeTabId, onSelect, onRequestClose, onNew }: SessionTabsProps) {
  return (
    <div className="session-tabs" role="tablist" aria-label="Open sessions">
      {tabs.map((tab) => (
        <div key={tab.id} className={`session-tab${tab.id === activeTabId ? " session-tab--active" : ""}`}>
          <button
            role="tab"
            aria-selected={tab.id === activeTabId}
            className="session-tab__label"
            onClick={() => onSelect(tab.id)}
            title={tab.dirty ? `${tab.id} (unsaved changes)` : tab.id}
          >
            {tab.dirty && <span className="session-tab__dirty-dot" aria-hidden="true" />}
            {tab.id}
          </button>
          <button
            className="session-tab__close"
            aria-label={`Close ${tab.id}`}
            title={`Close ${tab.id}`}
            onClick={(e) => {
              e.stopPropagation();
              onRequestClose(tab.id);
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <button className="session-tab__new" onClick={onNew} title="New session (Ctrl+N)" aria-label="New session">
        +
      </button>
    </div>
  );
}
