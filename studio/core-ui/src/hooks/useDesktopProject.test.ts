import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDesktopProject } from "./useDesktopProject";
import type { SessionDoc, LoadSessionResult, RunRecord, CorpusEntry, ProjectFile } from "./useDesktopProject";
import type { CompositeDef } from "../utils/composite";
import type { BlockSpec } from "../types/graph";
import type { SessionExportBundle, BundleCompatibilityWarning } from "../utils/sessionBundle";

/**
 * No GUI-automation path exists in this environment to click through the
 * real desktop shell (Tauri dialogs are native, out of DOM reach). This
 * suite is the real verification for B-M1's file-model logic instead of a
 * screenshot: an in-memory fake filesystem + dialog queue standing in for
 * the four Tauri modules the hook talks to, exercising the actual
 * createProject/openProjectAt/saveSession/loadSession/listSessions code
 * paths end to end.
 */

const files = new Map<string, string>();
const dirs = new Set<string>();
// Task 10's importCorpus does a multi-select JSON pick, so the queue now
// also carries string[] (multi-pick) entries alongside the existing
// single-path/null (cancel) ones every other dialog call uses.
let dialogQueue: Array<string | string[] | null> = [];
// B-M6 sample project: records every copyFile(from, to) call so the test can
// assert the bundled ecma404 resource files land under datasets/ecma404/
// without needing a real Tauri resource dir to copy from.
let copiedFiles: Array<{ from: string; to: string }> = [];

function resetFakeFs() {
  files.clear();
  dirs.clear();
  dialogQueue = [];
  copiedFiles = [];
}

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/path", () => ({
  appLocalDataDir: async () => "/appdata",
  join: async (...parts: string[]) => parts.join("/"),
  // Stands in for the real Tauri resource resolver (Task 7 bundles the
  // sample corpus under sample-data/ecma404/ in the packaged app).
  resolveResource: async (resourcePath: string) => `/resources/${resourcePath}`,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: async () => dialogQueue.shift() ?? null,
  save: async () => dialogQueue.shift() ?? null,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async (path: string) => files.has(path) || dirs.has(path),
  readTextFile: async (path: string) => {
    if (!files.has(path)) throw new Error(`not found: ${path}`);
    return files.get(path)!;
  },
  writeTextFile: async (path: string, content: string) => {
    files.set(path, content);
  },
  mkdir: async (path: string) => {
    dirs.add(path);
  },
  remove: async (path: string) => {
    files.delete(path);
    dirs.delete(path);
  },
  readDir: async (path: string) => {
    const prefix = `${path}/`;
    return [...files.keys()]
      .filter((f) => f.startsWith(prefix) && !f.slice(prefix.length).includes("/"))
      .map((f) => ({ name: f.slice(prefix.length), isFile: true, isDirectory: false, isSymlink: false }));
  },
  copyFile: async (from: string, to: string) => {
    copiedFiles.push({ from, to });
    // Real Tauri copyFile duplicates actual bytes; the B-M6 sample-project
    // tests never seed a fake source file (they copy from a resolveResource
    // path that only exists in the real packaged app) so they rely on the
    // `<copied:...>` placeholder. Task 10's importCorpus needs classify-by-
    // read to see the real JSON it just copied, so prefer real content when
    // the fake fs actually has it and fall back to the placeholder only when
    // it doesn't.
    files.set(to, files.has(from) ? files.get(from)! : `<copied:${from}>`);
  },
}));

async function readyHook() {
  const { result } = renderHook(() => useDesktopProject());
  await waitFor(() => expect(result.current.available).toBe(true));
  return result;
}

describe("useDesktopProject", () => {
  beforeEach(resetFakeFs);

  it("starts null then resolves available once isTauri() is checked", async () => {
    const { result } = renderHook(() => useDesktopProject());
    expect(result.current.available).toBeNull();
    await waitFor(() => expect(result.current.available).toBe(true));
  });

  it("createProject writes project.json + sessions/runs/datasets and records a recent entry", async () => {
    dialogQueue = ["/parent"];
    const result = await readyHook();

    let dir: string | null = null;
    await act(async () => {
      dir = await result.current.createProject("my-proj");
    });

    expect(dir).toBe("/parent/my-proj");
    expect(dirs.has("/parent/my-proj")).toBe(true);
    expect(dirs.has("/parent/my-proj/sessions")).toBe(true);
    expect(dirs.has("/parent/my-proj/runs")).toBe(true);
    expect(dirs.has("/parent/my-proj/datasets")).toBe(true);

    const project = JSON.parse(files.get("/parent/my-proj/project.json")!);
    expect(project.name).toBe("my-proj");
    expect(project.corpus).toEqual([]);

    const recents = JSON.parse(files.get("/appdata/recent-projects.json")!);
    expect(recents[0]).toMatchObject({ path: "/parent/my-proj", name: "my-proj" });
  });

  it("createProject returns null when the folder dialog is cancelled", async () => {
    dialogQueue = [null];
    const result = await readyHook();

    let dir: string | null = "unset";
    await act(async () => {
      dir = await result.current.createProject("abandoned");
    });

    expect(dir).toBeNull();
    expect(files.has("/parent/abandoned/project.json")).toBe(false);
  });

  it("createSampleProject copies bundle into datasets/, registers corpus, writes two sessions", async () => {
    dialogQueue = ["/parent"];
    const result = await readyHook();

    let dir: string | null = null;
    await act(async () => {
      dir = await result.current.createSampleProject("graft-sample");
    });

    expect(dir).toBe("/parent/graft-sample");
    expect(copiedFiles).toEqual(
      expect.arrayContaining([expect.objectContaining({ to: expect.stringContaining("datasets/ecma404/ecma404_json.pdf") })]),
    );
    const project = JSON.parse(files.get(`${dir}/project.json`)!);
    expect(project.corpus[0].id).toBe("ecma404");
    expect([...files.keys()]).toEqual(
      expect.arrayContaining([
        expect.stringContaining("sessions/eval-demo.ragsession"),
        expect.stringContaining("sessions/generation-demo.ragsession"),
      ]),
    );
  });

  it("createSampleProject returns null when the folder dialog is cancelled", async () => {
    dialogQueue = [null];
    const result = await readyHook();

    let dir: string | null = "unset";
    await act(async () => {
      dir = await result.current.createSampleProject("graft-sample");
    });

    expect(dir).toBeNull();
    expect(copiedFiles).toEqual([]);
  });

  it("ensureSampleData copies the bundle into datasets/ecma404 and registers the corpus entry", async () => {
    dirs.add("/proj");
    files.set("/proj/project.json", JSON.stringify({ name: "p", created: "t", corpus: [] }));
    const result = await readyHook();

    await act(async () => {
      await result.current.ensureSampleData("/proj");
    });

    expect(copiedFiles).toHaveLength(5);
    expect(copiedFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "/resources/sample-data/ecma404/bridges_ecma404_json_full.json",
          to: "/proj/datasets/ecma404/bridges_ecma404_json_full.json",
        }),
      ]),
    );
    const project = JSON.parse(files.get("/proj/project.json")!);
    expect(project.corpus).toHaveLength(1);
    expect(project.corpus[0].id).toBe("ecma404");
  });

  it("ensureSampleData is idempotent: second call copies nothing new and keeps one corpus entry", async () => {
    dirs.add("/proj");
    files.set("/proj/project.json", JSON.stringify({ name: "p", created: "t", corpus: [] }));
    const result = await readyHook();

    await act(async () => {
      await result.current.ensureSampleData("/proj");
      await result.current.ensureSampleData("/proj");
    });

    expect(copiedFiles).toHaveLength(5); // not 10
    const project = JSON.parse(files.get("/proj/project.json")!);
    expect(project.corpus).toHaveLength(1);
  });

  it("ensureSampleData leaves other corpus entries in place", async () => {
    dirs.add("/proj");
    const other = { id: "mydoc", label: "My Doc", pdf: "datasets/mydoc/mydoc.pdf" };
    files.set("/proj/project.json", JSON.stringify({ name: "p", created: "t", corpus: [other] }));
    const result = await readyHook();

    await act(async () => {
      await result.current.ensureSampleData("/proj");
    });

    const project = JSON.parse(files.get("/proj/project.json")!);
    expect(project.corpus.map((c: { id: string }) => c.id)).toEqual(["mydoc", "ecma404"]);
  });

  it("openProjectAt returns the parsed project for a valid folder", async () => {
    dirs.add("/existing");
    files.set("/existing/project.json", JSON.stringify({ name: "existing", created: "t", corpus: [] }));
    const result = await readyHook();

    let project: Awaited<ReturnType<typeof result.current.openProjectAt>> = null;
    await act(async () => {
      project = await result.current.openProjectAt("/existing");
    });

    expect(project).toEqual({ name: "existing", created: "t", corpus: [] });
  });

  it("openProjectAt returns null for a folder with no project.json", async () => {
    const result = await readyHook();
    let project: unknown = "unset";
    await act(async () => {
      project = await result.current.openProjectAt("/not-a-project");
    });
    expect(project).toBeNull();
  });

  it("saveSession then loadSession round-trips the graph doc including viewport", async () => {
    const result = await readyHook();
    const doc: SessionDoc = {
      schema_version: 1,
      name: "test-session",
      blocks: [],
      wires: [],
      meta: { created: "t", modified: "t", notes: "" },
      viewport: { x: 12, y: -4, zoom: 1.5 },
    };

    await act(async () => {
      await result.current.saveSession("/proj", "main", doc);
    });
    expect(files.get("/proj/sessions/main.ragsession")).toBeDefined();

    let loaded: LoadSessionResult | null = null;
    await act(async () => {
      loaded = await result.current.loadSession("/proj", "main");
    });
    expect(loaded).toEqual({ status: "ok", doc });
  });

  it("loadSession reports not_found when the session file doesn't exist", async () => {
    const result = await readyHook();
    let loaded: LoadSessionResult | null = null;
    await act(async () => {
      loaded = await result.current.loadSession("/proj", "missing");
    });
    expect(loaded).toEqual({ status: "not_found" });
  });

  it("loadSession reports corrupt for unparseable JSON without throwing", async () => {
    files.set("/proj/sessions/broken.ragsession", "{not valid json");
    const result = await readyHook();
    let loaded: LoadSessionResult | null = null;
    await act(async () => {
      loaded = await result.current.loadSession("/proj", "broken");
    });
    expect(loaded).toEqual({ status: "corrupt", raw: "{not valid json" });
  });

  it("saveDraft/loadDraft/hasDraft/deleteDraft manage the sibling .draft file", async () => {
    const result = await readyHook();
    const doc: SessionDoc = {
      schema_version: 1,
      name: "draft-doc",
      blocks: [],
      wires: [],
      meta: { created: "t", modified: "t", notes: "" },
    };

    let has = await result.current.hasDraft("/proj", "main");
    expect(has).toBe(false);

    await act(async () => {
      await result.current.saveDraft("/proj", "main", doc);
    });
    expect(files.get("/proj/sessions/main.ragsession.draft")).toBeDefined();

    has = await result.current.hasDraft("/proj", "main");
    expect(has).toBe(true);

    let loaded: SessionDoc | null = null;
    await act(async () => {
      loaded = await result.current.loadDraft("/proj", "main");
    });
    expect(loaded).toEqual(doc);

    await act(async () => {
      await result.current.deleteDraft("/proj", "main");
    });
    expect(files.has("/proj/sessions/main.ragsession.draft")).toBe(false);
    expect(await result.current.hasDraft("/proj", "main")).toBe(false);
  });

  it("listSessions returns only .ragsession files with the extension stripped", async () => {
    dirs.add("/proj/sessions");
    files.set("/proj/sessions/main.ragsession", "{}");
    files.set("/proj/sessions/experiment.ragsession", "{}");
    files.set("/proj/sessions/notes.txt", "not a session");
    const result = await readyHook();

    let names: string[] = [];
    await act(async () => {
      names = await result.current.listSessions("/proj");
    });
    expect(names.sort()).toEqual(["experiment", "main"]);
  });

  it("listSessions returns an empty list when the sessions folder doesn't exist yet", async () => {
    const result = await readyHook();
    let names: string[] = ["unset"];
    await act(async () => {
      names = await result.current.listSessions("/brand-new-proj");
    });
    expect(names).toEqual([]);
  });

  describe("run history (B-M3)", () => {
    function record(id: string, ok = true): RunRecord {
      return {
        id,
        timestamp: "2026-07-09T00:00:00.000Z",
        graph: { schema_version: 1, name: "g", blocks: [], wires: [], meta: { created: "t", modified: "t", notes: "" } },
        ok,
        failedBlock: ok ? null : "b1",
        order: ["b1"],
        artifacts: { b1: { out: { type: "chunks", ref: "chunks:abc", meta: { count: 5 } } } },
      };
    }

    it("saveRunRecord then listRunRecords/loadRunRecord round-trips, newest first", async () => {
      const result = await readyHook();
      await act(async () => {
        await result.current.saveRunRecord("/proj", "main", record("2026-07-09T00-00-00-000Z"));
        await result.current.saveRunRecord("/proj", "main", record("2026-07-09T00-05-00-000Z", false));
      });

      let ids: string[] = [];
      await act(async () => {
        ids = await result.current.listRunRecords("/proj", "main");
      });
      expect(ids).toEqual(["2026-07-09T00-05-00-000Z", "2026-07-09T00-00-00-000Z"]);

      let loaded: RunRecord | null = null;
      await act(async () => {
        loaded = await result.current.loadRunRecord("/proj", "main", ids[0]);
      });
      expect(loaded).toEqual(record("2026-07-09T00-05-00-000Z", false));
    });

    it("scopes run records per tab", async () => {
      const result = await readyHook();
      await act(async () => {
        await result.current.saveRunRecord("/proj", "alpha", record("r1"));
        await result.current.saveRunRecord("/proj", "beta", record("r2"));
      });
      let alphaIds: string[] = [];
      let betaIds: string[] = [];
      await act(async () => {
        alphaIds = await result.current.listRunRecords("/proj", "alpha");
        betaIds = await result.current.listRunRecords("/proj", "beta");
      });
      expect(alphaIds).toEqual(["r1"]);
      expect(betaIds).toEqual(["r2"]);
    });

    it("listRunRecords returns empty for a tab with no runs yet", async () => {
      const result = await readyHook();
      let ids: string[] = ["unset"];
      await act(async () => {
        ids = await result.current.listRunRecords("/proj", "never-run");
      });
      expect(ids).toEqual([]);
    });
  });

  describe("composite blocks (B-M4)", () => {
    function composite(id: string, label = "My Composite"): CompositeDef {
      return {
        id,
        label,
        blocks: [{ id: "a1", type: "chunks_import", position: { x: 0, y: 0 }, params: {} }],
        wires: [],
        exposedInputs: [],
        exposedOutputs: [{ block: "a1", port: "chunks", type: "chunks", label: "chunks" }],
      };
    }

    it("saveComposite then listComposites round-trips", async () => {
      const result = await readyHook();
      await act(async () => {
        await result.current.saveComposite("/proj", composite("c1"));
        await result.current.saveComposite("/proj", composite("c2", "Other"));
      });

      let defs: CompositeDef[] = [];
      await act(async () => {
        defs = await result.current.listComposites("/proj");
      });
      expect(defs.map((d) => d.id).sort()).toEqual(["c1", "c2"]);
      expect(defs.find((d) => d.id === "c1")).toEqual(composite("c1"));
    });

    it("listComposites returns empty when the blocks dir doesn't exist yet", async () => {
      const result = await readyHook();
      let defs: CompositeDef[] = [composite("stale")];
      await act(async () => {
        defs = await result.current.listComposites("/proj");
      });
      expect(defs).toEqual([]);
    });

    it("deleteComposite removes only the targeted file", async () => {
      const result = await readyHook();
      await act(async () => {
        await result.current.saveComposite("/proj", composite("c1"));
        await result.current.saveComposite("/proj", composite("c2"));
        await result.current.deleteComposite("/proj", "c1");
      });
      let defs: CompositeDef[] = [];
      await act(async () => {
        defs = await result.current.listComposites("/proj");
      });
      expect(defs.map((d) => d.id)).toEqual(["c2"]);
    });

    it("saveComposite overwrites an existing composite with the same id", async () => {
      const result = await readyHook();
      await act(async () => {
        await result.current.saveComposite("/proj", composite("c1", "First"));
        await result.current.saveComposite("/proj", composite("c1", "Renamed"));
      });
      let defs: CompositeDef[] = [];
      await act(async () => {
        defs = await result.current.listComposites("/proj");
      });
      expect(defs).toHaveLength(1);
      expect(defs[0].label).toBe("Renamed");
    });
  });

  describe("sharing & export (B-M5)", () => {
    const spec: BlockSpec = {
      type: "pdf_import",
      category: "sources",
      cost: "free",
      label: "PDF Source",
      subtitle: "",
      purpose: "",
      inputs: [],
      outputs: [],
      defaultParams: [],
      backing: "engine:pdf_import",
    };
    const session: SessionDoc = {
      schema_version: 1,
      name: "my-session",
      blocks: [{ id: "n1", type: "pdf_import", position: { x: 0, y: 0 }, params: {} }],
      wires: [],
      meta: { created: "t", modified: "t", notes: "" },
    };

    it("exportSessionBundle writes a bundle to the dialog-chosen path and returns it", async () => {
      dialogQueue = ["/out/my-session.ragbundle.json"];
      const result = await readyHook();
      let path: string | null = null;
      await act(async () => {
        path = await result.current.exportSessionBundle(session, [spec]);
      });
      expect(path).toBe("/out/my-session.ragbundle.json");
      const written = JSON.parse(files.get("/out/my-session.ragbundle.json")!);
      expect(written.session.name).toBe("my-session");
      expect(written.blockCatalogSnapshot).toEqual([{ type: "pdf_import", category: "sources", cost: "free", label: "PDF Source" }]);
    });

    it("exportSessionBundle returns null without writing anything when the save dialog is cancelled", async () => {
      dialogQueue = [null];
      const result = await readyHook();
      let path: string | null = "unset";
      await act(async () => {
        path = await result.current.exportSessionBundle(session, [spec]);
      });
      expect(path).toBeNull();
      expect(files.size).toBe(0);
    });

    it("importSessionBundle reads back an exported bundle with no compatibility warning when the catalog is unchanged", async () => {
      dialogQueue = ["/out/b.json"];
      const result = await readyHook();
      await act(async () => {
        await result.current.exportSessionBundle(session, [spec]);
      });
      dialogQueue = ["/out/b.json"];
      let imported: { bundle: SessionExportBundle; warning: BundleCompatibilityWarning | null } | { error: string } | null = null;
      await act(async () => {
        imported = await result.current.importSessionBundle([spec]);
      });
      // TS narrows `imported` to `never` here (a known quirk with `let`
      // variables reassigned inside an async act() closure) -- re-asserting
      // the type via `as` sidesteps it without weakening the actual check.
      const got = imported as { bundle: SessionExportBundle; warning: BundleCompatibilityWarning | null } | null;
      expect(got?.bundle.session.name).toBe("my-session");
      expect(got?.warning).toBeNull();
    });

    it("importSessionBundle surfaces a compatibility warning when the imported graph uses a block type no longer in the catalog", async () => {
      dialogQueue = ["/out/b.json"];
      const result = await readyHook();
      await act(async () => {
        await result.current.exportSessionBundle(session, [spec]);
      });
      dialogQueue = ["/out/b.json"];
      let imported: { bundle: SessionExportBundle; warning: BundleCompatibilityWarning | null } | { error: string } | null = null;
      await act(async () => {
        imported = await result.current.importSessionBundle([]); // pdf_import no longer exists
      });
      const got = imported as { bundle: SessionExportBundle; warning: BundleCompatibilityWarning | null } | null;
      expect(got?.warning?.missingTypes).toEqual(["pdf_import"]);
    });

    it("exportRunReport writes a self-contained HTML file to the dialog-chosen path", async () => {
      dialogQueue = ["/out/report.html"];
      const result = await readyHook();
      const record: RunRecord = {
        id: "r1",
        timestamp: "2026-07-09T00:00:00.000Z",
        graph: { schema_version: 1, name: "my-session", blocks: [], wires: [], meta: { created: "t", modified: "t", notes: "" } },
        ok: true,
        failedBlock: null,
        order: ["n1"],
        artifacts: { n1: { pdf: { type: "pdf", ref: "pdf:abc", meta: {} } } },
      };
      let path: string | null = null;
      await act(async () => {
        path = await result.current.exportRunReport(record);
      });
      expect(path).toBe("/out/report.html");
      const html = files.get("/out/report.html")!;
      expect(html).toContain("my-session");
      expect(html).toContain("<!doctype html>");
    });
  });
});

describe("sharing & export — hardening fixes", () => {
  const spec2: BlockSpec = {
    type: "pdf_import",
    category: "sources",
    cost: "free",
    label: "PDF Source",
    subtitle: "",
    purpose: "",
    inputs: [],
    outputs: [],
    defaultParams: [],
    backing: "engine:pdf_import",
  };

  it("importSessionBundle returns an error result (not a thrown rejection) for a non-JSON file", async () => {
    files.set("/shared/garbage.json", "this is not json {{{");
    dialogQueue = ["/shared/garbage.json"];
    const result = await readyHook();
    let imported: unknown = "unset";
    await act(async () => {
      imported = await result.current.importSessionBundle([spec2]);
    });
    expect(imported).toEqual({ error: expect.stringContaining("not a valid session bundle") });
  });

  it("importSessionBundle returns an error result for valid JSON that is not bundle-shaped", async () => {
    files.set("/shared/wrong-shape.json", JSON.stringify({ hello: "world" }));
    dialogQueue = ["/shared/wrong-shape.json"];
    const result = await readyHook();
    let imported: unknown = "unset";
    await act(async () => {
      imported = await result.current.importSessionBundle([spec2]);
    });
    expect(imported).toEqual({ error: expect.stringContaining("not a valid session bundle") });
  });

  it("exportSessionBundle embeds the composite defs the session uses", async () => {
    dialogQueue = ["/out/with-composite.json"];
    const result = await readyHook();
    const compositeDef: CompositeDef = {
      id: "composite-abc",
      label: "My Composite",
      blocks: [{ id: "a1", type: "chunker", position: { x: 0, y: 0 }, params: {} }],
      wires: [],
      exposedInputs: [],
      exposedOutputs: [{ block: "a1", port: "chunks", type: "chunks", label: "chunks" }],
    };
    const sessionWithComposite: SessionDoc = {
      schema_version: 1,
      name: "s",
      blocks: [{ id: "n1", type: "composite-abc", position: { x: 0, y: 0 }, params: {} }],
      wires: [],
      meta: { created: "t", modified: "t", notes: "" },
    };
    await act(async () => {
      await result.current.exportSessionBundle(sessionWithComposite, [spec2], [compositeDef]);
    });
    const written = JSON.parse(files.get("/out/with-composite.json")!);
    expect(written.composites).toEqual([compositeDef]);
  });
});

describe("corpus registry & import (Task 10)", () => {
  beforeEach(resetFakeFs);

  const factsJson = JSON.stringify([{ fact_id: "f1", text: "The sky is blue.", bboxes: [[0, 0, 1, 1]] }]);
  const chunksJson = JSON.stringify([{ chunk_id: "c1", text: "Some chunk text.", page: 1 }]);
  const qaJson = JSON.stringify([{ qa_id: "q1", question: "What?", answer: "This." }]);
  const unknownJson = JSON.stringify({ hello: "world" });

  function seedProject(dir: string, corpus: CorpusEntry[] = []) {
    dirs.add(dir);
    const project: ProjectFile = { name: "proj", created: "t", corpus };
    files.set(`${dir}/project.json`, JSON.stringify(project, null, 2));
  }

  it("getProjectFile reads project.json without touching the recents list", async () => {
    seedProject("/proj");
    const result = await readyHook();

    let project: ProjectFile | null = null;
    await act(async () => {
      project = await result.current.getProjectFile("/proj");
    });

    expect(project).toEqual({ name: "proj", created: "t", corpus: [] });
    expect(files.has("/appdata/recent-projects.json")).toBe(false);
  });

  it("getProjectFile returns null for a folder with no project.json", async () => {
    const result = await readyHook();
    let project: ProjectFile | null = { name: "x", created: "t", corpus: [] };
    await act(async () => {
      project = await result.current.getProjectFile("/nope");
    });
    expect(project).toBeNull();
  });

  it("importCorpus copies the picked PDF into datasets/<slug>/, classifies the JSON multi-pick, and appends the corpus entry to project.json", async () => {
    seedProject("/proj");
    files.set("/picked/ECMA 404.pdf", "%PDF-1.4 fake pdf bytes");
    files.set("/picked/facts_ecma404.json", factsJson);
    files.set("/picked/chunks_ecma404.json", chunksJson);
    files.set("/picked/qa_ecma404.json", qaJson);
    dialogQueue = ["/picked/ECMA 404.pdf", ["/picked/facts_ecma404.json", "/picked/chunks_ecma404.json", "/picked/qa_ecma404.json"]];
    const result = await readyHook();

    let imported: Awaited<ReturnType<typeof result.current.importCorpus>> = null;
    await act(async () => {
      imported = await result.current.importCorpus("/proj");
    });

    const got = imported as unknown as { entry: CorpusEntry; skipped: string[] };
    expect(got.entry).toEqual({
      id: "ecma-404",
      label: "ECMA 404",
      pdf: "datasets/ecma-404/ECMA 404.pdf",
      facts: "datasets/ecma-404/facts_ecma404.json",
      chunks: "datasets/ecma-404/chunks_ecma404.json",
      qa: "datasets/ecma-404/qa_ecma404.json",
    });
    expect(got.skipped).toEqual([]);
    expect(copiedFiles).toEqual(
      expect.arrayContaining([expect.objectContaining({ to: "/proj/datasets/ecma-404/ECMA 404.pdf" })]),
    );

    const project = JSON.parse(files.get("/proj/project.json")!) as ProjectFile;
    expect(project.corpus).toEqual([got.entry]);
  });

  it("importCorpus copies but does not attach a JSON file whose content shape is unrecognized, reporting it in skipped instead of erroring", async () => {
    seedProject("/proj");
    files.set("/picked/doc.pdf", "%PDF-1.4");
    files.set("/picked/mystery.json", unknownJson);
    dialogQueue = ["/picked/doc.pdf", ["/picked/mystery.json"]];
    const result = await readyHook();

    let imported: Awaited<ReturnType<typeof result.current.importCorpus>> = null;
    await act(async () => {
      imported = await result.current.importCorpus("/proj");
    });

    const got = imported as unknown as { entry: CorpusEntry; skipped: string[] };
    expect(got.entry.facts).toBeUndefined();
    expect(got.entry.chunks).toBeUndefined();
    expect(got.entry.qa).toBeUndefined();
    expect(got.skipped).toEqual(["mystery.json"]);
    // Copied to disk even though unattached — partial import is honest, not silent data loss.
    expect(files.has("/proj/datasets/doc/mystery.json")).toBe(true);
  });

  it("importCorpus with no JSON multi-pick (cancelled) still registers the PDF-only entry", async () => {
    seedProject("/proj");
    files.set("/picked/doc.pdf", "%PDF-1.4");
    dialogQueue = ["/picked/doc.pdf", null];
    const result = await readyHook();

    let imported: Awaited<ReturnType<typeof result.current.importCorpus>> = null;
    await act(async () => {
      imported = await result.current.importCorpus("/proj");
    });

    const got = imported as unknown as { entry: CorpusEntry; skipped: string[] };
    expect(got.entry).toEqual({ id: "doc", label: "doc", pdf: "datasets/doc/doc.pdf" });
    expect(got.skipped).toEqual([]);
  });

  it("importCorpus returns null when the PDF pick dialog is cancelled", async () => {
    seedProject("/proj");
    dialogQueue = [null];
    const result = await readyHook();

    let imported: Awaited<ReturnType<typeof result.current.importCorpus>> = "unset" as unknown as null;
    await act(async () => {
      imported = await result.current.importCorpus("/proj");
    });

    expect(imported).toBeNull();
    expect(copiedFiles).toEqual([]);
  });

  it("importCorpus returns {error} when the picked file is not a PDF", async () => {
    seedProject("/proj");
    files.set("/picked/notes.txt", "hello");
    dialogQueue = ["/picked/notes.txt"];
    const result = await readyHook();

    let imported: Awaited<ReturnType<typeof result.current.importCorpus>> = null;
    await act(async () => {
      imported = await result.current.importCorpus("/proj");
    });

    expect(imported).toEqual({ error: expect.stringContaining("not a PDF") });
    expect(copiedFiles).toEqual([]);
  });

  it("importCorpus gives a duplicate slug a -2 suffix instead of colliding with the existing corpus entry", async () => {
    seedProject("/proj", [{ id: "doc", label: "doc", pdf: "datasets/doc/doc.pdf" }]);
    files.set("/picked/doc.pdf", "%PDF-1.4");
    dialogQueue = ["/picked/doc.pdf", null];
    const result = await readyHook();

    let imported: Awaited<ReturnType<typeof result.current.importCorpus>> = null;
    await act(async () => {
      imported = await result.current.importCorpus("/proj");
    });

    const got = imported as unknown as { entry: CorpusEntry; skipped: string[] };
    expect(got.entry.id).toBe("doc-2");
    expect(got.entry.pdf).toBe("datasets/doc-2/doc.pdf");

    const project = JSON.parse(files.get("/proj/project.json")!) as ProjectFile;
    expect(project.corpus.map((c) => c.id)).toEqual(["doc", "doc-2"]);
  });

  it("updateProjectCorpus overwrites the corpus array in project.json", async () => {
    seedProject("/proj", [{ id: "old", label: "Old", pdf: "datasets/old/old.pdf" }]);
    const result = await readyHook();
    const next: CorpusEntry[] = [{ id: "new", label: "New", pdf: "datasets/new/new.pdf" }];

    await act(async () => {
      await result.current.updateProjectCorpus("/proj", next);
    });

    const project = JSON.parse(files.get("/proj/project.json")!) as ProjectFile;
    expect(project.corpus).toEqual(next);
  });
});
