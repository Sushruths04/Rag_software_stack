"""Tests for the ``fact_extract_llm`` block SDK adapter wrapping
``rag_gt.allpdf.extract.extract_sfu_facts`` (05_BLOCK_CATALOG.md §3 item 7,
TODO.md §3 row 1). PAID -- every test injects a FakeLLM via params["llm"],
exactly like the existing qa_gen_pairs/qa_gen_clusters/qa_gen_bridges block
tests (test_blocks_qa_gen.py); the real get_llm() default path is never hit.

The LLM-path NLI guard inside ``canonical_form_rewrite`` is bypassed the same
way ``tests/test_semantic_extraction.py`` bypasses it for its own direct
tests of that function (monkeypatching ``_forward_nli_guard`` rather than
loading a real NLI/embedding model), since ``extract_sfu_facts`` defaults
``nli_model=None`` to the ``USE_MODULE_NLI`` sentinel internally (production
behaviour: a rewrite is NLI-verified unless the caller explicitly disables
it), not to "skip the guard".
"""
from __future__ import annotations

import json

import rag_gt.facts.semantic_extraction as sx
from rag_gt.allpdf.preflight import DocProfile
from rag_gt.blocks import fact_extract_llm


class FakeLLM:
    """Serves canned ``.generate()`` responses in call order: one segmenter
    call (returns ``"[]"`` so the whole chunk is treated as one span, keeping
    the call sequence to exactly 3 per chunk), one canonical-rewrite call,
    one self-containment-score call."""

    def __init__(self, responses):
        self._queue = list(responses)
        self.calls = 0

    def generate(self, prompt, temperature=0.0, max_tokens=0):
        self.calls += 1
        if not self._queue:
            raise AssertionError("FakeLLM.generate() called more times than scripted")
        return self._queue.pop(0)


def _write_json(tmp_path, name, data):
    path = tmp_path / name
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def _artifact(type_, ref):
    return {"type": type_, "ref": str(ref)}


ONE_CHUNK = [
    {
        "chunk_id": "din_iso_15609_c0000",
        "doc_id": "din_iso_15609",
        "text": (
            "A welding procedure specification defines every essential "
            "variable required for the welding process to be qualified."
        ),
        "page_start": 1,
        "page_end": 1,
        "char_start": 0,
        "bboxes": [],
    }
]


def _always_pass_nli(monkeypatch):
    monkeypatch.setattr(sx, "_forward_nli_guard", lambda a, b, m, t: (True, 0.95, 0.9))


def test_fact_extract_llm_produces_facts_artifact_matching_fake_llm_output(tmp_path, monkeypatch):
    _always_pass_nli(monkeypatch)
    chunks_ref = _write_json(tmp_path, "chunks.json", ONE_CHUNK)
    llm = FakeLLM([
        "[]",  # segmenter: no sub-spans -> whole chunk is treated as one span
        "A welding procedure specification defines every essential variable "
        "required for the welding process to be qualified.",  # canonical rewrite
        "0.9",  # self-containment score
    ])

    out = fact_extract_llm.run(
        inputs={"chunks": _artifact("chunks", chunks_ref)},
        params={"llm": llm, "workers": 1},
        artifacts_dir=tmp_path,
    )

    assert out["facts"]["type"] == "facts"
    facts = json.loads(open(out["facts"]["ref"], encoding="utf-8").read())
    assert len(facts) == 1
    fact = facts[0]
    assert fact["fact_id"].startswith("din_iso_15609_F")
    assert fact["canonical_form"].startswith("A welding procedure specification")
    assert fact["self_containment_score"] == 0.9
    assert fact["self_containment_known"] is True
    # supporting_spans carries page/bbox provenance inherited from the chunk.
    assert fact["supporting_spans"][0]["page_start"] == 1
    assert fact["supporting_spans"][0]["chunk_id"] == "din_iso_15609_c0000"

    meta = out["facts"]["meta"]
    assert meta["count"] == 1
    assert meta["n_facts"] == 1
    assert meta["grounded"] is True
    assert meta["doc_id"] == "din_iso_15609"
    assert llm.calls == 3


def test_fact_extract_llm_infers_doc_id_from_chunk_dicts(tmp_path, monkeypatch):
    _always_pass_nli(monkeypatch)
    chunks_ref = _write_json(tmp_path, "chunks.json", ONE_CHUNK)
    llm = FakeLLM(["[]", "A welding procedure specification defines every essential "
                   "variable required for the welding process to be qualified.", "0.9"])

    out = fact_extract_llm.run(
        inputs={"chunks": _artifact("chunks", chunks_ref)},
        params={"llm": llm, "workers": 1},
        artifacts_dir=tmp_path,
    )

    assert out["facts"]["meta"]["doc_id"] == "din_iso_15609"


def test_fact_extract_llm_doc_id_param_overrides_chunk_dicts(tmp_path, monkeypatch):
    _always_pass_nli(monkeypatch)
    chunks_ref = _write_json(tmp_path, "chunks.json", ONE_CHUNK)
    llm = FakeLLM(["[]", "A welding procedure specification defines every essential "
                   "variable required for the welding process to be qualified.", "0.9"])

    out = fact_extract_llm.run(
        inputs={"chunks": _artifact("chunks", chunks_ref)},
        params={"llm": llm, "workers": 1, "doc_id": "override_doc"},
        artifacts_dir=tmp_path,
    )

    assert out["facts"]["meta"]["doc_id"] == "override_doc"
    facts = json.loads(open(out["facts"]["ref"], encoding="utf-8").read())
    assert facts[0]["fact_id"].startswith("override_doc_F")


def test_fact_extract_llm_empty_chunks_produces_zero_facts_and_never_calls_llm(tmp_path):
    chunks_ref = _write_json(tmp_path, "chunks.json", [])

    class _BoomLLM:
        def generate(self, *a, **k):
            raise AssertionError("LLM must not be called when there are no chunks")

    out = fact_extract_llm.run(
        inputs={"chunks": _artifact("chunks", chunks_ref)},
        params={"llm": _BoomLLM(), "workers": 1},
        artifacts_dir=tmp_path,
    )

    facts = json.loads(open(out["facts"]["ref"], encoding="utf-8").read())
    assert facts == []
    assert out["facts"]["meta"]["count"] == 0
    assert out["facts"]["meta"]["grounded"] is True


def test_fact_extract_llm_never_calls_real_get_llm_when_llm_param_given(tmp_path, monkeypatch):
    """PAID blocks must not silently reach for a real LLM in a test context."""
    from rag_gt.blocks import fact_extract_llm as mod

    def _boom(role="gt"):
        raise AssertionError("get_llm() must not be called when params['llm'] is provided")

    monkeypatch.setattr(mod, "get_llm", _boom)
    _always_pass_nli(monkeypatch)

    chunks_ref = _write_json(tmp_path, "chunks.json", ONE_CHUNK)
    llm = FakeLLM(["[]", "A welding procedure specification defines every essential "
                   "variable required for the welding process to be qualified.", "0.9"])

    fact_extract_llm.run(
        inputs={"chunks": _artifact("chunks", chunks_ref)},
        params={"llm": llm, "workers": 1},
        artifacts_dir=tmp_path,
    )


def test_fact_extract_llm_default_artifacts_dir_is_still_callable_standalone(tmp_path, monkeypatch):
    """Matches the FREE-spine blocks' contract (see rag_gt.blocks.facts_import):
    omitting artifacts_dir must not error -- falls back to the process-wide
    default temp directory."""
    _always_pass_nli(monkeypatch)
    chunks_ref = _write_json(tmp_path, "chunks.json", ONE_CHUNK)
    llm = FakeLLM(["[]", "A welding procedure specification defines every essential "
                   "variable required for the welding process to be qualified.", "0.9"])

    out = fact_extract_llm.run(
        inputs={"chunks": _artifact("chunks", chunks_ref)},
        params={"llm": llm, "workers": 1},
    )
    assert out["facts"]["type"] == "facts"
    assert json.loads(open(out["facts"]["ref"], encoding="utf-8").read())


def test_minimal_doc_profile_constructs_valid_docprofile_with_only_doc_id_meaningful():
    """extract_sfu_facts only reads profile.doc_id (verified by inspection of
    extract.py); the helper must still produce a structurally valid
    DocProfile instance (all required dataclass fields populated) even
    though every field but doc_id is an inert placeholder."""
    profile = fact_extract_llm._minimal_doc_profile("some_doc")
    assert isinstance(profile, DocProfile)
    assert profile.doc_id == "some_doc"
    # Round-trips through to_dict() without raising -- confirms every
    # required field got a value.
    assert profile.to_dict()["doc_id"] == "some_doc"
