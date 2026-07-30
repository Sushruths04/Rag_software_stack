import { useCallback, useEffect, useState } from "react";
import type { BlockSpec, GraphDoc } from "../types/graph";
import type { CompositeDef } from "../utils/composite";
import {
  buildSessionExportBundle,
  checkBundleCompatibility,
  SESSION_BUNDLE_SCHEMA_VERSION,
  type BundleCompatibilityWarning,
  type SessionExportBundle,
} from "../utils/sessionBundle";
import { buildRunReportHtml } from "../utils/runReport";
import { buildSampleSessions, sampleCorpusEntry, SAMPLE_FILES } from "../data/sampleProject";
import { classifyDatasetJson } from "../utils/datasetClassify";

/**
 * B-M1 project/session file model. Per 03_PHASE2_SOFTWARE_PLAN.md §1/§B-M1:
 * a Project is a folder (`*.ragproj/`) the user opens directly; a Session is
 * one graph file inside it. This talks straight to disk via Tauri's
 * dialog+fs plugins — NOT through the Python backend (that stays a flat
 * global store for the browser/Plan-A flow and for validate/run/blocks,
 * which are genuinely backend concerns). Total no-op outside a Tauri
 * webview, same pattern as useDesktopMenuCommands.
 */

/**
 * Task 10 — one imported dataset registered in a project's corpus. `id` is
 * a filesystem-safe slug (also the `datasets/<id>/` folder name) and doubles
 * as the uniqueness key importCorpus dedupes against. `pdf` is required —
 * every corpus entry originates from a PDF import — while chunks/facts/qa
 * are attached only for the JSON files importCorpus could classify; a
 * PDF-only import (no JSON picked, or all JSON unrecognized) is valid and
 * leaves all three undefined. All paths are project-relative, forward-slash,
 * e.g. "datasets/ecma404/ecma404_json.pdf" — never the absolute stamped
 * paths a session's block params consume.
 */
export interface CorpusEntry {
  id: string;
  label: string;
  pdf: string;
  chunks?: string;
  facts?: string;
  qa?: string;
}

export interface ProjectFile {
  name: string;
  created: string;
  /** Corpus registry (PDFs, chunk sets, fact sets) — starts empty; Task 10's
   * importCorpus appends to it, createSampleProject seeds it with the
   * bundled ecma404 entry. */
  corpus: CorpusEntry[];
}

export interface SessionDoc extends GraphDoc {
  viewport?: { x: number; y: number; zoom: number };
}

export interface RecentProject {
  path: string;
  name: string;
  lastOpened: string;
}

/** B-M3: one persisted completed run, so a run-history panel can list past
 * runs and diff their block configs — mirrors studio/backend's RunResult
 * shape (ok/failed_block/order/artifacts) plus the graph snapshot needed
 * for a diff, which the backend response itself doesn't carry. */
export interface RunRecord {
  /** timestamp-based, also the filename and the sort key (lexicographic ==
   * chronological since it's an ISO string with `:`/`.` stripped). */
  id: string;
  timestamp: string;
  graph: GraphDoc;
  ok: boolean;
  failedBlock: string | null;
  order: string[];
  artifacts: Record<string, Record<string, { type: string; ref: string; meta: Record<string, unknown> }>>;
}

const PROJECT_FILE_NAME = "project.json";
const SESSIONS_DIR = "sessions";
const RUNS_DIR = "runs";
const BLOCKS_DIR = "blocks";
const RECENT_PROJECTS_FILE = "recent-projects.json";
const SESSION_EXT = ".ragsession";
// Autosave drafts live next to the real session file with this suffix.
// Existence alone (not an mtime comparison) is the crash-recovery signal:
// a successful Save always deletes its tab's draft, so a draft present on
// reopen can only mean "edited since the last save, then closed uncleanly."
const DRAFT_EXT = ".draft";

export type LoadSessionResult =
  | { status: "ok"; doc: SessionDoc }
  | { status: "not_found" }
  | { status: "corrupt"; raw: string };

type TauriModuleSet = {
  dialog: typeof import("@tauri-apps/plugin-dialog");
  fs: typeof import("@tauri-apps/plugin-fs");
  path: typeof import("@tauri-apps/api/path");
};

// Every exported function below calls this on every invocation; without
// caching, concurrent first-time callers (e.g. this hook's own `available`
// effect racing a component's saveSession/loadSession call on mount) each
// trigger their own dynamic import() of the same specifier. Real bundled
// ESM resolves that instantly and identically either way, but caching
// behind one shared promise removes any dependence on import() timing —
// and avoids redundantly re-importing three modules per fs call.
let cachedModules: Promise<TauriModuleSet | null> | null = null;

async function tauriModules(): Promise<TauriModuleSet | null> {
  if (!cachedModules) {
    cachedModules = (async () => {
      const { isTauri } = await import("@tauri-apps/api/core");
      if (!isTauri()) return null;
      const [dialog, fs, path] = await Promise.all([
        import("@tauri-apps/plugin-dialog"),
        import("@tauri-apps/plugin-fs"),
        import("@tauri-apps/api/path"),
      ]);
      return { dialog, fs, path };
    })();
  }
  return cachedModules;
}

type TauriModules = NonNullable<Awaited<ReturnType<typeof tauriModules>>>;

// ---- Task 10: corpus import helpers — pure string logic, kept outside the
// hook so they need no fake-fs mocking of their own.

/** Last path segment, tolerant of either separator since the dialog can
 * hand back a native Windows path even though the rest of this file's
 * relative paths are always forward-slash. */
function basename(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

/** Filesystem-safe slug for the `datasets/<slug>/` folder and the corpus
 * entry's `id`: lowercase, any run of non-alphanumeric characters collapsed
 * to a single dash, leading/trailing dashes trimmed. Falls back to "corpus"
 * for a stem that has no alphanumeric characters at all. */
function slugify(stem: string): string {
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "corpus";
}

/** Human label from the PDF stem: underscores/dashes read as word breaks
 * become spaces, everything else (case, digits) is left as the author named
 * the file — this is a placeholder label the user can rename later, not an
 * attempt to title-case it. */
function labelFromStem(stem: string): string {
  const label = stem.replace(/[_-]+/g, " ").trim();
  return label || stem;
}

async function readRecentProjects(fs: TauriModules["fs"], filePath: string): Promise<RecentProject[]> {
  if (!(await fs.exists(filePath))) return [];
  try {
    const raw = await fs.readTextFile(filePath);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * `available` is `null` until the async isTauri() check resolves (one
 * microtask), then `false` (browser/tests) or `true` (real desktop shell).
 * App.tsx renders nothing meaningful while it's `null` so a real Tauri
 * session never flashes the canvas before the project home screen.
 */
export function useDesktopProject() {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void tauriModules().then((mods) => {
      if (!cancelled) setAvailable(!!mods);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const recentProjectsPath = useCallback(async () => {
    const mods = await tauriModules();
    if (!mods) return null;
    const dir = await mods.path.appLocalDataDir();
    await mods.fs.mkdir(dir, { recursive: true }).catch(() => undefined);
    return mods.path.join(dir, RECENT_PROJECTS_FILE);
  }, []);

  const getRecentProjects = useCallback(async (): Promise<RecentProject[]> => {
    const mods = await tauriModules();
    const filePath = await recentProjectsPath();
    if (!mods || !filePath) return [];
    return readRecentProjects(mods.fs, filePath);
  }, [recentProjectsPath]);

  const touchRecentProject = useCallback(
    async (projectPath: string, name: string) => {
      const mods = await tauriModules();
      const filePath = await recentProjectsPath();
      if (!mods || !filePath) return;
      const existing = await readRecentProjects(mods.fs, filePath);
      const next = [
        { path: projectPath, name, lastOpened: new Date().toISOString() },
        ...existing.filter((p) => p.path !== projectPath),
      ].slice(0, 10);
      await mods.fs.writeTextFile(filePath, JSON.stringify(next, null, 2));
    },
    [recentProjectsPath],
  );

  const createProject = useCallback(async (name: string): Promise<string | null> => {
    const mods = await tauriModules();
    if (!mods) return null;
    const parent = await mods.dialog.open({ directory: true, title: "Choose where to create the project" });
    if (!parent || Array.isArray(parent)) return null;
    const projectDir = await mods.path.join(parent, name);
    await mods.fs.mkdir(projectDir, { recursive: true });
    await mods.fs.mkdir(await mods.path.join(projectDir, SESSIONS_DIR), { recursive: true });
    await mods.fs.mkdir(await mods.path.join(projectDir, RUNS_DIR), { recursive: true });
    await mods.fs.mkdir(await mods.path.join(projectDir, BLOCKS_DIR), { recursive: true });
    await mods.fs.mkdir(await mods.path.join(projectDir, "datasets"), { recursive: true });
    const project: ProjectFile = { name, created: new Date().toISOString(), corpus: [] };
    await mods.fs.writeTextFile(await mods.path.join(projectDir, PROJECT_FILE_NAME), JSON.stringify(project, null, 2));
    await touchRecentProject(projectDir, name);
    return projectDir;
  }, [touchRecentProject]);

  const openProjectAt = useCallback(
    async (projectDir: string): Promise<ProjectFile | null> => {
      const mods = await tauriModules();
      if (!mods) return null;
      const projectFilePath = await mods.path.join(projectDir, PROJECT_FILE_NAME);
      if (!(await mods.fs.exists(projectFilePath))) return null;
      const raw = await mods.fs.readTextFile(projectFilePath);
      const project = JSON.parse(raw) as ProjectFile;
      await touchRecentProject(projectDir, project.name);
      return project;
    },
    [touchRecentProject],
  );

  const openProjectDialog = useCallback(async (): Promise<{ dir: string; project: ProjectFile } | null> => {
    const mods = await tauriModules();
    if (!mods) return null;
    const dir = await mods.dialog.open({ directory: true, title: "Open a GRAFT Studio project" });
    if (!dir || Array.isArray(dir)) return null;
    const project = await openProjectAt(dir);
    if (!project) return null;
    return { dir, project };
  }, [openProjectAt]);

  /** Reads project.json for a known project directory without recording it
   * as a recent project — unlike openProjectAt/openProjectDialog, which the
   * user explicitly invoked to "open" a project, this is a plumbing read for
   * callers (like importCorpus) that already have the project open and just
   * need its current state. */
  const getProjectFile = useCallback(async (projectDir: string): Promise<ProjectFile | null> => {
    const mods = await tauriModules();
    if (!mods) return null;
    const projectFilePath = await mods.path.join(projectDir, PROJECT_FILE_NAME);
    if (!(await mods.fs.exists(projectFilePath))) return null;
    try {
      return JSON.parse(await mods.fs.readTextFile(projectFilePath)) as ProjectFile;
    } catch {
      return null;
    }
  }, []);

  /** Overwrites project.json's corpus array in place, leaving every other
   * field (name, created) untouched. A no-op if the project can't be read
   * back (shouldn't happen for a real project dir, but avoids fabricating a
   * fresh project.json out of a write that was only meant to update one
   * field). */
  const updateProjectCorpus = useCallback(
    async (projectDir: string, corpus: CorpusEntry[]): Promise<void> => {
      const mods = await tauriModules();
      if (!mods) return;
      const project = await getProjectFile(projectDir);
      if (!project) return;
      project.corpus = corpus;
      const projectFilePath = await mods.path.join(projectDir, PROJECT_FILE_NAME);
      await mods.fs.writeTextFile(projectFilePath, JSON.stringify(project, null, 2));
    },
    [getProjectFile],
  );

  // ---- Task 10: import-corpus flow — user picks a PDF (required) plus any
  // number of dataset JSON files (optional), everything is copied into
  // datasets/<slug>/, each JSON is classified by content shape
  // (datasetClassify.ts) and attached to the corpus entry under the
  // matching field, and the entry is appended to project.json. A JSON file
  // whose shape isn't recognized is still copied to disk (so nothing the
  // user picked silently vanishes) but left off the entry and named in
  // `skipped` instead of failing the whole import — one bad file shouldn't
  // block a PDF + two good JSON files from registering.
  const importCorpus = useCallback(
    async (projectDir: string): Promise<{ entry: CorpusEntry; skipped: string[] } | { error: string } | null> => {
      const mods = await tauriModules();
      if (!mods) return null;

      const pdfPick = await mods.dialog.open({
        title: "Choose a PDF to import",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!pdfPick || Array.isArray(pdfPick)) return null;
      const pdfName = basename(pdfPick);
      if (!/\.pdf$/i.test(pdfName)) {
        return { error: `"${pdfPick}" is not a PDF file` };
      }

      const jsonPick = await mods.dialog.open({
        title: "Choose dataset JSON files (optional)",
        multiple: true,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      const jsonPaths: string[] = Array.isArray(jsonPick) ? jsonPick : jsonPick ? [jsonPick] : [];

      const project = await getProjectFile(projectDir);
      const existingCorpus = project?.corpus ?? [];
      const existingIds = new Set(existingCorpus.map((c) => c.id));
      const stem = pdfName.replace(/\.pdf$/i, "");
      const baseSlug = slugify(stem);
      let slug = baseSlug;
      for (let n = 2; existingIds.has(slug); n += 1) {
        slug = `${baseSlug}-${n}`;
      }

      const datasetDir = await mods.path.join(projectDir, "datasets", slug);
      await mods.fs.mkdir(datasetDir, { recursive: true });

      const pdfDest = await mods.path.join(datasetDir, pdfName);
      await mods.fs.copyFile(pdfPick, pdfDest);

      const entry: CorpusEntry = {
        id: slug,
        label: labelFromStem(stem),
        pdf: `datasets/${slug}/${pdfName}`,
      };
      const skipped: string[] = [];

      for (const jsonPath of jsonPaths) {
        const jsonName = basename(jsonPath);
        const dest = await mods.path.join(datasetDir, jsonName);
        await mods.fs.copyFile(jsonPath, dest);
        const relPath = `datasets/${slug}/${jsonName}`;
        try {
          const kind = classifyDatasetJson(JSON.parse(await mods.fs.readTextFile(dest)));
          if (kind === "facts") entry.facts = relPath;
          else if (kind === "chunks") entry.chunks = relPath;
          else if (kind === "qa") entry.qa = relPath;
          else skipped.push(jsonName);
        } catch {
          skipped.push(jsonName);
        }
      }

      if (project) {
        await updateProjectCorpus(projectDir, [...existingCorpus, entry]);
      }
      return { entry, skipped };
    },
    [getProjectFile, updateProjectCorpus],
  );

  // ---- Task 12: dataset inspector — corpus entries store project-relative
  // paths (e.g. "datasets/ecma404/facts_ecma404_json_full.json"); these two
  // helpers are the generic read-side counterpart to importCorpus's writes,
  // used to resolve an absolute pdf path for PdfPageView and to load a
  // corpus entry's facts/qa JSON without each caller re-deriving the
  // project-relative-path -> absolute-path join itself.
  const resolveProjectPath = useCallback(async (projectDir: string, relPath: string): Promise<string | null> => {
    const mods = await tauriModules();
    if (!mods) return null;
    return mods.path.join(projectDir, relPath);
  }, []);

  /** Reads and parses a project-relative JSON file — null if the project is
   * unavailable, the file is missing, or it fails to parse. Same tolerant
   * contract as getProjectFile: a bad file is never worth crashing over. */
  const readProjectJson = useCallback(async <T,>(projectDir: string, relPath: string): Promise<T | null> => {
    const mods = await tauriModules();
    if (!mods) return null;
    const filePath = await mods.path.join(projectDir, relPath);
    if (!(await mods.fs.exists(filePath))) return null;
    try {
      return JSON.parse(await mods.fs.readTextFile(filePath)) as T;
    } catch {
      return null;
    }
  }, []);

  const listSessions = useCallback(async (projectDir: string): Promise<string[]> => {
    const mods = await tauriModules();
    if (!mods) return [];
    const sessionsDir = await mods.path.join(projectDir, SESSIONS_DIR);
    if (!(await mods.fs.exists(sessionsDir))) return [];
    const entries = await mods.fs.readDir(sessionsDir);
    return entries.filter((e) => e.name?.endsWith(SESSION_EXT)).map((e) => e.name!.replace(SESSION_EXT, ""));
  }, []);

  const loadSession = useCallback(async (projectDir: string, sessionName: string): Promise<LoadSessionResult> => {
    const mods = await tauriModules();
    if (!mods) return { status: "not_found" };
    const filePath = await mods.path.join(projectDir, SESSIONS_DIR, `${sessionName}${SESSION_EXT}`);
    if (!(await mods.fs.exists(filePath))) return { status: "not_found" };
    const raw = await mods.fs.readTextFile(filePath);
    try {
      return { status: "ok", doc: JSON.parse(raw) as SessionDoc };
    } catch {
      return { status: "corrupt", raw };
    }
  }, []);

  const saveSession = useCallback(async (projectDir: string, sessionName: string, doc: SessionDoc): Promise<void> => {
    const mods = await tauriModules();
    if (!mods) return;
    const sessionsDir = await mods.path.join(projectDir, SESSIONS_DIR);
    await mods.fs.mkdir(sessionsDir, { recursive: true });
    const filePath = await mods.path.join(sessionsDir, `${sessionName}${SESSION_EXT}`);
    await mods.fs.writeTextFile(filePath, JSON.stringify(doc, null, 2));
  }, []);

  /** Idempotently stages the bundled ECMA-404 corpus into an EXISTING
   * project: copies any missing sample files into datasets/ecma404/ and
   * registers the "ecma404" corpus entry if absent. Extracted from
   * createSampleProject so needsSampleData template flows share one copy of
   * the resolveResource+copyFile logic instead of duplicating it. */
  const ensureSampleData = useCallback(
    async (projectDir: string): Promise<void> => {
      const mods = await tauriModules();
      if (!mods) return;
      const datasetDir = await mods.path.join(projectDir, "datasets", "ecma404");
      await mods.fs.mkdir(datasetDir, { recursive: true });
      for (const f of SAMPLE_FILES) {
        const dest = await mods.path.join(datasetDir, f);
        if (await mods.fs.exists(dest)) continue;
        const src = await mods.path.resolveResource(`sample-data/ecma404/${f}`);
        await mods.fs.copyFile(src, dest);
      }
      const project = await getProjectFile(projectDir);
      if (project && !project.corpus.some((c) => c.id === "ecma404")) {
        await updateProjectCorpus(projectDir, [...project.corpus, sampleCorpusEntry()]);
      }
    },
    [getProjectFile, updateProjectCorpus],
  );

  // ---- B-M6: first-run sample project — copies the bundled ecma404 resource
  // (Task 7's `sample-data/ecma404/` staged under the packaged app's
  // resource dir) into a fresh project's datasets/, registers it in
  // project.json's corpus, and writes the two ready-to-run demo sessions
  // from ../data/sampleProject (Task 8). Reuses createProject/saveSession
  // rather than duplicating their folder-scaffolding/write logic.
  const createSampleProject = useCallback(
    async (name: string): Promise<string | null> => {
      const mods = await tauriModules();
      if (!mods) return null;
      const dir = await createProject(name);
      if (!dir) return null;
      await ensureSampleData(dir);
      const datasetDir = await mods.path.join(dir, "datasets", "ecma404");
      const paths = {
        pdf: await mods.path.join(datasetDir, "ecma404_json.pdf"),
        chunks: await mods.path.join(datasetDir, "s2_chunks_full.json"),
        facts: await mods.path.join(datasetDir, "facts_ecma404_json_full.json"),
        qa: await mods.path.join(datasetDir, "qa_ecma404_json_full.json"),
      };
      const { evalDemo, generationDemo } = buildSampleSessions(paths);
      await saveSession(dir, "eval-demo", evalDemo);
      await saveSession(dir, "generation-demo", generationDemo);
      return dir;
    },
    [createProject, saveSession, ensureSampleData],
  );

  // ---- B-M1: autosave drafts + crash recovery ------------------------------
  const draftPath = useCallback(async (projectDir: string, sessionName: string) => {
    const mods = await tauriModules();
    if (!mods) return null;
    return mods.path.join(projectDir, SESSIONS_DIR, `${sessionName}${SESSION_EXT}${DRAFT_EXT}`);
  }, []);

  const saveDraft = useCallback(
    async (projectDir: string, sessionName: string, doc: SessionDoc): Promise<void> => {
      const mods = await tauriModules();
      const filePath = await draftPath(projectDir, sessionName);
      if (!mods || !filePath) return;
      const sessionsDir = await mods.path.join(projectDir, SESSIONS_DIR);
      await mods.fs.mkdir(sessionsDir, { recursive: true });
      await mods.fs.writeTextFile(filePath, JSON.stringify(doc, null, 2));
    },
    [draftPath],
  );

  /** Silently returns null for a missing OR corrupted draft — a draft is a
   * best-effort convenience file, never authoritative, so it is never worth
   * surfacing its own error dialog. */
  const loadDraft = useCallback(
    async (projectDir: string, sessionName: string): Promise<SessionDoc | null> => {
      const mods = await tauriModules();
      const filePath = await draftPath(projectDir, sessionName);
      if (!mods || !filePath) return null;
      if (!(await mods.fs.exists(filePath))) return null;
      try {
        return JSON.parse(await mods.fs.readTextFile(filePath)) as SessionDoc;
      } catch {
        return null;
      }
    },
    [draftPath],
  );

  const hasDraft = useCallback(
    async (projectDir: string, sessionName: string): Promise<boolean> => {
      const mods = await tauriModules();
      const filePath = await draftPath(projectDir, sessionName);
      if (!mods || !filePath) return false;
      return mods.fs.exists(filePath);
    },
    [draftPath],
  );

  const deleteDraft = useCallback(
    async (projectDir: string, sessionName: string): Promise<void> => {
      const mods = await tauriModules();
      const filePath = await draftPath(projectDir, sessionName);
      if (!mods || !filePath) return;
      if (await mods.fs.exists(filePath)) await mods.fs.remove(filePath);
    },
    [draftPath],
  );

  // ---- B-M3: run history — one JSON file per completed run, under
  // <project>/runs/<tabId>/<id>.json. The runs/ folder is created by
  // createProject but was otherwise unused until now.
  const saveRunRecord = useCallback(async (projectDir: string, tabId: string, record: RunRecord): Promise<void> => {
    const mods = await tauriModules();
    if (!mods) return;
    const dir = await mods.path.join(projectDir, RUNS_DIR, tabId);
    await mods.fs.mkdir(dir, { recursive: true });
    const filePath = await mods.path.join(dir, `${record.id}.json`);
    await mods.fs.writeTextFile(filePath, JSON.stringify(record, null, 2));
  }, []);

  const listRunRecords = useCallback(async (projectDir: string, tabId: string): Promise<string[]> => {
    const mods = await tauriModules();
    if (!mods) return [];
    const dir = await mods.path.join(projectDir, RUNS_DIR, tabId);
    if (!(await mods.fs.exists(dir))) return [];
    const entries = await mods.fs.readDir(dir);
    return entries
      .filter((e) => e.name?.endsWith(".json"))
      .map((e) => e.name!.replace(/\.json$/, ""))
      .sort()
      .reverse(); // ids are timestamp-prefixed — newest first
  }, []);

  const loadRunRecord = useCallback(async (projectDir: string, tabId: string, id: string): Promise<RunRecord | null> => {
    const mods = await tauriModules();
    if (!mods) return null;
    const filePath = await mods.path.join(projectDir, RUNS_DIR, tabId, `${id}.json`);
    if (!(await mods.fs.exists(filePath))) return null;
    try {
      return JSON.parse(await mods.fs.readTextFile(filePath)) as RunRecord;
    } catch {
      return null;
    }
  }, []);

  // ---- B-M4: composite blocks — one JSON file per composite under
  // <project>/blocks/<id>.json. Loaded once on project open into
  // StudioShell's blockCatalog/blockByType alongside the real 33 blocks.
  const saveComposite = useCallback(async (projectDir: string, def: CompositeDef): Promise<void> => {
    const mods = await tauriModules();
    if (!mods) return;
    const dir = await mods.path.join(projectDir, BLOCKS_DIR);
    await mods.fs.mkdir(dir, { recursive: true });
    const filePath = await mods.path.join(dir, `${def.id}.json`);
    await mods.fs.writeTextFile(filePath, JSON.stringify(def, null, 2));
  }, []);

  const listComposites = useCallback(async (projectDir: string): Promise<CompositeDef[]> => {
    const mods = await tauriModules();
    if (!mods) return [];
    const dir = await mods.path.join(projectDir, BLOCKS_DIR);
    if (!(await mods.fs.exists(dir))) return [];
    const entries = await mods.fs.readDir(dir);
    const defs: CompositeDef[] = [];
    for (const entry of entries) {
      if (!entry.name?.endsWith(".json")) continue;
      try {
        const raw = await mods.fs.readTextFile(await mods.path.join(dir, entry.name));
        defs.push(JSON.parse(raw) as CompositeDef);
      } catch {
        // one corrupted composite file shouldn't take down the whole list
      }
    }
    return defs;
  }, []);

  const deleteComposite = useCallback(async (projectDir: string, id: string): Promise<void> => {
    const mods = await tauriModules();
    if (!mods) return;
    const filePath = await mods.path.join(projectDir, BLOCKS_DIR, `${id}.json`);
    if (await mods.fs.exists(filePath)) await mods.fs.remove(filePath);
  }, []);

  // ---- B-M5: export/import session bundles (graph + pinned block-catalog
  // snapshot) and run reports. Real disk I/O via a save/open dialog, same
  // pattern as every other Tauri-backed function here — the actual
  // portable-file logic (bundle shape, HTML report, compatibility check)
  // lives in ../utils/sessionBundle.ts and ../utils/runReport.ts, pure and
  // unit-tested without needing the fake-fs harness.
  const exportSessionBundle = useCallback(
    async (session: SessionDoc, blockCatalog: BlockSpec[], composites?: CompositeDef[]): Promise<string | null> => {
      const mods = await tauriModules();
      if (!mods) return null;
      const target = await mods.dialog.save({
        title: "Export session",
        defaultPath: `${session.name || "session"}.ragbundle.json`,
        filters: [{ name: "GRAFT Studio session bundle", extensions: ["json"] }],
      });
      if (!target) return null;
      const bundle = buildSessionExportBundle(session, blockCatalog, new Date().toISOString(), composites);
      await mods.fs.writeTextFile(target, JSON.stringify(bundle, null, 2));
      return target;
    },
    [],
  );

  const importSessionBundle = useCallback(async (
    currentCatalog: BlockSpec[],
  ): Promise<{ bundle: SessionExportBundle; warning: BundleCompatibilityWarning | null } | { error: string } | null> => {
    const mods = await tauriModules();
    if (!mods) return null;
    const source = await mods.dialog.open({
      title: "Import session bundle",
      filters: [{ name: "GRAFT Studio session bundle", extensions: ["json"] }],
    });
    if (!source || Array.isArray(source)) return null;
    // The user can point this dialog at ANY file — a parse failure or a
    // wrong-shape JSON must come back as a result the caller can toast,
    // not escape as an unhandled rejection out of a void-ed onClick.
    let bundle: SessionExportBundle;
    try {
      bundle = JSON.parse(await mods.fs.readTextFile(source)) as SessionExportBundle;
    } catch {
      return { error: `"${source}" is not a valid session bundle (could not parse JSON)` };
    }
    if (
      bundle?.exportSchemaVersion !== SESSION_BUNDLE_SCHEMA_VERSION ||
      !Array.isArray(bundle.session?.blocks) ||
      !Array.isArray(bundle.session?.wires) ||
      !Array.isArray(bundle.blockCatalogSnapshot)
    ) {
      return { error: `"${source}" is not a valid session bundle (missing schema fields)` };
    }
    return { bundle, warning: checkBundleCompatibility(bundle, currentCatalog) };
  }, []);

  const exportRunReport = useCallback(async (record: RunRecord): Promise<string | null> => {
    const mods = await tauriModules();
    if (!mods) return null;
    const target = await mods.dialog.save({
      title: "Export run report",
      defaultPath: `run-report-${record.id}.html`,
      filters: [{ name: "HTML report", extensions: ["html"] }],
    });
    if (!target) return null;
    const html = await buildRunReportHtml(record, new Date().toISOString());
    await mods.fs.writeTextFile(target, html);
    return target;
  }, []);

  return {
    available,
    getRecentProjects,
    createProject,
    openProjectAt,
    openProjectDialog,
    getProjectFile,
    updateProjectCorpus,
    importCorpus,
    resolveProjectPath,
    readProjectJson,
    listSessions,
    loadSession,
    saveSession,
    createSampleProject,
    ensureSampleData,
    saveDraft,
    loadDraft,
    hasDraft,
    deleteDraft,
    saveRunRecord,
    listRunRecords,
    loadRunRecord,
    saveComposite,
    listComposites,
    deleteComposite,
    exportSessionBundle,
    importSessionBundle,
    exportRunReport,
  };
}
