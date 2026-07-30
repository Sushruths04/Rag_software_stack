/**
 * B-M4: composite blocks (sub-graphs). A composite is a project-local block
 * whose "backing" is a subgraph of REAL block types rather than a Python
 * adapter — created via "Group into block" on a canvas selection. Composite
 * instances live inside a session graph exactly like any other node; only
 * at compile time (right before Validate/Run) do they get expanded back
 * into their constituent blocks+wires via `expandComposites`, so the
 * Python backend never needs to know composites exist.
 *
 * No nested composites: StudioShell's "Group into block" handlers REJECT a
 * selection that contains a composite instance (with a toast), so a
 * composite's own `blocks` are always real backend block types and
 * expandComposites does not need to recurse. This is an enforced guard,
 * not a by-construction guarantee — composite instances are ordinary,
 * selectable canvas nodes.
 */
import type { Edge, Node } from "@xyflow/react";
import type { BlockSpec, CostClass, GraphBlockNode, GraphDoc, GraphWire, PortType, WireEndpoint } from "../types/graph";

export interface CompositePort {
  /** the inner block+port this exposes, e.g. for building the composite's
   * own port name ("<block>.<port>") and its label. */
  block: string;
  port: string;
  type: PortType;
  label: string;
}

export interface CompositeDef {
  id: string;
  label: string;
  blocks: GraphBlockNode[];
  wires: GraphWire[];
  exposedInputs: CompositePort[];
  exposedOutputs: CompositePort[];
}

/**
 * A port is exposed when nothing INSIDE the selection fills it (inputs) or
 * consumes it (outputs) — the frontier of the selected subgraph. This
 * slightly over-exposes outputs that happen to be unused by the composite's
 * caller (harmless: an unwired output port is just unused) rather than
 * trying to infer "the one true final output," which would be wrong for
 * composites with genuinely multiple outputs.
 */
export function buildCompositeFromSelection(
  selectedNodeIds: string[],
  allBlocks: GraphBlockNode[],
  allWires: GraphWire[],
  blockByType: Record<string, BlockSpec>,
  id: string,
  label: string,
): CompositeDef {
  const selected = new Set(selectedNodeIds);
  const blocks = allBlocks.filter((b) => selected.has(b.id));
  const wires = allWires.filter((w) => selected.has(w.from.block) && selected.has(w.to.block));

  const exposedInputs: CompositePort[] = [];
  const exposedOutputs: CompositePort[] = [];

  for (const block of blocks) {
    const spec = blockByType[block.type];
    if (!spec) continue;
    for (const input of spec.inputs) {
      const fed = wires.some((w) => w.to.block === block.id && w.to.port === input.name);
      if (!fed) exposedInputs.push({ block: block.id, port: input.name, type: input.type, label: `${spec.label} · ${input.name}` });
    }
    for (const output of spec.outputs) {
      const consumed = wires.some((w) => w.from.block === block.id && w.from.port === output.name);
      if (!consumed) exposedOutputs.push({ block: block.id, port: output.name, type: output.type, label: `${spec.label} · ${output.name}` });
    }
  }

  return { id, label, blocks, wires, exposedInputs, exposedOutputs };
}

/** Composite ports are named "<innerBlockId>.<innerPort>" — deterministic,
 * collision-free (inner block ids are already unique within the
 * composite), and self-describing for expandComposites to reverse. */
export function compositeToBlockSpec(def: CompositeDef, cost: CostClass): BlockSpec {
  return {
    type: def.id,
    category: "composite",
    cost,
    label: def.label,
    subtitle: `composite · ${def.blocks.length} block${def.blocks.length === 1 ? "" : "s"}`,
    purpose: `Composite block grouping ${def.blocks.length} inner blocks. Double-click to edit.`,
    inputs: def.exposedInputs.map((p) => ({ name: `${p.block}.${p.port}`, type: p.type, doc: p.label })),
    outputs: def.exposedOutputs.map((p) => ({ name: `${p.block}.${p.port}`, type: p.type, doc: p.label })),
    defaultParams: [],
    backing: `composite:${def.id}`,
  };
}

/** A composite is paid iff any block inside it is paid — the instance's
 * badge must not undersell that money is involved (the backend still
 * enforces spend confirmation on the expanded graph either way). Unknown
 * inner types (spec missing) count as free rather than crashing. */
export function compositeCost(def: CompositeDef, blockByType: Record<string, BlockSpec>): CostClass {
  return def.blocks.some((b) => blockByType[b.type]?.cost === "paid") ? "paid" : "free";
}

/** After "Save & Done" edits a composite, instance nodes on canvas still
 * hold the spec captured when they were dropped — stale ports render, and
 * a wire attached to an exposed port that no longer exists would expand to
 * a nonexistent inner block. Swap every instance's spec for the new one
 * and drop wires whose composite-side handle is gone. */
export function refreshCompositeInstances(
  nodes: Node[],
  edges: Edge[],
  def: CompositeDef,
  spec: BlockSpec,
): { nodes: Node[]; edges: Edge[]; droppedWireIds: string[] } {
  const instanceIds = new Set(
    nodes.filter((n) => (n.data as { node?: { type?: string } }).node?.type === def.id).map((n) => n.id),
  );
  const refreshedNodes = nodes.map((n) => (instanceIds.has(n.id) ? { ...n, data: { ...n.data, spec } } : n));

  const inputNames = new Set(spec.inputs.map((p) => p.name));
  const outputNames = new Set(spec.outputs.map((p) => p.name));
  const droppedWireIds: string[] = [];
  const keptEdges = edges.filter((e) => {
    const badSource = instanceIds.has(e.source) && !outputNames.has(e.sourceHandle ?? "");
    const badTarget = instanceIds.has(e.target) && !inputNames.has(e.targetHandle ?? "");
    if (badSource || badTarget) {
      droppedWireIds.push(e.id);
      return false;
    }
    return true;
  });

  return { nodes: refreshedNodes, edges: keptEdges, droppedWireIds };
}

/** Reverse map for the live-run animation: every id expandComposites will
 * emit for a composite member (`<instanceId>__<innerId>`) -> the instance
 * node id still on canvas. Built from the same doc+composites inputs as
 * expandComposites (never by string-splitting result ids, which would
 * misfire on any plain block id that happens to contain "__"). */
export function buildExpansionIndex(doc: GraphDoc, composites: Record<string, CompositeDef>): Record<string, string> {
  const index: Record<string, string> = {};
  for (const block of doc.blocks) {
    const def = composites[block.type];
    if (!def) continue;
    for (const inner of def.blocks) index[`${block.id}__${inner.id}`] = block.id;
  }
  return index;
}

function resolveEndpoint(endpoint: WireEndpoint, blockType: Map<string, string>, composites: Record<string, CompositeDef>): WireEndpoint {
  const type = blockType.get(endpoint.block);
  const def = type ? composites[type] : undefined;
  if (!def) return endpoint;
  const dot = endpoint.port.indexOf(".");
  if (dot === -1) return endpoint; // malformed — leave as-is rather than throw
  const innerBlockId = endpoint.port.slice(0, dot);
  const innerPort = endpoint.port.slice(dot + 1);
  return { block: `${endpoint.block}__${innerBlockId}`, port: innerPort };
}

/** Replaces every composite-instance node with its inner blocks/wires
 * (ids namespaced `<instanceId>__<innerId>` so two instances of the same
 * composite never collide), and rewires any external wire that touched the
 * instance's exposed ports to the correct inner block+port. Call this on
 * the graph right before POSTing to /api/graphs/validate or .../run — the
 * canvas itself keeps showing the un-expanded composite node. */
export function expandComposites(doc: GraphDoc, composites: Record<string, CompositeDef>): GraphDoc {
  const blockType = new Map(doc.blocks.map((b) => [b.id, b.type]));
  const blocks: GraphBlockNode[] = [];
  const wires: GraphWire[] = [];

  for (const block of doc.blocks) {
    const def = composites[block.type];
    if (!def) {
      blocks.push(block);
      continue;
    }
    for (const inner of def.blocks) blocks.push({ ...inner, id: `${block.id}__${inner.id}` });
    for (const inner of def.wires) {
      wires.push({
        ...inner,
        id: `${block.id}__${inner.id}`,
        from: { block: `${block.id}__${inner.from.block}`, port: inner.from.port },
        to: { block: `${block.id}__${inner.to.block}`, port: inner.to.port },
      });
    }
  }

  for (const wire of doc.wires) {
    wires.push({
      ...wire,
      from: resolveEndpoint(wire.from, blockType, composites),
      to: resolveEndpoint(wire.to, blockType, composites),
    });
  }

  return { ...doc, blocks, wires };
}
