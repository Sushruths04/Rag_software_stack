"""QA-gen blocks must emit the meta keys the UI and the rest of the graph read.

Found 2026-08-01. The stub implementations of qa_gen_pairs/clusters/bridges
emitted {"count": N, "multi_hop": M} -- the convention every other block and
the frontend's runFormat.ts use. When the three blocks were wired to the real
engine they switched to {"n_qa": N, "n_multihop": M}, so real runs display
"? QA" on those nodes in the canvas while stub runs render correctly. The
data underneath was always fine; only the badge was broken.

Both spellings are emitted now: "count"/"multi_hop" for the UI and the
gate/assembler/verifier convention, "n_qa"/"n_multihop" kept because the
backend and frontend test suites already assert on them.

Mirrors the FakeLLM injection used by tests/test_blocks_qa_gen.py -- no real
LLM call is ever made.
"""

import json

import pytest

from rag_gt.blocks import qa_gen_bridges, qa_gen_clusters, qa_gen_pairs
from tests.test_answer_first_v2 import (
    BRIDGE_PAIRS,
    CLUSTER,
    FACTS,
    FakeLLM,
    _accepting_nli,
    _passing_necessity,
)

DOC = "din_iso_15609_welding_procedure_full"
# Keys the frontend's runFormat.ts reads for a "qa" artifact.
UI_KEYS = ("count", "multi_hop")
# Keys the backend/frontend test suites already assert on.
LEGACY_KEYS = ("n_qa", "n_multihop")


def _write_json(tmp_path, name, data):
    path = tmp_path / name
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def _artifact(type_, ref):
    return {"type": type_, "ref": str(ref)}


def _params():
    return {
        "doc": DOC,
        "llm": FakeLLM(),
        "nli_fn": _accepting_nli,
        "necessity_fn": _passing_necessity,
        "workers": 1,
    }


def _assert_meta_contract(meta, label):
    for k in UI_KEYS + LEGACY_KEYS:
        assert k in meta, f"{label} meta missing {k!r}"
    assert meta["count"] == meta["n_qa"], f"{label}: count must mirror n_qa"
    assert meta["multi_hop"] == meta["n_multihop"], (
        f"{label}: multi_hop must mirror n_multihop"
    )
    assert isinstance(meta["count"], int)
    assert isinstance(meta["multi_hop"], int)


def test_qa_gen_pairs_emits_ui_and_legacy_meta_keys(tmp_path):
    facts_ref = _write_json(tmp_path, "facts.json", FACTS)
    candidates_ref = _write_json(tmp_path, "candidates.json", [{"fact_a": "A", "fact_b": "A2"}])

    out = qa_gen_pairs.run(
        inputs={
            "facts": _artifact("facts", facts_ref),
            "candidates": _artifact("candidates", candidates_ref),
        },
        params=_params(),
        artifacts_dir=tmp_path,
    )
    _assert_meta_contract(out["qa"]["meta"], "qa_gen_pairs")
    assert out["qa"]["meta"]["count"] == 1


def test_qa_gen_clusters_emits_ui_and_legacy_meta_keys(tmp_path):
    facts_ref = _write_json(tmp_path, "facts.json", FACTS)
    candidates_ref = _write_json(tmp_path, "candidates.json", [CLUSTER])

    out = qa_gen_clusters.run(
        inputs={
            "facts": _artifact("facts", facts_ref),
            "candidates": _artifact("candidates", candidates_ref),
        },
        params=_params(),
        artifacts_dir=tmp_path,
    )
    _assert_meta_contract(out["qa"]["meta"], "qa_gen_clusters")
    assert out["qa"]["meta"]["count"] == 1
    # Cluster QA is multi-hop by construction.
    assert out["qa"]["meta"]["multi_hop"] == 1


def test_qa_gen_bridges_emits_ui_and_legacy_meta_keys(tmp_path):
    facts_ref = _write_json(tmp_path, "facts.json", FACTS)
    bridges_ref = _write_json(tmp_path, "bridges.json", BRIDGE_PAIRS)

    out = qa_gen_bridges.run(
        inputs={
            "facts": _artifact("facts", facts_ref),
            "bridges": _artifact("bridges", bridges_ref),
        },
        params=_params(),
        artifacts_dir=tmp_path,
    )
    _assert_meta_contract(out["qa"]["meta"], "qa_gen_bridges")


@pytest.mark.parametrize("mod", [qa_gen_pairs, qa_gen_clusters, qa_gen_bridges])
def test_ui_badge_would_render_a_number_not_a_question_mark(mod, tmp_path):
    """runFormat.ts renders `${meta.count ?? "?"} QA` -- count must be a number."""
    facts_ref = _write_json(tmp_path, "facts.json", FACTS)
    if mod is qa_gen_bridges:
        inputs = {
            "facts": _artifact("facts", facts_ref),
            "bridges": _artifact("bridges", _write_json(tmp_path, "b.json", BRIDGE_PAIRS)),
        }
    else:
        cand = [CLUSTER] if mod is qa_gen_clusters else [{"fact_a": "A", "fact_b": "A2"}]
        inputs = {
            "facts": _artifact("facts", facts_ref),
            "candidates": _artifact("candidates", _write_json(tmp_path, "c.json", cand)),
        }

    meta = mod.run(inputs=inputs, params=_params(), artifacts_dir=tmp_path)["qa"]["meta"]
    assert meta.get("count") is not None, (
        f"{mod.__name__} would render '? QA' in the canvas"
    )
