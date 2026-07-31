"""Generic (non-hardcoded) loading for the no-API RAG evaluation.

The 13-document corpus map in rag/loader.py is fine for the thesis corpus
study, but production use means evaluating a document the map has never seen.
These tests cover the explicit-path loaders and the evaluate_doc override that
make that possible without editing source.
"""

import json

import pytest

from rag_gt.rag.loader import load_chunks_from, load_gt_pairs_from
from rag_gt.rag.pipeline import evaluate_doc


def _write_chunks(tmp_path, n=3):
    chunks = [
        {
            "chunk_id": f"newdoc_c{i:04d}",
            "doc_id": "newdoc",
            "text": f"The vacuum chamber pressure limit is {i} pascal for stage {i}.",
            "page_start": i,
            "page_end": i,
        }
        for i in range(n)
    ]
    p = tmp_path / "s2_chunks_full.json"
    p.write_text(json.dumps(chunks), encoding="utf-8")
    return p, chunks


def _write_pairs_jsonl(tmp_path):
    pairs = [
        {
            "question": "What is the vacuum chamber pressure limit for stage 1?",
            "answer": "1 pascal",
            "chain_fact_ids": ["newdoc_F001001"],
            "facts": [
                {
                    "fact_id": "newdoc_F001001",
                    "text": "The vacuum chamber pressure limit is 1 pascal for stage 1.",
                }
            ],
        },
        {
            "question": "What is the pressure limit for stage 2?",
            "answer": "2 pascal",
            "chain_fact_ids": ["otherdoc_F000001"],
            "facts": [
                {
                    "fact_id": "otherdoc_F000001",
                    "text": "The vacuum chamber pressure limit is 2 pascal for stage 2.",
                }
            ],
        },
    ]
    p = tmp_path / "pairs.jsonl"
    p.write_text("\n".join(json.dumps(x) for x in pairs), encoding="utf-8")
    return p, pairs


def test_load_chunks_from_reads_any_path(tmp_path):
    path, chunks = _write_chunks(tmp_path)
    loaded = load_chunks_from(path)
    assert loaded == chunks


def test_load_chunks_from_missing_file_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_chunks_from(tmp_path / "nope.json")


def test_load_gt_pairs_from_jsonl_all(tmp_path):
    path, pairs = _write_pairs_jsonl(tmp_path)
    loaded = load_gt_pairs_from(path)
    assert len(loaded) == 2


def test_load_gt_pairs_from_filters_by_doc_id(tmp_path):
    path, _ = _write_pairs_jsonl(tmp_path)
    loaded = load_gt_pairs_from(path, doc_id="newdoc")
    assert len(loaded) == 1
    assert loaded[0]["chain_fact_ids"] == ["newdoc_F001001"]


def test_load_gt_pairs_from_json_list_also_accepted(tmp_path):
    """s7_pairs.json from the allpdf pipeline is a JSON array, not JSONL."""
    _, pairs = _write_pairs_jsonl(tmp_path)
    p = tmp_path / "s7_pairs.json"
    p.write_text(json.dumps(pairs), encoding="utf-8")
    loaded = load_gt_pairs_from(p)
    assert len(loaded) == 2


def test_evaluate_doc_accepts_explicit_pairs_and_chunks(tmp_path):
    chunks_path, chunks = _write_chunks(tmp_path)
    pairs_path, _ = _write_pairs_jsonl(tmp_path)

    result = evaluate_doc(
        doc_id="newdoc",
        pairs=load_gt_pairs_from(pairs_path, doc_id="newdoc"),
        chunks=load_chunks_from(chunks_path),
    )
    assert result["doc_id"] == "newdoc"
    assert result["n_pairs"] == 1
    assert result["n_chunks"] == len(chunks)
    # The single pair's fact text matches chunk c0001 verbatim -> retrievable.
    assert result["aggregate"]["fact_recall@5"] > 0
