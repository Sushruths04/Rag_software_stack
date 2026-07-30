import type { GraphDoc } from "../types/graph";

/**
 * Small graph-algorithm helpers shared by Validate (05 §5 rule 2, no
 * cycles), the simulated Run order, and Auto-layout's topo-depth columns
 * (04 §9 A18: "staggered by topo depth 30ms"). A real ELK layout is a later
 * milestone (02_PHASE2_APP_PLAN.md M5 polish); this is a deliberately small
 * stand-in that is honest about being one.
 */

export function adjacency(graph: GraphDoc): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const b of graph.blocks) adj.set(b.id, []);
  for (const w of graph.wires) {
    if (!adj.has(w.from.block)) adj.set(w.from.block, []);
    adj.get(w.from.block)!.push(w.to.block);
  }
  return adj;
}

/** Kahn's algorithm; returns null if the graph has a cycle. */
export function topoOrder(graph: GraphDoc): string[] | null {
  const indegree = new Map<string, number>();
  for (const b of graph.blocks) indegree.set(b.id, 0);
  for (const w of graph.wires) indegree.set(w.to.block, (indegree.get(w.to.block) ?? 0) + 1);

  const adj = adjacency(graph);
  const queue = graph.blocks.filter((b) => (indegree.get(b.id) ?? 0) === 0).map((b) => b.id);
  const order: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adj.get(id) ?? []) {
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }

  return order.length === graph.blocks.length ? order : null;
}

/** BFS depth (longest path from any root) per node, used for layout columns. */
export function topoDepths(graph: GraphDoc, order: string[]): Map<string, number> {
  const depth = new Map<string, number>();
  for (const id of order) depth.set(id, 0);
  for (const w of graph.wires) {
    const d = (depth.get(w.from.block) ?? 0) + 1;
    if (d > (depth.get(w.to.block) ?? 0)) depth.set(w.to.block, d);
  }
  // one more pass in topo order so depth propagates through chains correctly
  for (const id of order) {
    for (const w of graph.wires.filter((w) => w.from.block === id)) {
      const d = (depth.get(id) ?? 0) + 1;
      if (d > (depth.get(w.to.block) ?? 0)) depth.set(w.to.block, d);
    }
  }
  return depth;
}

export interface ValidationResult {
  ok: boolean;
  message: string;
  errors: string[];
}

/** 05_BLOCK_CATALOG.md §5 — a small subset of the compiler's validation rules. */
export function validateGraph(graph: GraphDoc, portTypeOf: (blockId: string, port: string, side: "in" | "out") => string | null): ValidationResult {
  const errors: string[] = [];

  const order = topoOrder(graph);
  if (!order) errors.push("cycle detected — a graph must be a DAG (rule 2)");

  for (const w of graph.wires) {
    const fromType = portTypeOf(w.from.block, w.from.port, "out");
    const toType = portTypeOf(w.to.block, w.to.port, "in");
    if (fromType && toType && fromType !== toType) {
      errors.push(`${w.id}: ${w.from.block}.${w.from.port} (${fromType}) -> ${w.to.block}.${w.to.port} (${toType}) — type mismatch`);
    }
  }

  if (errors.length === 0) {
    return { ok: true, message: `${graph.wires.length} wires valid · ${graph.blocks.length} blocks · no cycles`, errors };
  }
  return { ok: false, message: `${errors.length} problem${errors.length === 1 ? "" : "s"} found`, errors };
}
