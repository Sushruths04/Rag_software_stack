/** One readable line for the console/toast out of a raw backend error;
 * the untouched original rides along as `detail` when it was condensed.
 * No HTTP codes or pydantic internals in the summary — a live demo showed
 * the raw dump wall-papering the screen (28 extra_forbidden errors). */
export function summarizeApiError(raw: string): { summary: string; detail?: string } {
  const compact = raw.replace(/\s+/g, " ").trim();
  // api/client.ts prefixes every non-2xx result with "HTTP <status>: " —
  // status codes must never reach a user-facing summary, so drop the prefix
  // here (the untouched raw still rides along as `detail` for debugging).
  const stripped = compact.replace(/^HTTP \d+:\s*/, "");
  const m = stripped.match(/(\d+) validation errors?/);
  if (m) {
    const n = Number(m[1]);
    return { summary: `request rejected — ${n} validation error${n === 1 ? "" : "s"} (details below)`, detail: raw };
  }
  if (stripped.length <= 160) {
    return stripped === compact ? { summary: stripped } : { summary: stripped, detail: raw };
  }
  return { summary: `${stripped.slice(0, 157)}…`, detail: raw };
}
