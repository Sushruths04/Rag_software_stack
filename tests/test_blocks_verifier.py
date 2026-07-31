"""TDD: rag_gt.blocks.verifier -- qa + facts -> qa (TODO.md sec. 3/8, the
last row in the fact_extract_llm -> bridge_miner/quality -> gates ->
assembler -> verifier wiring chain).

Thin wrapper around rag_gt.validation.verify_v2.verify_v2_pairs -- the
Stage D cascade (deterministic-first, LLM judge escalation only for
borderline-margin cases). Reuses the exact SETTINGS/fixture/FakeLLM pattern
already established in tests/test_verify_v2.py (which tests verify_v2_pairs
directly) rather than inventing a new fixture shape, since the block is a
pure pass-through of that function's contract.
"""
from __future__ import annotations

import json

from rag_gt.blocks.verifier import run

SETTINGS = {
    "duplicate_jaccard_max": 0.60,
    "mutual_entailment_min": 0.85,
    "borderline_margin": 0.05,
    "use_llm_borderline": False,
    "judge_temperature": 0.0,
    "judge_max_tokens": 192,
    "clause_entailment_min": 0.65,
    "single_fact_answer_max": 0.50,
    "joint_answer_min": 0.85,
}


def _facts():
    return [
        {"id": "A", "text": "The welding procedure specification defines ranges for essential variables."},
        {"id": "A2", "text": "Each essential variable range must be recorded before qualification."},
        {"id": "B", "text": "ISO 15607 defines the general rules for specification and qualification."},
        {"id": "B2", "text": "Qualification records must reference the governing standard edition."},
    ]


def _neighbor_pair_qa():
    return {
        "qa_id": "V2Q00001",
        "hop_type": "single",
        "evidence_strategy": "neighbor_pair_v2",
        "bridge_entity": "",
        "question": "Which values does a WPS define, and when are they recorded?",
        "answer": "The WPS defines ranges for essential variables; each range is recorded before qualification.",
        "answer_clauses": [
            {"text": "The WPS defines ranges for essential variables.", "fact_id": "A"},
            {"text": "Each range is recorded before qualification.", "fact_id": "A2"},
        ],
        "gold_fact_ids": ["A", "A2"],
        "necessity": {"nli_singles": [0.1, 0.12], "nli_joint": 0.95},
    }


def _cluster_qa():
    return {
        "qa_id": "V2Q00002",
        "hop_type": "bridge",
        "evidence_strategy": "cluster_2plus2",
        "bridge_entity": "ISO 15607",
        "question": "Which values does a WPS define, and which records must name the governing edition?",
        "answer": ("The WPS defines ranges for essential variables; each range is recorded before "
                  "qualification; general qualification rules come from a governing standard; "
                  "qualification records must reference that standard's edition."),
        "answer_clauses": [
            {"text": "The WPS defines ranges for essential variables.", "fact_id": "A"},
            {"text": "Each range is recorded before qualification.", "fact_id": "A2"},
            {"text": "General qualification rules come from a governing standard.", "fact_id": "B"},
            {"text": "Qualification records must reference that standard's edition.", "fact_id": "B2"},
        ],
        "gold_fact_ids": ["A", "A2", "B", "B2"],
        "necessity": {"nli_singles": [0.1, 0.1, 0.1, 0.1], "nli_joint": 0.97},
    }


def _make_accepting_nli(clause_texts):
    clause_set = set(clause_texts)

    def nli(pairs):
        scores = []
        for premise, hypothesis in pairs:
            if premise.count(".") >= 2:
                scores.append(0.95)
            elif premise in clause_set:
                scores.append(0.05)
            else:
                scores.append(0.92)
        return scores

    return nli


_ALL_CLAUSES = [
    "The WPS defines ranges for essential variables.",
    "Each range is recorded before qualification.",
    "General qualification rules come from a governing standard.",
    "Qualification records must reference that standard's edition.",
]
_accepting_nli = _make_accepting_nli(_ALL_CLAUSES)


class _BoomLLM:
    def generate_json(self, prompt, temperature=0.0, max_tokens=0):
        raise AssertionError("get_llm() must not be called -- no borderline case in this batch")


def _qa_artifact(records: list, tmp_path, name: str = "qa_in") -> dict:
    ref = tmp_path / f"{name}.json"
    ref.write_text(json.dumps(records), encoding="utf-8")
    return {"type": "qa", "ref": str(ref), "meta": {"count": len(records)}}


def _facts_artifact(records: list, tmp_path, name: str = "facts_in") -> dict:
    ref = tmp_path / f"{name}.json"
    ref.write_text(json.dumps(records), encoding="utf-8")
    return {"type": "facts", "ref": str(ref), "meta": {"count": len(records)}}


def test_deterministic_pass_needs_no_llm_call(tmp_path):
    """A batch with no borderline-margin scores must never touch the LLM --
    params["llm"] is a FakeLLM that raises if generate_json is ever called."""
    inputs = {
        "qa": _qa_artifact([_neighbor_pair_qa()], tmp_path),
        "facts": _facts_artifact(_facts(), tmp_path),
    }
    params = {"llm": _BoomLLM(), "nli_fn": _accepting_nli, "settings": SETTINGS}

    out = run(inputs, params, artifacts_dir=tmp_path)

    verified = json.loads(open(out["qa"]["ref"], encoding="utf-8").read())
    assert len(verified) == 1
    assert verified[0]["verify"]["verdict"] == "PASS"
    assert verified[0]["verify"]["judge_used"] is False
    assert out["qa"]["meta"]["count"] == 1
    assert out["qa"]["meta"]["count_in"] == 1
    assert out["qa"]["meta"]["n_v2_native"] == 1
    assert out["qa"]["meta"]["n_v1_bridge_routed"] == 0
    assert out["qa"]["meta"]["verdicts"] == {"PASS": 1}


def test_verify_field_present_on_every_output_record_mixed_batch(tmp_path):
    pairs = [_neighbor_pair_qa(), _cluster_qa()]
    inputs = {
        "qa": _qa_artifact(pairs, tmp_path),
        "facts": _facts_artifact(_facts(), tmp_path),
    }
    params = {"llm": _BoomLLM(), "nli_fn": _accepting_nli, "settings": SETTINGS}

    out = run(inputs, params, artifacts_dir=tmp_path)

    verified = json.loads(open(out["qa"]["ref"], encoding="utf-8").read())
    assert len(verified) == 2
    for row in verified:
        assert "verify" in row
        assert row["verify"]["verdict"] in ("PASS", "REJECT")
    assert out["qa"]["meta"]["count"] == 2
    assert out["qa"]["meta"]["n_input"] == 2


def test_borderline_case_escalates_to_llm_judge(tmp_path):
    """Scores sitting exactly at the clause_entailment_min/joint_answer_min
    margin must trigger the LLM judge fallback -- this is the one path
    where a real (here: fake) LLM call happens."""

    class _JudgeLLM:
        def generate_json(self, prompt, temperature=0.0, max_tokens=0):
            return {"verdict": "PASS", "reason": "Fully supported by both source facts."}

    def borderline_nli(pairs):
        # Fixed 5-value layout verify_v2_pairs always builds for an n=2
        # record: clause0, clause1, joint, then the (0,1) pair's a_to_b/
        # b_to_a duplicate-check scores (see verify_v2.py's nli_inputs
        # construction). Clause/joint scores sit exactly at
        # clause_entailment_min/joint_answer_min so `borderline` is True;
        # a_to_b/b_to_a stay low so `mutual`/`duplicate` are both False.
        return [0.65, 0.65, 0.85, 0.10, 0.12]

    settings = dict(SETTINGS)
    settings["use_llm_borderline"] = True

    inputs = {
        "qa": _qa_artifact([_neighbor_pair_qa()], tmp_path),
        "facts": _facts_artifact(_facts(), tmp_path),
    }
    params = {"llm": _JudgeLLM(), "nli_fn": borderline_nli, "settings": settings}

    out = run(inputs, params, artifacts_dir=tmp_path)

    verified = json.loads(open(out["qa"]["ref"], encoding="utf-8").read())
    assert verified[0]["verify"]["judge_used"] is True
    assert verified[0]["verify"]["verdict"] == "PASS"
    assert out["qa"]["meta"]["reasons"].get("judge_pass") == 1


def test_get_llm_is_not_called_when_params_llm_is_supplied(tmp_path):
    """Confirm the block never reaches get_llm() at all when params['llm']
    is already supplied, matching the established PAID-block convention
    (see tests/test_blocks_fact_extract.py's identical check)."""
    import rag_gt.blocks.verifier as m

    def _boom_get_llm(role):
        raise AssertionError("get_llm() must not be called when params['llm'] is provided")

    original = m.get_llm
    m.get_llm = _boom_get_llm
    try:
        inputs = {
            "qa": _qa_artifact([_neighbor_pair_qa()], tmp_path),
            "facts": _facts_artifact(_facts(), tmp_path),
        }
        params = {"llm": _BoomLLM(), "nli_fn": _accepting_nli, "settings": SETTINGS}
        out = run(inputs, params, artifacts_dir=tmp_path)
    finally:
        m.get_llm = original

    assert out["qa"]["meta"]["count"] == 1


def test_model_role_default_threads_through_to_get_llm_when_not_supplied(tmp_path):
    """VerifierParams.model_role defaults to "verifier" (studio params.py).
    When params['llm'] is NOT supplied, the block must resolve via
    get_llm(role) using that default -- the same eager
    ``params.get('llm') or get_llm(params.get(<role_key>, <default>))``
    convention qa_gen_pairs/fact_extract_llm already use, just under this
    block's own studio field name ("model_role", not "llm_role")."""
    import rag_gt.blocks.verifier as m

    captured = {}

    class _FakeLLM:
        def generate_json(self, prompt, temperature=0.0, max_tokens=0):
            return {"verdict": "PASS", "reason": "ok"}

    def spy_get_llm(role):
        captured["role"] = role
        return _FakeLLM()

    original = m.get_llm
    m.get_llm = spy_get_llm
    try:
        inputs = {
            "qa": _qa_artifact([_neighbor_pair_qa()], tmp_path),
            "facts": _facts_artifact(_facts(), tmp_path),
        }
        params = {"nli_fn": _accepting_nli, "settings": SETTINGS}  # no "llm" key
        run(inputs, params, artifacts_dir=tmp_path)
    finally:
        m.get_llm = original

    assert captured["role"] == "verifier"
