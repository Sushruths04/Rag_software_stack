import type { Edge, Node } from "@xyflow/react";
import type { BlockSpec, GraphDoc, GraphMeta } from "../types/graph";
import { BLOCK_BY_TYPE } from "../data/catalog";
import type { BlockNodeData } from "../components/BlockNode/BlockNode";
import type { WireData } from "../components/Wire/Wire";

/**
 * GraphDoc (engine-facing schema) -> React Flow nodes/edges (canvas-facing).
 *
 * ``blockByType`` defaults to the static catalog but accepts the live
 * registry's merged spec map too (see ``src/utils/liveCatalog.ts``) so a
 * graph loaded from the backend renders with whichever catalog is current.
 */
/** Placeholder spec for a block type the current catalog doesn't know
 * (a bundle imported from another project, a retired catalog entry, a
 * composite whose definition file was deleted). Rendering it as an inert
 * "unknown" block keeps the graph visible and editable instead of letting
 * BlockNode crash the whole shell on `spec.category` — the type is
 * preserved verbatim so Save/toGraphDoc round-trips without corruption. */
export function unknownBlockSpec(type: string): BlockSpec {
  return {
    type,
    category: "utility",
    cost: "free",
    label: "Unknown block",
    subtitle: type,
    purpose: `Block type "${type}" is not available in the current catalog — it cannot run until the missing block (or composite definition) is restored.`,
    inputs: [],
    outputs: [],
    defaultParams: [],
    backing: `missing:${type}`,
  };
}

export function graphToFlow(
  graph: GraphDoc,
  blockByType: Record<string, BlockSpec> = BLOCK_BY_TYPE,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = graph.blocks.map((b) => {
    const spec = blockByType[b.type] ?? unknownBlockSpec(b.type);
    return {
      id: b.id,
      type: "block",
      position: b.position,
      data: { spec, node: b } satisfies BlockNodeData,
    };
  });

  const edges: Edge[] = graph.wires.map((w) => {
    const spec = blockByType[graph.blocks.find((b) => b.id === w.from.block)?.type ?? ""];
    const portSpec = spec?.outputs.find((p) => p.name === w.from.port);
    const portType = portSpec?.type ?? "facts";
    return {
      id: w.id,
      type: "wire",
      source: w.from.block,
      sourceHandle: w.from.port,
      target: w.to.block,
      targetHandle: w.to.port,
      data: {
        portType,
        badge: w.badge,
        typeName: portType,
        weight: w.weight,
      } satisfies WireData,
    };
  });

  return { nodes, edges };
}

/**
 * React Flow nodes/edges (canvas-facing) -> GraphDoc (engine-facing schema).
 * The inverse of ``graphToFlow``; used by Save. Reads position from the
 * node's live ``position`` (kept current by React Flow's own drag handling)
 * and params from ``data.node.params`` (kept current by StudioShell's
 * ``onParamChange``), not from the possibly-stale ``data.node`` snapshot
 * taken at drop time.
 */
export function toGraphDoc(nodes: Node[], edges: Edge[], name: string, meta: GraphMeta): GraphDoc {
  return {
    schema_version: 1,
    name,
    meta,
    blocks: nodes.map((n) => {
      const d = n.data as BlockNodeData;
      return {
        id: n.id,
        type: d.spec.type,
        position: { x: n.position.x, y: n.position.y },
        params: d.node.params ?? {},
      };
    }),
    wires: edges.map((e) => {
      const data = e.data as WireData | undefined;
      return {
        id: e.id,
        from: { block: e.source, port: e.sourceHandle ?? "" },
        to: { block: e.target, port: e.targetHandle ?? "" },
        badge: data?.badge,
        weight: data?.weight,
      };
    }),
  };
}

/**
 * Copy of a GraphDoc safe to POST to the backend: wire `badge`/`weight`
 * are canvas display state; the backend Wire model is extra="forbid" and
 * rejects them (observed: 28 validation errors running the demo graph).
 * Local .ragsession saves intentionally do NOT use this — reopened
 * sessions keep their last-run badges.
 */
export function stripGraphForApi(graph: GraphDoc): GraphDoc {
  return {
    ...graph,
    wires: graph.wires.map(({ badge: _badge, weight: _weight, ...w }) => w),
  };
}

export function portTypeLookup(graph: GraphDoc) {
  return (blockId: string, port: string, side: "in" | "out"): string | null => {
    const block = graph.blocks.find((b) => b.id === blockId);
    if (!block) return null;
    const spec = BLOCK_BY_TYPE[block.type];
    if (!spec) return null;
    const list = side === "in" ? spec.inputs : spec.outputs;
    return list.find((p) => p.name === port)?.type ?? null;
  };
}
