# TODO / Known Gaps — Rag_software_stack

Audit date: 2026-07-30/31. Every number below was produced by actually
running the suite, not recalled from memory — re-run the commands yourself
before trusting a count that looks stale.

---

## 1. Test status (verified live)

| Suite | Command | Result |
|---|---|---|
| Backend (`studio/backend`) | `python -m pytest studio/backend -q` | **126 passed**, 1 skipped, 8.0s |
| Frontend (`studio/core-ui`) | `cd studio/core-ui && npx vitest run` | **323 passed**, 21 skipped (344 total), 41 files (40 passed/1 skipped), 40.7s |
| Desktop shell (`studio/desktop/src-tauri`) | `cd studio/desktop/src-tauri && cargo test` | **8 passed**, 0 failed |
| Vendored engine (`src/rag_gt`) | — | **NO TESTS SHIPPED** — see §2, item P0-1 |

No `.github/workflows/` exist anywhere in this repo — there is **no CI**.
Every number above is a manual local run; nothing enforces them on push/PR.

## 2. P0 — fix before trusting this repo for anything real

1. **The vendored `src/rag_gt` engine has zero test coverage in this repo**
   — same gap as the sibling `Rag_web_pipeline` repo (98 test files, 742
   passed / 3 skipped / 1 deselected on the source branch, none of it
   exported). Since this repo's 12 real block adapters
   (`studio/backend/adapters_live.py`) call directly into `rag_gt.blocks.*`,
   an engine regression would currently show up as a studio bug with no
   engine-level test to point at as the root cause. Fix the same way as the
   sibling repo: pull `tests/` over, or write a scoped smoke suite for
   `rag_gt.blocks.*` specifically.
2. **No CI.** Add GitHub Actions running all three test commands in §1 (Python
   pytest, vitest, cargo test) on every push/PR.
3. **`studio/backend/requirements.txt` is new** (added during the export,
   did not exist as a committed file on the source branch — the deps were
   only ever satisfied by whatever happened to already be in the dev venv).
   It has not been verified against a genuinely clean venv. Install into a
   fresh environment and confirm nothing's missing before trusting it.

## 3. P1 — the "13 of 33 blocks are real" gap, spelled out block by block

This is the single biggest thing to communicate honestly to whoever reviews
this repo: **20 of the 33 block types in `studio/backend/registry.py` are
stub adapters in `studio/backend/stubs.py`**, returning fabricated
count/metric numbers, not real computation. Every stub function is marked
`# TODO(M0-refactor)` inline. Table below is what exists today vs. what
needs to happen for each to go live — "real function to wire" points at the
already-existing, already-tested engine code each stub should eventually
call.

| Block type | Stub location | Real function to wire (already exists + tested in `src/rag_gt`) |
|---|---|---|
| `pdf_source` | `stubs.py:61` | No real function exists yet — needs new code. Nearest reference implementation: `production/backend/app/stages/graft.py`'s `_ingest`/`_chunk` stages in the sibling `Rag_web_pipeline` repo (calls `rag_gt.allpdf.ingest.ingest_document`). |
| `fact_extract_llm` | `stubs.py:104` | `rag_gt.allpdf.extract.extract_sfu_facts` — real, tested, just not block-wrapped. |
| `fact_debris_filter` | `stubs.py:115` | `rag_gt.allpdf.filter_adaptive.filter_facts_adaptive` (or `rag_gt.facts.domain_filter`, check which is current). |
| `fact_splitter` | `stubs.py:125` | No confirmed single owning function — needs investigation into whether long-fact splitting exists anywhere in `rag_gt.facts.*` before wiring (flagged as still-open even on the source branch: "long-fact splitting for cluster yield" was an explicit unstarted item). |
| `provenance_join` | `stubs.py:138` | `scripts/join_v1_fact_provenance.py` on the source branch (not vendored into this repo's `src/rag_gt` — it lives at repo-root `scripts/` on the monorepo, not under `src/`). Needs porting into `src/rag_gt` proper before it can be a block. |
| `bridge_miner` | `stubs.py:148` | Bridge mining logic inside `rag_gt.allpdf.pipeline` (`_build_graph`/bridge extraction) — needs isolating into a standalone callable. |
| `bridge_quality` | `stubs.py:154` | `rag_gt.allpdf.bridge_quality.surface_ok` — real, tested, not block-wrapped. |
| `demotion` | `stubs.py:209` | Cluster-to-bridge demotion logic inside `rag_gt.generation.answer_first_v2` — needs isolating. |
| `gate_clause` | `stubs.py:220-238` (factory) | `rag_gt.validation.nli_check` (clause-level NLI, threshold 0.65 per engine's own hard rule — **do not loosen this when wiring it in**). |
| `gate_joint` | same factory | `rag_gt.validation.nli_check` (joint-necessity NLI, threshold 0.85 — same hard-rule caveat). |
| `gate_loo` | same factory | Leave-one-out necessity check inside `rag_gt.generation.answer_first_v2` (`necessity_batch` per engine history). |
| `gate_grounding` | same factory | `require_chunk_ids=True` grounding check — engine-side hard rule, must stay strict when wired, never a soft warning. |
| `gate_leak` | same factory | Bridge-leak / forbidden-word check inside `rag_gt.generation.answer_first_v2`. |
| `gate_dedup` | same factory | `rag_gt` dataset_budget's `dedup_pairs`. |
| `assembler` | `stubs.py:246` | Assembly logic inside `rag_gt.generation.answer_first_v2.build_v2_pairs` (already split into composable steps per the engine's own M4 refactor — `gate_neighbor_pairs`/`gate_clusters` exist and are real; just not exposed as a block). |
| `verifier` | `stubs.py:255` | `rag_gt.validation.verify_v2` — real, tested Stage-D verifier, not block-wrapped. |
| `sweep` | `stubs.py:279` | `rag_gt.rag.eval_v2` / the retrieval-config sweep logic used by the sibling web-pipeline repo's evaluation stage. |
| `bbox_viewer` | `stubs.py:293` | No standalone function — the bbox evidence viewer exists as a frontend feature (`🔎 Dataset` button) reading fact/QA provenance directly; this block would need to expose that same data as a block output. |
| `note`, `cost_probe` | `stubs.py:302-307` | These are intentionally no-op utility blocks (a canvas comment, a manual cost marker) — not a gap, leave as-is. |

**Real (already wired, no action needed):** `chunks_import`, `facts_import`,
`bridges_import`, `qa_import`, `chunker`, `neighbor_sampler`,
`cluster_builder`, `qa_gen_pairs`, `qa_gen_clusters`, `qa_gen_bridges`,
`index_builder`, `evaluator`, `report` — 13 total, adapters in
`studio/backend/adapters_live.py`, engine functions in `src/rag_gt/blocks/`.

**Important nuance for whoever picks this up:** `studio/backend/api.py`'s
`run_graph()` endpoint defaults to `use_stubs: bool = True` — i.e. **stub
mode is the default**, not an edge case. The frontend must explicitly
request the live registry to get real execution. Confirm this is still true
before changing anything (`grep -n "use_stubs" studio/backend/api.py`).

## 4. P1 — evaluator's exact-ID match mode is explicitly unimplemented

`src/rag_gt/blocks/evaluator.py:26-32` raises `NotImplementedError` for any
`match_mode` other than `"overlap"`:

```
if match_mode != "overlap":
    raise NotImplementedError(
        f"evaluator match_mode={match_mode!r} is not implemented in "
        "rag_gt.rag.matcher yet (catalog Phase-1 P1.4); use 'overlap'."
    )
```

`rag_gt.rag.matcher` has no exact-chunk-ID path at all today. This means
retrieval evaluation can currently only score by token-overlap similarity,
never by exact chunk-ID match — a stricter, arguably more correct metric
for cases where chunk boundaries are known to be stable. Add the exact-ID
path to `rag_gt.rag.matcher` first, then remove the guard here.

## 5. P1 — desktop shell gaps (confirmed still absent by direct inspection)

- **No Settings panel.** `find studio/core-ui/src -iname "*settings*"`
  returns nothing. There is no UI for LLM endpoint/key, GPU env override,
  cache location, or telemetry toggle — `.env` is the only configuration
  surface, edited by hand outside the app.
- **No auto-restart-with-backoff** if the Python sidecar crashes mid-session
  (`studio/desktop/src-tauri/src/sidecar.rs`) — a crash currently behaves
  identically to a failed start; nothing automatically respawns it.
- **No per-session-run log files** — logging is one file per app launch,
  not scoped per run, which makes debugging a specific past run harder than
  it should be.
- **No packaged installer for a machine without the dev toolchain.**
  `tauri build` produces a real MSI/NSIS installer, but it still assumes
  Python + the venv are present on the target machine
  (`missing_root_failure()` in `sidecar.rs` just fails with a clearer
  message rather than actually working standalone). Full fix needs an
  embedded/bundled Python runtime shipped inside the installer, not just a
  better error message.
- **"Arrows cycle focused ports" keyboard navigation** was scoped out of
  the original accessibility pass as its own milestone-sized item — never
  implemented.
- **No real run cancellation.** `Run graph` is a single blocking HTTP call;
  there is no in-flight cancel today (noted as scoped-out, not forgotten,
  when B-M7 hardening shipped).

## 6. P2 — smaller/known items

- A documented mismatch between the app-plan spec and `BLOCK_GUIDE.md` over
  what starter template #2 should contain — never resolved, just flagged.
  Check `studio/core-ui/src/data/templates/sampleB.ts` against
  `studio/core-ui/src/content/BLOCK_GUIDE.md` §10 and reconcile one way or
  the other.
- No `$` USD pricing for composite (grouped) blocks beyond what
  `compositeCost()` derives from its expanded members — fine for now, just
  don't assume it accounts for anything beyond simple aggregation.
- No `LICENSE` file — decide and add one before distributing.
- No Dockerfile / containerized dev setup — everything assumes a local
  Python + Node + (optionally) Rust toolchain on the developer's machine.

## 7. What is genuinely solid (don't waste review time re-litigating)

- The 13 real block adapters and their compiler/executor/graph-store
  plumbing are properly tested (126 backend + a meaningful chunk of the 323
  frontend tests exercise this path) and match the engine's own tested
  behavior — this is not a thin wrapper, it calls the real, gated
  generation/evaluation code.
- The cost-confirmation gate before any paid block runs is real
  (`confirm_paid` / HTTP 402 flow in `studio/backend/api.py`), not just a
  UI dialog with nothing behind it.
- Session persistence, autosave/crash-recovery, and multi-tab dirty
  tracking in the desktop shell are real and were verified against actual
  race conditions (two documented, fixed bugs: Save's own state-bump
  re-dirtying itself, and React Flow's internal re-renders being
  misread as user edits) — not just "looks fine in a demo."
- The sidecar lifecycle (auto-spawn, port fallback, graceful shutdown via a
  Windows Job Object so force-killing the app doesn't orphan the Python
  process) was verified live via real process/port inspection, not just
  code review.

## 8. Priority order for a fixing agent

1. P0-1 (ship engine tests or a scoped smoke suite) — same reasoning as the
   sibling repo; changes to `src/rag_gt/blocks/*` currently have no safety
   net in this repo.
2. P0-2 (CI).
3. §3's block-by-block real-wiring work, roughly in this order since each
   stage depends on the previous one having real data: `fact_extract_llm` →
   `bridge_miner` + `bridge_quality` → the 6 gate blocks → `assembler` →
   `verifier`. `pdf_source`, `provenance_join`, `fact_splitter`, `sweep`,
   `bbox_viewer` can be picked up independently once you decide whether
   they're worth building at all vs. leaving the two-path workflow
   documented in the README (engine CLI first, then import into the
   canvas).
4. §4 (exact-ID match mode) — self-contained, doesn't block anything else.
5. §5 (desktop gaps) — independent of the block-wiring work, can run in
   parallel.
