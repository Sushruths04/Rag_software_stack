import { useEffect, useRef } from "react";

export interface DesktopMenuCommands {
  onNewProject: () => void;
  onOpenProject: () => void;
  onNewSession: () => void;
  onSave: () => void;
  onRun: () => void;
  onCancelRun: () => void;
  onToggleConsole: () => void;
  onToggleMinimap: () => void;
  onFitView: () => void;
}

// Event names must match the MENU_* constants emitted by
// studio/desktop/src-tauri/src/lib.rs — one command path, not two.
const MENU_EVENTS: Record<keyof DesktopMenuCommands, string> = {
  onNewProject: "menu://new-project",
  onOpenProject: "menu://open-project",
  onNewSession: "menu://new-session",
  onSave: "menu://save",
  onRun: "menu://run",
  onCancelRun: "menu://cancel-run",
  onToggleConsole: "menu://toggle-console",
  onToggleMinimap: "menu://toggle-minimap",
  onFitView: "menu://fit-view",
};

/**
 * Bridges the desktop shell's native menu (studio/desktop, Tauri) to the
 * exact same handlers the toolbar buttons call, so there is one command
 * path rather than a duplicated one for the native menu.
 *
 * Accepts a PARTIAL command set: App.tsx owns onNewProject/onOpenProject
 * (project navigation happens above StudioShell, which may not even be
 * mounted yet), StudioShell owns the rest (canvas/run/view commands).
 * Both may be mounted at once with disjoint keys — missing keys are simply
 * not dispatched, never crash.
 *
 * No-ops entirely in the browser (studio/web) and under vitest/jsdom:
 * `isTauri()` is false outside a real Tauri webview, so `listen` is never
 * imported or called there.
 */
export function useDesktopMenuCommands(commands: Partial<DesktopMenuCommands>): void {
  // Handlers close over nodes/edges/etc. and get a new identity most
  // renders; subscribe to Tauri events once per mount and always dispatch
  // through this ref so the native menu never calls a stale handler.
  const commandsRef = useRef(commands);
  commandsRef.current = commands;

  useEffect(() => {
    let cancelled = false;
    let unlisten: Array<() => void> = [];

    void (async () => {
      const { isTauri } = await import("@tauri-apps/api/core");
      if (!isTauri()) return;

      const { listen } = await import("@tauri-apps/api/event");
      if (cancelled) return;

      const entries = Object.entries(MENU_EVENTS) as Array<[keyof DesktopMenuCommands, string]>;
      const subs = await Promise.all(
        entries.map(([key, eventName]) => listen(eventName, () => commandsRef.current[key]?.())),
      );

      if (cancelled) {
        subs.forEach((un) => un());
        return;
      }
      unlisten = subs;
    })();

    return () => {
      cancelled = true;
      unlisten.forEach((un) => un());
    };
  }, []);
}
