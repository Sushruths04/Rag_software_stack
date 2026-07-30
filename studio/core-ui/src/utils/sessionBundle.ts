/**
 * B-M5: session export/import. A bundle pins the graph together with a
 * snapshot of the block-catalog entries it was built against (type/
 * category/cost/label only — enough to detect drift, not a full spec
 * dump) so opening the bundle later, possibly against a newer catalog,
 * can say something concrete about what changed instead of silently
 * rendering wrong or crashing on an unknown block type.
 *
 * "Import with migration prompts" (03_PHASE2_SOFTWARE_PLAN.md §B-M5) is
 * scoped here to a compatibility WARNING, not field-by-field migration:
 * schema_version has only ever been 1, so there is nothing to migrate
 * from yet. checkBundleCompatibility is the real, useful part of that
 * requirement today; a version-bump migration path is a future item
 * once schema_version 2 actually exists.
 */
import type { BlockSpec, GraphDoc } from "../types/graph";
import type { CompositeDef } from "./composite";

export const SESSION_BUNDLE_SCHEMA_VERSION = 1;

export type SessionBundleGraph = GraphDoc & { viewport?: { x: number; y: number; zoom: number } };

export interface CatalogSnapshotEntry {
  type: string;
  category: BlockSpec["category"];
  cost: BlockSpec["cost"];
  label: string;
}

export interface SessionExportBundle {
  exportSchemaVersion: typeof SESSION_BUNDLE_SCHEMA_VERSION;
  exportedAt: string;
  session: SessionBundleGraph;
  blockCatalogSnapshot: CatalogSnapshotEntry[];
  /** Composite definitions the session's graph uses. Composites are
   * project-local (blocks/<id>.json), so unlike engine blocks they must
   * TRAVEL with the bundle or the session can never render or run on the
   * receiving side. Optional: bundles exported before this field existed
   * simply don't have it. */
  composites?: CompositeDef[];
}

/** Snapshots only the catalog entries the graph actually references, not
 * the full 30+ block catalog every time -- keeps the bundle small and
 * keeps checkBundleCompatibility's warnings limited to blocks this
 * session genuinely depends on. */
export function buildSessionExportBundle(
  session: SessionBundleGraph,
  blockCatalog: BlockSpec[],
  exportedAt: string,
  composites?: CompositeDef[],
): SessionExportBundle {
  const usedTypes = new Set(session.blocks.map((b) => b.type));
  const usedComposites = (composites ?? []).filter((c) => usedTypes.has(c.id));
  return {
    exportSchemaVersion: SESSION_BUNDLE_SCHEMA_VERSION,
    exportedAt,
    session,
    blockCatalogSnapshot: blockCatalog
      .filter((b) => usedTypes.has(b.type))
      .map((b) => ({ type: b.type, category: b.category, cost: b.cost, label: b.label })),
    ...(usedComposites.length > 0 ? { composites: usedComposites } : {}),
  };
}

export interface BundleCompatibilityWarning {
  /** block types the graph actually uses that the CURRENT catalog no longer has — these blocks will fail to render/expand. */
  missingTypes: string[];
  /** block types that still exist but whose label changed since export — cosmetic, not fatal. */
  changedLabels: Array<{ type: string; from: string; to: string }>;
}

/** Returns null when the bundle's pinned catalog snapshot is fully
 * consistent with `currentCatalog` for every block type the session
 * graph actually references. */
export function checkBundleCompatibility(bundle: SessionExportBundle, currentCatalog: BlockSpec[]): BundleCompatibilityWarning | null {
  const currentByType = new Map(currentCatalog.map((b) => [b.type, b]));
  // composite defs embedded in the bundle install on import — not missing
  const bundledComposites = new Set((bundle.composites ?? []).map((c) => c.id));
  const usedTypes = [...new Set(bundle.session.blocks.map((b) => b.type))];
  const missingTypes = usedTypes.filter((t) => !currentByType.has(t) && !bundledComposites.has(t));

  const changedLabels: BundleCompatibilityWarning["changedLabels"] = [];
  for (const snap of bundle.blockCatalogSnapshot) {
    const current = currentByType.get(snap.type);
    if (current && current.label !== snap.label) {
      changedLabels.push({ type: snap.type, from: snap.label, to: current.label });
    }
  }

  if (missingTypes.length === 0 && changedLabels.length === 0) return null;
  return { missingTypes, changedLabels };
}
