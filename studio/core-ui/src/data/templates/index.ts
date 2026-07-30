import type { GraphDoc } from "../../types/graph";
import { SAMPLE_A_TEMPLATE } from "./sampleA";
import { SAMPLE_B_TEMPLATE } from "./sampleB";
import { SAMPLE_C_TEMPLATE } from "./sampleC";
import { BM25_BASELINE_TEMPLATE } from "./bm25Baseline";
import { HYBRID_EVAL_TEMPLATE } from "./hybridEval";
import { TIGHT_TOPK_PRECISION_TEMPLATE } from "./tightTopkPrecision";
import { WIDE_TOPK_EXPLORATORY_TEMPLATE } from "./wideTopkExploratory";
import { EXACT_ID_MATCH_MODE_TEMPLATE } from "./exactIdMatchMode";
import { SMALL_CHUNK_RECHUNK_TEMPLATE } from "./smallChunkRechunk";
import { LARGE_CHUNK_RECHUNK_TEMPLATE } from "./largeChunkRechunk";
import { SENTENCE_RECHUNK_TEMPLATE } from "./sentenceRechunk";
import { BM25_HTML_REPORT_TEMPLATE } from "./bm25HtmlReport";
import { HYBRID_MD_REPORT_CI_TEMPLATE } from "./hybridMdReportCi";
import { NEIGHBOR_SAMPLING_DEFAULT_TEMPLATE } from "./neighborSamplingDefault";
import { NEIGHBOR_SAMPLING_TIGHT_TEMPLATE } from "./neighborSamplingTight";
import { NEIGHBOR_SAMPLING_WIDE_TEMPLATE } from "./neighborSamplingWide";
import { CLUSTER_BUILDER_DEFAULT_TEMPLATE } from "./clusterBuilderDefault";
import { CLUSTER_BUILDER_TIGHT_TEMPLATE } from "./clusterBuilderTight";
import { CAPPED_BUDGET_SAMPLING_TEMPLATE } from "./cappedBudgetSampling";
import { INSPECT_CHUNKS_ONLY_TEMPLATE } from "./inspectChunksOnly";
import { INSPECT_FACTS_AND_QA_TEMPLATE } from "./inspectFactsAndQa";
import { INSPECT_EVERYTHING_TEMPLATE } from "./inspectEverything";
import { KITCHEN_SINK_ALL_LIVE_TEMPLATE } from "./kitchenSinkAllLive";

export { SAMPLE_A_TEMPLATE, SAMPLE_B_TEMPLATE, SAMPLE_C_TEMPLATE };

/** Home-screen / picker grouping (template-library spec 2026-07-11), in
 * display order. */
export type TemplateCategory =
  | "Retrieval & Eval"
  | "Mining & Sampling"
  | "Import & Inspect"
  | "Full Pipeline";

export const TEMPLATE_CATEGORIES: readonly TemplateCategory[] = [
  "Retrieval & Eval",
  "Mining & Sampling",
  "Import & Inspect",
  "Full Pipeline",
];

export interface TemplateDef {
  id: string;
  /** Card title — the exact quoted/heading phrase from BLOCK_GUIDE.md §10. */
  title: string;
  /** Cost/time qualifier taken from the same heading's parenthetical. */
  tag: string;
  /** One-line description — the exact intro sentence from §10, verbatim. */
  description: string;
  /** Which section this card renders under in ProjectHome/TemplatePicker. */
  category: TemplateCategory;
  /** true → hydrating this template first stages the bundled ECMA-404
   * corpus into the open project (datasets/ecma404/) and stamps its
   * "datasets/..." param paths to absolute project paths. The original
   * three samples keep their illustrative paths and stay false. */
  needsSampleData: boolean;
  /** true → excluded from every user-facing gallery (ProjectHome, picker)
   * while staying in the frozen registry for tests and the live smoke suite. */
  hidden?: boolean;
  graph: GraphDoc;
}

/**
 * The three templates shown on the empty-canvas state (04_DESIGN_SYSTEM.md
 * §5 "Empty canvas state" / F1). Titles, tags, and descriptions are copied
 * verbatim from BLOCK_GUIDE.md §10 so the in-app Documentation panel and the
 * template picker never disagree about what each sample is.
 */
export const TEMPLATES: TemplateDef[] = [
  {
    id: "sample-a",
    title: "How good is retrieval on my existing dataset?",
    tag: "fully free, 5 minutes",
    description: "The fastest way to get a real number out of the studio right now.",
    category: "Retrieval & Eval",
    needsSampleData: false,
    graph: SAMPLE_A_TEMPLATE,
  },
  {
    id: "sample-b",
    title: "Turn my facts into candidate question material",
    tag: "fully free",
    description: "Shows the sampling side of the pipeline without touching generation at all.",
    category: "Mining & Sampling",
    needsSampleData: false,
    graph: SAMPLE_B_TEMPLATE,
  },
  {
    id: "sample-c",
    title: "The full v2 pipeline shape",
    tag: "mixed live + planned",
    description: "The full 22-block GT pipeline pre-wired end to end — sources through mining, generation, and gates to evaluation and report.",
    category: "Full Pipeline",
    needsSampleData: false,
    graph: SAMPLE_C_TEMPLATE,
  },
  {
    id: "bm25-baseline",
    title: "Is plain BM25 good enough?",
    tag: "fully free · baseline",
    description: "Pure lexical baseline: build a BM25 index over the sample chunks and score the shipped QA set at top-10 overlap.",
    category: "Retrieval & Eval",
    needsSampleData: true,
    graph: BM25_BASELINE_TEMPLATE,
  },
  {
    id: "hybrid-eval",
    title: "Does hybrid retrieval beat BM25?",
    tag: "fully free · hybrid",
    description: "The same evaluation as the BM25 baseline but with the hybrid (BM25 + local embeddings) index strategy — compare the two runs.",
    category: "Retrieval & Eval",
    needsSampleData: true,
    graph: HYBRID_EVAL_TEMPLATE,
  },
  {
    id: "tight-topk-precision",
    title: "How precise is my top hit?",
    tag: "fully free · precision@1",
    description: "Hybrid retrieval scored at top_k=1 — only the single best chunk counts, the strictest precision pass.",
    category: "Retrieval & Eval",
    needsSampleData: true,
    graph: TIGHT_TOPK_PRECISION_TEMPLATE,
  },
  {
    id: "wide-topk-exploratory",
    title: "How much recall hides below the top 10?",
    tag: "fully free · high recall",
    description: "Hybrid retrieval scored at top_k=50 — a wide exploratory pass that shows the recall ceiling.",
    category: "Retrieval & Eval",
    needsSampleData: true,
    graph: WIDE_TOPK_EXPLORATORY_TEMPLATE,
  },
  {
    id: "exact-id-match-mode",
    title: "Score retrieval by exact chunk ID",
    tag: "not yet runnable · needs engine support",
    description: "Scores retrieval by exact chunk-ID match instead of token overlap — the strictest possible scoring. Requires an engine capability that is still in development.",
    category: "Retrieval & Eval",
    needsSampleData: true,
    hidden: true,
    graph: EXACT_ID_MATCH_MODE_TEMPLATE,
  },
  {
    id: "small-chunk-rechunk",
    title: "Do smaller chunks retrieve better?",
    tag: "fully free · re-chunking",
    description: "Re-chunks the sample corpus with the sliding_256 strategy before indexing, then evaluates — finer granularity than the shipped chunks.",
    category: "Retrieval & Eval",
    needsSampleData: true,
    graph: SMALL_CHUNK_RECHUNK_TEMPLATE,
  },
  {
    id: "large-chunk-rechunk",
    title: "Do paragraph-sized chunks retrieve better?",
    tag: "fully free · re-chunking",
    description: "Re-chunks the sample corpus into paragraphs before indexing, then evaluates — coarser granularity than the shipped chunks.",
    category: "Retrieval & Eval",
    needsSampleData: true,
    graph: LARGE_CHUNK_RECHUNK_TEMPLATE,
  },
  {
    id: "sentence-rechunk",
    title: "What happens with one-sentence chunks?",
    tag: "fully free · re-chunking",
    description: "Re-chunks the sample corpus into single sentences before indexing, then evaluates — the finest granularity the chunker offers.",
    category: "Retrieval & Eval",
    needsSampleData: true,
    graph: SENTENCE_RECHUNK_TEMPLATE,
  },
  {
    id: "bm25-html-report",
    title: "Give me a shareable HTML eval report",
    tag: "fully free · report",
    description: "The BM25 evaluation chain finished off with the Report Builder, producing an HTML report artifact.",
    category: "Retrieval & Eval",
    needsSampleData: true,
    graph: BM25_HTML_REPORT_TEMPLATE,
  },
  {
    id: "hybrid-md-report-ci",
    title: "Give me a Markdown report with per-doc CI",
    tag: "fully free · report",
    description: "Hybrid evaluation rendered as Markdown with the per-document confidence-interval breakdown turned on.",
    category: "Retrieval & Eval",
    needsSampleData: true,
    graph: HYBRID_MD_REPORT_CI_TEMPLATE,
  },
  {
    id: "neighbor-sampling-default",
    title: "Sample neighbor pairs from my facts",
    tag: "fully free · sampling",
    description: "The default neighbor-window sampler: turns the sample facts into candidate fact pairs, no generation involved.",
    category: "Mining & Sampling",
    needsSampleData: true,
    graph: NEIGHBOR_SAMPLING_DEFAULT_TEMPLATE,
  },
  {
    id: "neighbor-sampling-tight",
    title: "Sample only tight neighbor pairs",
    tag: "fully free · sampling",
    description: "A one-fact window and tight cosine band — fewer, more-related candidate pairs than the defaults.",
    category: "Mining & Sampling",
    needsSampleData: true,
    graph: NEIGHBOR_SAMPLING_TIGHT_TEMPLATE,
  },
  {
    id: "neighbor-sampling-wide",
    title: "Sample as many neighbor pairs as possible",
    tag: "fully free · sampling",
    description: "An eight-fact window and permissive cosine band — the broadest candidate sweep the sampler supports.",
    category: "Mining & Sampling",
    needsSampleData: true,
    graph: NEIGHBOR_SAMPLING_WIDE_TEMPLATE,
  },
  {
    id: "cluster-builder-default",
    title: "Build 2+2 clusters from bridges",
    tag: "fully free · clustering",
    description: "The default cluster builder: joins the sample bridge pairs with neighboring facts into 2+2 clusters.",
    category: "Mining & Sampling",
    needsSampleData: true,
    graph: CLUSTER_BUILDER_DEFAULT_TEMPLATE,
  },
  {
    id: "cluster-builder-tight",
    title: "Build clusters with a tight cosine band",
    tag: "fully free · clustering",
    description: "Cluster building with stricter admission (min_cosine 0.6, max_cosine 0.85) than the defaults.",
    category: "Mining & Sampling",
    needsSampleData: true,
    graph: CLUSTER_BUILDER_TIGHT_TEMPLATE,
  },
  {
    id: "capped-budget-sampling",
    title: "Sample candidates on a hard budget",
    tag: "fully free · budget",
    description: "Both mining blocks side by side, with the sampler capped at 25 pairs and one use per fact — budget-controlled candidates.",
    category: "Mining & Sampling",
    needsSampleData: true,
    graph: CAPPED_BUDGET_SAMPLING_TEMPLATE,
  },
  {
    id: "inspect-chunks-only",
    title: "Just inspect my chunks",
    tag: "fully free · inspect",
    description: "A single Chunks Import and nothing else — open the Dataset Inspector and browse, zero processing.",
    category: "Import & Inspect",
    needsSampleData: true,
    graph: INSPECT_CHUNKS_ONLY_TEMPLATE,
  },
  {
    id: "inspect-facts-and-qa",
    title: "Browse facts and QA together",
    tag: "fully free · inspect",
    description: "Facts Import and QA Import side by side for Dataset Inspector browsing — no wires, no processing.",
    category: "Import & Inspect",
    needsSampleData: true,
    graph: INSPECT_FACTS_AND_QA_TEMPLATE,
  },
  {
    id: "inspect-everything",
    title: "Inspect the full raw dataset",
    tag: "fully free · inspect",
    description: "All four import blocks loaded at once — every source type browsable in the Dataset Inspector.",
    category: "Import & Inspect",
    needsSampleData: true,
    graph: INSPECT_EVERYTHING_TEMPLATE,
  },
  {
    id: "kitchen-sink-all-live",
    title: "Show me every live block at once",
    tag: "fully free · everything",
    description: "All ten live blocks in one graph: re-chunk, index, evaluate, report, plus both mining chains — the full reference layout.",
    category: "Full Pipeline",
    needsSampleData: true,
    graph: KITCHEN_SINK_ALL_LIVE_TEMPLATE,
  },
];
