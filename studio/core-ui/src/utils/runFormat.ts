/**
 * Formats a real (or stub) run artifact from POST /api/graphs/run into the
 * short mono display string used for a block's meta line and its outgoing
 * wire badges — the same visual slot DEMO_GRAPH's canned ``runMeta`` used to
 * fill (see data/demoGraph.ts), now driven by the backend's real ``meta``.
 *
 * Honesty requirement (M3 scope, see 02_PHASE2_APP_PLAN.md): a stub artifact
 * must never be mistaken for a real measurement. Every ``ref`` the executor
 * returns is prefixed ``"stub:"`` when it came from a placeholder adapter
 * (studio/backend/stubs.py) and is a real path/manifest reference otherwise
 * (studio/backend/adapters_live.py). ``formatArtifactBadge`` appends a
 * plain-text ``" (planned)"`` suffix whenever that prefix is present, so the
 * marker survives into every place this string is rendered (node meta line,
 * wire badge) without any component needing its own stub-awareness.
 */
import type { ApiArtifact } from "../api/client";

const STUB_PREFIX = "stub:";

export function isStubRef(ref: string): boolean {
  return ref.startsWith(STUB_PREFIX);
}

function formatByType(artifact: ApiArtifact): string {
  const { type, meta } = artifact;
  switch (type) {
    case "pdf":
      return `${meta.pages ?? "?"} pages`;
    case "chunks":
      return `${meta.count ?? "?"} chunks`;
    case "facts":
      return `${meta.count ?? "?"} facts${meta.grounded ? " · grounded" : ""}`;
    case "bridges":
      return `${meta.count ?? "?"} bridges`;
    case "candidates": {
      const parts: string[] = [];
      if (typeof meta.clusters === "number" && meta.clusters > 0) parts.push(`${meta.clusters} clusters`);
      if (typeof meta.pairs === "number" && (meta.pairs > 0 || parts.length === 0)) parts.push(`${meta.pairs} pairs`);
      return parts.join(" · ");
    }
    case "qa": {
      const parts = [`${meta.count ?? "?"} QA`];
      if (typeof meta.multi_hop === "number" && meta.multi_hop > 0) parts.push(`${meta.multi_hop} multi-hop`);
      return parts.join(" · ");
    }
    case "index":
      return `${meta.strategy ?? "index"} · ${meta.docs ?? "?"} docs`;
    case "eval":
      return meta.recall_at_k !== undefined ? `recall@${meta.k ?? ""} ${meta.recall_at_k}` : "eval";
    case "report":
      return typeof meta.path === "string" ? meta.path : "report";
    default:
      return type;
  }
}

/** Human-readable badge/meta-line text for one output artifact, with the
 * "(planned)" honesty suffix appended whenever ``artifact.ref`` is a stub. */
export function formatArtifactBadge(artifact: ApiArtifact): string {
  const text = formatByType(artifact);
  return isStubRef(artifact.ref) ? `${text} (planned)` : text;
}
