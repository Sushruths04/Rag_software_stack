# GRAFT Block Studio — Block Guide

This is the complete reference for every block you can drop on the canvas:
what it does, what goes in, what comes out, every parameter, a worked
example, and where it usually connects. Read §1 first if you're new — it
explains the concepts every block shares. Then either browse by category
(§2–9) or jump straight to §10 for ready-to-build sample pipelines.

This file is the single source of truth for block documentation — the
in-app "Documentation" panel renders this exact file, so what you read here
is exactly what you'll see in the app.

---

## 1. Getting started — concepts you need before your first block

**A block** is one step of a pipeline: import some data, transform it, gate
it, or measure it. Every block has a **name**, a **category** (shown as a
colored tint on its left edge), a **cost class**, zero or more **input
ports** (left side), zero or more **output ports** (right side), and a set
of **parameters** you can edit in the Inspector panel.

**A wire** connects one block's output port to another block's input port.
Wires are typed — you can only connect a `facts` output to a `facts` input,
never to a `chunks` input. If you try, the studio refuses the connection and
tells you why. This is deliberate: it is the mechanism that stops you from
building a pipeline that would fail halfway through a paid run.

**Port types** — the "shape" of data flowing on a wire. Every type has a
fixed color everywhere in the app (palette, ports, wires):

| type | color | what it carries | example wire badge |
|---|---|---|---|
| `pdf` | violet | one source PDF | `46 pages` |
| `chunks` | blue | a document split into retrievable pieces | `210 chunks` |
| `facts` | teal | atomic, grounded claims extracted from chunks | `118 facts · grounded` |
| `bridges` | orange | verified pairs of facts that share a concept across pages | `172 pairs` |
| `candidates` | sand | pre-question-generation groupings (pairs/clusters) | `52 pairs · 147 clusters` |
| `qa` | green | actual question–answer records | `86 QA · 33 multi-hop` |
| `index` | cyan | a built retrieval index | `bm25 · 210 docs` |
| `eval` | magenta | retrieval evaluation results | `recall@5 0.698` |
| `report` | silver | a rendered output file | `report.html` |

Once a block has run, its output wire shows a **badge** — a small chip with
the real number that came out (not a placeholder). That's how you read a
pipeline's health at a glance without opening anything.

**Cost class** — every block is either:
- **FREE** — runs locally, instantly, no API calls, no cost. Most blocks are
  free: importing files, sampling, filtering, gating, indexing, evaluating.
- **PAID** — calls a real language model. Shown with an amber `$` badge. The
  studio estimates the call count before you run anything that touches a
  paid block and asks you to confirm — you cannot spend money by accident.

**Live vs. planned** — this app is being built incrementally. Every block
below is marked:
- ✅ **Live** — really executes against your real data right now.
- 🚧 **Planned** — exists on the canvas, fully documented, but the backend
  still returns a stand-in result. You can build with it and see how it
  would wire in; running it doesn't yet call the real engine.

As of this writing, **10 blocks are live**: Chunks Import, Facts Import,
Bridge Pairs Import, QA Dataset Import, Chunker, Neighbor Pair Sampler,
Cluster Builder 2+2, Index Builder, Retrieval Evaluator, Report Builder.
Everything else is planned. This list only grows — check back or see
`future_software_RAG_GT/CLAUDE.md` for the current state.

**Locked parameters** — a few gate thresholds (shown with a 🔒) are
read-only. These are the exact numbers that were validated against real
data during development (see §5 Gates). Changing them isn't blocked
forever — turn on "expert mode" in settings — but any dataset you export
under changed thresholds is flagged so you never mistake it for the
validated default.

---

## 2. Sources & Imports

Blocks with no inputs — every pipeline starts with one or more of these.

### PDF Source `pdf_source` 🚧 planned · FREE
Registers one source PDF so later blocks can reference it (mainly used by
the Evidence Viewer, §7, to show highlighted pages).
- **In:** none. **Out:** `pdf`.
- **Params:** `path` (file path to the PDF), `display_name` (human label
  shown on the node), `doc_id` (short id used to match this PDF against
  facts/chunks that reference the same document).
- **Example:** path `data/test_corpus_allpdf/din_iso_6507_vickers.pdf`,
  display_name "DIN ISO 6507 — Vickers Hardness", doc_id
  `din_iso_6507_vickers`.

### Chunks Import `chunks_import` ✅ live · FREE
Loads an already-chunked document — the retrievable pieces a document was
split into upstream of this app.
- **In:** none. **Out:** `chunks`.
- **Param:** `path`, defaulting to the pattern
  `pipeline_run/<doc>_phase2/checkpoints/s2_chunks_full.json`.
- **Example:** set `path` to
  `data/test_corpus_allpdf/pipeline_run/din_iso_6507_vickers_phase2/checkpoints/s2_chunks_full.json`
  → output badge reads something like `chunks · 202 items`.

### Facts Import `facts_import` ✅ live · FREE
Loads a set of grounded facts — the atomic claims already extracted and
tied back to real chunk IDs and page/bbox locations.
- **In:** none. **Out:** `facts`.
- **Param:** `path`, defaulting to
  `data/eval_results/facts_v1_grounded/facts_<doc>.json`.
- **Example:** `path =
  data/eval_results/facts_v1_grounded/facts_din_iso_6507_vickers_full.json`
  → badge `118 facts · grounded`. This is the exact file the shipped v3
  dataset was built from.

### Bridge Pairs Import `bridges_import` ✅ live · FREE
Loads already-mined bridge pairs — two facts on different pages verified to
share a concept (the raw material for multi-hop questions).
- **In:** none. **Out:** `bridges`.
- **Param:** `path`.
- **Example:** `path = data/eval_results/allpdf_bridge_pairs_clean.json` →
  badge `172 pairs` for din_iso_6507 alone.

### QA Dataset Import `qa_import` ✅ live · FREE
Loads an existing generated dataset — for re-evaluating or re-verifying
something you already built, without regenerating it. Accepts either a bare
array of QA records or a wrapper document with a `pairs` array (the shape
most full-dataset exports use) — the loader normalizes both.
- **In:** none. **Out:** `qa`.
- **Param:** `path`.
- **Example:** point it at
  `data/eval_results/allpdf_v2_gt_r3/final/din_iso_6507_vickers_full.json`
  to re-run the evaluator on the shipped round-3 dataset without spending
  anything on regeneration. This is exactly the block used by the sample
  project's free evaluation session (§10).

---

## 3. Extraction & Cleaning

Turn raw chunks into clean, well-formed facts.

### Chunker `chunker` ✅ live · FREE
Re-splits a chunk set with a different strategy — useful for comparing how
retrieval behaves under different chunking.
- **In:** `chunks`. **Out:** `chunks`.
- **Params:** `strategy` (`original` | `sentence` | `sliding_256` |
  `paragraph`), `window` (default 256, tokens per chunk for the sliding
  strategy), `overlap` (default 32).
- **Example:** feed it Chunks Import's output with `strategy=sentence` →
  badge changes from `202 chunks` to something like `1,140 chunks` (one
  chunk per sentence instead of per page-section).

### LLM Fact Extractor `fact_extract_llm` 🚧 planned · **PAID**
Reads chunks and asks a language model to extract atomic factual claims
from them — the very first step if you're starting from a PDF with no
facts yet.
- **In:** `chunks`. **Out:** `facts` (ungrounded — needs Provenance Join
  afterward).
- **Params:** `model_role` (default `extractor`), `batch_size` (default 8).
- **Example:** 202 chunks in → roughly 400–600 raw facts out, one call per
  batch of 8 chunks (~25 calls).

### Debris Filter `fact_debris_filter` 🚧 planned · FREE
Drops facts that are extraction noise, not real claims — shredded equations,
figure-key fragments, that sort of thing.
- **In:** `facts`. **Out:** `facts`.
- **Params:** `symbol_density_threshold` (default 0.4 — a fact whose
  non-alphabetic character ratio exceeds this is dropped), `drop_equations`
  (default on), `drop_figure_keys` (default on, drops things like "Key 1
  edge of test piece...").
- **Example:** 550 raw facts in → ~500 clean facts out, having dropped
  things like `"U k u u u M H ms E 2 2 2 2 2 = … + …"`.

### Fact Clause Splitter `fact_splitter` 🚧 planned · FREE
Splits a long fact carrying two or more separate claims into shorter
single-claim facts, keeping the same source chunk/page/bbox on each piece.
- **In:** `facts`. **Out:** `facts`.
- **Param:** `max_tokens` (default 45 — a fact longer than this with 2+
  predicates gets split).
- **Example:** "The specification defines ranges for essential variables
  AND each range must be recorded before qualification" (one 60-token fact)
  → two ~25-token facts, both still pointing at the original chunk.

### Provenance Join `provenance_join` 🚧 planned · FREE
Attaches real chunk IDs, page numbers, and bounding boxes to facts that
don't have them yet — turning "ungrounded" facts (e.g. straight from the
LLM Fact Extractor) into "grounded" facts every downstream block requires.
Always joins by exact fact ID, never by fuzzy text matching.
- **In:** `facts` (required), `qa` (optional — a verified dataset to use as
  the source of truth for the mapping). **Out:** `facts` (grounded).
- **Param:** `verified_gt_path` (path to the verified ground truth file
  supplying the id→chunk/page/bbox mapping).
- **Example:** 553 ungrounded facts in, `verified_gt_path =
  data/eval_results/allpdf_qa_pairs_verified_bbox.json` → badge
  `547 facts · grounded` (the 6 that don't appear in the verified set stay
  unmapped and are reported, not silently dropped).

---

## 4. Mining & Sampling

Find the raw material for questions: pairs and groups of facts that could
become one question together.

### Bridge Miner `bridge_miner` 🚧 planned · FREE (PAID only if `cosine_scorer=api`)
Scans a fact set for pairs on different pages that share a concept —
candidate "bridges" for multi-hop questions.
- **In:** `facts`. **Out:** `bridges`.
- **Params:** `bridge_types` (default `["shared_entity"]`), `min_page_spread`
  (default 1 — how many pages apart the two facts must be), `cosine_scorer`
  (`off` | `local` | `api` — whether to also require embedding similarity;
  `api` makes this a paid block).
- **Example:** 118 facts in → `172 pairs` out for din_iso_6507, bridges like
  "Vickers microhardness" linking page 17 to page 43.

### Bridge Quality Filter `bridge_quality` 🚧 planned · FREE
Rejects bridge pairs whose shared "concept" is actually junk — a stopword
phrase, an OCR artifact, or too generic to mean anything. Where the surface
is a repairable OCR split (like "di erent"), it repairs it and re-checks
rather than blindly discarding it.
- **In:** `bridges`. **Out:** `bridges`.
- **Params:** `stoplist` (extra words/phrases to reject beyond the built-in
  list), `idf_floor` (reject surfaces below this corpus-wide informativeness
  score; 0.0 = off).
- **Example:** 172 pairs in, one surface is `"less than"` → filtered out;
  one is `"di erent"` → repaired to `"different"` and kept (though it's
  still a weak, generic bridge — you'll likely want a real `stoplist` entry
  for it too).

### Neighbor Pair Sampler `neighbor_sampler` ✅ live · FREE
Finds pairs of facts that sit near each other on the *same* page and are
related enough to be asked about together, but distinct enough that both
are actually needed — the raw material for single-hop, two-evidence
questions.
- **In:** `facts`. **Out:** `candidates`.
- **Params:** `window` (default 3 — how many source positions apart two
  facts can be), `min_cosine` (default 0.40), `max_cosine` (default 0.95 —
  above this the two facts are near-duplicates and get skipped, because one
  fact alone would answer the whole question), `max_uses_per_fact` (default
  2 — how many pairs one fact can join; raise this for denser sampling on
  data-rich pages), `max_pairs` (optional cap).
- **Example:** 118 facts in, defaults → badge around `52 pairs`. Raise
  `max_uses_per_fact` to 3 on the same input and you'll see the count climb
  further as facts get reused across more pairs.

### Cluster Builder 2+2 `cluster_builder` ✅ live · FREE
Takes verified bridge pairs and, for each one, tries to find one more
same-page neighbor fact on EACH side — building a 4-fact group (2 from one
page, 2 from another) that can support a genuinely hard multi-hop question.
Bridge pairs that can't find a same-page neighbor on both sides fall back to
being plain 2-fact candidates instead of being dropped.
- **In:** `bridges`, `facts`. **Out:** `candidates` (both the 4-fact clusters
  and the 2-fact fallbacks, distinguished in the output metadata).
- **Params:** `window` (default 3), `min_cosine` (default 0.40), `max_cosine`
  (default 0.95) — same meaning as the Neighbor Pair Sampler, applied to the
  same-page neighbor search on each side.
- **Example:** 172 bridge pairs + 118 facts in → badge like
  `52 pairs · 147 clusters` (most bridges do find a neighbor on both sides
  at this corpus's density).

---

## 5. Generation (all PAID except Demotion)

Turn candidates into actual draft questions. These are the only blocks that
spend money.

### Neighbor QA Generator `qa_gen_pairs` 🚧 planned · **PAID**
Drafts a question from each 2-fact candidate — one question whose complete
answer genuinely needs both facts.
- **In:** `candidates`, `facts`. **Out:** `qa` (drafts, not yet gated).
- **Params:** `model_role` (default `generator`), `workers` (default 4,
  parallel draft calls), `cache_path` (where drafts are cached so a re-run
  with the same inputs doesn't re-pay for identical work).
- **Example:** 52 candidate pairs in → 52 draft QA records out (before any
  gate has looked at them), roughly 1 call per pair.

### Cluster QA Generator (two-stage) `qa_gen_clusters` 🚧 planned · **PAID**
Drafts a question from each 4-fact cluster, in two cheaper steps instead of
one expensive one: first two short calls draft a pair of clauses per page
-side and check them locally, then one call synthesizes the final question
only once all four clauses already pass — so a hard clause never wastes a
question-drafting call.
- **In:** `candidates`, `facts`. **Out:** `qa` (drafts).
- **Params:** `question_attempts` (default 3 — this call gets a larger
  retry budget than side-drafting, since hiding the bridge concept in a
  4-clause question is the hardest part), `workers` (default 4).
- **Example:** 147 clusters in → typically far fewer than 147 pass the
  downstream gates (§6) — this is normal; four independently-verifiable
  clauses is a genuinely high bar, by design.

### Bridge QA Generator (2-fact) `qa_gen_bridges` 🚧 planned · **PAID**
Drafts a question from a plain 2-fact bridge pair (no same-page neighbors
needed) — simpler and cheaper than the cluster path, used both for bridges
that never had 4-fact candidates and for demoted failed clusters (see next
block).
- **In:** `bridges`, `facts`. **Out:** `qa` (drafts).
- **Params:** `model_role` (default `generator`), `workers` (default 4),
  `cache_path`.
- **Example:** 25 leftover/demoted bridge pairs in → 25 draft QA records
  out, ~1–2 calls each.

### Cluster→Bridge Demotion `demotion` 🚧 planned · FREE
When a 4-fact cluster fails to produce a passing question, this block routes
it back into the 2-fact bridge pipeline instead of throwing the work away —
a cluster that failed 4-way still rests on a *verified* 2-fact bridge, so a
simpler question is very likely to succeed where the harder one didn't.
- **In:** `qa` (the rejected cluster drafts), `bridges` (the original bridge
  pairs). **Out:** `bridges` (the subset worth retrying as 2-fact
  questions — feed this into Bridge QA Generator).
- **Params:** none.
- **Example:** in the shipped round-3 dataset, this exact mechanism took the
  cluster pass rate from ~5% to a 33.7% overall multi-hop share by
  recovering failed 4-fact attempts as 2-fact bridge questions instead.

---

## 6. Gates (all FREE — deterministic checks on local hardware)

Every gate takes `qa → qa`: it looks at draft questions and only lets
through the ones that pass a specific, machine-checkable test. Order
matters conceptually (see §10's sample pipeline) but the studio doesn't
force one — you decide the sequence by how you wire them.

### Clause Entailment Gate `gate_clause`
Checks that each answer clause is genuinely supported by the specific fact
it claims to come from — not just plausible-sounding, but actually entailed.
- **Param:** `threshold` 🔒 locked at **0.65**. This exact number was
  validated against real pilot data; loosening it admits answers that sound
  right but aren't actually grounded in the source.
- **Example:** a clause claiming "gain is 5 dB" when its source fact never
  mentions gain → fails this gate, regardless of how fluent the sentence is.

### Joint Necessity Gate `gate_joint`
Checks two things together: no single fact in the group is enough to answer
the whole question on its own (below `single_fact_max`), AND all the facts
together really do entail the full answer (above `joint_min`). This is what
makes a multi-hop question genuinely multi-hop instead of one fact doing all
the work while the others just ride along.
- **Params:** `single_fact_max` 🔒 locked at **0.50**, `joint_min` 🔒 locked
  at **0.85**.
- **Example:** a "cluster" question where one clause alone already entails
  90% of the composed answer → fails here; that's a single-hop question
  wearing a multi-hop costume.

### LOO Necessity Gate `gate_loo`
Leave-one-out check: remove any ONE fact from the evidence group and confirm
the answer can no longer be derived. This is the strongest necessity test in
the pipeline — pairwise checks can miss cases that only show up when you
actually take a fact away.
- **Params:** none (uses the same thresholds as the Joint Necessity Gate
  internally).
- **Example:** a 4-fact cluster where removing fact #3 still leaves the
  other 3 able to reconstruct 95% of the answer → fails here even if it
  passed the joint check, because fact #3 turned out not to matter.

### Grounding Gate `gate_grounding`
Rejects any record whose evidence doesn't carry a real, retrievable chunk
ID — no exceptions, no placeholder IDs allowed through as if they were real.
This is the gate that guarantees every question in your final dataset can
actually be checked against real retrieval results.
- **Params:** none — always strict, cannot be loosened even in expert mode.
- **Example:** a fact whose provenance never resolved (see Provenance Join)
  and fell back to a placeholder ID → rejected here, not silently shipped.

### Bridge-Leak Gate `gate_leak`
For multi-hop questions specifically: checks that the question text doesn't
give away the bridge concept it's supposed to be hiding. A question that
names "ISO 15607" directly isn't testing whether a retriever can find the
connection — it's just telling it.
- **Params:** none.
- **Example:** "How does ISO 15607 connect the WPS ranges to the
  qualification records?" → leaks the bridge, rejected. "Which values does a
  WPS define, and which records must name the governing edition?" → doesn't
  name it, passes.

### Dedup Gate `gate_dedup`
Drops near-duplicate questions — either ones asking about the exact same set
of facts as another surviving question, or ones whose wording is different
but the meaning is a near-identical paraphrase (checked by embedding
similarity).
- **Param:** `near_dupe_cosine` 🔒 locked at **0.92**.
- **Example:** "What details must be included in the test report...?" and
  "What details must be recorded in the test report...?" (same 4 words
  changed) → the second one gets dropped, keeping whichever of the two had
  more/better-scored evidence.

---

## 7. Assembly, Verification & Evaluation

Turn gated questions into a finished, measured dataset.

### Dataset Assembler `assembler` 🚧 planned · FREE
Merges however many `qa` streams you feed it into one final dataset, applies
an overall size cap if you set one, and renumbers every question with a
clean sequential ID.
- **In:** `qa` (multiple wires allowed into this one port). **Out:** `qa`.
- **Params:** `target_total` (default 500 — the overall cap), `keep_all_multi_hop`
  (default on — multi-hop questions are never trimmed to fit the cap; only
  single-hop questions get cut, proportionally per source document, so a
  20-page document never gets asked to carry as many questions as a
  500-page one).
- **Example:** feed it the outputs of your gated Neighbor QA stream (214
  singles) and your gated cluster/bridge streams (22 + 87 multi-hop) with
  `target_total=500` → all 109 multi-hop questions are kept, and up to 391
  singles worth of budget remains — since only 214 exist, all of them are
  kept too, giving 323 total (this is exactly what produced the shipped
  round-3 dataset).

### Stage-D Verifier `verifier` 🚧 planned · **PAID**
A second, independent check on already-gated questions: a deterministic
cascade first (clause/joint entailment recomputed, duplicate-clause check),
and only for genuinely borderline cases does it ask a language model to make
the final call. Most rows never need the paid step at all.
- **In:** `qa`. **Out:** `qa` (every record now carries a real PASS/REJECT
  verdict and a reason instead of "pending").
- **Params:** `model_role` (default `verifier`), `workers` (default 4).
- **Example:** on the shipped round-3 dataset, 323 questions went through
  this block: 300 passed (298 of those resolved by the free deterministic
  cascade alone, only 2 needed the paid judge), 23 were rejected — every
  rejection came with a specific, machine-readable reason, and rejects are
  quarantined into a separate file, never silently deleted.

### Index Builder `index_builder` ✅ live · FREE
Builds a retrieval index over a chunk set — the thing your questions will
actually be tested against.
- **In:** `chunks`. **Out:** `index`.
- **Params:** `strategy` (`bm25` | `hybrid`), `embedding_source` (`local` |
  `api` — for `hybrid`; `local` uses an on-machine model and costs nothing).
- **Example:** 202 chunks in, `strategy=hybrid, embedding_source=local` →
  badge `hybrid · 202 docs`, built with zero API calls.

### Retrieval Evaluator `evaluator` ✅ live · FREE
Runs every question in a `qa` set against a built index and scores how well
retrieval finds the right evidence — recall, rank-weighted precision, hit
rate, MRR, broken down overall and by question type.
- **In:** `qa`, `index`, `facts`. **Out:** `eval`.
- **Params:** `top_k` (default 10), `match_mode` (`overlap` — token overlap
  ≥60% between a fact and a retrieved chunk — or `exact-id`, matching the
  question's exact gold chunk ID; `exact-id` is not implemented yet).
- **Example:** 323 questions + a hybrid index + the grounded facts →
  `recall@5 0.698` for the round-3 dataset overall, with the cluster subset
  showing a much lower hit@5 (~0.09) than the single-hop subset (~0.71) —
  which is the whole point: harder multi-hop questions should be harder for
  a retriever, and now you can measure exactly how much harder.

### Sweep `sweep` 🚧 planned · FREE
Runs the Retrieval Evaluator across a grid of chunking and retriever
settings at once and reports the best combination — instead of manually
building N different Index Builder + Evaluator pairs.
- **In:** `qa`, `chunks`. **Out:** `eval` (one row per grid point, plus the
  winner highlighted).
- **Param:** `grid` — a dict of parameter name → list of values to try, e.g.
  `{"chunk_strategy": ["original", "sentence"], "retriever": ["bm25", "hybrid"]}`.
- **Example:** the grid above tries 4 combinations in one run and reports
  which one has the best rank-weighted F1.

### Report Builder `report` ✅ live · FREE
Turns one or more evaluation results into a readable report.
- **In:** `eval` (multiple wires allowed — e.g. compare two strategies
  side by side). **Out:** `report`.
- **Params:** `format` (`md` | `html`), `include_per_doc_ci` (default off —
  add confidence intervals to the per-document breakdown, useful when a
  document only contributes a handful of questions and the raw numbers
  would otherwise look more precise than they really are).
- **Example:** wire in the hybrid-strategy `eval` and the bm25-strategy
  `eval` from two separate Evaluator blocks → one report with both side by
  side, exactly like `V3_FULLCORPUS_EVAL.md`.

### Evidence Viewer `bbox_viewer` 🚧 planned · FREE
Renders a question alongside its source evidence, highlighted directly on
the original PDF pages — the fastest way to sanity-check "does this question
really come from what it claims to."
- **In:** `qa`, `pdf`. **Out:** `report` (an HTML file with the highlighted
  pages).
- **Params:** none.
- **Example:** pick one 4-fact cluster question and the PDF it came from →
  an HTML page showing all four source regions highlighted across two
  different pages, side by side with the question and composed answer.

---

## 8. Utility

### Note `note` 🚧 planned · FREE
A free-text sticky note on the canvas. No ports, no effect on the pipeline —
purely for you to leave yourself (or a teammate) context about why the graph
is shaped the way it is.
- **Example:** drop one near your Gate chain reading "don't touch these
  thresholds — see the pilot writeup for why 0.65/0.50/0.85 are load
  -bearing."

### Cost Estimator `cost_probe` 🚧 planned · FREE
Attaches to any paid block's input and shows the estimated call count and
dollar cost before you run anything — the same number the run-confirmation
sheet would show you, but visible on the canvas at design time so you can
compare two pipeline shapes without triggering a run.
- **Param:** `target_block_id` — which paid block on the canvas to estimate.
- **Example:** attach it to a Cluster QA Generator fed by 147 candidate
  clusters → shows roughly 147 × 3–5 calls, letting you decide to trim your
  candidate set before spending anything.

---

## 9. How gates typically chain together

Gates don't have a forced order, but there's a sequence that makes sense and
matches how the shipped dataset was actually built — cheapest/most-decisive
checks first, so you never pay for a call whose result later gets thrown
away by a free check:

```
qa_gen_* (PAID) → gate_clause → gate_joint → gate_loo → gate_grounding
                → gate_leak (multi-hop only) → gate_dedup → assembler
```

The compiler's Validate check specifically watches for one thing: a
`gate_grounding` somewhere between any generator and the Assembler. If it's
missing, you'll get a warning with a one-click fix — this exists because
shipping a question with fake evidence IDs is the single most damaging
mistake this pipeline is designed to prevent.

---

## 10. Sample pipelines to try

These are ready to build with blocks that are **live today** (§1) — you can
actually run them, not just look at them.

### Sample project — one click, bundled data, no file paths to hunt down

The fastest way into any of this: on the studio's start screen, click **Try
the sample project**. This copies a small bundled corpus — ECMA-404 (the
JSON data-interchange spec), already chunked, fact-extracted, and shipped
with 20 verified ground-truth QA pairs — into a fresh project folder, and
creates it with **two ready-to-run sessions already saved**, so there is
nothing to wire by hand before your first run:

- **"Sample: evaluate retrieval (free)"** — the exact 5-block shape from
  Sample A below (QA Dataset Import + Chunks Import + Facts Import → Index
  Builder → Retrieval Evaluator), pre-wired against the bundled ECMA-404
  files. Zero API calls; open it and click **Run graph**.
- **"Sample: generate draft QA (paid)"** — Facts Import → Neighbor Pair
  Sampler → Neighbor QA Generator, pre-wired against the same facts. This
  one calls a language model, so running it raises the normal cost-confirm
  sheet first (§5) — nothing spends until you approve it.

Both sessions use the same underlying blocks documented in this guide; the
sample project just saves you the setup. It is meant as a two-minute "does
this thing actually work" check before you point the studio at your own
documents.

### Sample A — "How good is retrieval on my existing dataset?" (fully free, 5 minutes)

The fastest way to get a real number out of the studio right now.

1. Drop **QA Dataset Import**, point it at
   `data/eval_results/allpdf_v2_gt_r3/final/din_iso_6507_vickers_full.json`.
2. Drop **Chunks Import**, point it at
   `data/test_corpus_allpdf/pipeline_run/din_iso_6507_vickers_phase2/checkpoints/s2_chunks_full.json`.
3. Drop **Facts Import**, point it at
   `data/eval_results/facts_v1_grounded/facts_din_iso_6507_vickers_full.json`.
4. Drop **Index Builder**, wire Chunks Import's `chunks` output into it. Set
   `strategy = hybrid`, `embedding_source = local`.
5. Drop **Retrieval Evaluator**, wire QA Dataset Import → its `qa` input,
   Index Builder → its `index` input, Facts Import → its `facts` input.
6. Click **Validate**, then **Run graph**.
7. Click the Evaluator block afterward — its output badge shows the real
   recall/precision/hit-rate numbers for that document, computed live, with
   zero API cost.

### Sample B — "Turn my facts into candidate question material" (fully free)

Shows the sampling side of the pipeline without touching generation at all.

1. **Facts Import** → the same din_iso_6507 facts file as above.
2. **Bridge Pairs Import** → `data/eval_results/allpdf_bridge_pairs_clean.json`.
3. **Neighbor Pair Sampler**, wired from Facts Import → `facts`. Try the
   default params first, then raise `max_uses_per_fact` to 3 and re-run —
   watch the output badge's pair count increase.
4. **Cluster Builder 2+2**, wired from Bridge Pairs Import → `bridges` and
   Facts Import → `facts`. Compare its `candidates` badge (clusters +
   fallback pairs) to the Neighbor Pair Sampler's.

This is exactly the sampling stage that fed the shipped v3 dataset — you're
looking at the real candidate pool before any money was spent drafting
questions from it.

### Sample C — the full v2 pipeline shape (mixed live + planned)

This is the graph shown in the built-in demo (open the app — it loads by
default). It reproduces the entire shipped pipeline as 22 blocks / 26 wires:
Chunks Import + Chunker + Index Builder on one branch; PDF Source + LLM Fact
Extractor + Debris Filter + Fact Clause Splitter + Provenance Join on
another; Bridge Miner + Bridge Quality Filter feeding Neighbor Pair Sampler
and Cluster Builder 2+2; both generators into the full gate chain from §9;
Assembler; Index Builder + Evaluator + Report Builder; Evidence Viewer off
to the side. Open it, click through each block in the Inspector to see its
real parameters, and use it as the template for wiring your own variant —
swap in a different document's facts/chunks and you have a new pipeline.

---

## 11. Building your own pipeline from scratch

1. Start from an empty canvas (or clear the demo).
2. Decide your input: do you have chunks+facts already (start with the
   Import blocks in §2), or only a PDF (start with PDF Source + LLM Fact
   Extractor in §3)?
3. Pick ONE generation strategy first — Neighbor QA Generator alone is the
   simplest way to get single-hop questions end to end. Add Cluster/Bridge
   generation once that's working.
4. Chain the gates in the order shown in §9. Don't skip Grounding — the
   compiler will warn you if you do.
5. Wire the gated output into an Assembler.
6. Wire an Index Builder (from your Chunks) and a Retrieval Evaluator
   (from the Assembler's output + the Index Builder + your Facts) to
   measure it.
7. Click **Validate** before every run — it's free and it catches the
   mistakes that would otherwise waste a paid call.
8. Once you're happy, **Save** the graph so you (or a teammate) can load it
   again exactly as built.

If you get stuck on what a specific error means, every gate and every
compiler check in this guide states exactly what it's checking for — search
this file for the exact wording you saw in the console.

---

## 12. Dataset inspector

A read-only companion panel, separate from the canvas, for browsing what a
corpus actually contains and checking it against its source PDF — open it
with the **🔎 Dataset** button in the top bar. This is the fastest way to
answer "does this fact/question really say what the pipeline claims" without
opening a JSON file by hand.

Pick a corpus entry from the dropdown (or **Import corpus…** to register a
new one — the studio classifies each imported file into `pdf` / `chunks` /
`facts` / `qa` automatically and skips anything it doesn't recognize), then
switch between two tabs:

- **Facts** — every fact in the corpus's facts file, with its page number
  and a truncated preview of its text. Click one to jump the right-hand pane
  to its source PDF page with its bounding box highlighted.
- **QA pairs** — every question, tagged with its hop type. Click one to
  expand its answer-clause chips; click a chip to jump to that clause's
  source fact. Selecting a whole QA pair highlights all of its evidence
  facts at once, each in its own color, even when they land on different
  pages — a page-switcher above the preview lets you step through every page
  the evidence touches. A chip for a clause whose fact ID isn't in this
  corpus's facts file is shown greyed out rather than crashing the panel.

The inspector never modifies a corpus — it is purely for looking, which
makes it safe to click through a dataset you didn't build yourself before
trusting it.
