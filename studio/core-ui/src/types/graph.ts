/**
 * Graph JSON schema + block/port type system.
 * Mirrors 02_PHASE2_APP_PLAN.md "Graph file schema (schema_version: 1)" and
 * 05_BLOCK_CATALOG.md §1 (port types) / §3 (blocks).
 *
 * This file has no backend dependency — it is the contract the frontend
 * scaffolds against ahead of `GET /api/blocks` (M1 in 02_PHASE2_APP_PLAN.md).
 * Once that endpoint exists, `BLOCK_CATALOG` in src/data/catalog.ts becomes a
 * fetched value instead of a static one; these types stay the same.
 */

/** 05_BLOCK_CATALOG.md §1 — one color per port type, fixed forever. */
export type PortType =
  | "pdf"
  | "chunks"
  | "facts"
  | "bridges"
  | "candidates"
  | "qa"
  | "index"
  | "eval"
  | "report";

/** 05_BLOCK_CATALOG.md §3 category headings == 04_DESIGN_SYSTEM.md §8.5 tints.
 * "composite" is B-M4's addition — project-local "Group into block" results,
 * not part of the original 33-block catalog. */
export type BlockCategory =
  | "sources"
  | "extraction"
  | "mining"
  | "generation"
  | "gates"
  | "assembly"
  | "retrieval"
  | "utility"
  | "composite";

export type CostClass = "free" | "paid";

export interface PortSpec {
  /** stable port name, unique within its side of the block */
  name: string;
  type: PortType;
  /** stacked-square shape (04 §8.4) — this port accepts multiple wires */
  multi?: boolean;
  /** shown on hover / in Inspector port docs */
  doc?: string;
  /** optional-input ports (e.g. Provenance Join's qa source-of-truth) */
  optional?: boolean;
}

export interface ParamSpec {
  key: string;
  label: string;
  /** string form for display; the demo graph never needs real typed values */
  value: string;
  /** 05 §5 rule 5 — gate thresholds are read-only outside expert mode */
  locked?: boolean;
  /** true when the value equals the catalog default (renders italic, 04 §3) */
  isDefault?: boolean;
}

/** One entry in the block catalog (05_BLOCK_CATALOG.md §3). */
export interface BlockSpec {
  type: string;
  category: BlockCategory;
  cost: CostClass;
  /** short display name, e.g. "Cluster Builder 2+2" */
  label: string;
  /** subtitle row under the title, e.g. "sampling · FREE" */
  subtitle: string;
  /** one-line purpose, used in palette tooltips + Inspector */
  purpose: string;
  inputs: PortSpec[];
  outputs: PortSpec[];
  /** default param rows shown on a freshly-dropped node */
  defaultParams: ParamSpec[];
  /** backing engine reference, shown in Inspector "implementation" row */
  backing: string;
}

/** Live per-run meta for a node's output ports, drives the meta line + badges. */
export interface RunMeta {
  /** short mono line under the node body, e.g. "147 clusters · 25 fallback" */
  metaLine?: string;
  /** per-port wire badge text, e.g. { facts: "118 facts · grounded" } */
  portBadges?: Partial<Record<string, string>>;
  error?: string;
}

export type RunState = "idle" | "queued" | "running" | "done" | "failed";

/** Graph node — position + reference into the block catalog + param overrides. */
export interface GraphBlockNode {
  id: string;
  type: string; // BlockSpec.type
  position: { x: number; y: number };
  /** overrides merged onto BlockSpec.defaultParams by key */
  params?: Record<string, string>;
  runState?: RunState;
  runMeta?: RunMeta;
}

export interface WireEndpoint {
  block: string;
  port: string;
}

export interface GraphWire {
  id: string;
  from: WireEndpoint;
  to: WireEndpoint;
  /** filled in after the upstream block runs (04 §4 wire badge) */
  badge?: string;
  /** thicker wire for heavier payloads (04 §8.4 / 06 Blender lesson) */
  weight?: "normal" | "heavy";
}

export interface GraphMeta {
  created: string;
  modified: string;
  notes: string;
}

/** Top-level `.graft.json` document (02_PHASE2_APP_PLAN.md graph schema). */
export interface GraphDoc {
  schema_version: 1;
  name: string;
  blocks: GraphBlockNode[];
  wires: GraphWire[];
  meta: GraphMeta;
}
