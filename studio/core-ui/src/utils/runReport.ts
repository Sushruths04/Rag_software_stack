/**
 * B-M5: "Export dataset" (03_PHASE2_SOFTWARE_PLAN.md §B-M5) is scoped down
 * to "export run report", because studio has no QA-dataset/evidence-viewer
 * data model at all yet — RunRecord artifacts carry {type, ref, meta} only,
 * no bbox coordinates. Real bbox evidence lives in the engine's separate
 * v10-source-anchored-gt reporter, not wired into studio. This report
 * covers everything studio's own run/artifact model actually contains:
 * block execution order, artifact refs+meta, ok/fail status, and a
 * provenance manifest of content hashes — a single self-contained HTML
 * file with no external requests, openable on a machine without the
 * software installed (the part of the B-M5 accept criterion this slice
 * can honestly satisfy).
 *
 * Hashes below are of the run record's own JSON content and each
 * artifact's recorded reference/metadata, NOT the underlying artifact
 * file bytes — this desktop shell has no access to those directly.
 */
import type { RunRecord } from "../hooks/useDesktopProject";

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashArtifacts(artifacts: RunRecord["artifacts"]): Promise<Record<string, Record<string, string>>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [blockId, ports] of Object.entries(artifacts)) {
    out[blockId] = {};
    for (const [port, artifact] of Object.entries(ports)) {
      out[blockId][port] = await sha256Hex(JSON.stringify(artifact));
    }
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface RunReportProvenanceManifest {
  provenanceSchemaVersion: 1;
  generatedAt: string;
  runId: string;
  runContentHash: string;
  artifactHashes: Record<string, Record<string, string>>;
}

export async function buildProvenanceManifest(record: RunRecord, generatedAt: string): Promise<RunReportProvenanceManifest> {
  return {
    provenanceSchemaVersion: 1,
    generatedAt,
    runId: record.id,
    runContentHash: await sha256Hex(JSON.stringify(record)),
    artifactHashes: await hashArtifacts(record.artifacts),
  };
}

/** Self-contained (inline CSS, no external requests) HTML report for one
 * run. The provenance manifest is embedded twice on purpose: once as a
 * machine-readable `<script type="application/json">` block, once as a
 * human-visible content hash line — a supervisor opening the file in a
 * browser sees the number without needing to view-source. */
export async function buildRunReportHtml(record: RunRecord, generatedAt: string): Promise<string> {
  const manifest = await buildProvenanceManifest(record, generatedAt);
  const manifestJson = JSON.stringify(manifest, null, 2).replace(/<\/script/gi, "<\\/script");

  const rows = record.order
    .map((blockId) => {
      const ports = record.artifacts[blockId] ?? {};
      const portEntries = Object.entries(ports);
      const portsHtml = portEntries.length
        ? `<ul>${portEntries
            .map(
              ([port, a]) =>
                `<li><code>${escapeHtml(port)}</code>: ${escapeHtml(a.type)} — <code>${escapeHtml(a.ref)}</code></li>`,
            )
            .join("")}</ul>`
        : "—";
      return `<tr><td><code>${escapeHtml(blockId)}</code></td><td>${portsHtml}</td></tr>`;
    })
    .join("");

  const statusHtml = record.ok
    ? `<span class="status-ok">✓ ok</span>`
    : `<span class="status-fail">✗ failed at ${escapeHtml(record.failedBlock ?? "?")}</span>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Run report — ${escapeHtml(record.graph.name)}</title>
<style>
  body { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; background: #0e1512; color: #e7fff5; margin: 0; padding: 32px; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  h2 { font-size: 14px; margin-top: 32px; border-top: 1px solid #2a3b35; padding-top: 16px; }
  table { border-collapse: collapse; width: 100%; margin-top: 16px; }
  td, th { border: 1px solid #2a3b35; padding: 8px; text-align: left; vertical-align: top; font-size: 13px; }
  th { background: #152420; }
  .status-ok { color: #17e2b6; }
  .status-fail { color: #ff6b6b; }
  code { background: #152420; padding: 1px 4px; border-radius: 3px; }
  ul { margin: 0; padding-left: 18px; }
  .meta { color: #9fb8ae; font-size: 12px; }
</style>
</head>
<body>
  <h1>Run report — ${escapeHtml(record.graph.name)}</h1>
  <p class="meta">Run <code>${escapeHtml(record.id)}</code> · ${escapeHtml(record.timestamp)} · ${statusHtml}</p>
  <table>
    <thead><tr><th>Block (execution order)</th><th>Artifacts</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <h2>Provenance manifest</h2>
  <p class="meta">Content hash (SHA-256) of this run record: <code>${manifest.runContentHash}</code></p>
  <p class="meta">Hashes cover the run record's own JSON content and each artifact's recorded reference/metadata — not the underlying artifact file bytes, which this desktop shell does not read directly.</p>
  <script type="application/json" id="provenance-manifest">${manifestJson}</script>
</body>
</html>
`;
}
