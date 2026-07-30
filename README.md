# GRAFT Block Studio — RAG Ground-Truth Software Stack

A drag-and-drop, node-graph builder for RAG ground-truth pipelines — instead
of writing Python, you connect typed **blocks** on a canvas: import a folder
of PDFs, extract facts, sample QA pairs, gate them with NLI/necessity
checks, build retrieval indexes, evaluate, get a report. Runs as a desktop
app (Tauri) or in the browser, both against the same engine.

If you just want an always-on web service that runs the fixed 19-stage
pipeline end to end without a visual builder, that's a separate, simpler
repo: [`Rag_web_pipeline`](https://github.com/Sushruths04/Rag_web_pipeline).
This repo is the composable, block-by-block version of the same underlying
engine — useful when you want to inspect or rewire individual pipeline
steps, not just run the whole thing.

**Status: developer-preview.** You run it from source; there is no
double-click installer for a general machine yet (see §7).

---

## 1. What's in this repo

```
src/rag_gt/        the ground-truth generation engine (vendored, not a
                    separate install — extraction, QA generation, retrieval,
                    evaluation; every block is a thin wrapper around a
                    function in here)
studio/
  backend/          FastAPI app — block registry, graph compiler, executor
  core-ui/          React + React Flow canvas (palette, inspector, console) —
                    shared by both the browser and desktop entry points
  desktop/          Tauri 2 shell wrapping core-ui in a native window, with
                    a bundled sample project (ECMA-404 corpus)
  web/              thin npm proxy so `studio/web` just runs core-ui
pyproject.toml      installs the `rag_gt` engine package (`pip install -e .`)
```

## 2. Requirements

- Python 3.11+
- Node.js 18+
- Rust (`rustup`) — only if you want the native desktop shell, not needed
  to run it in a browser
- An OpenAI-compatible LLM API endpoint — only needed for the 3 **paid**
  blocks (QA generation). Everything else (import, chunk, extract, sample,
  gate, index, evaluate, report) runs free and local.

## 3. Install

```bash
# from the repo root
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -e .                              # installs the rag_gt engine
pip install -r studio/backend/requirements.txt
```

For the paid QA-generation blocks, copy `.env.example` to `.env` in the repo
root and fill in your LLM endpoint (`API_BASE_URL`, `API_KEY`,
`API_GT_MODEL`, `API_ANSWER_MODEL`, or the Ollama equivalents).

## 4. Run it — browser

Two terminals, from the repo root.

**Backend:**

```bash
uvicorn studio.backend.api:app --reload --port 8100
```

**Frontend:**

```bash
cd studio/core-ui
npm install        # first time only
npm run dev
# → open http://localhost:5190
```

If you only start the frontend, it still works in a degraded mode — the
block palette falls back to a bundled copy of the catalog and Validate does
a local-only check, instead of hitting the live backend.

## 5. Run it — desktop (native window)

```bash
cd studio/desktop
npm install        # first time only
npm run dev:desktop
```

This wraps the same `core-ui` frontend in a Tauri window with a native
File/Run/View menu and auto-spawns the Python backend for you — no separate
`uvicorn` terminal needed. Requires the Rust toolchain in addition to Node.

## 6. Using it on your own folder of PDFs

**Honest gap first:** inside the canvas today, `pdf_source` (turn a raw PDF
into chunks+facts) is still a planned/stub block — only 12 of the 33 block
types are wired to the real engine so far (the rest are stubs, clearly
marked `(planned)` in the UI; see the table in §7 and the full status per
block in `studio/core-ui/src/content/BLOCK_GUIDE.md`). So the canvas starts
from **already-chunked and already-fact-extracted** documents, not a raw
folder of PDFs. There are two ways to get there:

**Path A — reuse the vendored engine's own CLI to go from PDFs to
chunks/facts first**, then continue in the studio:

```bash
rag-gt-generate --input_dir my_pdfs/ --output my_pdfs_gt.jsonl
```

(installed by `pip install -e .`, §3). This runs the same `src/rag_gt`
ingestion/chunking/fact-extraction the studio's blocks wrap, over every PDF
in `my_pdfs/`. Then import its outputs into the canvas as described below.

**Path B — if you just want raw-PDF-in, report-out with no block wiring at
all**, use the sibling repo,
[`Rag_web_pipeline`](https://github.com/Sushruths04/Rag_web_pipeline) —
its `graft` pipeline does raw-PDF ingestion end to end today; come back to
this studio when you want to inspect or rewire individual stages.

**A second honest gap:** of the blocks that come after generation — the
quality gates (clause NLI, joint NLI, leave-one-out necessity, grounding,
leak, dedup), the **Assembler**, and the **Verifier** — none are wired to
the real engine yet either; they're stubs that return placeholder data. So
inside the canvas today you can do two things for real against your own
PDFs, and they're separate:

**6a. Generate draft QA candidates from your own facts (real, paid):**

1. Drop **Facts Import**, `path` → the facts JSON from Path A.
2. Drop **Neighbor Pair Sampler** (single-hop) and/or **Bridge Pairs
   Import** + **Cluster Builder 2+2** (multi-hop), wired from Facts
   Import's `facts` output.
3. Drop **Neighbor QA Generator** / **Cluster QA Generator** / **Bridge QA
   Generator** — amber `$` badge — wired from the sampler output. These
   call the LLM in `.env` and produce real draft QA pairs with real
   source/page/bbox provenance.
4. **Validate**, then **Run graph** (`Ctrl+Enter`); confirm the cost
   estimate. These outputs are *drafts* — the gating/verification that the
   underlying engine normally runs on them (NLI checks, necessity, leak
   detection, dedup) isn't wired into the canvas yet, so treat generator
   output as a candidate pool, not a finished dataset. If you want a fully
   gated/verified dataset today, run the engine's own generation path
   directly (`rag_gt.generation.answer_first_v2` / the CLI in
   `src/rag_gt/cli/`) instead of the canvas for that step — same engine,
   just not yet block-wired.

**6b. Evaluate an already-verified QA dataset against your own retrieval
index (real, free, this is the reliable end-to-end path today):**

1. Drop **QA Dataset Import**, `path` → a verified QA dataset (yours, or
   the bundled sample).
2. Drop **Chunks Import** and **Facts Import**, `path` → your chunk/fact
   files from Path A.
3. Drop **Index Builder**, wired from Chunks Import's `chunks` output; set
   `strategy = hybrid`, `embedding_source = local`.
4. Drop **Retrieval Evaluator**, wired from QA Dataset Import → `qa`,
   Index Builder → `index`, Facts Import → `facts`.
5. **Validate**, then **Run graph** — zero API cost. The Evaluator's output
   badge shows real recall/precision/hit-rate for your documents.

The built-in demo graph (loads by default when you open the app) shows the
full 22-block shape, including the still-stubbed stages, as a template —
open it, and BLOCK_GUIDE.md §10's "Sample A" / "Sample B" walk through the
exact same two real paths above against the bundled corpus, if you want to
see them work before touching your own files. The full block-by-block
reference — every block's inputs/outputs/params, live vs. planned status,
and a worked example — is in `studio/core-ui/src/content/BLOCK_GUIDE.md`,
also rendered in-app via the **📖 Docs** button in the top bar.

The studio also ships a **"Try the sample project"** button on the start
screen (bundled ECMA-404 corpus, already chunked and fact-extracted, two
pre-wired sessions) — start there for a two-minute, zero-setup check that
everything actually runs before pointing it at your own documents.

## 7. What's actually working right now

Read this before assuming a button does something it doesn't:

| capability | status |
|---|---|
| Drag/wire/inspect/validate/save/load a graph against the live backend | ✅ works |
| Fetch the live block catalog; falls back to a bundled copy if the backend is offline | ✅ works |
| 13 of 33 block types run for real: Chunks/Facts/Bridges/QA Dataset Import, Chunker, Neighbor Sampler, Cluster Builder, the 3 QA Generators, Index Builder, Evaluator, Report Builder | ✅ works |
| The other 20 block types (PDF Source, LLM Fact Extractor, gates, Assembler, Verifier, Sweep, Bbox Viewer, ...) | 🚧 stubs — run but return fake/planned data, clearly labeled in the UI |
| Click "Run graph" and have it execute your actual graph for the live blocks above, including the 3 paid QA-generation blocks with a cost-confirmation gate | ✅ works |
| Run history, param diffs between runs, composite (grouped) blocks | ✅ works |
| Export a self-contained run report (HTML + SHA-256 provenance manifest) | ✅ works |
| Sample project + starter templates | ✅ works |
| Native desktop shell with sidecar-managed backend, crash-safe autosave, multi-session tabs | ✅ works |
| One-click installer for a machine without Python/Node/Rust already set up | 🚧 not yet — packaged builds still assume the dev toolchain is present |

## 8. Free vs. paid

Every block is either free (deterministic, local, no cost) or paid (calls a
real LLM) — paid blocks always show a `$` badge and a cost estimate before
they run. You will not spend money by accident.

## 9. Troubleshooting

- **Palette looks generic / console says "offline, using bundled catalog"**
  — the backend (§4) isn't running or isn't reachable on port 8100. Start
  it, then reload.
- **`ModuleNotFoundError: rag_gt`** — run `pip install -e .` from the repo
  root, not from inside `studio/backend/`.
- **Port 8100 or 5190 already in use** — stop whatever else is listening, or
  change the port (backend: `--port <other>`; frontend: edit
  `studio/core-ui/vite.config.ts`).
- **A paid block fails immediately** — check `.env` has `API_BASE_URL` /
  `API_KEY` set; the block will otherwise fail fast rather than run without
  credentials.
