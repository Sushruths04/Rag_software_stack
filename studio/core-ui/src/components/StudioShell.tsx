import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useNodesState,
  useEdgesState,
  useReactFlow,
  addEdge,
  type Connection,
  type Edge,
  type Node,
  type OnConnectStartParams,
} from "@xyflow/react";
import { Toolbar, type SavedGraphEntry } from "./Toolbar/Toolbar";
import { Palette } from "./Palette/Palette";
import { Canvas } from "./Canvas/Canvas";
import { Inspector } from "./Inspector/Inspector";
import { Console, type ConsoleLine } from "./Console/Console";
import { ToastStack, type ToastMessage } from "./Toast/Toast";
import { DocumentationPanel } from "./DocumentationPanel/DocumentationPanel";
import { TemplatePicker } from "./TemplatePicker/TemplatePicker";
import { CostConfirmSheet } from "./CostConfirmSheet/CostConfirmSheet";
import { usePortDrag } from "../state/portDragContext";
import { useTheme } from "../hooks/useTheme";
import { useDesktopMenuCommands } from "../hooks/useDesktopMenuCommands";
import { useDesktopProject, type SessionDoc, type RunRecord } from "../hooks/useDesktopProject";
import { BLOCK_CATALOG } from "../data/catalog";
import { DEMO_GRAPH } from "../data/demoGraph";
import type { TemplateDef } from "../data/templates";
import { graphToFlow, toGraphDoc } from "../utils/toFlow";
import {
  buildCompositeFromSelection,
  compositeCost,
  compositeToBlockSpec,
  buildExpansionIndex,
  expandComposites,
  refreshCompositeInstances,
  type CompositeDef,
} from "../utils/composite";
import { mergeLiveBlocks } from "../utils/liveCatalog";
import { stampTemplateGraph } from "../utils/templateStamp";
import { formatArtifactBadge } from "../utils/runFormat";
import { summarizeApiError } from "../utils/apiErrorSummary";
import {
  getBlocks,
  listGraphs,
  loadGraph as apiLoadGraph,
  runGraph as apiRunGraph,
  saveGraph as apiSaveGraph,
  validateGraph as apiValidateGraph,
  type ApiArtifact,
  type PaidBlockEstimate,
  type RunResult,
} from "../api/client";
import { topoDepths, topoOrder, validateGraph as validateGraphLocal, type ValidationResult } from "../utils/graphAlgorithms";
import type { BlockNodeData } from "./BlockNode/BlockNode";
import type { WireData } from "./Wire/Wire";
import type { BlockSpec, GraphDoc, GraphMeta } from "../types/graph";
import { SessionTabs } from "./SessionTabs/SessionTabs";
import { RunHistoryPanel } from "./RunHistoryPanel/RunHistoryPanel";
import { DatasetInspectorPanel } from "./DatasetInspector/DatasetInspectorPanel";
import { NamePromptDialog } from "./NamePromptDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import "./StudioShell.css";

const initialNodes: Node[] = [];
const initialEdges: Edge[] = [];

function nowId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Mirrors the CSS `prefers-reduced-motion` gate (theme/tokens.css) for the
 * imperative A20 template-hydrate stagger, which cannot be expressed in CSS. */
function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Reconstructs the minimal GraphDoc shape the pure graph algorithms need. */
function toAlgoGraph(nodes: Node[], edges: { id: string; source: string; sourceHandle: string | null; target: string; targetHandle: string | null }[]): GraphDoc {
  return {
    schema_version: 1,
    name: "current",
    meta: { created: "", modified: "", notes: "" },
    blocks: nodes.map((n) => ({ id: n.id, type: (n.data as BlockNodeData).spec.type, position: n.position })),
    wires: edges.map((e) => ({
      id: e.id,
      from: { block: e.source, port: e.sourceHandle ?? "" },
      to: { block: e.target, port: e.targetHandle ?? "" },
    })),
  };
}

/**
 * Owns all canvas state (nodes/edges/selection/console/theme) and the
 * interaction logic — Palette drag-drop, wire connect + type-check, the
 * simulated Run (drives A9/A10/A11/A12/A13 in sequence), Auto-layout
 * (A18 stand-in), and Validate. Canvas.tsx itself stays a dumb wrapper.
 */
export interface StudioShellProps {
  /** B-M1: set once a project folder is open (App.tsx owns this); null in
   * the browser (studio/web) and while no project is open on desktop. */
  projectDir?: string | null;
  /** Present (possibly null for "blank") only right after App.tsx creates a
   * NEW project, so this mount seeds the canvas instead of trying to load
   * an existing session. Absent when reopening an existing project. */
  initialTemplate?: TemplateDef | null;
  /** B-M2: changes exactly once, from undefined/null to a port number, when
   * the desktop shell's engine sidecar transitions to "ready". The initial
   * block-registry fetch is mount-only otherwise, so without this the
   * palette stays on its offline fallback until some unrelated action
   * (Save/Validate) happens to call the API again after the engine caught
   * up. App.tsx passes engineStatus.port here; absent in the browser. */
  engineReadySignal?: number | null;
}

const PROJECT_SESSION_NAME = "main";
// How long to wait after the last edit before writing an autosave draft.
const AUTOSAVE_DEBOUNCE_MS = 2000;

interface SessionSnapshot {
  nodes: Node[];
  edges: Edge[];
  graphName: string;
  graphMeta: GraphMeta;
  viewport?: { x: number; y: number; zoom: number };
}

export interface SessionTabMeta {
  /** session filename without extension — the id used for save/load. */
  id: string;
  dirty: boolean;
}

export function StudioShell({ projectDir = null, initialTemplate, engineReadySignal = null }: StudioShellProps = {}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([
    { id: nowId("l"), level: "info", text: "GRAFT Block Studio ready." },
    { id: nowId("l"), level: "info", text: "Drag blocks from the palette, or start from a template." },
  ]);
  const [consoleOpen, setConsoleOpen] = useState(true);
  const [minimapOpen, setMinimapOpen] = useState(true);
  const [loadMenuOpen, setLoadMenuOpen] = useState(false);
  const [costTotal, setCostTotal] = useState<string | undefined>(undefined);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  // ---- paid-block spend confirmation (M4b, 04 §9 F4 "Paid run flow") ------
  // Non-null while the CostConfirmSheet is open, waiting on the user; holds
  // exactly what a confirmed re-run needs (the already-built apiGraph/order
  // from the attempt that got the 402, so Confirm doesn't have to rebuild
  // or re-validate anything).
  const [pendingPaidRun, setPendingPaidRun] = useState<{
    apiGraph: GraphDoc;
    order: string[];
    paidBlocks: string[];
    estimated: PaidBlockEstimate[];
  } | null>(null);
  const [theme, , toggleTheme] = useTheme();
  const { setDraggingType } = usePortDrag();
  const desktopProject = useDesktopProject();
  const runningRef = useRef(false);
  // suppresses the "canvas is empty -> show template picker" effect while
  // handleUseTemplate is itself clearing the canvas mid-hydration (A20)
  const hydratingRef = useRef(false);
  // true while a project's initial session list/load is still in flight —
  // suppresses the empty-canvas template-picker invitation so it doesn't
  // flash over a session that's about to appear.
  const initialLoadPendingRef = useRef(projectDir !== null && initialTemplate === undefined);
  const reactFlow = useReactFlow();

  // ---- live block registry (M1: GET /api/blocks, falls back to catalog.ts)
  const [registryBlocks, setRegistryBlocks] = useState<BlockSpec[]>(BLOCK_CATALOG);
  // ---- B-M4: composites merge into the SAME catalog/byType every other
  // handler already reads — derived, not raw state, so a composite loaded
  // or created after the registry effect last ran is never wiped out by it
  // (the earlier direct setBlockCatalog(merged) approach did exactly that).
  const [composites, setComposites] = useState<Record<string, CompositeDef>>({});
  const [groupPromptOpen, setGroupPromptOpen] = useState(false);
  // Set while double-click-editing a composite's inner sub-graph; holds
  // what to restore on "Done" plus which composite is being edited.
  const [editingComposite, setEditingComposite] = useState<{ id: string; label: string } | null>(null);
  const editingReturnSnapshotRef = useRef<SessionSnapshot | null>(null);
  const blockCatalog = useMemo(() => {
    // A composite's cost is derived from its inner blocks (paid if any
    // inner block is paid) — hardcoding "free" would hide the paid badge
    // on a composite wrapping LLM blocks. The backend still enforces spend
    // confirmation on the expanded graph regardless; this keeps the UI's
    // first money signal honest.
    const registryByType = Object.fromEntries(registryBlocks.map((b) => [b.type, b]));
    const compositeSpecs = Object.values(composites).map((def) => compositeToBlockSpec(def, compositeCost(def, registryByType)));
    return [...registryBlocks, ...compositeSpecs];
  }, [registryBlocks, composites]);
  const blockByType = useMemo(() => Object.fromEntries(blockCatalog.map((b) => [b.type, b])), [blockCatalog]);

  // ---- persistence (M2: POST/GET /api/graphs) ------------------------------
  const [graphName, setGraphName] = useState("untitled session");
  const [graphMeta, setGraphMeta] = useState<GraphMeta>({ created: new Date().toISOString(), modified: new Date().toISOString(), notes: "" });
  const [savedGraphs, setSavedGraphs] = useState<SavedGraphEntry[]>([]);

  // ---- B-M1: session tabs (project mode only; empty/inert in the browser
  // and in Plan-A single-graph mode). Only the ACTIVE tab's graph lives in
  // the `nodes`/`edges`/`graphName`/`graphMeta` state above; every other
  // open tab's last-known snapshot sits in sessionSnapshotsRef, swapped in
  // on tab switch. See handleSwitchTab/handleRequestNewSession below.
  const [sessionTabs, setSessionTabs] = useState<SessionTabMeta[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const sessionSnapshotsRef = useRef<Record<string, SessionSnapshot>>({});
  const [newSessionPromptOpen, setNewSessionPromptOpen] = useState(false);
  const [closeTabRequest, setCloseTabRequest] = useState<string | null>(null);
  // Set right before a tab load/switch/seed so the dirty-tracking effect
  // doesn't mark a just-loaded tab dirty from its own initial data.
  const suppressDirtyRef = useRef(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushToast = useCallback((text: string, kind: ToastMessage["kind"] = "info") => {
    const id = nowId("t");
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4300);
  }, []);

  const pushLine = useCallback((level: ConsoleLine["level"], text: string, detail?: string) => {
    setConsoleLines((ls) => [...ls, { id: nowId("l"), level, text, detail }]);
  }, []);

  // ---- load the live block registry, fall back to the bundled static
  // catalog if the backend is unreachable (offline demo must work). Runs on
  // mount AND again whenever engineReadySignal changes (B-M2: the desktop
  // sidecar negotiates its port asynchronously — the mount-time call can
  // easily lose that race and fail before the engine is up; refetching
  // once it reports "ready" is what actually refreshes the palette instead
  // of leaving it on the offline fallback until an unrelated Save/Validate
  // call happens to hit the API again).
  useEffect(() => {
    let cancelled = false;
    getBlocks().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        const merged = mergeLiveBlocks(result.data.blocks);
        setRegistryBlocks(merged);
        pushLine("ok", `live block registry loaded — ${merged.length} blocks from backend`);
      } else {
        pushLine("info", "engine offline — using the bundled block catalog");
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pushLine is stable; engineReadySignal is the deliberate re-run trigger
  }, [engineReadySignal]);

  // ---- empty-canvas invitation (04 §5 "not a blank void" / §6 copy rule) --
  // Whenever the canvas has zero blocks -- after clearing every node, or
  // after loading an empty saved graph -- show the template picker instead
  // of a blank void. Suppressed while handleUseTemplate is itself clearing
  // the canvas as the first step of hydration.
  useEffect(() => {
    if (nodes.length === 0 && !hydratingRef.current && !initialLoadPendingRef.current) {
      setTemplatePickerOpen(true);
    }
  }, [nodes.length]);

  // ---- selection --------------------------------------------------------
  const onNodeClick = useCallback((_: unknown, node: Node) => setSelectedId(node.id), []);
  const onPaneClick = useCallback(() => setSelectedId(null), []);

  const selected = useMemo(() => nodes.find((n) => n.id === selectedId) ?? null, [nodes, selectedId]);
  // B-M4: multi-select is React Flow's own default behavior (shift-drag box
  // select, ctrl/cmd-click) — nothing new to wire up, just read `.selected`.
  const selectedNodeIds = useMemo(() => nodes.filter((n) => n.selected).map((n) => n.id), [nodes]);
  const selectedData = selected?.data as BlockNodeData | undefined;

  const onParamChange = useCallback(
    (key: string, value: string) => {
      if (!selectedId) return;
      setNodes((ns) =>
        ns.map((n) => {
          if (n.id !== selectedId) return n;
          const d = n.data as BlockNodeData;
          return { ...n, data: { ...d, node: { ...d.node, params: { ...d.node.params, [key]: value } } } };
        }),
      );
    },
    [selectedId, setNodes],
  );

  // ---- palette drag/drop (A1 ghost lives in Palette; A2 settle here) ----
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const blockType = e.dataTransfer.getData("application/x-graft-block");
      const spec = blockByType[blockType];
      if (!spec) return;
      const position = reactFlow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const id = nowId("n");
      const newNode: Node = {
        id,
        type: "block",
        position,
        data: { spec, node: { id, type: spec.type, position, runState: "idle" } } satisfies BlockNodeData,
      };
      setNodes((ns) => [...ns, newNode]);
      setSelectedId(id);
      pushLine("info", `+ ${spec.label} dropped on canvas`);
    },
    [reactFlow, setNodes, pushLine, blockByType],
  );

  const onPaletteDoubleClick = useCallback(
    (spec: BlockSpec) => {
      const viewport = reactFlow.getViewport();
      const position = reactFlow.screenToFlowPosition({ x: 420 - viewport.x, y: 260 - viewport.y });
      const id = nowId("n");
      setNodes((ns) => [...ns, { id, type: "block", position, data: { spec, node: { id, type: spec.type, position, runState: "idle" } } satisfies BlockNodeData }]);
      setSelectedId(id);
    },
    [reactFlow, setNodes],
  );

  // ---- wiring: type-checked connect (05 §5 rule 1) + A5/A6 -------------
  const onConnectStart = useCallback(
    (_: unknown, params: OnConnectStartParams) => {
      const node = nodes.find((n) => n.id === params.nodeId);
      const spec = node && (node.data as BlockNodeData).spec;
      const ports = params.handleType === "source" ? spec?.outputs : spec?.inputs;
      const port = ports?.find((p) => p.name === params.handleId);
      if (port) setDraggingType(port.type);
    },
    [nodes, setDraggingType],
  );
  const onConnectEnd = useCallback(() => setDraggingType(null), [setDraggingType]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setDraggingType(null);
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);
      const sourceSpec = sourceNode && (sourceNode.data as BlockNodeData).spec;
      const targetSpec = targetNode && (targetNode.data as BlockNodeData).spec;
      const outPort = sourceSpec?.outputs.find((p) => p.name === connection.sourceHandle);
      const inPort = targetSpec?.inputs.find((p) => p.name === connection.targetHandle);

      if (!outPort || !inPort) return;
      if (outPort.type !== inPort.type) {
        pushToast(`${outPort.type} -> ${inPort.type}: types differ`, "warn");
        return;
      }

      const id = nowId("w");
      const edgeId = id;
      setEdges((es) =>
        addEdge(
          {
            ...connection,
            id,
            type: "wire",
            data: { portType: outPort.type, typeName: outPort.type, justConnected: true } satisfies WireData,
          },
          es,
        ),
      );
      pushLine("info", `wired ${connection.source}.${connection.sourceHandle} -> ${connection.target}.${connection.targetHandle}`);
      setTimeout(() => {
        setEdges((es) => es.map((e) => (e.id === edgeId ? { ...e, data: { ...(e.data as WireData), justConnected: false } } : e)));
      }, 340);
    },
    [nodes, setEdges, pushToast, pushLine, setDraggingType],
  );

  // ---- toolbar: validate ----------------------------------------------------
  // Calls the real compiler (POST /api/graphs/validate) and surfaces its
  // result: hard errors as error toasts/console lines, the grounding-gate
  // structural lint (and any other warning) distinctly as warnings, matching
  // the existing warn/error visual split (Toast kind, Console line level).
  // Falls back to the local client-only checks (utils/graphAlgorithms) if
  // the backend is unreachable, noting that in the console.
  const runLocalValidate = useCallback(() => {
    const g = toAlgoGraph(nodes, edges as unknown as { id: string; source: string; sourceHandle: string | null; target: string; targetHandle: string | null }[]);
    const result = validateGraphLocal(g, (blockId, port, side) => {
      const block = g.blocks.find((b) => b.id === blockId);
      const spec = block && blockByType[block.type];
      const list = side === "in" ? spec?.inputs : spec?.outputs;
      return list?.find((p) => p.name === port)?.type ?? null;
    });
    setValidation(result);
    pushLine(result.ok ? "ok" : "warn", `validate (local-only): ${result.message}`);
    result.errors.forEach((e) => pushLine("error", e));
    return result;
  }, [nodes, edges, pushLine, blockByType]);

  const handleValidate = useCallback(async () => {
    const g = toGraphDoc(nodes, edges as Edge[], graphName, graphMeta);
    // B-M4: the backend never needs to know composites exist — expand them
    // back into real blocks/wires right before sending, while the canvas
    // (and this validate summary's counts) keeps showing the un-expanded
    // composite node.
    const result = await apiValidateGraph(expandComposites(g, composites));

    if (!result.ok) {
      pushLine("info", "engine offline — using local-only validation");
      runLocalValidate();
      return;
    }

    const { data } = result;
    const message = data.valid
      ? `${g.wires.length} wires valid · ${g.blocks.length} blocks · no cycles`
      : `${data.errors.length} problem${data.errors.length === 1 ? "" : "s"} found`;
    setValidation({ ok: data.valid, message, errors: data.errors.map((e) => e.message) });
    pushLine(data.valid ? "ok" : "error", `validate: ${message}`);

    data.errors.forEach((e) => {
      pushLine("error", `error: ${e.message}`);
      pushToast(e.message, "error");
    });
    data.warnings.forEach((w) => {
      const autofixHint = w.autofix ? ` — autofix: insert ${String(w.autofix.block_type ?? "block")}` : "";
      pushLine("warn", `lint: ${w.message}${autofixHint}`);
      pushToast(`${w.message}${autofixHint}`, "warn");
    });
  }, [nodes, edges, graphName, graphMeta, pushLine, pushToast, runLocalValidate, composites]);

  // ---- toolbar: auto-layout (A18 stand-in) ---------------------------------
  const handleAutoLayout = useCallback(() => {
    const g = toAlgoGraph(nodes, edges as unknown as { id: string; source: string; sourceHandle: string | null; target: string; targetHandle: string | null }[]);
    const order = topoOrder(g);
    if (!order) {
      pushToast("cannot auto-layout: graph has a cycle", "error");
      return;
    }
    const depths = topoDepths(g, order);
    const columnCounts = new Map<number, number>();
    setNodes((ns) =>
      ns.map((n) => {
        const depth = depths.get(n.id) ?? 0;
        const row = columnCounts.get(depth) ?? 0;
        columnCounts.set(depth, row + 1);
        return { ...n, position: { x: 60 + depth * 320, y: 40 + row * 190 } };
      }),
    );
    pushLine("info", "auto-layout: combed into topological columns");
    setTimeout(() => reactFlow.fitView({ padding: 0.15, duration: 300 }), 60);
  }, [nodes, edges, setNodes, pushLine, reactFlow, pushToast]);

  const handleFit = useCallback(() => reactFlow.fitView({ padding: 0.15, duration: 260 }), [reactFlow]);

  // ---- toolbar: save/load (M2: POST/GET /api/graphs) -----------------------
  const handleSave = useCallback(async () => {
    // B-M4: mid-composite-edit, the canvas shows the composite's inner
    // sub-graph, not the session's own graph — Save here would silently
    // overwrite the session file with the composite's content. Use the
    // composite editor's own "Save & Done" instead.
    if (editingComposite) {
      pushToast('use "Save & Done" to save this composite', "info");
      return;
    }
    const now = new Date().toISOString();
    const meta: GraphMeta = { ...graphMeta, created: graphMeta.created || now, modified: now };
    const g = toGraphDoc(nodes, edges as Edge[], graphName, meta);

    // B-M1: inside an open project, sessions are real files on disk written
    // directly via Tauri fs — not the backend's flat graph store (that
    // stays the browser/Plan-A path, unaffected below). Saves the ACTIVE
    // tab specifically and clears just that tab's dirty flag.
    if (projectDir) {
      const tabId = activeTabId ?? PROJECT_SESSION_NAME;
      const viewport = reactFlow.getViewport();
      await desktopProject.saveSession(projectDir, tabId, { ...g, viewport });
      // A real Save is authoritative — drop any pending autosave and the
      // on-disk draft so a later crash-recovery prompt doesn't offer to
      // "restore" content that predates this save.
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      await desktopProject.deleteDraft(projectDir, tabId);
      setGraphMeta(meta);
      setSessionTabs((tabs) => tabs.map((t) => (t.id === tabId ? { ...t, dirty: false } : t)));
      pushToast(`saved "${g.name}"`, "info");
      pushLine("ok", `saved session "${tabId}" (${g.blocks.length} blocks, ${g.wires.length} wires)`);
      return;
    }

    const result = await apiSaveGraph(g);
    if (result.ok) {
      setGraphMeta(meta);
      pushToast(`saved "${g.name}"`, "info");
      pushLine("ok", `saved graph "${g.name}" as ${result.data.id} (${g.blocks.length} blocks, ${g.wires.length} wires)`);
    } else {
      pushToast(`save failed: ${result.error}`, "error");
      pushLine("error", `save failed: ${result.error}`);
    }
  }, [nodes, edges, graphName, graphMeta, pushToast, pushLine, projectDir, activeTabId, desktopProject, reactFlow, editingComposite]);

  const handleOpenLoadMenu = useCallback(async () => {
    const result = await listGraphs();
    if (result.ok) {
      setSavedGraphs(result.data.graphs);
    } else {
      pushLine("info", `could not list saved graphs: ${result.error}`);
    }
  }, [pushLine]);

  // loadMenuOpen is lifted here (not local to Toolbar) so the desktop
  // shell's native "Open Project" menu item can drive the same dropdown a
  // toolbar click would, via useDesktopMenuCommands below.
  const handleToggleLoadMenu = useCallback(() => {
    setLoadMenuOpen((open) => {
      const next = !open;
      if (next) void handleOpenLoadMenu();
      return next;
    });
  }, [handleOpenLoadMenu]);

  const handleLoadGraph = useCallback(
    async (id: string) => {
      const result = await apiLoadGraph(id);
      if (!result.ok) {
        pushToast(`load failed: ${result.error}`, "error");
        pushLine("error", `load failed: ${result.error}`);
        return;
      }
      const { graph } = result.data;
      const { nodes: loadedNodes, edges: loadedEdges } = graphToFlow(graph, blockByType);
      setNodes(loadedNodes);
      setEdges(loadedEdges);
      setGraphName(graph.name);
      setGraphMeta(graph.meta);
      setSelectedId(null);
      setValidation(null);
      pushToast(`loaded "${graph.name}"`, "info");
      pushLine("info", `loaded graph "${graph.name}" — ${loadedNodes.length} blocks, ${loadedEdges.length} wires`);
      setTimeout(() => reactFlow.fitView({ padding: 0.15, duration: 260 }), 60);
    },
    [blockByType, setNodes, setEdges, pushToast, pushLine, reactFlow],
  );

  // ---- toolbar: run — simulated fallback (drives A9/A10/A11/A12/A13) ------
  // Extracted verbatim from the pre-M3 handleRun body (minus the "queued"
  // pre-pass and "run started" line, now hoisted into handleRun so both this
  // and runLiveSteps share one entry point). Used only when the real
  // POST /api/graphs/run call fails (offline demo must keep working exactly
  // as it did before this milestone).
  const runSimulatedSteps = useCallback(
    async (order: string[]) => {
      for (const blockId of order) {
        setNodes((ns) =>
          ns.map((n) => (n.id === blockId ? { ...n, data: { ...(n.data as BlockNodeData), node: { ...(n.data as BlockNodeData).node, runState: "running" } } } : n)),
        );
        await sleep(260);

        setNodes((ns) =>
          ns.map((n) => {
            if (n.id !== blockId) return n;
            const d = n.data as BlockNodeData;
            const demoMeta = DEMO_GRAPH.blocks.find((b) => b.id === blockId)?.runMeta;
            return { ...n, data: { ...d, node: { ...d.node, runState: "done", runMeta: demoMeta ?? { metaLine: "done" } } } };
          }),
        );
        const doneNode = nodes.find((n) => n.id === blockId);
        const label = doneNode ? (doneNode.data as BlockNodeData).spec.label : blockId;
        const demoMeta = DEMO_GRAPH.blocks.find((b) => b.id === blockId)?.runMeta;
        pushLine("ok", `${label} done${demoMeta?.metaLine ? ` — ${demoMeta.metaLine}` : ""}`);

        const outgoing = edges.filter((e) => e.source === blockId);
        if (outgoing.length > 0) {
          setEdges((es) =>
            es.map((e) => {
              if (e.source !== blockId) return e;
              const demoMetaOut = demoMeta?.portBadges?.[e.sourceHandle ?? ""];
              return { ...e, data: { ...(e.data as WireData), flowing: true, badge: demoMetaOut ?? (e.data as WireData).badge } };
            }),
          );
          await sleep(320);
          setEdges((es) => es.map((e) => (e.source === blockId ? { ...e, data: { ...(e.data as WireData), flowing: false } } : e)));
        }
      }

      setCostTotal("$0.95 spent · 2 paid blocks");
      pushLine("ok", "run complete");
    },
    [nodes, edges, setNodes, setEdges, pushLine],
  );

  // ---- toolbar: run — real backend execution (M3: POST /api/graphs/run) ---
  // Replays the endpoint's already-complete event list through the exact
  // same queued->running->done choreography and sleep pacing as the
  // simulated path, so a real run doesn't feel jarringly different — it's
  // just driven by real data now. use_stubs=false so the 9 live FREE-spine
  // adapters actually execute where the graph has them; any block with no
  // live adapter (or use_stubs left true) stays honestly stub-prefixed, and
  // formatArtifactBadge appends the "(planned)" marker for those.
  const runLiveSteps = useCallback(
    async (result: RunResult, expandedToInstance: Record<string, string> = {}) => {
      // B-M4 gap closed: the backend speaks in EXPANDED ids (inst__inner) but
      // the canvas still shows the composite instance node. Every step below
      // targets `canvasId` (the instance for composite members, the block id
      // itself otherwise); an instance turns "done" only after its LAST
      // member in the order finishes, and its badges are re-keyed to the
      // exposed "<inner>.<port>" names its canvas wires actually use.
      const remainingByInstance: Record<string, number> = {};
      for (const id of result.order) {
        const inst = expandedToInstance[id];
        if (inst) remainingByInstance[inst] = (remainingByInstance[inst] ?? 0) + 1;
      }
      const badgesByInstance: Record<string, Record<string, string>> = {};

      for (const blockId of result.order) {
        const instanceId = expandedToInstance[blockId];
        const canvasId = instanceId ?? blockId;
        setNodes((ns) =>
          ns.map((n) => (n.id === canvasId ? { ...n, data: { ...(n.data as BlockNodeData), node: { ...(n.data as BlockNodeData).node, runState: "running" } } } : n)),
        );
        await sleep(260);

        const canvasNode = nodes.find((n) => n.id === canvasId);
        const canvasLabel = canvasNode ? (canvasNode.data as BlockNodeData).spec.label : canvasId;
        const label = instanceId ? `${canvasLabel} › ${blockId.slice(instanceId.length + 2)}` : canvasLabel;

        const failedEvent = result.events.find((e) => e.block_id === blockId && e.type === "block_failed");
        if (failedEvent) {
          const errorMsg = typeof failedEvent.payload?.error === "string" ? failedEvent.payload.error : "block failed";
          setNodes((ns) =>
            ns.map((n) => {
              if (n.id !== canvasId) return n;
              const d = n.data as BlockNodeData;
              return { ...n, data: { ...d, node: { ...d.node, runState: "failed", runMeta: { metaLine: errorMsg, error: errorMsg } } } };
            }),
          );
          pushLine("error", `${label} failed — ${errorMsg}`);
          pushToast(`${label} failed: ${errorMsg}`, "error");
          return; // stop the animation here — downstream blocks never ran
        }

        const blockArtifacts = (result.artifacts[blockId] ?? {}) as Record<string, ApiArtifact>;
        const portBadges: Record<string, string> = {};
        let metaLine = "done";
        for (const [portName, artifact] of Object.entries(blockArtifacts)) {
          const badge = formatArtifactBadge(artifact);
          portBadges[portName] = badge;
          metaLine = badge;
        }
        const cacheHit = result.events.some((e) => e.block_id === blockId && e.type === "block_skipped_cache");
        const finishedEvent = result.events.find((e) => e.block_id === blockId && e.type === "block_finished");
        const elapsedSec = finishedEvent?.payload?.elapsed_sec;
        const elapsedLabel =
          typeof elapsedSec === "number" ? ` · ${elapsedSec < 0.01 ? "<0.01" : elapsedSec.toFixed(2)}s` : "";

        if (instanceId) {
          // Accumulate this member's badges under the instance's exposed
          // port names; the instance node only flips "done" on its last member.
          const innerId = blockId.slice(instanceId.length + 2);
          const instBadges = (badgesByInstance[instanceId] ??= {});
          for (const [portName, badge] of Object.entries(portBadges)) {
            instBadges[`${innerId}.${portName}`] = badge;
          }
          pushLine("ok", `${label} ${cacheHit ? "cache-hit" : "done"}${metaLine ? ` — ${metaLine}` : ""}${elapsedLabel}`);
          remainingByInstance[instanceId] -= 1;
          if (remainingByInstance[instanceId] > 0) continue;
        }

        const finalBadges = instanceId ? (badgesByInstance[instanceId] ?? {}) : portBadges;
        const finalMeta = instanceId ? (Object.values(finalBadges).at(-1) ?? "done") : metaLine;
        setNodes((ns) =>
          ns.map((n) => {
            if (n.id !== canvasId) return n;
            const d = n.data as BlockNodeData;
            return { ...n, data: { ...d, node: { ...d.node, runState: "done", runMeta: { metaLine: finalMeta, portBadges: finalBadges } } } };
          }),
        );
        if (instanceId) {
          pushLine("ok", `${canvasLabel} done — all ${result.order.filter((id) => expandedToInstance[id] === instanceId).length} inner blocks finished`);
        } else {
          pushLine("ok", `${label} ${cacheHit ? "cache-hit" : "done"}${metaLine ? ` — ${metaLine}` : ""}${elapsedLabel}`);
        }

        const outgoing = edges.filter((e) => e.source === canvasId);
        if (outgoing.length > 0) {
          setEdges((es) =>
            es.map((e) => {
              if (e.source !== canvasId) return e;
              const badge = finalBadges[e.sourceHandle ?? ""];
              return { ...e, data: { ...(e.data as WireData), flowing: true, badge: badge ?? (e.data as WireData).badge } };
            }),
          );
          await sleep(320);
          setEdges((es) => es.map((e) => (e.source === canvasId ? { ...e, data: { ...(e.data as WireData), flowing: false } } : e)));
        }
      }

      setCostTotal("$0.00 spent · live free blocks only");
      pushLine("ok", "run complete");
    },
    [nodes, edges, setNodes, setEdges, pushLine, pushToast],
  );

  // ---- toolbar: templates (M5, 04 §9 A20 "template hydrate") --------------
  const handleOpenTemplatePicker = useCallback(() => setTemplatePickerOpen(true), []);
  const handleCloseTemplatePicker = useCallback(() => setTemplatePickerOpen(false), []);

  const handleUseTemplate = useCallback(
    async (template: TemplateDef) => {
      let g = template.graph;
      // Template-library spec 2026-07-11: bundled-data templates stage the
      // ECMA-404 corpus into the open project (idempotent) and get their
      // datasets/-relative paths stamped absolute before hydration. Covers
      // both create-project-from-template (seed effect) and the in-project
      // "New from template" picker with one code path. No-op in browser.
      if (template.needsSampleData && projectDir) {
        await desktopProject.ensureSampleData(projectDir);
        g = await stampTemplateGraph(g, (rel) => desktopProject.resolveProjectPath(projectDir, rel));
      }
      const order = topoOrder(g) ?? g.blocks.map((b) => b.id);
      const { nodes: allNodes, edges: allEdges } = graphToFlow(g, blockByType);

      setTemplatePickerOpen(false);
      hydratingRef.current = true;
      setSelectedId(null);
      setValidation(null);
      setEdges([]);
      setNodes([]);
      setGraphName(g.name);
      setGraphMeta(g.meta);
      pushLine("info", `template "${g.name}" — hydrating ${allNodes.length} blocks`);

      const reduced = prefersReducedMotion();
      try {
        for (const blockId of order) {
          const node = allNodes.find((n) => n.id === blockId);
          if (!node) continue;
          setNodes((ns) => [...ns, node]);
          if (!reduced) await sleep(60); // A20: 60ms stagger per block, each with its own A2 settle
        }
        setEdges(allEdges);
      } finally {
        hydratingRef.current = false;
      }

      pushLine("ok", `template "${g.name}" ready — ${allNodes.length} blocks, ${allEdges.length} wires`);
      setTimeout(() => reactFlow.fitView({ padding: 0.15, duration: 260 }), 60);
    },
    [blockByType, setNodes, setEdges, pushLine, reactFlow, projectDir, desktopProject.ensureSampleData, desktopProject.resolveProjectPath],
  );

  // ---- B-M1: session tabs — capture/apply/switch -------------------------
  const captureActiveSnapshot = useCallback((): SessionSnapshot => {
    return { nodes, edges: edges as Edge[], graphName, graphMeta, viewport: reactFlow.getViewport() };
  }, [nodes, edges, graphName, graphMeta, reactFlow]);

  const applySnapshot = useCallback(
    (snapshot: SessionSnapshot) => {
      suppressDirtyRef.current = true;
      setNodes(snapshot.nodes);
      setEdges(snapshot.edges);
      setGraphName(snapshot.graphName);
      setGraphMeta(snapshot.graphMeta);
      setSelectedId(null);
      setValidation(null);
      setTimeout(() => {
        if (snapshot.viewport) reactFlow.setViewport(snapshot.viewport);
        else reactFlow.fitView({ padding: 0.15, duration: 260 });
      }, 60);
    },
    [setNodes, setEdges, reactFlow],
  );

  // ---- B-M1: crash recovery + corrupt-file dialogs -------------------------
  // A draft's mere EXISTENCE is the recovery signal (see useDesktopProject
  // doc) — no mtime comparison needed, since a successful Save always
  // deletes its own tab's draft.
  const [draftRecoveryTabId, setDraftRecoveryTabId] = useState<string | null>(null);
  const [corruptFileTabId, setCorruptFileTabId] = useState<string | null>(null);
  const draftDecisionRef = useRef<((restore: boolean) => void) | null>(null);

  const handleDraftDecision = useCallback((restore: boolean) => {
    setDraftRecoveryTabId(null);
    draftDecisionRef.current?.(restore);
    draftDecisionRef.current = null;
  }, []);

  // Single entry point for "put tab `id`'s content on screen", used by tab
  // switch, closing the active tab (falling back to another), and reopening
  // a project's first session — one path so draft-recovery and corrupt-file
  // handling apply everywhere a session gets loaded from disk, not just once.
  // Returns the number of blocks it actually put on the canvas: the reopen
  // effect needs that count SYNCHRONOUSLY at its decision point (an
  // effect-lagged ref or the closed-over `nodes` state would still read the
  // pre-load value when its `finally` runs) to know whether the load ended
  // with an empty canvas and the template-picker invitation should show.
  const resolveAndApplySession = useCallback(
    async (id: string): Promise<number> => {
      if (!projectDir) return 0;
      if (await desktopProject.hasDraft(projectDir, id)) {
        const draft = await desktopProject.loadDraft(projectDir, id);
        if (draft) {
          const restore = await new Promise<boolean>((resolve) => {
            draftDecisionRef.current = resolve;
            setDraftRecoveryTabId(id);
          });
          if (restore) {
            const { nodes: n, edges: e } = graphToFlow(draft, blockByType);
            applySnapshot({ nodes: n, edges: e, graphName: draft.name, graphMeta: draft.meta, viewport: draft.viewport });
            setSessionTabs((tabs) => tabs.map((t) => (t.id === id ? { ...t, dirty: true } : t)));
            pushLine("info", `restored unsaved draft for "${id}"`);
            return n.length;
          }
          await desktopProject.deleteDraft(projectDir, id);
        }
      }
      const result = await desktopProject.loadSession(projectDir, id);
      if (result.status === "ok") {
        const { nodes: n, edges: e } = graphToFlow(result.doc, blockByType);
        applySnapshot({ nodes: n, edges: e, graphName: result.doc.name, graphMeta: result.doc.meta, viewport: result.doc.viewport });
        pushLine("ok", `loaded session "${result.doc.name}" — ${n.length} blocks, ${e.length} wires`);
        return n.length;
      } else if (result.status === "corrupt") {
        setCorruptFileTabId(id);
        applySnapshot({ nodes: [], edges: [], graphName: id, graphMeta: { created: "", modified: "", notes: "" } });
        pushLine("error", `session "${id}" file is corrupted — started blank`);
      } else {
        pushLine("info", `no saved "${id}" session yet`);
      }
      return 0;
    },
    [projectDir, desktopProject, blockByType, applySnapshot, pushLine],
  );

  // ---- B-M4 hardening: while a composite's inner sub-graph is on the
  // canvas, every OTHER canvas-swapping entry point (tab switch, new
  // session, close tab, import, export) must be locked, not just Save —
  // otherwise captureActiveSnapshot() records the composite's guts as the
  // session tab's content and Discard/"Save & Done" restores the pre-edit
  // snapshot into whatever tab happens to be active by then.
  const guardCompositeEditing = useCallback((): boolean => {
    if (!editingComposite) return false;
    pushToast('finish editing the composite first — "Save & Done" or Discard', "info");
    return true;
  }, [editingComposite, pushToast]);

  const handleSwitchTab = useCallback(
    async (id: string) => {
      if (!projectDir || id === activeTabId || guardCompositeEditing()) return;
      if (activeTabId) sessionSnapshotsRef.current[activeTabId] = captureActiveSnapshot();

      const cached = sessionSnapshotsRef.current[id];
      setActiveTabId(id);
      if (cached) {
        applySnapshot(cached);
        return;
      }
      await resolveAndApplySession(id);
    },
    [projectDir, activeTabId, guardCompositeEditing, captureActiveSnapshot, applySnapshot, resolveAndApplySession],
  );

  // ---- B-M4: composite blocks — group a canvas selection into a reusable
  // sub-graph block, and edit one by double-click. Project-mode only:
  // composites are persisted per-project, same as sessions/runs.
  // Composite instances are ordinary selectable nodes, so grouping must
  // actively reject them — expandComposites is single-level by design, and
  // a composite-inside-a-composite would reach the backend unexpanded as
  // an unknown block type (see utils/composite.ts doc comment).
  const selectionContainsComposite = useCallback(
    () => nodes.some((n) => n.selected && composites[(n.data as BlockNodeData).node.type] !== undefined),
    [nodes, composites],
  );

  const handleRequestGroupIntoComposite = useCallback(() => {
    if (!projectDir) return;
    const selectedIds = nodes.filter((n) => n.selected).map((n) => n.id);
    if (selectedIds.length < 2) {
      pushToast("select 2+ blocks to group into a composite", "error");
      return;
    }
    if (selectionContainsComposite()) {
      pushToast("composites cannot be nested — ungroup or edit the existing composite instead", "error");
      return;
    }
    setGroupPromptOpen(true);
  }, [projectDir, nodes, pushToast, selectionContainsComposite]);

  const handleConfirmGroupIntoComposite = useCallback(
    async (label: string) => {
      setGroupPromptOpen(false);
      if (!projectDir) return;
      const selectedIds = nodes.filter((n) => n.selected).map((n) => n.id);
      if (selectedIds.length < 2 || selectionContainsComposite()) return;

      const doc = toGraphDoc(nodes, edges as Edge[], graphName, graphMeta);
      const id = `composite-${Date.now().toString(36)}`;
      const def = buildCompositeFromSelection(selectedIds, doc.blocks, doc.wires, blockByType, id, label);
      await desktopProject.saveComposite(projectDir, def);
      setComposites((prev) => ({ ...prev, [id]: def }));

      const selectedSet = new Set(selectedIds);
      const selectedPositions = nodes.filter((n) => selectedSet.has(n.id)).map((n) => n.position);
      const centroid = {
        x: selectedPositions.reduce((s, p) => s + p.x, 0) / selectedPositions.length,
        y: selectedPositions.reduce((s, p) => s + p.y, 0) / selectedPositions.length,
      };
      const spec = compositeToBlockSpec(def, compositeCost(def, blockByType));
      const instanceId = `${id}-inst1`;
      const instanceNode: Node = {
        id: instanceId,
        type: "block",
        position: centroid,
        data: { spec, node: { id: instanceId, type: id, position: centroid, params: {}, runState: "idle" } } satisfies BlockNodeData,
      };

      // Boundary wires (exactly one endpoint inside the selection) get
      // rewired to the new instance's exposed port; fully-internal wires
      // are dropped (now inside the composite definition itself).
      const remaining = (edges as Edge[]).filter((e) => !(selectedSet.has(e.source) && selectedSet.has(e.target)));
      const rewired = remaining
        .map((e) => {
          if (selectedSet.has(e.source)) {
            const port = def.exposedOutputs.find((p) => p.block === e.source && p.port === e.sourceHandle);
            return port ? { ...e, id: `${e.id}__rw`, source: instanceId, sourceHandle: `${port.block}.${port.port}` } : null;
          }
          if (selectedSet.has(e.target)) {
            const port = def.exposedInputs.find((p) => p.block === e.target && p.port === e.targetHandle);
            return port ? { ...e, id: `${e.id}__rw`, target: instanceId, targetHandle: `${port.block}.${port.port}` } : null;
          }
          return e;
        })
        .filter((e): e is Edge => e !== null);

      setNodes((ns) => [...ns.filter((n) => !selectedSet.has(n.id)), instanceNode]);
      setEdges(rewired);
      setSelectedId(instanceId);
      pushLine("ok", `grouped ${selectedIds.length} blocks into composite "${label}"`);
    },
    [projectDir, nodes, edges, graphName, graphMeta, blockByType, desktopProject, setNodes, setEdges, pushLine, selectionContainsComposite],
  );

  const handleEnterCompositeEdit = useCallback(
    (def: CompositeDef) => {
      if (!projectDir || editingComposite) return;
      editingReturnSnapshotRef.current = captureActiveSnapshot();
      setEditingComposite({ id: def.id, label: def.label });
      const compositeDoc: GraphDoc = {
        schema_version: 1,
        name: def.label,
        blocks: def.blocks,
        wires: def.wires,
        meta: { created: "", modified: "", notes: "" },
      };
      const { nodes: n, edges: e } = graphToFlow(compositeDoc, blockByType);
      applySnapshot({ nodes: n, edges: e, graphName: def.label, graphMeta: compositeDoc.meta });
    },
    [projectDir, editingComposite, captureActiveSnapshot, blockByType, applySnapshot],
  );

  const handleExitCompositeEdit = useCallback(
    async (save: boolean) => {
      if (!editingComposite || !projectDir) return;
      let snapshot = editingReturnSnapshotRef.current;
      if (save) {
        const doc = toGraphDoc(nodes, edges as Edge[], editingComposite.label, graphMeta);
        const allIds = doc.blocks.map((b) => b.id);
        const updated = buildCompositeFromSelection(allIds, doc.blocks, doc.wires, blockByType, editingComposite.id, editingComposite.label);
        await desktopProject.saveComposite(projectDir, updated);
        setComposites((prev) => ({ ...prev, [editingComposite.id]: updated }));

        // Instance nodes captured their spec when they were dropped — if
        // this edit changed the composite's frontier, stale ports would
        // render and a wire attached to a removed exposed port would
        // expand to a nonexistent inner block. Refresh the snapshot being
        // restored AND every cached tab snapshot.
        const newSpec = compositeToBlockSpec(updated, compositeCost(updated, blockByType));
        let droppedTotal = 0;
        if (snapshot) {
          const refreshed = refreshCompositeInstances(snapshot.nodes, snapshot.edges, updated, newSpec);
          droppedTotal += refreshed.droppedWireIds.length;
          snapshot = { ...snapshot, nodes: refreshed.nodes, edges: refreshed.edges };
        }
        for (const [tabId, snap] of Object.entries(sessionSnapshotsRef.current)) {
          const refreshed = refreshCompositeInstances(snap.nodes, snap.edges, updated, newSpec);
          droppedTotal += refreshed.droppedWireIds.length;
          sessionSnapshotsRef.current[tabId] = { ...snap, nodes: refreshed.nodes, edges: refreshed.edges };
        }
        pushLine("ok", `saved composite "${editingComposite.label}" — every instance now uses the update`);
        if (droppedTotal > 0) {
          pushLine("warn", `removed ${droppedTotal} wire(s) that were attached to exposed ports this edit deleted`);
          pushToast(`${droppedTotal} wire(s) removed — their composite ports no longer exist`, "warn");
        }
      }
      setEditingComposite(null);
      editingReturnSnapshotRef.current = null;
      if (snapshot) applySnapshot(snapshot);
    },
    [editingComposite, projectDir, nodes, edges, graphMeta, blockByType, desktopProject, applySnapshot, pushLine, pushToast],
  );

  const onNodeDoubleClick = useCallback(
    (_: unknown, node: Node) => {
      const blockType = (node.data as BlockNodeData).spec.type;
      const def = composites[blockType];
      if (def) {
        handleEnterCompositeEdit(def);
        return;
      }
      // Regular block: double-click = "take me straight to editing this
      // block's parameters". Selection already shows the Inspector (04 §2:
      // "click a block, edit params in place"); the double-click addition
      // is moving focus into the first editable param field so typing can
      // start immediately. setTimeout(0) lets React commit the Inspector
      // for the newly selected node before the query runs.
      setSelectedId(node.id);
      setTimeout(() => {
        const input = document.querySelector<HTMLInputElement>(".inspector__field input:not(:disabled)");
        input?.focus();
        input?.select();
      }, 0);
    },
    [composites, handleEnterCompositeEdit],
  );

  const closeTabNow = useCallback(
    (id: string) => {
      delete sessionSnapshotsRef.current[id];
      const remaining = sessionTabs.filter((t) => t.id !== id);
      setSessionTabs(remaining);
      if (id !== activeTabId) return;

      const next = remaining[0];
      if (!next) {
        setActiveTabId(null);
        applySnapshot({ nodes: [], edges: [], graphName: "untitled", graphMeta: { created: "", modified: "", notes: "" } });
        return;
      }
      const cached = sessionSnapshotsRef.current[next.id];
      setActiveTabId(next.id);
      if (cached) applySnapshot(cached);
      else void resolveAndApplySession(next.id);
    },
    [sessionTabs, activeTabId, applySnapshot, resolveAndApplySession],
  );

  const handleRequestCloseTab = useCallback(
    (id: string) => {
      if (guardCompositeEditing()) return;
      const tab = sessionTabs.find((t) => t.id === id);
      if (tab?.dirty) setCloseTabRequest(id);
      else closeTabNow(id);
    },
    [sessionTabs, closeTabNow, guardCompositeEditing],
  );

  const handleConfirmCloseTab = useCallback(() => {
    if (closeTabRequest) closeTabNow(closeTabRequest);
    setCloseTabRequest(null);
  }, [closeTabRequest, closeTabNow]);

  // ---- B-M1: "New Session" — in the browser/Plan-A path (no project open)
  // this is unchanged (opens the template picker over the single canvas).
  // Inside a project it opens a NEW tab: name it, blank the active canvas,
  // then let the template picker optionally seed that new (now-active) tab
  // via the existing handleUseTemplate — no separate seeding path needed.
  const handleRequestNewSession = useCallback(() => {
    if (guardCompositeEditing()) return;
    if (!projectDir) {
      handleOpenTemplatePicker();
      return;
    }
    setNewSessionPromptOpen(true);
  }, [projectDir, handleOpenTemplatePicker, guardCompositeEditing]);

  const handleConfirmNewSessionName = useCallback(
    (name: string) => {
      setNewSessionPromptOpen(false);
      if (sessionTabs.some((t) => t.id === name)) {
        void handleSwitchTab(name);
        return;
      }
      if (activeTabId) sessionSnapshotsRef.current[activeTabId] = captureActiveSnapshot();
      setSessionTabs((tabs) => [...tabs, { id: name, dirty: true }]);
      setActiveTabId(name);
      suppressDirtyRef.current = true;
      setNodes([]);
      setEdges([]);
      setGraphName(name);
      const now = new Date().toISOString();
      setGraphMeta({ created: now, modified: now, notes: "" });
      setSelectedId(null);
      setValidation(null);
      setTemplatePickerOpen(true);
    },
    [sessionTabs, activeTabId, captureActiveSnapshot, handleSwitchTab, setNodes, setEdges],
  );

  // ---- B-M5: sharing & export. "Export dataset" from the spec is scoped
  // to "export run report" here (see utils/runReport.ts doc comment for
  // why — studio has no QA-dataset data model yet); "Export/Import
  // session" is the graph + a pinned snapshot of the block-catalog entries
  // it actually uses, so opening it later (possibly on a newer catalog)
  // can say something concrete about drift instead of silently breaking.
  const handleExportSession = useCallback(async () => {
    if (!projectDir || guardCompositeEditing()) return;
    const g = toGraphDoc(nodes, edges as Edge[], graphName, graphMeta);
    // Composite defs are project-local, so they must TRAVEL with the
    // bundle (exportSessionBundle keeps only the ones this graph uses) —
    // otherwise a session using a composite can never render or run on
    // the receiving side.
    const path = await desktopProject.exportSessionBundle({ ...g, viewport: reactFlow.getViewport() }, blockCatalog, Object.values(composites));
    if (path) pushLine("ok", `exported session bundle to ${path}`);
  }, [projectDir, nodes, edges, graphName, graphMeta, reactFlow, desktopProject, blockCatalog, composites, pushLine, guardCompositeEditing]);

  const handleImportSession = useCallback(async () => {
    if (!projectDir || guardCompositeEditing()) return;
    const result = await desktopProject.importSessionBundle(blockCatalog);
    if (!result) return;
    if ("error" in result) {
      pushToast(result.error, "error");
      pushLine("error", `session import failed — ${result.error}`);
      return;
    }
    const { bundle, warning } = result;

    // Composite defs travelling in the bundle install into THIS project
    // (persisted like locally created ones) so their instances render and
    // expand immediately — and their specs join the lookup used for THIS
    // import below, since the composites state update lands a render later.
    const arrivedComposites = bundle.composites ?? [];
    for (const def of arrivedComposites) {
      await desktopProject.saveComposite(projectDir, def);
    }
    if (arrivedComposites.length > 0) {
      setComposites((prev) => ({ ...prev, ...Object.fromEntries(arrivedComposites.map((d) => [d.id, d])) }));
      pushLine("ok", `installed ${arrivedComposites.length} composite block(s) from the bundle`);
    }
    const importByType: Record<string, BlockSpec> = {
      ...blockByType,
      ...Object.fromEntries(arrivedComposites.map((d) => [d.id, compositeToBlockSpec(d, compositeCost(d, blockByType))])),
    };

    if (warning) {
      const parts: string[] = [];
      if (warning.missingTypes.length) parts.push(`missing block types: ${warning.missingTypes.join(", ")}`);
      if (warning.changedLabels.length) {
        parts.push(`relabeled: ${warning.changedLabels.map((c) => `${c.type} (${c.from} -> ${c.to})`).join(", ")}`);
      }
      pushToast(`imported with compatibility warnings — ${parts.join("; ")}`, "warn");
      pushLine("warn", `session import compatibility warning — ${parts.join("; ")}`);
    }

    let tabId = bundle.session.name || "imported";
    if (sessionTabs.some((t) => t.id === tabId)) tabId = `${tabId}-imported-${Date.now().toString(36)}`;

    if (activeTabId) sessionSnapshotsRef.current[activeTabId] = captureActiveSnapshot();
    setSessionTabs((tabs) => [...tabs, { id: tabId, dirty: true }]);
    setActiveTabId(tabId);
    suppressDirtyRef.current = true;
    const { nodes: n, edges: e } = graphToFlow(bundle.session, importByType);
    setNodes(n);
    setEdges(e);
    setGraphName(tabId);
    setGraphMeta(bundle.session.meta);
    setSelectedId(null);
    setValidation(null);
    pushLine("ok", `imported session "${tabId}" from bundle`);
  }, [projectDir, desktopProject, blockCatalog, blockByType, sessionTabs, activeTabId, captureActiveSnapshot, setNodes, setEdges, pushToast, pushLine, guardCompositeEditing]);

  const handleExportRunReport = useCallback(
    async (record: RunRecord) => {
      const path = await desktopProject.exportRunReport(record);
      if (path) pushLine("ok", `exported run report to ${path}`);
    },
    [desktopProject, pushLine],
  );

  // ---- B-M1: dirty tracking — content-signature based, NOT raw
  // nodes/edges reference identity. React Flow's own internal bookkeeping
  // (dimension measurement after mount, selection) produces a new nodes/
  // edges array reference with no actual persisted-content change; a naive
  // reference-diffing effect treated those as edits and would sporadically
  // re-dirty a tab moments after Save cleared it (a real bug found via
  // repeated-run flakiness, not dismissed as "just timing"). The signature
  // below mirrors exactly what toGraphDoc persists (id/type/position/params,
  // wire endpoints), deliberately excluding runState/runMeta/wire badges —
  // running a graph is not an unsaved edit for save/reload purposes.
  const lastContentSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    // B-M4: mid-composite-edit the canvas shows the composite's inner
    // sub-graph, not the active tab's session content — this content
    // change is not a session edit, must not mark the tab dirty or
    // autosave a draft mislabeled as the session's own content.
    if (!projectDir || !activeTabId || editingComposite) return;
    const signature = JSON.stringify({
      name: graphName,
      blocks: nodes.map((n) => ({
        id: n.id,
        position: n.position,
        params: (n.data as BlockNodeData).node.params ?? {},
      })),
      wires: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle })),
    });
    if (suppressDirtyRef.current) {
      suppressDirtyRef.current = false;
      lastContentSignatureRef.current = signature;
      return;
    }
    if (lastContentSignatureRef.current === signature) return;
    lastContentSignatureRef.current = signature;
    setSessionTabs((tabs) => tabs.map((t) => (t.id === activeTabId ? { ...t, dirty: true } : t)));

    // Autosave draft, debounced — writes <tabId>.ragsession.draft so an
    // unclean close (crash, force-quit) can be recovered on next open. The
    // doc/viewport snapshot is captured NOW (this closure), not at fire
    // time, but that's fine: if content changed again before the timer
    // fires, this effect re-runs and reschedules with the newer snapshot.
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    const draftTabId = activeTabId;
    const draftDoc: SessionDoc = { ...toGraphDoc(nodes, edges as Edge[], graphName, graphMeta), viewport: reactFlow.getViewport() };
    autosaveTimerRef.current = setTimeout(() => {
      void desktopProject.saveDraft(projectDir, draftTabId, draftDoc);
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [nodes, edges, graphName, projectDir, activeTabId, graphMeta, reactFlow, desktopProject, editingComposite]);

  // Cancel any pending autosave on unmount so it never writes after the
  // component (and the project it belonged to) is gone.
  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, []);

  // ---- B-M1: project open/create — one-shot per projectDir change. A
  // freshly created project (initialTemplate present, possibly null for
  // "blank") seeds a first tab named PROJECT_SESSION_NAME ("main"); reopening
  // an existing project lists every *.ragsession file as a tab and loads
  // the first one.
  const seededProjectRef = useRef<string | null>(null);
  useEffect(() => {
    if (!projectDir || seededProjectRef.current === projectDir) return;
    seededProjectRef.current = projectDir;

    if (initialTemplate !== undefined) {
      setSessionTabs([{ id: PROJECT_SESSION_NAME, dirty: true }]);
      setActiveTabId(PROJECT_SESSION_NAME);
      if (initialTemplate) {
        void handleUseTemplate(initialTemplate);
      } else {
        suppressDirtyRef.current = true;
        setNodes([]);
        setEdges([]);
        setGraphName("untitled");
        const now = new Date().toISOString();
        setGraphMeta({ created: now, modified: now, notes: "" });
        pushLine("info", "blank project — canvas cleared");
      }
      initialLoadPendingRef.current = false;
      return;
    }

    void (async () => {
      // Blocks actually applied to the canvas by this reopen. Deliberately
      // NOT read from `nodes`/a ref: the closed-over state is the mount
      // value, and any ref written by an effect gated on nodes.length lags
      // behind — React defers passive effects past the microtask where the
      // `finally` below runs, so such a ref would still read 0 right after
      // applySnapshot's setNodes and open the picker over a loaded session.
      let loadedBlocks = 0;
      try {
        const names = await desktopProject.listSessions(projectDir);
        if (names.length === 0) {
          pushLine("info", `project opened — no saved "${PROJECT_SESSION_NAME}" session yet`);
          return;
        }
        setSessionTabs(names.map((id) => ({ id, dirty: false })));
        setActiveTabId(names[0]);
        loadedBlocks = await resolveAndApplySession(names[0]);
      } finally {
        initialLoadPendingRef.current = false;
        // the gated empty-canvas effect above only fires on a nodes.length
        // CHANGE — if the reopened session (or "no saved session yet")
        // leaves the canvas empty, nodes.length never changed from its
        // initial 0, so that effect won't re-fire on its own. Trigger the
        // invitation here instead, once loading has actually settled.
        if (loadedBlocks === 0 && !hydratingRef.current) {
          setTemplatePickerOpen(true);
        }
      }
    })();
  }, [projectDir, initialTemplate, handleUseTemplate, desktopProject, resolveAndApplySession, setNodes, setEdges, pushLine]);

  // ---- B-M4: load this project's composites once per projectDir change.
  // Ref-guarded like the seed effect above: `desktopProject` is a fresh
  // object every render (only its individual functions are stable), so
  // without the guard this effect body would re-run on every render, not
  // just once per project open.
  const compositesLoadedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!projectDir) {
      // Guarded: `desktopProject` is a fresh object every render (see
      // comment above), so without this guard an unconditional
      // setComposites({}) here would fire every render and never settle —
      // a real infinite-render loop caught by the full test suite, not a
      // hypothetical.
      if (compositesLoadedRef.current !== null) {
        setComposites({});
        compositesLoadedRef.current = null;
      }
      return;
    }
    if (compositesLoadedRef.current === projectDir) return;
    compositesLoadedRef.current = projectDir;
    void desktopProject.listComposites(projectDir).then((defs) => {
      setComposites(Object.fromEntries(defs.map((d) => [d.id, d])));
    });
  }, [projectDir, desktopProject]);

  // ---- toolbar: run — paid-block spend confirmation (M4b) -----------------
  // A confirmed run's total isn't a metered actual (no billing integration
  // exists) -- always phrased as an estimate, per the task's honesty rule:
  // never invent a $ figure the backend estimators didn't actually report.
  const setCostTotalFromEstimate = useCallback((paidBlocks: string[], estimated: PaidBlockEstimate[]) => {
    const totalCalls = estimated.reduce((sum, e) => sum + e.calls, 0);
    const allHaveUsd = estimated.length > 0 && estimated.every((e) => typeof e.usd === "number");
    const n = paidBlocks.length;
    const suffix = `${n} paid block${n === 1 ? "" : "s"} run`;
    if (allHaveUsd) {
      const totalUsd = estimated.reduce((sum, e) => sum + (e.usd ?? 0), 0);
      setCostTotal(`$${totalUsd.toFixed(2)} est · ${suffix}`);
    } else {
      setCostTotal(`~${totalCalls} calls est · ${suffix} (no $ pricing configured)`);
    }
  }, []);

  const resetRunStatesToIdle = useCallback(() => {
    setNodes((ns) =>
      ns.map((n) => ({ ...n, data: { ...(n.data as BlockNodeData), node: { ...(n.data as BlockNodeData).node, runState: "idle" } } })),
    );
  }, [setNodes]);

  // ---- B-M3: run history — persist one record per completed run under
  // <project>/runs/<tabId>/. Fire-and-forget: never blocks the run
  // animation, and a save failure shouldn't surface as a run failure.
  const persistRunRecord = useCallback(
    async (apiGraph: GraphDoc, result: RunResult) => {
      if (!projectDir || !activeTabId) return;
      const id = new Date().toISOString().replace(/[:.]/g, "-");
      const record: RunRecord = {
        id,
        timestamp: new Date().toISOString(),
        graph: apiGraph,
        ok: result.ok,
        failedBlock: result.failed_block,
        order: result.order,
        artifacts: result.artifacts,
      };
      await desktopProject.saveRunRecord(projectDir, activeTabId, record);
    },
    [projectDir, activeTabId, desktopProject],
  );

  const handleConfirmPaidRun = useCallback(async () => {
    const pending = pendingPaidRun;
    if (!pending) return;
    setPendingPaidRun(null);
    pushLine("info", `spend confirmed — running ${pending.paidBlocks.length} paid block(s)`);
    setNodes((ns) => ns.map((n) => ({ ...n, data: { ...(n.data as BlockNodeData), node: { ...(n.data as BlockNodeData).node, runState: "queued" } } })));

    // The record must store the SAME expanded graph the backend ran, so
    // record.order/artifacts (expanded inst__inner ids) always join
    // against record.graph.blocks.
    const expandedPaidGraph = expandComposites(pending.apiGraph, composites);
    const result = await apiRunGraph(expandedPaidGraph, { useStubs: false, confirmPaid: true });
    if (result.ok) {
      void persistRunRecord(expandedPaidGraph, result.data);
      await runLiveSteps(result.data, buildExpansionIndex(pending.apiGraph, composites));
      setCostTotalFromEstimate(pending.paidBlocks, pending.estimated);
    } else {
      const message = result.requiresConfirmation ? "backend still requires confirmation (unexpected)" : result.error;
      pushLine("error", `confirmed run failed — ${message}`);
      pushToast(`run failed: ${message}`, "error");
      resetRunStatesToIdle();
    }
    runningRef.current = false;
  }, [pendingPaidRun, setNodes, pushLine, pushToast, runLiveSteps, setCostTotalFromEstimate, resetRunStatesToIdle, persistRunRecord, composites]);

  const handleCancelPaidRun = useCallback(() => {
    setPendingPaidRun(null);
    resetRunStatesToIdle();
    pushLine("info", "paid run cancelled — nothing executed");
    runningRef.current = false;
  }, [resetRunStatesToIdle, pushLine]);

  const handleRun = useCallback(async () => {
    if (runningRef.current) return;
    const g = toAlgoGraph(nodes, edges as unknown as { id: string; source: string; sourceHandle: string | null; target: string; targetHandle: string | null }[]);
    const order = topoOrder(g);
    if (!order) {
      pushToast("cannot run: graph has a cycle", "error");
      return;
    }
    runningRef.current = true;
    setConsoleOpen(true);
    pushLine("info", `run started — ${order.length} blocks`);
    setNodes((ns) => ns.map((n) => ({ ...n, data: { ...(n.data as BlockNodeData), node: { ...(n.data as BlockNodeData).node, runState: "queued" } } })));

    const apiGraph = toGraphDoc(nodes, edges as Edge[], graphName, graphMeta);
    const expandedGraph = expandComposites(apiGraph, composites);
    const result = await apiRunGraph(expandedGraph, { useStubs: false });

    if (result.ok) {
      // persist the SAME expanded graph the backend ran — order/artifacts
      // come back keyed by expanded ids, and a record whose graph speaks
      // in un-expanded instance ids could never join against them.
      // runLiveSteps gets the expanded->instance index so the composite
      // INSTANCE node on canvas animates running/done/failed even though
      // the backend only knows the expanded inner ids (closed B-M4 gap).
      void persistRunRecord(expandedGraph, result.data);
      await runLiveSteps(result.data, buildExpansionIndex(apiGraph, composites));
      runningRef.current = false;
      return;
    }

    if (result.requiresConfirmation) {
      // Pause here: don't fall back to the simulated demo (that would run
      // FREE fake data as if it answered the paid-spend question) and don't
      // execute anything yet. Nodes go back to idle until the user decides.
      pushLine("info", `run paused — ${result.paidBlocks.length} paid block(s) need spend confirmation`);
      resetRunStatesToIdle();
      setPendingPaidRun({ apiGraph, order, paidBlocks: result.paidBlocks, estimated: result.estimated });
      return; // runningRef stays true until Confirm/Cancel resolves
    }

    if (!result.networkError) {
      // The backend WAS reachable and actively rejected this run (e.g. a
      // 400 graph_not_runnable, or any other real HTTP error) — this must
      // never be silently swapped for the fake simulated demo, or the user
      // sees fabricated success data for a run that never happened.
      const { summary, detail } = summarizeApiError(result.error);
      pushLine("error", `run rejected — ${summary}`, detail);
      pushToast(`run rejected: ${summary}`, "error");
      resetRunStatesToIdle();
      runningRef.current = false;
      return;
    }

    pushLine("info", "engine offline — showing a simulated run instead");
    await runSimulatedSteps(order);
    runningRef.current = false;
  }, [nodes, edges, graphName, graphMeta, pushLine, pushToast, setNodes, runSimulatedSteps, runLiveSteps, resetRunStatesToIdle, persistRunRecord, composites]);

  // ---- keyboard shortcuts (04 §5: Space pan, Del delete, Ctrl+D duplicate,
  // Ctrl+Enter run, Ctrl+K block search, F fit view) -------------------------
  // Del is handled by React Flow itself (see the Canvas `deleteKeyCode` prop
  // below); Space/Ctrl+K are handled by Canvas/Palette respectively. Ctrl+D
  // has no React Flow equivalent, so it is implemented here.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "f" || e.key === "F") handleFit();
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") handleRun();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (!selected) return;
        const d = selected.data as BlockNodeData;
        const id = nowId("n");
        const position = { x: selected.position.x + 40, y: selected.position.y + 40 };
        const clone: Node = {
          id,
          type: "block",
          position,
          data: {
            spec: d.spec,
            node: { id, type: d.spec.type, position, params: { ...d.node.params }, runState: "idle" },
          } satisfies BlockNodeData,
        };
        setNodes((ns) => [...ns, clone]);
        setSelectedId(id);
        pushLine("info", `duplicated ${d.spec.label} (Ctrl+D)`);
      }
    },
    [handleFit, handleRun, selected, setNodes, pushLine],
  );

  // Desktop shell only (see hook doc): native menu -> same handlers as the
  // toolbar. No-op in the browser and under tests.
  // onNewProject/onOpenProject are App.tsx's — project navigation happens
  // above this component, which is unmounted entirely while the project
  // home screen shows.
  useDesktopMenuCommands({
    onNewSession: handleRequestNewSession,
    onSave: handleSave,
    onRun: handleRun,
    onCancelRun: handleCancelPaidRun,
    onToggleConsole: () => setConsoleOpen((o) => !o),
    onToggleMinimap: () => setMinimapOpen((o) => !o),
    onFitView: handleFit,
  });

  return (
    <div className="studio-shell" onKeyDown={onKeyDown} tabIndex={-1}>
      <Toolbar
        graphName={graphName}
        onRun={handleRun}
        onAutoLayout={handleAutoLayout}
        onValidate={handleValidate}
        onFit={handleFit}
        onSave={handleSave}
        loadMenuOpen={loadMenuOpen}
        onToggleLoadMenu={handleToggleLoadMenu}
        onLoadGraph={(id) => {
          void handleLoadGraph(id);
          setLoadMenuOpen(false);
        }}
        savedGraphs={savedGraphs}
        validation={validation ? { ok: validation.ok, message: validation.message } : null}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenTemplatePicker={handleRequestNewSession}
      />
      <DocumentationPanel open={docsOpen} onClose={() => setDocsOpen(false)} />
      {projectDir && (
        <>
          <RunHistoryPanel
            open={historyOpen}
            onClose={() => setHistoryOpen(false)}
            listRunRecords={desktopProject.listRunRecords}
            loadRunRecord={desktopProject.loadRunRecord}
            onExportReport={(record) => void handleExportRunReport(record)}
            projectDir={projectDir}
            tabId={activeTabId ?? PROJECT_SESSION_NAME}
          />
          <DatasetInspectorPanel open={inspectorOpen} onClose={() => setInspectorOpen(false)} projectDir={projectDir} />
          <NamePromptDialog
            open={groupPromptOpen}
            title="New composite block"
            subtitle="Name this composite. It's saved to this project's 'My blocks' and can be reused any number of times."
            confirmLabel="Create"
            defaultName="my-composite"
            onCancel={() => setGroupPromptOpen(false)}
            onConfirm={(name) => void handleConfirmGroupIntoComposite(name)}
          />
        </>
      )}
      {editingComposite && (
        <div className="studio-shell__composite-banner" role="status">
          <span>
            Editing composite: <strong>{editingComposite.label}</strong>
          </span>
          <div className="studio-shell__composite-banner-actions">
            <button onClick={() => void handleExitCompositeEdit(false)}>Discard</button>
            <button className="primary" onClick={() => void handleExitCompositeEdit(true)}>
              Save &amp; Done
            </button>
          </div>
        </div>
      )}
      <TemplatePicker open={templatePickerOpen} onClose={handleCloseTemplatePicker} onUseTemplate={handleUseTemplate} />
      <CostConfirmSheet
        open={pendingPaidRun !== null}
        paidBlocks={pendingPaidRun?.estimated ?? []}
        blockByType={blockByType}
        onConfirm={handleConfirmPaidRun}
        onCancel={handleCancelPaidRun}
      />
      <NamePromptDialog
        open={newSessionPromptOpen}
        title="New session"
        subtitle="Name this session. You can pick a template for it next."
        confirmLabel="Create"
        defaultName={`untitled-${sessionTabs.length + 1}`}
        onCancel={() => setNewSessionPromptOpen(false)}
        onConfirm={handleConfirmNewSessionName}
      />
      <ConfirmDialog
        open={closeTabRequest !== null}
        title="Close session"
        message={`"${closeTabRequest}" has unsaved changes. Close it anyway?`}
        confirmLabel="Close without saving"
        onCancel={() => setCloseTabRequest(null)}
        onConfirm={handleConfirmCloseTab}
      />
      <ConfirmDialog
        open={draftRecoveryTabId !== null}
        title="Restore unsaved changes?"
        message={`"${draftRecoveryTabId}" has autosaved changes from a session that didn't close cleanly. Restore them, or discard and load the last saved version?`}
        confirmLabel="Restore draft"
        cancelLabel="Discard draft"
        onCancel={() => handleDraftDecision(false)}
        onConfirm={() => handleDraftDecision(true)}
      />
      <ConfirmDialog
        open={corruptFileTabId !== null}
        title="Session file corrupted"
        message={`"${corruptFileTabId}"'s saved file could not be read. Started this tab blank instead of losing the project — the corrupted file was left on disk untouched.`}
        confirmLabel="OK"
        hideCancel
        onCancel={() => setCorruptFileTabId(null)}
        onConfirm={() => setCorruptFileTabId(null)}
      />
      {projectDir && (
        <SessionTabs
          tabs={sessionTabs}
          activeTabId={activeTabId}
          onSelect={(id) => void handleSwitchTab(id)}
          onRequestClose={handleRequestCloseTab}
          onNew={handleRequestNewSession}
        />
      )}
      <div className="studio-shell__body">
        <Palette onBlockDoubleClick={onPaletteDoubleClick} blocks={blockCatalog} />
        <div className="studio-shell__canvas-wrap" onDrop={onDrop} onDragOver={onDragOver}>
          <div className="studio-shell__trigger-bar">
            <button
              type="button"
              className="studio-shell__trigger"
              onClick={() => setDocsOpen(true)}
              title="Open the block guide (what every block does, with examples)"
            >
              📖 Docs
            </button>
            {projectDir && (
              <>
                <button
                  type="button"
                  className="studio-shell__trigger"
                  onClick={() => setHistoryOpen(true)}
                  title="Browse past runs for this session (artifacts + param diffs)"
                >
                  🕘 History
                </button>
                <button
                  type="button"
                  className="studio-shell__trigger"
                  onClick={() => setInspectorOpen(true)}
                  title="Inspect this project's datasets (facts + QA pairs) against their source PDF pages"
                >
                  🔎 Dataset
                </button>
                <button
                  type="button"
                  className="studio-shell__trigger"
                  onClick={() => void handleExportSession()}
                  title="Export this session as a portable bundle (graph + pinned block versions)"
                >
                  ⬆ Export
                </button>
                <button
                  type="button"
                  className="studio-shell__trigger"
                  onClick={() => void handleImportSession()}
                  title="Import a session bundle exported from this or another project"
                >
                  ⬇ Import
                </button>
                {selectedNodeIds.length >= 2 && !editingComposite && (
                  <button
                    type="button"
                    className="studio-shell__trigger"
                    onClick={handleRequestGroupIntoComposite}
                    title="Group the selected blocks into a reusable composite"
                  >
                    ⛓ Group into block ({selectedNodeIds.length})
                  </button>
                )}
              </>
            )}
          </div>
          <Canvas
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onPaneClick={onPaneClick}
            deleteKeyCode={["Backspace", "Delete"]}
            fitView
            showMiniMap={minimapOpen}
          />
          <ToastStack toasts={toasts} />
        </div>
        <Inspector spec={selectedData?.spec ?? null} node={selectedData?.node ?? null} onParamChange={onParamChange} />
      </div>
      <Console lines={consoleLines} costTotal={costTotal} open={consoleOpen} onToggle={() => setConsoleOpen((o) => !o)} />
    </div>
  );
}
