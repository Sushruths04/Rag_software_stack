import type { GraphDoc } from "../types/graph";

/**
 * Rewrites a template graph's bundled-data paths for a concrete project.
 * Template files ship project-relative paths ("datasets/ecma404/...");
 * the engine's import blocks resolve relative paths against the BACKEND
 * process CWD, not the project folder, so hydration must stamp them to
 * absolute paths (same reason buildSampleSessions takes stamped paths).
 * Pure: deep-clones, never mutates the shared template constant. Only
 * params literally named "path" that start with "datasets/" are touched;
 * a null resolver result (no project open / browser mode) leaves the
 * relative path as-is.
 */
export async function stampTemplateGraph(
  graph: GraphDoc,
  resolveRel: (rel: string) => Promise<string | null>,
): Promise<GraphDoc> {
  const out: GraphDoc = structuredClone(graph);
  for (const block of out.blocks) {
    const p = block.params?.path;
    if (typeof p === "string" && p.startsWith("datasets/")) {
      const abs = await resolveRel(p);
      if (abs) block.params!.path = abs;
    }
  }
  return out;
}
