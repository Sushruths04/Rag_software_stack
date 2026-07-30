import { useEffect, useState } from "react";
import type { RunRecord } from "../../hooks/useDesktopProject";
import type { ApiArtifact } from "../../api/client";
import { formatArtifactBadge } from "../../utils/runFormat";
import { useEscapeToClose } from "../../hooks/useEscapeToClose";
import "./RunHistoryPanel.css";

export interface RunHistoryPanelProps {
  open: boolean;
  onClose: () => void;
  listRunRecords: (projectDir: string, tabId: string) => Promise<string[]>;
  loadRunRecord: (projectDir: string, tabId: string, id: string) => Promise<RunRecord | null>;
  /** B-M5: exports the currently selected run as a self-contained HTML
   * report + provenance manifest. Optional so this panel stays usable
   * without wiring export in call sites that don't need it (e.g. tests). */
  onExportReport?: (record: RunRecord) => void;
  projectDir: string;
  tabId: string;
}

function formatId(id: string): string {
  // ids are ISO timestamps with `:`/`.` replaced by `-` (see StudioShell's
  // persistRunRecord) — recover a readable local time from it.
  const iso = id.replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, ":$1:$2.$3Z").replace(/T(\d{2})-(\d{2})/, "T$1:$2");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? id : d.toLocaleString();
}

function paramsDiff(a: RunRecord, b: RunRecord): Array<{ blockId: string; key: string; from: string; to: string }> {
  const diffs: Array<{ blockId: string; key: string; from: string; to: string }> = [];
  const bBlocks = new Map(b.graph.blocks.map((blk) => [blk.id, blk]));
  for (const blockA of a.graph.blocks) {
    const blockB = bBlocks.get(blockA.id);
    if (!blockB) continue;
    const keys = new Set([...Object.keys(blockA.params ?? {}), ...Object.keys(blockB.params ?? {})]);
    for (const key of keys) {
      const from = blockA.params?.[key] ?? "";
      const to = blockB.params?.[key] ?? "";
      if (from !== to) diffs.push({ blockId: blockA.id, key, from, to });
    }
  }
  return diffs;
}

// B-M7: 04_DESIGN_SYSTEM.md's perf pass explicitly names "virtualized
// palette/history lists" -- listRunRecords already returns every run ever
// recorded for this tab, unbounded, and this panel used to render every one
// of them as a plain <li>. A long-lived project can accumulate hundreds of
// runs; capping to the most recent N (already sorted newest-first) avoids
// an unbounded DOM list without pulling in a virtualized-scroll dependency
// for what's realistically dozens-to-low-hundreds of entries in practice --
// a real, scoped fix, not a full virtualization rewrite.
const MAX_VISIBLE_RUNS = 100;

/** B-M3: run history panel — lists past runs for the active tab (persisted
 * by StudioShell's persistRunRecord after every completed run), an
 * artifact browser for the selected run, and a param diff against a second
 * selected run. */
export function RunHistoryPanel({ open, onClose, listRunRecords, loadRunRecord, onExportReport, projectDir, tabId }: RunHistoryPanelProps) {
  useEscapeToClose(open, onClose);
  const [ids, setIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [record, setRecord] = useState<RunRecord | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [compareRecord, setCompareRecord] = useState<RunRecord | null>(null);

  useEffect(() => {
    if (!open) return;
    void listRunRecords(projectDir, tabId).then((loaded) => {
      setIds(loaded);
      setSelectedId(loaded[0] ?? null);
    });
  }, [open, listRunRecords, projectDir, tabId]);

  const visibleIds = ids.slice(0, MAX_VISIBLE_RUNS);

  // Both loads are guarded latest-wins: rapid clicks race two loadRunRecord
  // promises, and without the cleanup flag the slower (older) response
  // could land last and show a record that mismatches the highlighted
  // selection — the param diff and Export report would then silently
  // operate on the wrong run.
  useEffect(() => {
    if (!selectedId) {
      setRecord(null);
      return;
    }
    let stale = false;
    void loadRunRecord(projectDir, tabId, selectedId).then((r) => {
      if (!stale) setRecord(r);
    });
    return () => {
      stale = true;
    };
  }, [selectedId, loadRunRecord, projectDir, tabId]);

  useEffect(() => {
    if (!compareId) {
      setCompareRecord(null);
      return;
    }
    let stale = false;
    void loadRunRecord(projectDir, tabId, compareId).then((r) => {
      if (!stale) setCompareRecord(r);
    });
    return () => {
      stale = true;
    };
  }, [compareId, loadRunRecord, projectDir, tabId]);

  if (!open) return null;

  const diffs = record && compareRecord ? paramsDiff(record, compareRecord) : null;

  return (
    <div className="run-history__overlay" role="dialog" aria-label="Run history">
      <div className="run-history">
        <div className="run-history__header">
          <div className="run-history__title">Run history</div>
          <button className="run-history__close" aria-label="Close run history" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="run-history__body">
          <ul className="run-history__list">
            {ids.length === 0 && <li className="run-history__empty">No runs yet — Run the graph once this saves a record.</li>}
            {visibleIds.map((id) => (
              <li key={id}>
                <button
                  className={`run-history__item${id === selectedId ? " run-history__item--active" : ""}`}
                  onClick={() => setSelectedId(id)}
                  title={id}
                >
                  {formatId(id)}
                </button>
              </li>
            ))}
            {ids.length > MAX_VISIBLE_RUNS && (
              <li className="run-history__truncated">showing the {MAX_VISIBLE_RUNS} most recent of {ids.length} runs</li>
            )}
          </ul>
          <div className="run-history__detail">
            {record ? (
              <>
                <div className="run-history__summary">
                  <span className={record.ok ? "run-history__ok" : "run-history__fail"}>{record.ok ? "✓ ok" : `✗ failed at ${record.failedBlock}`}</span>
                  <span className="mono">{record.order.length} blocks</span>
                  {onExportReport && (
                    <button type="button" className="run-history__export" onClick={() => onExportReport(record)}>
                      Export report
                    </button>
                  )}
                  <label className="run-history__compare-label">
                    Compare with:
                    <select value={compareId ?? ""} onChange={(e) => setCompareId(e.target.value || null)}>
                      <option value="">(none)</option>
                      {visibleIds
                        .filter((id) => id !== selectedId)
                        .map((id) => (
                          <option key={id} value={id}>
                            {formatId(id)}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>

                {diffs && (
                  <div className="run-history__diffs">
                    <div className="run-history__section-title">Param diff vs {formatId(compareId!)}</div>
                    {diffs.length === 0 ? (
                      <p className="run-history__empty">No param differences.</p>
                    ) : (
                      <table className="run-history__diff-table">
                        <thead>
                          <tr>
                            <th>Block</th>
                            <th>Param</th>
                            <th>This run</th>
                            <th>Compared run</th>
                          </tr>
                        </thead>
                        <tbody>
                          {diffs.map((d) => (
                            <tr key={`${d.blockId}.${d.key}`}>
                              <td className="mono">{d.blockId}</td>
                              <td className="mono">{d.key}</td>
                              <td className="mono">{d.from || "(empty)"}</td>
                              <td className="mono">{d.to || "(empty)"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                <div className="run-history__section-title">Artifacts by block</div>
                <table className="run-history__artifact-table">
                  <thead>
                    <tr>
                      <th>Block</th>
                      <th>Port</th>
                      <th>Result</th>
                      <th>Ref</th>
                    </tr>
                  </thead>
                  <tbody>
                    {record.order.map((blockId) =>
                      Object.entries(record.artifacts[blockId] ?? {}).map(([port, artifact]) => (
                        <tr key={`${blockId}.${port}`}>
                          <td className="mono">{blockId}</td>
                          <td className="mono">{port}</td>
                          <td className="mono">{formatArtifactBadge(artifact as ApiArtifact)}</td>
                          <td className="mono run-history__ref">{(artifact as ApiArtifact).ref}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </>
            ) : (
              <p className="run-history__empty">Select a run to inspect its artifacts.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
