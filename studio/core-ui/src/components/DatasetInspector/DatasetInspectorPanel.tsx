import { useCallback, useEffect, useMemo, useState } from "react";
import { useDesktopProject, type CorpusEntry } from "../../hooks/useDesktopProject";
import { PdfPageView, type Highlight } from "./PdfPageView";
import { pagesOf, type FactBBox } from "../../utils/bboxOverlay";
import { useEscapeToClose } from "../../hooks/useEscapeToClose";
import "./DatasetInspectorPanel.css";

/** Task 12: a fact record as written by the pipeline's Stage-4/5 facts
 * artifact. `bboxes` is optional in the type only to stay honest about a
 * malformed/partial file — this panel never crashes on a fact missing it,
 * it just has nothing to highlight. */
export interface FactRecord {
  fact_id: string;
  text?: string;
  canonical_form?: string;
  page_start?: number;
  bboxes?: FactBBox[];
}

export interface AnswerClause {
  fact_id: string;
  [key: string]: unknown;
}

export interface QaRecord {
  qa_id: string;
  hop_type?: string;
  question?: string;
  answer_clauses?: AnswerClause[];
}

export interface DatasetInspectorPanelProps {
  open: boolean;
  onClose: () => void;
  projectDir: string;
}

type Tab = "facts" | "qa";

// One CSS token hue per fact when a QA pair's several answer-clause facts
// are overlaid together on the same page (04_DESIGN_SYSTEM.md §8.4's port
// type map — reused here, not a new color scale, since it already gives 9
// visually distinct hues with light/dark variants defined once in
// theme/tokens.css). Cycles if a pair somehow has more than 9 clauses.
const HIGHLIGHT_PALETTE = [
  "var(--port-pdf)",
  "var(--port-chunks)",
  "var(--port-facts)",
  "var(--port-bridges)",
  "var(--port-candidates)",
  "var(--port-qa)",
  "var(--port-index)",
  "var(--port-eval)",
  "var(--port-report)",
];

function truncate(s: string, n = 100): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** QA artifacts come in two shapes depending on which pipeline stage wrote
 * them (see datasetClassify.ts): a bare array of pairs, or a wrapper
 * document with a `pairs` array (a full QA-set export). */
function normalizeQaPairs(raw: unknown): QaRecord[] {
  if (Array.isArray(raw)) return raw as QaRecord[];
  if (raw && typeof raw === "object" && Array.isArray((raw as { pairs?: unknown }).pairs)) {
    return (raw as { pairs: QaRecord[] }).pairs;
  }
  return [];
}

function factPage(fact: FactRecord): number | null {
  if (fact.page_start != null) return fact.page_start;
  return pagesOf(fact.bboxes ?? [])[0] ?? null;
}

/**
 * Task 12 — capstone panel tying together Task 10's corpus registry
 * (getProjectFile/importCorpus) and Task 11's PdfPageView: pick a corpus
 * entry, browse its facts/QA artifacts, click through to the source PDF
 * page with the fact's bbox(es) highlighted. Structure mirrors
 * RunHistoryPanel (overlay + two-pane body, same open/close contract). Binds
 * Escape to close (Task 3), making it consistent with TemplatePicker,
 * DocumentationPanel, and RunHistoryPanel.
 */
export function DatasetInspectorPanel({ open, onClose, projectDir }: DatasetInspectorPanelProps) {
  useEscapeToClose(open, onClose);
  const { getProjectFile, importCorpus, resolveProjectPath, readProjectJson } = useDesktopProject();

  const [entries, setEntries] = useState<CorpusEntry[]>([]);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("facts");
  // null = no facts/qa file attached to the entry at all (honest empty
  // state); [] = a file is attached but parsed to zero records.
  const [facts, setFacts] = useState<FactRecord[] | null>(null);
  const [qa, setQa] = useState<QaRecord[] | null>(null);
  const [pdfAbsPath, setPdfAbsPath] = useState<string | null>(null);
  const [selectedFactId, setSelectedFactId] = useState<string | null>(null);
  const [selectedQaId, setSelectedQaId] = useState<string | null>(null);
  const [expandedQaId, setExpandedQaId] = useState<string | null>(null);
  const [activePageNo, setActivePageNo] = useState<number | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);

  const refreshEntries = useCallback(
    async (preferId?: string) => {
      const project = await getProjectFile(projectDir);
      const corpus = project?.corpus ?? [];
      setEntries(corpus);
      setSelectedEntryId((prev) => {
        if (preferId && corpus.some((c) => c.id === preferId)) return preferId;
        if (prev && corpus.some((c) => c.id === prev)) return prev;
        return corpus[0]?.id ?? null;
      });
    },
    [getProjectFile, projectDir],
  );

  // Opening the panel is the trigger — same pattern as RunHistoryPanel's
  // listRunRecords effect.
  useEffect(() => {
    if (!open) return;
    void refreshEntries();
  }, [open, refreshEntries]);

  // Loading a selected entry's facts/qa/pdf-path is latest-wins guarded:
  // rapid entry-picker changes race several reads, and without the `stale`
  // flag a slower (older) response could land last and show artifacts that
  // mismatch the highlighted entry.
  useEffect(() => {
    const entry = entries.find((e) => e.id === selectedEntryId) ?? null;
    setSelectedFactId(null);
    setSelectedQaId(null);
    setExpandedQaId(null);
    setActivePageNo(null);
    setFacts(null);
    setQa(null);
    setPdfAbsPath(null);
    if (!entry) return;

    let stale = false;
    void (async () => {
      const [pdfPath, factsRaw, qaRaw] = await Promise.all([
        resolveProjectPath(projectDir, entry.pdf),
        entry.facts ? readProjectJson<FactRecord[]>(projectDir, entry.facts) : Promise.resolve(null),
        entry.qa ? readProjectJson<unknown>(projectDir, entry.qa) : Promise.resolve(null),
      ]);
      if (stale) return;
      setPdfAbsPath(pdfPath);
      setFacts(entry.facts ? (Array.isArray(factsRaw) ? factsRaw : []) : null);
      setQa(entry.qa ? normalizeQaPairs(qaRaw) : null);
    })();
    return () => {
      stale = true;
    };
  }, [selectedEntryId, entries, projectDir, resolveProjectPath, readProjectJson]);

  const clauseFactsFor = useCallback(
    (pair: QaRecord): FactRecord[] =>
      (pair.answer_clauses ?? [])
        .map((c) => facts?.find((f) => f.fact_id === c.fact_id))
        .filter((f): f is FactRecord => !!f),
    [facts],
  );

  const handleSelectFact = useCallback(
    (factId: string) => {
      setSelectedFactId(factId);
      setSelectedQaId(null);
      const fact = facts?.find((f) => f.fact_id === factId);
      setActivePageNo(fact ? factPage(fact) : null);
    },
    [facts],
  );

  const handleSelectChip = useCallback(
    (factId: string) => {
      // A dangling answer_clauses[].fact_id (fact missing from this
      // corpus's facts file) must never crash — just do nothing.
      if (!facts?.some((f) => f.fact_id === factId)) return;
      handleSelectFact(factId);
    },
    [facts, handleSelectFact],
  );

  const handleSelectQa = useCallback(
    (qaId: string) => {
      setExpandedQaId((prev) => (prev === qaId ? null : qaId));
      setSelectedQaId(qaId);
      setSelectedFactId(null);
      const pair = qa?.find((q) => q.qa_id === qaId);
      const pages = pair ? pagesOf(clauseFactsFor(pair).flatMap((f) => f.bboxes ?? [])) : [];
      setActivePageNo(pages[0] ?? null);
    },
    [qa, clauseFactsFor],
  );

  const activeFact = useMemo(() => facts?.find((f) => f.fact_id === selectedFactId) ?? null, [facts, selectedFactId]);
  const activeQa = useMemo(() => qa?.find((q) => q.qa_id === selectedQaId) ?? null, [qa, selectedQaId]);

  // The facts actually being previewed on the right, each paired with the
  // color it should draw in: a single-fact click gets no color override
  // (PdfPageView's default amber); a QA-pair selection assigns one palette
  // hue per clause fact so they read as distinct on an overlapping page.
  const coloredFacts = useMemo(() => {
    if (activeQa) {
      return clauseFactsFor(activeQa).map((fact, i) => ({ fact, color: HIGHLIGHT_PALETTE[i % HIGHLIGHT_PALETTE.length] as string | undefined }));
    }
    if (activeFact) return [{ fact: activeFact, color: undefined as string | undefined }];
    return [];
  }, [activeQa, activeFact, clauseFactsFor]);

  const allPages = useMemo(() => pagesOf(coloredFacts.flatMap(({ fact }) => fact.bboxes ?? [])), [coloredFacts]);

  const highlightsForActivePage: Highlight[] = useMemo(() => {
    if (activePageNo == null) return [];
    const result: Highlight[] = [];
    for (const { fact, color } of coloredFacts) {
      for (const b of fact.bboxes ?? []) {
        if (b.page_no !== activePageNo) continue;
        result.push(color ? { ...b, color } : { ...b });
      }
    }
    return result;
  }, [coloredFacts, activePageNo]);

  const handleImportCorpus = useCallback(async () => {
    const result = await importCorpus(projectDir);
    if (!result) return; // dialog cancelled
    if ("error" in result) {
      setImportNotice(result.error);
      return;
    }
    setImportNotice(
      result.skipped.length > 0
        ? `imported "${result.entry.label}" — ${result.skipped.length} file(s) skipped (unrecognized shape)`
        : `imported "${result.entry.label}"`,
    );
    await refreshEntries(result.entry.id);
  }, [importCorpus, projectDir, refreshEntries]);

  if (!open) return null;

  return (
    <div className="dataset-inspector__overlay" role="dialog" aria-label="Dataset inspector">
      <div className="dataset-inspector">
        <div className="dataset-inspector__header">
          <div className="dataset-inspector__title">Dataset inspector</div>
          {entries.length > 0 && (
            <label className="dataset-inspector__entry-picker">
              Corpus:
              <select aria-label="Corpus entry" value={selectedEntryId ?? ""} onChange={(e) => setSelectedEntryId(e.target.value || null)}>
                {entries.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" className="dataset-inspector__import" onClick={() => void handleImportCorpus()}>
            Import corpus…
          </button>
          <button type="button" className="dataset-inspector__close" aria-label="Close dataset inspector" onClick={onClose}>
            ✕
          </button>
        </div>

        {importNotice && <div className="dataset-inspector__notice">{importNotice}</div>}

        {entries.length === 0 ? (
          <p className="dataset-inspector__empty">This project has no corpus imported yet — use &quot;Import corpus…&quot; to add one.</p>
        ) : (
          <div className="dataset-inspector__body">
            <div className="dataset-inspector__list-pane">
              <div className="dataset-inspector__tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "facts"}
                  className={`dataset-inspector__tab${tab === "facts" ? " dataset-inspector__tab--active" : ""}`}
                  onClick={() => setTab("facts")}
                >
                  Facts
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "qa"}
                  className={`dataset-inspector__tab${tab === "qa" ? " dataset-inspector__tab--active" : ""}`}
                  onClick={() => setTab("qa")}
                >
                  QA pairs
                </button>
              </div>

              {tab === "facts" ? (
                facts === null ? (
                  <p className="dataset-inspector__empty">this corpus has no facts file attached</p>
                ) : facts.length === 0 ? (
                  <p className="dataset-inspector__empty">no facts found in this corpus's facts file</p>
                ) : (
                  <ul className="dataset-inspector__list">
                    {facts.map((fact) => {
                      const page = factPage(fact);
                      return (
                        <li key={fact.fact_id}>
                          <button
                            type="button"
                            className={`dataset-inspector__item${fact.fact_id === selectedFactId ? " dataset-inspector__item--active" : ""}`}
                            onClick={() => handleSelectFact(fact.fact_id)}
                          >
                            <span className="mono dataset-inspector__item-id">{fact.fact_id}</span>
                            {page != null && <span className="dataset-inspector__page-badge">p.{page}</span>}
                            <span className="dataset-inspector__item-text">{truncate(fact.canonical_form || fact.text || "", 100)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )
              ) : qa === null ? (
                <p className="dataset-inspector__empty">this corpus has no qa file attached</p>
              ) : qa.length === 0 ? (
                <p className="dataset-inspector__empty">no QA pairs found in this corpus's qa file</p>
              ) : (
                <ul className="dataset-inspector__list">
                  {qa.map((pair) => (
                    <li key={pair.qa_id}>
                      <button
                        type="button"
                        className={`dataset-inspector__item${pair.qa_id === selectedQaId ? " dataset-inspector__item--active" : ""}`}
                        onClick={() => handleSelectQa(pair.qa_id)}
                      >
                        <span className="mono dataset-inspector__item-id">{pair.qa_id}</span>
                        {pair.hop_type && <span className="dataset-inspector__hop-badge">{pair.hop_type}</span>}
                        <span className="dataset-inspector__item-text">{pair.question ?? ""}</span>
                      </button>
                      {expandedQaId === pair.qa_id && (
                        <div className="dataset-inspector__chips">
                          {(pair.answer_clauses ?? []).length === 0 ? (
                            <span className="dataset-inspector__chip dataset-inspector__chip--missing">no answer clauses</span>
                          ) : (
                            (pair.answer_clauses ?? []).map((clause) => {
                              const known = facts?.some((f) => f.fact_id === clause.fact_id) ?? false;
                              return known ? (
                                <button
                                  key={clause.fact_id}
                                  type="button"
                                  className="dataset-inspector__chip mono"
                                  onClick={() => handleSelectChip(clause.fact_id)}
                                >
                                  {clause.fact_id}
                                </button>
                              ) : (
                                <span
                                  key={clause.fact_id}
                                  className="dataset-inspector__chip dataset-inspector__chip--missing mono"
                                  title="fact not found in this corpus's facts file"
                                >
                                  {clause.fact_id}
                                </span>
                              );
                            })
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="dataset-inspector__detail-pane">
              {allPages.length > 1 && (
                <div className="dataset-inspector__page-chips">
                  {allPages.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`dataset-inspector__page-chip${p === activePageNo ? " dataset-inspector__page-chip--active" : ""}`}
                      onClick={() => setActivePageNo(p)}
                    >
                      Page {p}
                    </button>
                  ))}
                </div>
              )}
              {pdfAbsPath && activePageNo != null ? (
                <PdfPageView pdfPath={pdfAbsPath} pageNo={activePageNo} highlights={highlightsForActivePage} />
              ) : (
                <p className="dataset-inspector__empty">Select a fact or QA pair to preview its source page.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
