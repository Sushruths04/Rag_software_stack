import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { PortDragProvider } from "../state/portDragContext";
import { StudioShell } from "./StudioShell";
import { TEMPLATES } from "../data/templates";
import type { SessionDoc } from "../hooks/useDesktopProject";

/**
 * B-M1 project/session file model, exercised through StudioShell (not just
 * the hook in isolation) so the actual "create project -> seed from
 * template -> save -> reopen" accept criterion from
 * 03_PHASE2_SOFTWARE_PLAN.md is verified end to end. No GUI-automation path
 * exists to click through the real Tauri window in this environment, so
 * this — a real render with a fake filesystem standing in for the four
 * Tauri modules — is the actual verification, not a screenshot.
 */

const files = new Map<string, string>();
const dirs = new Set<string>();

function resetFakeFs() {
  files.clear();
  dirs.clear();
  dialogQueue = [];
}

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
// StudioShell also mounts useDesktopMenuCommands, which listens for native
// menu events once isTauri() is true — stub it out so mounting doesn't hit
// the real (unavailable in jsdom) Tauri event bridge.
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => undefined }));
vi.mock("@tauri-apps/api/path", () => ({
  appLocalDataDir: async () => "/appdata",
  join: async (...parts: string[]) => parts.join("/"),
}));
let dialogQueue: Array<string | null> = [];
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
}));

function renderShell(props: { projectDir?: string | null; initialTemplate?: (typeof TEMPLATES)[number] | null }) {
  return render(
    <ReactFlowProvider>
      <PortDragProvider>
        <StudioShell projectDir={props.projectDir} initialTemplate={props.initialTemplate} />
      </PortDragProvider>
    </ReactFlowProvider>,
  );
}

// handleUseTemplate's hydration reaches its final visible block count before
// the trailing setEdges(allEdges) call lands (still awaiting the last
// per-block sleep(60)) — block count alone is not "hydration done". Waiting
// for this "ready" console line (not .wire-path DOM count, which jsdom can't
// reliably render without real layout) avoids racing that trailing update.
async function waitForTemplateReady(templateName: string) {
  const escaped = templateName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await screen.findByText(new RegExp(`template "${escaped}" ready`));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetFakeFs();
});

describe("StudioShell — B-M1 project/session file model", () => {
  it("seeds a fresh project's canvas from the chosen template", async () => {
    const template = TEMPLATES.find((t) => t.id === "sample-b")!;
    renderShell({ projectDir: "/proj", initialTemplate: template });

    await waitFor(
      () => expect(document.querySelectorAll(".block-node")).toHaveLength(template.graph.blocks.length),
      { timeout: 3000 },
    );
    expect(await screen.findByText(template.graph.name)).toBeInTheDocument();
  });

  it("seeds a blank canvas when the project was created without a template", async () => {
    renderShell({ projectDir: "/proj", initialTemplate: null });

    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(0));
    expect(await screen.findByText("untitled")).toBeInTheDocument();
  });

  it("Save writes a real .ragsession file (not a backend call) with a viewport", async () => {
    globalThis.fetch = vi.fn(() => {
      throw new Error("Save must not call the backend while a project is open");
    });
    renderShell({ projectDir: "/proj", initialTemplate: null });
    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(0));

    fireEvent.click(screen.getByTitle("Save the current graph to the backend"));

    await waitFor(() => expect(files.has("/proj/sessions/main.ragsession")).toBe(true));
    const saved = JSON.parse(files.get("/proj/sessions/main.ragsession")!) as SessionDoc;
    expect(saved.name).toBe("untitled");
    expect(saved.viewport).toBeDefined();
    expect(typeof saved.viewport!.zoom).toBe("number");
  });

  it("reopening an existing project auto-loads its saved session, including the viewport", async () => {
    const template = TEMPLATES.find((t) => t.id === "sample-a")!;
    const savedDoc: SessionDoc = {
      ...template.graph,
      name: "reopened-session",
      viewport: { x: 40, y: -20, zoom: 0.8 },
    };
    dirs.add("/existing-proj/sessions");
    files.set("/existing-proj/sessions/main.ragsession", JSON.stringify(savedDoc));

    // initialTemplate omitted entirely -> "reopen an existing project" path
    renderShell({ projectDir: "/existing-proj" });

    await waitFor(
      () => expect(document.querySelectorAll(".block-node")).toHaveLength(savedDoc.blocks.length),
      { timeout: 3000 },
    );
    expect(await screen.findByText("reopened-session")).toBeInTheDocument();

    await waitFor(() => {
      const viewportEl = document.querySelector(".react-flow__viewport") as HTMLElement | null;
      expect(viewportEl?.style.transform).toContain("0.8");
    });
  });

  it("shows nothing was saved yet for a newly created (never-saved) project on reopen", async () => {
    dirs.add("/fresh-proj");
    renderShell({ projectDir: "/fresh-proj" });
    expect(await screen.findByText(/no saved "main" session yet/i)).toBeInTheDocument();
  });

  it("does not open the template-picker invitation over a reopened session that has blocks", async () => {
    const template = TEMPLATES.find((t) => t.id === "sample-a")!;
    dirs.add("/reopen-full/sessions");
    files.set("/reopen-full/sessions/main.ragsession", JSON.stringify({ ...template.graph, name: "full-session" }));

    renderShell({ projectDir: "/reopen-full" });

    await waitFor(
      () => expect(document.querySelectorAll(".block-node")).toHaveLength(template.graph.blocks.length),
      { timeout: 3000 },
    );
    expect(await screen.findByText("full-session")).toBeInTheDocument();

    // Give React time to flush any deferred passive effects — the bug this
    // guards against opened the picker from the reopen effect's finally
    // block AFTER the session had already landed on the canvas.
    await new Promise((r) => setTimeout(r, 150));
    expect(screen.queryByRole("dialog", { name: "Choose a template" })).not.toBeInTheDocument();
  });

  it("opens the template-picker invitation when the reopened session is empty (0 blocks)", async () => {
    dirs.add("/reopen-empty/sessions");
    files.set(
      "/reopen-empty/sessions/main.ragsession",
      JSON.stringify({
        schema_version: 1,
        name: "empty-session",
        meta: { created: "", modified: "", notes: "" },
        blocks: [],
        wires: [],
      }),
    );

    renderShell({ projectDir: "/reopen-empty" });

    expect(await screen.findByRole("dialog", { name: "Choose a template" })).toBeInTheDocument();
    expect(document.querySelectorAll(".block-node")).toHaveLength(0);
  });
});

describe("StudioShell — B-M1 session tabs", () => {
  it("reopening a project with multiple sessions shows a tab per file and loads the first", async () => {
    const template = TEMPLATES.find((t) => t.id === "sample-a")!;
    dirs.add("/multi/sessions");
    files.set("/multi/sessions/alpha.ragsession", JSON.stringify({ ...template.graph, name: "alpha-graph" }));
    files.set("/multi/sessions/beta.ragsession", JSON.stringify({ ...template.graph, name: "beta-graph" }));

    renderShell({ projectDir: "/multi" });

    expect(await screen.findByRole("tab", { name: "alpha" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "beta" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("tab", { name: "alpha" })).toHaveAttribute("aria-selected", "true"));
    expect(await screen.findByText("alpha-graph")).toBeInTheDocument();
  });

  it("marks the active tab dirty on edit and clears the dot on Save", async () => {
    const template = TEMPLATES.find((t) => t.id === "sample-a")!;
    renderShell({ projectDir: "/proj", initialTemplate: template });
    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(template.graph.blocks.length));
    // handleUseTemplate's hydration adds nodes one at a time (A20 stagger),
    // THEN calls setEdges(allEdges) — block count alone isn't "hydration
    // done"; the wires haven't landed in state yet. Without waiting for
    // hydration's own "ready" console line, that trailing setEdges races the
    // immediately-following Save/Auto-layout clicks below and intermittently
    // re-dirties the tab (edges appearing IS a real content change, just one
    // that arrives after this test had already moved on). (.wire-path DOM
    // count isn't a reliable signal here — jsdom doesn't do real layout, so
    // React Flow may not render measured edges at all in this environment.)
    await waitForTemplateReady(template.graph.name);

    // fresh tab is already dirty (never saved) — save it first so the next
    // edit is what we're actually asserting on.
    fireEvent.click(screen.getByTitle("Save the current graph to the backend"));
    await waitFor(() => expect(screen.getByRole("tab", { name: "main" })).toHaveAttribute("title", "main"));

    fireEvent.click(screen.getByTitle("Comb the graph into topological columns (ELK stand-in)"));
    await waitFor(() => expect(screen.getByRole("tab", { name: "main" })).toHaveAttribute("title", "main (unsaved changes)"));

    fireEvent.click(screen.getByTitle("Save the current graph to the backend"));
    await waitFor(() => expect(screen.getByRole("tab", { name: "main" })).toHaveAttribute("title", "main"));
  });

  it("switching tabs preserves each tab's unsaved edits and Save only touches the active tab's file", async () => {
    const template = TEMPLATES.find((t) => t.id === "sample-a")!;
    dirs.add("/multi/sessions");
    files.set("/multi/sessions/alpha.ragsession", JSON.stringify({ ...template.graph, name: "alpha-graph" }));
    files.set("/multi/sessions/beta.ragsession", JSON.stringify({ ...template.graph, name: "beta-graph" }));
    renderShell({ projectDir: "/multi" });
    await screen.findByText("alpha-graph");

    // dirty alpha (auto-layout), switch to beta, switch back — alpha's dirty
    // state (and content) must have survived the round trip in memory.
    fireEvent.click(screen.getByTitle("Comb the graph into topological columns (ELK stand-in)"));
    await waitFor(() => expect(screen.getByRole("tab", { name: "alpha" })).toHaveAttribute("title", "alpha (unsaved changes)"));

    fireEvent.click(screen.getByRole("tab", { name: "beta" }));
    await screen.findByText("beta-graph");
    expect(screen.getByRole("tab", { name: "beta" })).toHaveAttribute("title", "beta");

    fireEvent.click(screen.getByRole("tab", { name: "alpha" }));
    await screen.findByText("alpha-graph");
    expect(screen.getByRole("tab", { name: "alpha" })).toHaveAttribute("title", "alpha (unsaved changes)");

    fireEvent.click(screen.getByTitle("Save the current graph to the backend"));
    await waitFor(() => expect(screen.getByRole("tab", { name: "alpha" })).toHaveAttribute("title", "alpha"));

    // beta was never touched -> its file on disk must be exactly what it was
    const betaRaw = JSON.parse(files.get("/multi/sessions/beta.ragsession")!);
    expect(betaRaw.name).toBe("beta-graph");
  });

  it("New Session opens a new dirty tab without touching the current one", async () => {
    renderShell({ projectDir: "/proj", initialTemplate: null });
    await waitFor(() => expect(screen.getByRole("tab", { name: "main" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    const dialog = screen.getByRole("dialog", { name: "New session" });
    const input = within(dialog).getByRole("textbox");
    fireEvent.change(input, { target: { value: "second-session" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("tab", { name: "second-session" })).toHaveAttribute(
      "title",
      "second-session (unsaved changes)",
    );
    expect(screen.getByRole("tab", { name: "main" })).toBeInTheDocument();
    // template picker opens for the new (now-active, blank) tab
    expect(screen.getByRole("dialog", { name: "Choose a template" })).toBeInTheDocument();
  });

  it("closes a clean tab immediately, and a dirty tab only after confirming", async () => {
    const template = TEMPLATES.find((t) => t.id === "sample-a")!;
    dirs.add("/multi/sessions");
    files.set("/multi/sessions/alpha.ragsession", JSON.stringify({ ...template.graph, name: "alpha-graph" }));
    files.set("/multi/sessions/beta.ragsession", JSON.stringify({ ...template.graph, name: "beta-graph" }));
    renderShell({ projectDir: "/multi" });
    await screen.findByText("alpha-graph");

    // beta is clean (never edited) -> closes with no confirm
    fireEvent.click(screen.getByRole("button", { name: "Close beta" }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: "beta" })).not.toBeInTheDocument());

    // dirty alpha -> confirm required; Cancel keeps it
    fireEvent.click(screen.getByTitle("Comb the graph into topological columns (ELK stand-in)"));
    await waitFor(() => expect(screen.getByRole("tab", { name: "alpha" })).toHaveAttribute("title", "alpha (unsaved changes)"));

    fireEvent.click(screen.getByRole("button", { name: "Close alpha" }));
    const confirmDialog = screen.getByRole("dialog", { name: "Close session" });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("tab", { name: "alpha" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "Close without saving" }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: "alpha" })).not.toBeInTheDocument());
  });
});

describe("StudioShell — B-M1 autosave + crash recovery", () => {
  it("autosaves a draft after the debounce following an edit, and Save deletes it", async () => {
    const template = TEMPLATES.find((t) => t.id === "sample-b")!;
    renderShell({ projectDir: "/proj", initialTemplate: template });
    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(template.graph.blocks.length));
    await waitForTemplateReady(template.graph.name);

    // fresh tab is already dirty from seeding — save first so what follows
    // tests a genuine SUBSEQUENT edit's autosave, not the initial seed.
    fireEvent.click(screen.getByTitle("Save the current graph to the backend"));
    await waitFor(() => expect(files.has("/proj/sessions/main.ragsession")).toBe(true));
    expect(files.has("/proj/sessions/main.ragsession.draft")).toBe(false);

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByTitle("Comb the graph into topological columns (ELK stand-in)"));
      await vi.advanceTimersByTimeAsync(2100);
    } finally {
      vi.useRealTimers();
    }
    expect(files.has("/proj/sessions/main.ragsession.draft")).toBe(true);

    fireEvent.click(screen.getByTitle("Save the current graph to the backend"));
    await waitFor(() => expect(files.has("/proj/sessions/main.ragsession.draft")).toBe(false));
  });

  it("prompts to restore an autosaved draft on reopen; Restore applies it and keeps the tab dirty", async () => {
    const template = TEMPLATES.find((t) => t.id === "sample-a")!;
    const savedDoc: SessionDoc = { ...template.graph, name: "saved-version" };
    const draftDoc: SessionDoc = { ...template.graph, name: "draft-version", blocks: template.graph.blocks.slice(0, 2) };
    dirs.add("/proj/sessions");
    files.set("/proj/sessions/main.ragsession", JSON.stringify(savedDoc));
    files.set("/proj/sessions/main.ragsession.draft", JSON.stringify(draftDoc));

    renderShell({ projectDir: "/proj" });

    const dialog = await screen.findByRole("dialog", { name: "Restore unsaved changes?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore draft" }));

    expect(await screen.findByText("draft-version")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(2));
    expect(screen.getByRole("tab", { name: "main" })).toHaveAttribute("title", "main (unsaved changes)");
    // discarding is the only thing that removes a draft from disk — Restore leaves it
    expect(files.has("/proj/sessions/main.ragsession.draft")).toBe(true);
  });

  it("Discard draft loads the last saved version and removes the draft file", async () => {
    const template = TEMPLATES.find((t) => t.id === "sample-a")!;
    const savedDoc: SessionDoc = { ...template.graph, name: "saved-version" };
    const draftDoc: SessionDoc = { ...template.graph, name: "draft-version", blocks: template.graph.blocks.slice(0, 2) };
    dirs.add("/proj/sessions");
    files.set("/proj/sessions/main.ragsession", JSON.stringify(savedDoc));
    files.set("/proj/sessions/main.ragsession.draft", JSON.stringify(draftDoc));

    renderShell({ projectDir: "/proj" });

    const dialog = await screen.findByRole("dialog", { name: "Restore unsaved changes?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard draft" }));

    expect(await screen.findByText("saved-version")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(template.graph.blocks.length));
    await waitFor(() => expect(files.has("/proj/sessions/main.ragsession.draft")).toBe(false));
  });

  it("shows a corrupted-file dialog and starts blank instead of crashing", async () => {
    dirs.add("/proj/sessions");
    files.set("/proj/sessions/main.ragsession", "{not valid json at all");

    renderShell({ projectDir: "/proj" });

    expect(await screen.findByRole("dialog", { name: "Session file corrupted" })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(0));

    // dismiss and confirm no further disruption
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("dialog", { name: "Session file corrupted" })).not.toBeInTheDocument();
  });
});

describe("StudioShell — B-M3 run history", () => {
  function mockRunEndpoint(body: unknown, status = 200) {
    return (url: string) => {
      if (url === "/api/blocks") return Promise.reject(new TypeError("offline"));
      if (url === "/api/graphs/run?use_stubs=false") return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: "not found" }) } as Response);
    };
  }

  it("persists a run record after a completed run and shows it in the History panel", async () => {
    globalThis.fetch = vi.fn(
      mockRunEndpoint({
        ok: true,
        failed_block: null,
        order: [],
        events: [],
        artifacts: {},
      }),
    ) as unknown as typeof fetch;

    renderShell({ projectDir: "/proj", initialTemplate: null });
    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(0));

    fireEvent.click(screen.getByTitle("Run graph (Ctrl+Enter)"));
    await screen.findByText(/run complete/i, {}, { timeout: 5000 });

    fireEvent.click(screen.getByTitle("Browse past runs for this session (artifacts + param diffs)"));

    const dialog = await screen.findByRole("dialog", { name: "Run history" });
    expect(await within(dialog).findByText("✓ ok")).toBeInTheDocument();
    expect(within(dialog).getByText("0 blocks")).toBeInTheDocument();
  });

  it("shows a param diff between two runs", async () => {
    let call = 0;
    globalThis.fetch = vi.fn((url: string) => {
      if (url === "/api/blocks") return Promise.reject(new TypeError("offline"));
      if (url === "/api/graphs/run?use_stubs=false") {
        call += 1;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ ok: true, failed_block: null, order: [], events: [], artifacts: {} }),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: "not found" }) } as Response);
    }) as unknown as typeof fetch;

    renderShell({ projectDir: "/proj", initialTemplate: null });
    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(0));

    fireEvent.click(screen.getByTitle("Run graph (Ctrl+Enter)"));
    await screen.findByText(/run complete/i, {}, { timeout: 5000 });
    fireEvent.click(screen.getByTitle("Run graph (Ctrl+Enter)"));
    await waitFor(() => expect(call).toBe(2));

    fireEvent.click(screen.getByTitle("Browse past runs for this session (artifacts + param diffs)"));
    const dialog = await screen.findByRole("dialog", { name: "Run history" });
    const items = within(dialog).getAllByRole("button", { name: /\d/ });
    expect(items.length).toBeGreaterThanOrEqual(2);

    const select = (await within(dialog).findByLabelText(/compare with/i)) as HTMLSelectElement;
    const otherOption = Array.from(select.options).find((o) => o.value !== "");
    expect(otherOption).toBeDefined();
    fireEvent.change(select, { target: { value: otherOption!.value } });
    expect(await within(dialog).findByText(/param diff vs/i)).toBeInTheDocument();
  });
});

describe("StudioShell — B-M4 composite blocks", () => {
  function selectTwo() {
    // sample-b's b1 (facts_import) and b2 (bridges_import) have no wire
    // between them and no shared internal wire with anything else selected,
    // so grouping them is unambiguous: zero internal wires, two exposed
    // outputs, and every external wire (b1->b3, b1->b4, b2->b4) survives
    // rewired onto the new instance — a clean case, not a degenerate one.
    // React Flow's multi-select tracks the modifier key via a global
    // keydown/keyup listener on `window` (useKeyPress), not the click
    // event's own ctrlKey flag -- a plain `fireEvent.click(node, {
    // ctrlKey: true })` on the node alone does NOT register as multi-select.
    const b1 = document.querySelector('[data-block-type="facts_import"]') as HTMLElement;
    const b2 = document.querySelector('[data-block-type="bridges_import"]') as HTMLElement;
    fireEvent.click(b1);
    fireEvent.keyDown(window, { key: "Control", ctrlKey: true });
    fireEvent.click(b2, { ctrlKey: true });
    fireEvent.keyUp(window, { key: "Control" });
  }

  async function groupIntoComposite(label: string) {
    fireEvent.click(await screen.findByTitle(/group the selected blocks into/i));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: label } });
    fireEvent.click(within(dialog).getByRole("button", { name: /create|ok|confirm/i }));
  }

  it("groups a 2-block selection into a composite, persists it to disk, and shows it in the palette", async () => {
    const template = TEMPLATES.find((t) => t.id === "sample-b")!;
    renderShell({ projectDir: "/proj", initialTemplate: template });
    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(4));

    selectTwo();
    expect(await screen.findByText(/Group into block \(2\)/)).toBeInTheDocument();

    await groupIntoComposite("My Group");

    // two blocks replaced by one composite instance -> 4 - 2 + 1 = 3
    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(3));
    expect(document.querySelector('[data-block-type^="composite-"]')).toBeTruthy();
    expect(document.querySelector('[data-block-type="facts_import"]')).toBeNull();
    expect(document.querySelector('[data-block-type="bridges_import"]')).toBeNull();

    // real disk persistence, not just in-memory UI state
    await waitFor(() => expect([...files.keys()].some((f) => f.startsWith("/proj/blocks/composite-") && f.endsWith(".json"))).toBe(true));

    // "My Group" appears twice now (the palette entry AND the new instance
    // node's own title) -- scope to the palette to disambiguate.
    const palette = screen.getByLabelText("Block palette");
    expect(within(palette).getByText("My blocks")).toBeInTheDocument();
    expect(within(palette).getByText("My Group")).toBeInTheDocument();
  });

  it("double-clicking a composite instance enters edit mode showing its inner blocks, and Discard restores the outer graph", async () => {
    const template = TEMPLATES.find((t) => t.id === "sample-b")!;
    renderShell({ projectDir: "/proj", initialTemplate: template });
    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(4));
    selectTwo();
    await screen.findByText(/Group into block \(2\)/);
    await groupIntoComposite("My Group");
    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(3));

    const instance = document.querySelector('[data-block-type^="composite-"]') as HTMLElement;
    fireEvent.doubleClick(instance);

    expect(await screen.findByText(/Editing composite:/)).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(2));
    expect(document.querySelector('[data-block-type="facts_import"]')).toBeTruthy();
    expect(document.querySelector('[data-block-type="bridges_import"]')).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /discard/i }));

    await waitFor(() => expect(screen.queryByText(/Editing composite:/)).not.toBeInTheDocument());
    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(3));
    expect(document.querySelector('[data-block-type^="composite-"]')).toBeTruthy();
  });
});

describe("StudioShell — B-M5 sharing & export", () => {
  it("Export writes a portable session bundle to the dialog-chosen path", async () => {
    const template = TEMPLATES.find((t) => t.id === "sample-b")!;
    renderShell({ projectDir: "/proj", initialTemplate: template });
    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(4));

    dialogQueue = ["/out/bundle.json"];
    fireEvent.click(screen.getByTitle(/export this session/i));

    await waitFor(() => expect(files.has("/out/bundle.json")).toBe(true));
    const bundle = JSON.parse(files.get("/out/bundle.json")!);
    expect(bundle.exportSchemaVersion).toBe(1);
    expect(bundle.session.blocks).toHaveLength(4);
    // only the block types this graph actually uses are pinned, not the
    // whole catalog
    expect(bundle.blockCatalogSnapshot.map((b: { type: string }) => b.type).sort()).toEqual(
      ["bridges_import", "cluster_builder", "facts_import", "neighbor_sampler"].sort(),
    );
  });

  it("Import reads a bundle exported elsewhere and opens it as a new session tab", async () => {
    files.set(
      "/shared/bundle.json",
      JSON.stringify({
        exportSchemaVersion: 1,
        exportedAt: "2026-07-09T00:00:00.000Z",
        session: {
          schema_version: 1,
          name: "shared-session",
          blocks: [{ id: "n1", type: "pdf_source", position: { x: 0, y: 0 }, params: {} }],
          wires: [],
          meta: { created: "t", modified: "t", notes: "" },
        },
        blockCatalogSnapshot: [{ type: "pdf_source", category: "sources", cost: "free", label: "PDF Source" }],
      }),
    );

    renderShell({ projectDir: "/proj", initialTemplate: null });
    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(0));

    dialogQueue = ["/shared/bundle.json"];
    fireEvent.click(screen.getByTitle(/import a session bundle/i));

    await waitFor(() => expect(screen.getByRole("tab", { name: /shared-session/ })).toBeInTheDocument());
    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(1));
    expect(document.querySelector('[data-block-type="pdf_source"]')).toBeTruthy();
  });
});

describe("StudioShell — post-review hardening fixes", () => {
  function selectPair(typeA: string, typeB: string) {
    const a = document.querySelector(`[data-block-type="${typeA}"]`) as HTMLElement;
    const b = document.querySelector(`[data-block-type="${typeB}"]`) as HTMLElement;
    fireEvent.click(a);
    fireEvent.keyDown(window, { key: "Control", ctrlKey: true });
    fireEvent.click(b, { ctrlKey: true });
    fireEvent.keyUp(window, { key: "Control" });
  }

  async function makeComposite(label: string) {
    selectPair("facts_import", "bridges_import");
    fireEvent.click(await screen.findByTitle(/group the selected blocks into/i));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: label } });
    fireEvent.click(within(dialog).getByRole("button", { name: /create|ok|confirm/i }));
    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(3));
  }

  /** Mocks /api/graphs/run to echo back a run result built from whatever
   * expanded graph was actually POSTed (instance ids are dynamic, so the
   * canned-body approach used elsewhere can't know them upfront). */
  function mockRunEchoingPostedGraph(opts: { failLastInner?: boolean } = {}) {
    globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/blocks") return Promise.reject(new TypeError("offline"));
      if (url === "/api/graphs/run?use_stubs=false") {
        const posted = JSON.parse((init?.body as string) ?? "{}");
        const graph = posted.graph ?? posted;
        const ids: string[] = graph.blocks.map((b: { id: string }) => b.id);
        const expanded = ids.filter((i) => i.includes("__"));
        const failId = opts.failLastInner ? (expanded[expanded.length - 1] ?? null) : null;
        const events = ids.map((id) =>
          id === failId
            ? { block_id: id, type: "block_failed", payload: { error: "inner exploded" } }
            : { block_id: id, type: "block_finished", payload: { elapsed_sec: 0.01 } },
        );
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ ok: failId === null, failed_block: failId, order: ids, events, artifacts: {} }),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: "not found" }) } as Response);
    }) as unknown as typeof fetch;
  }

  it("locks tab-switching entry points while a composite is being edited", async () => {
    const template = TEMPLATES.find((t) => t.id === "sample-b")!;
    renderShell({ projectDir: "/proj", initialTemplate: template });
    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(4));
    await makeComposite("Locked");

    const instance = document.querySelector('[data-block-type^="composite-"]') as HTMLElement;
    fireEvent.doubleClick(instance);
    await screen.findByText(/Editing composite:/);

    // "New session" must not swap the canvas away mid-edit
    fireEvent.click(screen.getByLabelText("New session"));
    expect(await screen.findByText(/finish editing/i)).toBeInTheDocument();
    expect(screen.getByText(/Editing composite:/)).toBeInTheDocument();
    expect(screen.queryAllByRole("tab")).toHaveLength(1);

    // Import must not swap the canvas away mid-edit either
    fireEvent.click(screen.getByTitle(/import a session bundle/i));
    await waitFor(() => expect(screen.getAllByText(/finish editing/i).length).toBeGreaterThanOrEqual(1));
    expect(screen.getByText(/Editing composite:/)).toBeInTheDocument();
  });

  it("rejects grouping a selection that contains a composite instance (no nested composites)", async () => {
    const template = TEMPLATES.find((t) => t.id === "sample-b")!;
    renderShell({ projectDir: "/proj", initialTemplate: template });
    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(4));
    await makeComposite("Inner");

    const instance = document.querySelector('[data-block-type^="composite-"]') as HTMLElement;
    const other = document.querySelector('[data-block-type="neighbor_sampler"]') as HTMLElement;
    fireEvent.click(instance);
    fireEvent.keyDown(window, { key: "Control", ctrlKey: true });
    fireEvent.click(other, { ctrlKey: true });
    fireEvent.keyUp(window, { key: "Control" });

    fireEvent.click(await screen.findByTitle(/group the selected blocks into/i));
    expect(await screen.findByText(/cannot be nested/i)).toBeInTheDocument();
    // no name prompt opened, canvas unchanged
    expect(screen.queryByRole("dialog", { name: /new composite block/i })).not.toBeInTheDocument();
    expect(document.querySelectorAll(".block-node")).toHaveLength(3);
  });

  it("shows an error toast (and does not crash) when the imported file is not a valid bundle", async () => {
    files.set("/shared/garbage.json", "this is not json {{{");
    renderShell({ projectDir: "/proj", initialTemplate: null });
    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(0));

    dialogQueue = ["/shared/garbage.json"];
    fireEvent.click(screen.getByTitle(/import a session bundle/i));

    // both the toast and the console line carry the message
    expect((await screen.findAllByText(/not a valid session bundle/i)).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryAllByRole("tab")).toHaveLength(1); // no new tab opened
  });

  it("renders an imported graph with a missing block type as an inert Unknown block instead of crashing", async () => {
    files.set(
      "/shared/missing-type.json",
      JSON.stringify({
        exportSchemaVersion: 1,
        exportedAt: "t",
        session: {
          schema_version: 1,
          name: "with-missing",
          blocks: [{ id: "n1", type: "retired_block", position: { x: 0, y: 0 }, params: {} }],
          wires: [],
          meta: { created: "t", modified: "t", notes: "" },
        },
        blockCatalogSnapshot: [{ type: "retired_block", category: "sources", cost: "free", label: "Retired" }],
      }),
    );
    renderShell({ projectDir: "/proj", initialTemplate: null });
    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(0));

    dialogQueue = ["/shared/missing-type.json"];
    fireEvent.click(screen.getByTitle(/import a session bundle/i));

    await waitFor(() => expect(screen.getByRole("tab", { name: /with-missing/ })).toBeInTheDocument());
    await waitFor(() => expect(document.querySelector('[data-block-type="retired_block"]')).toBeTruthy());
    expect(screen.getAllByText("Unknown block").length).toBeGreaterThanOrEqual(1);
  });

  it("installs composite defs that travel inside an imported bundle", async () => {
    const compositeDef = {
      id: "composite-travel",
      label: "Travelled",
      blocks: [{ id: "a1", type: "chunker", position: { x: 0, y: 0 }, params: {} }],
      wires: [],
      exposedInputs: [{ block: "a1", port: "chunks", type: "chunks", label: "chunks" }],
      exposedOutputs: [{ block: "a1", port: "chunks", type: "chunks", label: "chunks" }],
    };
    files.set(
      "/shared/with-composite.json",
      JSON.stringify({
        exportSchemaVersion: 1,
        exportedAt: "t",
        session: {
          schema_version: 1,
          name: "uses-composite",
          blocks: [{ id: "n1", type: "composite-travel", position: { x: 0, y: 0 }, params: {} }],
          wires: [],
          meta: { created: "t", modified: "t", notes: "" },
        },
        blockCatalogSnapshot: [{ type: "composite-travel", category: "composite", cost: "free", label: "Travelled" }],
        composites: [compositeDef],
      }),
    );
    renderShell({ projectDir: "/proj", initialTemplate: null });
    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(0));

    dialogQueue = ["/shared/with-composite.json"];
    fireEvent.click(screen.getByTitle(/import a session bundle/i));

    await waitFor(() => expect(screen.getByRole("tab", { name: /uses-composite/ })).toBeInTheDocument());
    // def persisted into THIS project's blocks/ dir, instance renders with its real label
    await waitFor(() => expect(files.has("/proj/blocks/composite-travel.json")).toBe(true));
    expect(document.querySelector('[data-block-type="composite-travel"]')).toBeTruthy();
    expect(screen.queryByText("Unknown block")).not.toBeInTheDocument();
  });

  it("persists run records with the SAME expanded graph that was sent to the backend", async () => {
    let postedBody: string | null = null;
    globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/blocks") return Promise.reject(new TypeError("offline"));
      if (url === "/api/graphs/run?use_stubs=false") {
        postedBody = (init?.body as string) ?? null;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ ok: true, failed_block: null, order: [], events: [], artifacts: {} }),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: "not found" }) } as Response);
    }) as unknown as typeof fetch;

    const template = TEMPLATES.find((t) => t.id === "sample-b")!;
    renderShell({ projectDir: "/proj", initialTemplate: template });
    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(4));
    // block count alone is NOT "hydration done" (see waitForTemplateReady's
    // doc): grouping while the trailing setEdges is pending races the
    // canvas state and the run intermittently never reaches "run complete".
    await waitForTemplateReady(template.graph.name);
    await makeComposite("RunMe");

    fireEvent.click(screen.getByTitle("Run graph (Ctrl+Enter)"));
    await screen.findByText(/run complete/i, {}, { timeout: 5000 });

    const recordPath = [...files.keys()].find((f) => f.startsWith("/proj/runs/"));
    expect(recordPath).toBeDefined();
    const persisted = JSON.parse(files.get(recordPath!)!);
    const posted = JSON.parse(postedBody!);
    const postedGraph = posted.graph ?? posted;
    // record ids match what actually executed (expanded inst__inner ids),
    // so record.order/artifacts always join against record.graph.blocks
    expect(persisted.graph.blocks.map((b: { id: string }) => b.id).sort()).toEqual(
      postedGraph.blocks.map((b: { id: string }) => b.id).sort(),
    );
    expect(persisted.graph.blocks.some((b: { id: string }) => b.id.includes("__"))).toBe(true);
  }, 15000);

  it("animates the composite instance to run-done when all its inner blocks finish (B-M4 logged gap)", async () => {
    mockRunEchoingPostedGraph();
    const template = TEMPLATES.find((t) => t.id === "sample-b")!;
    renderShell({ projectDir: "/proj", initialTemplate: template });
    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(4));
    await waitForTemplateReady(template.graph.name);
    await makeComposite("RunMe");

    fireEvent.click(screen.getByTitle("Run graph (Ctrl+Enter)"));
    await screen.findByText(/run complete/i, {}, { timeout: 5000 });

    const instance = document.querySelector('[data-block-type^="composite-"]') as HTMLElement;
    expect(instance.classList.contains("run-done")).toBe(true);
    expect(instance.classList.contains("run-queued")).toBe(false);
    // 15s budget: render + template hydration + grouping + the animated run
    // legitimately take 2-4s and spike under full-file load; the default 5s
    // intermittently trips on whichever run-flow test the load lands on.
  }, 15000);

  it("marks the composite instance run-failed when an inner block fails", async () => {
    mockRunEchoingPostedGraph({ failLastInner: true });
    const template = TEMPLATES.find((t) => t.id === "sample-b")!;
    renderShell({ projectDir: "/proj", initialTemplate: template });
    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(4));
    await waitForTemplateReady(template.graph.name);
    await makeComposite("RunMe");

    fireEvent.click(screen.getByTitle("Run graph (Ctrl+Enter)"));
    // the message lands in BOTH the console line and the toast -> findAll
    await screen.findAllByText(/inner exploded/i, {}, { timeout: 8000 });

    await waitFor(() => {
      const instance = document.querySelector('[data-block-type^="composite-"]') as HTMLElement;
      expect(instance.classList.contains("run-failed")).toBe(true);
    });
  }, 15000);

  it("double-clicking a regular block selects it and focuses its first editable parameter in the Inspector", async () => {
    const template = TEMPLATES.find((t) => t.id === "sample-b")!;
    renderShell({ projectDir: "/proj", initialTemplate: template });
    await waitFor(() => expect(document.querySelectorAll(".block-node")).toHaveLength(4));

    const node = document.querySelector('[data-block-type="facts_import"]') as HTMLElement;
    fireEvent.doubleClick(node);

    await waitFor(() => {
      const active = document.activeElement as HTMLElement | null;
      expect(active?.closest(".inspector")).toBeTruthy();
      expect(active?.tagName).toBe("INPUT");
    });
  });
});
