import type { BlockSpec, ParamSpec } from "../types/graph";

/**
 * Merges a node's param overrides (graph JSON `params: Record<string,string>`)
 * onto the block's catalog defaults, keyed by ParamSpec.key. Overridden rows
 * lose `isDefault` (04 §3: "editable inline; locked params show a lock icon,
 * default values render italic" — italic-vs-not is driven by isDefault).
 */
export function mergeParams(spec: BlockSpec, overrides?: Record<string, string>): ParamSpec[] {
  if (!overrides) return spec.defaultParams;
  return spec.defaultParams.map((p) => {
    const ov = overrides[p.key];
    if (ov === undefined || ov === p.value) return p;
    return { ...p, value: ov, isDefault: false };
  });
}
