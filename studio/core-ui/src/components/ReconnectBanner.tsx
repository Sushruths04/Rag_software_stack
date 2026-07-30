import type { EngineSidecarStatus } from "../hooks/useEngineSidecar";
import "./ReconnectBanner.css";

export interface ReconnectBannerProps {
  status: EngineSidecarStatus;
}

/** B-M2: shown whenever the desktop shell's engine sidecar isn't ready —
 * starting up, or failed to start/crashed. Hidden entirely in the browser
 * (status stays "unknown" there, see useEngineSidecar). */
export function ReconnectBanner({ status }: ReconnectBannerProps) {
  if (status.status === "ready" || status.status === "unknown") return null;

  const message =
    status.status === "starting"
      ? "Starting the local engine..."
      : `Engine unavailable${status.message ? ` — ${status.message}` : ""}. Validate/Run won't work until it reconnects.`;

  return (
    <div className={`reconnect-banner reconnect-banner--${status.status}`} role="status">
      {message}
    </div>
  );
}
