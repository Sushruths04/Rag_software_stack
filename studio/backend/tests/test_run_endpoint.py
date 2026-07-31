"""Tests for POST /api/graphs/run: compiles a graph and runs it through a
fresh per-request ``Executor``, returning the full ordered event list plus
final artifacts in one blocking JSON response (see M3 acceptance criteria in
02_PHASE2_APP_PLAN.md — no WebSocket/SSE infra, a single blocking call is the
correct scope since every live block is fast/free/local).

``use_stubs=True`` (the default) must behave exactly like the rest of the
stub registry: zero ``rag_gt`` import. ``use_stubs=False`` swaps in the live
block adapters (see adapters_live.py) -- including ``qa_import`` and the 6
``gate_*`` blocks, which went live in this module and the gate-blocks task
respectively -- for whichever blocks in the graph have them; unmapped block
types (e.g. ``fact_splitter``, which has no live adapter) stay stubs even in
a live run — this is exercised directly so a stub artifact is never mistaken
for a real one downstream.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from fastapi.testclient import TestClient

WORKTREE_ROOT = Path(__file__).resolve().parents[3]

# Same rationale as adapters_live.py's own sys.path fix: the `rag_gt`
# editable install can resolve to the main repo checkout, which lacks this
# worktree's generation/*.py additions (answer_first_v2.py etc). Force this
# worktree's src/ to the front before importing tests.test_answer_first_v2
# below (which itself imports rag_gt.generation.answer_first_v2).
_SRC = WORKTREE_ROOT / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from studio.backend.api import app  # noqa: E402
from tests.test_answer_first_v2 import FACTS, FakeLLM, _accepting_nli, _passing_necessity  # noqa: E402

client = TestClient(app)

DIN_ISO_6507_FACTS_PATH = (
    WORKTREE_ROOT / "data" / "eval_results" / "facts_v1_grounded" / "facts_din_iso_6507_vickers_full.json"
)


def _block(id_, type_, params=None, x=0, y=0):
    return {"id": id_, "type": type_, "position": {"x": x, "y": y}, "params": params or {}}


def _wire(id_, from_block, from_port, to_block, to_port):
    return {
        "id": id_,
        "from": {"block": from_block, "port": from_port},
        "to": {"block": to_block, "port": to_port},
    }


def _stub_pipeline_graph():
    return {
        "schema_version": 1,
        "blocks": [
            _block("b1", "facts_import", params={"path": "facts.json"}),
            _block("b2", "neighbor_sampler"),
            _block("b3", "qa_gen_pairs"),
            _block("b4", "gate_grounding"),
            _block("b5", "assembler"),
        ],
        "wires": [
            _wire("w1", "b1", "facts", "b2", "facts"),
            _wire("w2", "b2", "candidates", "b3", "candidates"),
            _wire("w3", "b1", "facts", "b3", "facts"),
            _wire("w4", "b3", "qa", "b4", "qa"),
            _wire("w5", "b4", "qa", "b5", "qa"),
        ],
    }


def _cycle_graph():
    return {
        "schema_version": 1,
        "blocks": [_block("b1", "gate_clause"), _block("b2", "gate_joint")],
        "wires": [
            _wire("w1", "b1", "qa", "b2", "qa"),
            _wire("w2", "b2", "qa", "b1", "qa"),
        ],
    }


def _live_facts_chain_graph(facts_path: str, qa_path: str):
    """facts_import -> neighbor_sampler, both live-eligible, plus
    qa_import -> gate_grounding (now also live -- see gate_clause.py's module
    docstring for why it is a real, if identity, adapter) to exercise the
    "graph must produce qa/eval/report somewhere" runnability check
    (compiler.py Phase 5 rule 6), and a facts_import -> fact_splitter branch
    to keep a genuinely still-unmapped block in the same live run.

    qa_import and gate_grounding both HAVE live adapters (this module), so
    they must produce real (non-``stub:``) artifacts. ``fact_splitter`` has
    no live adapter at all (TODO.md §3: no confirmed single owning function
    to wire yet), so it is the block that stays honestly stub-prefixed even
    under ``use_stubs=False`` -- asserting that is part of the point."""
    return {
        "schema_version": 1,
        "blocks": [
            _block("facts_import", "facts_import", params={"path": facts_path}),
            _block("neighbor_sampler", "neighbor_sampler", params={"window": 3}),
            _block("fact_splitter", "fact_splitter"),
            _block("qa_import", "qa_import", params={"path": qa_path}),
            _block("gate_grounding", "gate_grounding"),
        ],
        "wires": [
            _wire("w1", "facts_import", "facts", "neighbor_sampler", "facts"),
            _wire("w2", "qa_import", "qa", "gate_grounding", "qa"),
            _wire("w3", "facts_import", "facts", "fact_splitter", "facts"),
        ],
    }


def _write_qa_file(tmp_path) -> str:
    path = tmp_path / "qa.json"
    path.write_text(json.dumps({"pairs": [{"qa_id": "V2Q1"}], "stats": {}}), encoding="utf-8")
    return str(path)


# --- stub-registry default path -------------------------------------------


def test_run_stub_graph_returns_ok_true_with_stub_prefixed_artifacts():
    resp = client.post("/api/graphs/run", json=_stub_pipeline_graph())
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["failed_block"] is None
    assert body["order"] == ["b1", "b2", "b3", "b4", "b5"]

    started = [e["block_id"] for e in body["events"] if e["type"] == "block_started"]
    finished = [e["block_id"] for e in body["events"] if e["type"] == "block_finished"]
    assert started == body["order"]
    assert finished == body["order"]

    assert body["artifacts"]["b1"]["facts"]["ref"].startswith("stub:")
    assert body["artifacts"]["b5"]["qa"]["type"] == "qa"


def test_run_defaults_to_use_stubs_true_when_omitted():
    resp_default = client.post("/api/graphs/run", json=_stub_pipeline_graph())
    resp_explicit = client.post("/api/graphs/run?use_stubs=true", json=_stub_pipeline_graph())
    assert resp_default.json()["artifacts"] == resp_explicit.json()["artifacts"]


def test_run_stub_path_never_imports_rag_gt():
    """Mirrors test_adapters_live.py's
    test_importing_registry_module_alone_does_not_import_rag_gt: running a
    graph with the default (stub) registry must not touch rag_gt at all."""
    code = (
        "import sys\n"
        "from fastapi.testclient import TestClient\n"
        "from studio.backend.api import app\n"
        "print('rag_gt' in sys.modules)\n"
        "client = TestClient(app)\n"
        "graph = " + repr(_stub_pipeline_graph()) + "\n"
        "resp = client.post('/api/graphs/run', json=graph)\n"
        "assert resp.status_code == 200, resp.text\n"
        "print('rag_gt' in sys.modules)\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=str(WORKTREE_ROOT),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    assert lines == ["False", "False"], result.stdout


# --- compiler-error path: no 500s -------------------------------------------


def test_run_cycle_graph_returns_400_with_compiler_errors_not_500():
    resp = client.post("/api/graphs/run", json=_cycle_graph())
    assert resp.status_code == 400
    body = resp.json()["detail"]
    assert body["valid"] is False
    assert any(e["code"] == "cycle_detected" for e in body["errors"])


# --- live registry path -----------------------------------------------------


def test_run_live_graph_use_stubs_false_returns_real_artifacts(tmp_path):
    assert DIN_ISO_6507_FACTS_PATH.exists(), f"fixture missing: {DIN_ISO_6507_FACTS_PATH}"
    graph = _live_facts_chain_graph(str(DIN_ISO_6507_FACTS_PATH), _write_qa_file(tmp_path))
    resp = client.post("/api/graphs/run?use_stubs=false", json=graph)
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True, body

    facts_artifact = body["artifacts"]["facts_import"]["facts"]
    assert not facts_artifact["ref"].startswith("stub:")
    assert facts_artifact["meta"]["count"] == 118

    candidates_artifact = body["artifacts"]["neighbor_sampler"]["candidates"]
    assert not candidates_artifact["ref"].startswith("stub:")

    # qa_import now HAS a live adapter (Task 6): it must yield a real,
    # non-stub artifact just like the other live-eligible blocks above.
    qa_artifact = body["artifacts"]["qa_import"]["qa"]
    assert not qa_artifact["ref"].startswith("stub:")
    assert qa_artifact["meta"]["count"] == 1

    # gate_grounding now HAS a live adapter too (identity pass-through by
    # design -- see gate_clause.py's module docstring): it must yield a
    # real, non-stub artifact carrying the same qa_import count through
    # unchanged.
    grounding_artifact = body["artifacts"]["gate_grounding"]["qa"]
    assert not grounding_artifact["ref"].startswith("stub:")
    assert grounding_artifact["meta"]["count"] == 1
    assert grounding_artifact["meta"]["passthrough"] is True

    # fact_splitter has no live adapter at all: stays a stub even in a live
    # run, and must be honestly marked as such by its ref prefix.
    splitter_artifact = body["artifacts"]["fact_splitter"]["facts"]
    assert splitter_artifact["ref"].startswith("stub:")


def test_run_live_block_failure_returns_200_ok_false_with_failed_block(tmp_path):
    graph = _live_facts_chain_graph("does_not_exist_xyz.json", _write_qa_file(tmp_path))
    resp = client.post("/api/graphs/run?use_stubs=false", json=graph)
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is False
    assert body["failed_block"] == "facts_import"
    failed_events = [e for e in body["events"] if e["type"] == "block_failed"]
    assert len(failed_events) == 1
    assert failed_events[0]["block_id"] == "facts_import"
    # neighbor_sampler is downstream of the failed block and must not run
    assert "neighbor_sampler" not in body["artifacts"]


def test_run_stub_qa_import_stays_stub_when_use_stubs_true_even_for_live_eligible_blocks(tmp_path):
    """Sanity check on the flip side: with use_stubs=True (default), every
    block type -- including the now-live-eligible ones -- must stay
    stub-prefixed."""
    graph = _live_facts_chain_graph(str(DIN_ISO_6507_FACTS_PATH), _write_qa_file(tmp_path))
    resp = client.post("/api/graphs/run", json=graph)
    body = resp.json()
    assert body["ok"] is True
    assert body["artifacts"]["facts_import"]["facts"]["ref"].startswith("stub:")
    assert body["artifacts"]["qa_import"]["qa"]["ref"].startswith("stub:")


def test_run_live_qa_import_produces_real_artifact(tmp_path):
    qa_file = tmp_path / "final.json"
    qa_file.write_text(json.dumps({"pairs": [{"qa_id": "V2Q1"}], "stats": {}}), encoding="utf-8")
    graph = {  # qa_import alone satisfies the compiler's qa/eval/report rule
        "schema_version": 1,
        "name": "live-qa",
        "blocks": [_block("qa_import", "qa_import", params={"path": str(qa_file)})],
        "wires": [],
    }
    resp = client.post("/api/graphs/run?use_stubs=false", json=graph)
    body = resp.json()
    assert body["ok"] is True
    assert not body["artifacts"]["qa_import"]["qa"]["ref"].startswith("stub:")
    assert body["artifacts"]["qa_import"]["qa"]["meta"]["count"] == 1


def test_run_live_chunks_import_explicit_path_hits_passthrough_branch(tmp_path):
    """The _wrap_chunks_import explicit-existing-path branch must forward the
    path straight to chunks_import.run (Task 5's load_chunks_from), NOT fall
    back to doc_id resolution. meta["source"] == "path" is emitted only by
    that branch (chunks_import.run sets source="path" iff it took the path),
    so it proves the passthrough was hit. chunks_import has no input ports, so
    it sits disconnected; a live qa_import block satisfies rule 6."""
    chunks_file = tmp_path / "s2_chunks_full.json"
    chunks_file.write_text(json.dumps([{"chunk_id": "c1", "text": "hello"}]), encoding="utf-8")
    graph = {
        "schema_version": 1,
        "name": "live-chunks-path",
        "blocks": [
            _block("chunks_import", "chunks_import", params={"path": str(chunks_file)}),
            _block("qa_import", "qa_import", params={"path": _write_qa_file(tmp_path)}),
        ],
        "wires": [],
    }
    resp = client.post("/api/graphs/run?use_stubs=false", json=graph)
    body = resp.json()
    assert body["ok"] is True, body
    chunks_artifact = body["artifacts"]["chunks_import"]["chunks"]
    assert not chunks_artifact["ref"].startswith("stub:")
    assert chunks_artifact["meta"]["source"] == "path"
    assert chunks_artifact["meta"]["count"] == 1


# --- paid-block spend confirmation gate (M4b) -------------------------------
# The compiler's cost roll-up (compiler.py's _cost_rollup) always dry-runs
# through the STUB registry regardless of use_stubs, so detecting/estimating
# paid blocks never costs anything or needs real input files. The gate below
# only fires for use_stubs=false (a live run) -- use_stubs=true (default)
# behaves exactly as before (see test_run_stub_graph_returns_ok_true_with_
# stub_prefixed_artifacts above, which posts a graph containing the PAID
# qa_gen_pairs block and expects an immediate ok:true with no confirmation).


def _paid_live_graph(facts_path: str):
    """facts_import -> neighbor_sampler -> qa_gen_pairs, all live-eligible.
    qa_gen_pairs is PAID -- this is the graph shape the confirm-before-run
    gate exists for."""
    return {
        "schema_version": 1,
        "blocks": [
            _block("facts_import", "facts_import", params={"path": facts_path}),
            _block("neighbor_sampler", "neighbor_sampler", params={"window": 3}),
            _block(
                "qa_gen_pairs",
                "qa_gen_pairs",
                params={"doc": "din_iso_15609_welding_procedure_full", "workers": 1},
            ),
        ],
        "wires": [
            _wire("w1", "facts_import", "facts", "neighbor_sampler", "facts"),
            _wire("w2", "neighbor_sampler", "candidates", "qa_gen_pairs", "candidates"),
            _wire("w3", "facts_import", "facts", "qa_gen_pairs", "facts"),
        ],
    }


def _write_facts_file(tmp_path) -> str:
    path = tmp_path / "facts.json"
    path.write_text(json.dumps(FACTS), encoding="utf-8")
    return str(path)


def test_run_live_graph_with_paid_block_requires_confirmation_when_not_confirmed(tmp_path, monkeypatch):
    """use_stubs=false + a paid block + confirm_paid omitted -> 402, no
    execution, get_llm() never reached (proven by monkeypatching it to
    raise if it's ever called)."""
    from rag_gt.blocks import qa_gen_pairs as qa_gen_pairs_mod

    def _boom(role="gt"):
        raise AssertionError("get_llm() must not be called before confirm_paid=true")

    monkeypatch.setattr(qa_gen_pairs_mod, "get_llm", _boom)

    graph = _paid_live_graph(_write_facts_file(tmp_path))
    resp = client.post("/api/graphs/run?use_stubs=false", json=graph)

    assert resp.status_code == 402
    body = resp.json()
    assert body["requires_confirmation"] is True
    assert "qa_gen_pairs" in body["paid_blocks"]
    estimated_ids = [e["block_id"] for e in body["estimated"]]
    assert "qa_gen_pairs" in estimated_ids
    qa_estimate = next(e for e in body["estimated"] if e["block_id"] == "qa_gen_pairs")
    assert qa_estimate["type"] == "qa_gen_pairs"
    assert "calls" in qa_estimate


def test_run_live_graph_with_paid_block_confirm_paid_false_also_requires_confirmation(tmp_path, monkeypatch):
    """Explicit confirm_paid: false behaves identically to omitting it."""
    from rag_gt.blocks import qa_gen_pairs as qa_gen_pairs_mod

    def _boom(role="gt"):
        raise AssertionError("get_llm() must not be called before confirm_paid=true")

    monkeypatch.setattr(qa_gen_pairs_mod, "get_llm", _boom)

    graph = {**_paid_live_graph(_write_facts_file(tmp_path)), "confirm_paid": False}
    resp = client.post("/api/graphs/run?use_stubs=false", json=graph)

    assert resp.status_code == 402
    assert resp.json()["requires_confirmation"] is True


def test_run_stub_graph_with_paid_block_never_requires_confirmation():
    """use_stubs=true (default) is unaffected by the gate -- it never costs
    anything regardless of which block types are present."""
    graph = _paid_live_graph("unused_facts.json")
    resp = client.post("/api/graphs/run", json=graph)
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_run_live_graph_with_paid_block_confirmed_executes_with_fake_llm(tmp_path, monkeypatch):
    """confirm_paid: true proceeds to a real execution. A real LLM is never
    touched: get_llm/nli_batch/leave_one_out_necessity are monkeypatched to
    the same FakeLLM/test doubles test_blocks_qa_gen.py uses (the graph JSON
    params model has no field capable of carrying a live Python object, so
    monkeypatching the block module's default-resolution path is the
    equivalent of 'wiring a FakeLLM' at the HTTP boundary)."""
    from rag_gt.blocks import qa_gen_pairs as qa_gen_pairs_mod

    monkeypatch.setattr(qa_gen_pairs_mod, "get_llm", lambda role="gt": FakeLLM())
    monkeypatch.setattr(qa_gen_pairs_mod, "nli_batch", _accepting_nli)
    monkeypatch.setattr(qa_gen_pairs_mod, "leave_one_out_necessity", _passing_necessity)

    graph = {**_paid_live_graph(_write_facts_file(tmp_path)), "confirm_paid": True}
    resp = client.post("/api/graphs/run?use_stubs=false", json=graph)

    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True, body

    qa_artifact = body["artifacts"]["qa_gen_pairs"]["qa"]
    assert not qa_artifact["ref"].startswith("stub:")
    assert qa_artifact["meta"]["n_qa"] >= 1
