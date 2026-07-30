/**
 * Merges the live backend registry (`GET /api/blocks`) with the static
 * catalog (`src/data/catalog.ts`) into the `BlockSpec[]` shape the palette
 * and inspector already render.
 *
 * The backend is authoritative for everything that drives compiler/wiring
 * behavior: port names/types/multi/required, category, and cost class. It
 * does not serialize human-facing copy (label, subtitle, purpose, backing
 * reference) or the hand-tuned default param display values (e.g. a cosine
 * band shown as "0.40-0.95") — those are presentation concerns that stay
 * in the static catalog. For a block type the static catalog already knows
 * about, this borrows that display text; for a type only the live registry
 * knows about (added in Python, not yet transcribed into catalog.ts), it
 * falls back to a generated label/params derived straight from the
 * params_schema so the block still renders usably.
 */
import type { ApiBlockSpec } from "../api/client";
import { BLOCK_BY_TYPE } from "../data/catalog";
import type { BlockCategory, BlockSpec, ParamSpec, PortSpec, PortType } from "../types/graph";

function toPortSpec(p: ApiBlockSpec["inputs"][number]): PortSpec {
  return { name: p.name, type: p.type as PortType, multi: p.multi, optional: !p.required };
}

function paramSpecsFromSchema(block: ApiBlockSpec): ParamSpec[] {
  const props = block.params_schema.properties ?? {};
  return Object.entries(props).map(([key, prop]) => ({
    key,
    label: prop.title ?? key,
    value: prop.default === undefined ? "" : String(prop.default),
    locked: block.locked_params.includes(key),
    isDefault: prop.default !== undefined,
  }));
}

function subtitleFor(block: ApiBlockSpec): string {
  return `${block.category} · ${block.cost === "paid" ? "PAID" : "FREE"}`;
}

export function mergeLiveBlocks(apiBlocks: ApiBlockSpec[]): BlockSpec[] {
  return apiBlocks.map((block) => {
    const fallback = BLOCK_BY_TYPE[block.type];
    return {
      type: block.type,
      category: block.category as BlockCategory,
      cost: block.cost,
      label: fallback?.label ?? block.type,
      subtitle: fallback?.subtitle ?? subtitleFor(block),
      purpose: fallback?.purpose ?? "",
      inputs: block.inputs.map(toPortSpec),
      outputs: block.outputs.map(toPortSpec),
      defaultParams: fallback?.defaultParams ?? paramSpecsFromSchema(block),
      backing: fallback?.backing ?? "",
    };
  });
}
