/**
 * Task 10 — content-shape classification for a JSON file dropped into
 * importCorpus. Deliberately ignores filenames: the pipeline produces
 * facts/chunks/qa files under whatever name a run happened to give them, so
 * the only reliable signal is the shape of the parsed content itself,
 * matched against the real field names those stages emit (fact_id+bboxes,
 * chunk_id+text, qa_id, or a `pairs` array for a full QA-set document).
 */

export type DatasetKind = "facts" | "qa" | "chunks" | "unknown";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function classifyDatasetJson(parsed: unknown): DatasetKind {
  if (Array.isArray(parsed)) {
    const first = parsed[0];
    if (isRecord(first)) {
      if ("fact_id" in first && "bboxes" in first) return "facts";
      if ("chunk_id" in first && "text" in first) return "chunks";
      if ("qa_id" in first) return "qa";
    }
    return "unknown";
  }
  if (isRecord(parsed) && Array.isArray(parsed.pairs)) return "qa";
  return "unknown";
}
