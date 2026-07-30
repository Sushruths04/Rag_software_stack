import { useEffect, useState } from "react";

/**
 * B-M2: consumes `sidecar://status` events emitted by
 * studio/desktop/src-tauri/src/sidecar.rs, which spawns and health-checks
 * the Python backend automatically (no more running `uvicorn` in a second
 * terminal). Total no-op in the browser (studio/web) and under tests, same
 * pattern as useDesktopMenuCommands/useDesktopProject: dynamically imports
 * @tauri-apps/api/event only after confirming isTauri().
 */

export type EngineSidecarStatus =
  | { status: "unknown" }
  | { status: "starting"; port?: number }
  | { status: "ready"; port: number }
  | { status: "failed"; message?: string };

export function useEngineSidecar(): EngineSidecarStatus {
  const [state, setState] = useState<EngineSidecarStatus>({ status: "unknown" });

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    let gotEvent = false;

    void (async () => {
      const { isTauri, invoke } = await import("@tauri-apps/api/core");
      if (!isTauri()) return;

      const { listen } = await import("@tauri-apps/api/event");
      if (cancelled) return;

      // Attach the listener FIRST so no future transition is missed, THEN
      // ask for the current status. Tauri events aren't buffered — a fast
      // health-check can resolve to "ready" before the webview even
      // finishes loading React and registering this listener, and that
      // event would otherwise be silently lost. get_sidecar_status is the
      // fallback that catches it.
      const un = await listen<EngineSidecarStatus>("sidecar://status", (event) => {
        gotEvent = true;
        setState(event.payload);
      });
      if (cancelled) {
        un();
        return;
      }
      unlisten = un;

      const current = await invoke<EngineSidecarStatus>("get_sidecar_status");
      if (!cancelled && !gotEvent) setState(current);
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return state;
}
