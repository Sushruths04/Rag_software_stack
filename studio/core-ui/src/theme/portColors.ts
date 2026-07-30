import type { PortType } from "../types/graph";

/** 04_DESIGN_SYSTEM.md §4 / §8.4 — one color per port type, fixed forever. */
export const PORT_VAR: Record<PortType, string> = {
  pdf: "--port-pdf",
  chunks: "--port-chunks",
  facts: "--port-facts",
  bridges: "--port-bridges",
  candidates: "--port-candidates",
  qa: "--port-qa",
  index: "--port-index",
  eval: "--port-eval",
  report: "--port-report",
};

export const PORT_BADGE_VAR: Record<PortType, string> = {
  pdf: "--port-pdf-badge",
  chunks: "--port-chunks-badge",
  facts: "--port-facts-badge",
  bridges: "--port-bridges-badge",
  candidates: "--port-candidates-badge",
  qa: "--port-qa-badge",
  index: "--port-index-badge",
  eval: "--port-eval-badge",
  report: "--port-report-badge",
};

export const PORT_LABEL: Record<PortType, string> = {
  pdf: "pdf",
  chunks: "chunks",
  facts: "facts",
  bridges: "bridges",
  candidates: "candidates",
  qa: "qa",
  index: "index",
  eval: "eval",
  report: "report",
};
