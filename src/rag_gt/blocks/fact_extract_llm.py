"""Block adapter: **SFU Fact Extraction** ``fact_extract_llm`` [PAID].

``chunks -> facts``. Thin wrapper around
``rag_gt.allpdf.extract.extract_sfu_facts`` -- Stage 3 of the all-PDF
pipeline (05_BLOCK_CATALOG.md sec. 3 item 7) -- the real SFU fact extractor
that produces source/page/bbox-grounded facts from Stage-2 chunks.

This block makes real LLM calls when actually invoked (one chunk-segmenter
call plus one canonical-form-rewrite call and one self-containment-score call
per resulting span). Never call ``run()`` in a test without supplying
``params["llm"]``.
"""
from __future__ import annotations

import dataclasses
from pathlib import Path

from rag_gt.allpdf.chunk import ChunkResult
from rag_gt.allpdf.extract import extract_sfu_facts
from rag_gt.allpdf.preflight import DocProfile
from rag_gt.blocks._common import artifact, read_list_input, write_json_artifact
from rag_gt.core.llm import get_llm


def _doc_id_from_chunks(chunks: list, params: dict) -> str:
    """``doc_id`` is not a first-class block input -- infer it from the chunk
    dicts' own ``doc_id`` field, the same convention every chunk-producing
    block already uses (see ``chunker.py`` / ``tests/test_blocks_chunker.py``'s
    ``SAMPLE_CHUNKS``, each of which carries an explicit ``doc_id`` key).
    ``params["doc_id"]`` is an explicit override for callers whose chunk
    dicts don't carry it.
    """
    override = params.get("doc_id")
    if override:
        return str(override)
    for chunk in chunks:
        doc_id = chunk.get("doc_id") if isinstance(chunk, dict) else None
        if doc_id:
            return str(doc_id)
    return "unknown_doc"


def _minimal_doc_profile(doc_id: str) -> DocProfile:
    """``extract_sfu_facts`` reads exactly one attribute off ``profile`` --
    ``profile.doc_id`` (verified by inspection of ``extract.py``: no other
    ``profile.*`` access exists in the function body). ``DocProfile``'s other
    fields have no defaults but are never read here, so a placeholder profile
    with inert values is safe -- this block does not require an upstream
    Stage-0 preflight run just to extract facts from an already-chunked
    input.
    """
    return DocProfile(
        doc_id=doc_id,
        path="",
        source_sha256="",
        page_count=0,
        sampled_pages=0,
        digital_text_ratio=1.0,
        scanned=False,
        mixed=False,
        avg_chars_per_page=0.0,
        figure_density=0.0,
        table_density=0.0,
        multi_column=False,
        reading_order_risk="low",
    )


def _fact_to_dict(fact) -> dict:
    """``Fact`` has no ``to_dict()`` of its own (unlike ``Span``/``SourceBBox``),
    but every field on ``Fact``, ``Span``, and ``SourceBBox`` is a plain
    dataclass field of a JSON-native type (str/float/bool/list of dataclasses),
    so ``dataclasses.asdict()`` recurses cleanly with no custom encoder needed.
    The resulting dict carries ``fact_id``/``text``/``canonical_form``/
    ``raw_text``/``self_containment_score``/``supporting_spans`` -- exactly the
    keys downstream readers (``rag_gt.generation.answer_first._as_fact``,
    ``rag_gt.validation.bridge_verifier._fact_id``/``_fact_text``) already look
    for via ``.get(...)``.
    """
    return dataclasses.asdict(fact)


def run(inputs: dict, params: dict, artifacts_dir: Path | str | None = None) -> dict:
    """``inputs``: ``{"chunks": <chunks artifact>}``.

    ``params``: ``doc_id`` (optional override; else inferred from the chunk
    dicts themselves), ``llm`` (optional -- FakeLLM in tests, else defaults to
    ``get_llm(params.get("llm_role", "gt"))``), ``nli_model`` (optional
    passthrough; default ``None`` lets ``extract_sfu_facts`` fall back to its
    own production default -- module-level NLI-verified canonical rewrites),
    ``max_chunks``, ``llm_chunk_cap`` (engine default 40), ``cache_dir``,
    ``workers``, ``strategy``/``chunk_size``/``overlap`` (cosmetic
    ``ChunkResult`` metadata -- ``extract_sfu_facts`` never reads them, only
    ``chunk_result.chunks`` and ``profile.doc_id``).

    Returns ``{"facts": {"type": "facts", "ref": <path>, "meta": {...}}}``
    where ``meta`` is ``ExtractResult.summary()`` plus ``count``/``grounded``
    for parity with the other ``facts``-typed block outputs
    (``facts_import``, ``stubs.run_fact_extract_llm``).
    """
    chunks = read_list_input(inputs.get("chunks"))
    doc_id = _doc_id_from_chunks(chunks, params)
    profile = _minimal_doc_profile(doc_id)
    chunk_result = ChunkResult(
        doc_id=doc_id,
        strategy=str(params.get("strategy") or "unknown"),
        chunk_size=int(params.get("chunk_size") or 0),
        overlap=int(params.get("overlap") or 0),
        chunks=chunks,
    )

    llm = params.get("llm") or get_llm(str(params.get("llm_role", "gt")))
    max_chunks = params.get("max_chunks")
    llm_chunk_cap = params.get("llm_chunk_cap", 40)
    cache_dir = params.get("cache_dir")
    workers = params.get("workers")

    result = extract_sfu_facts(
        profile,
        chunk_result,
        llm=llm,
        nli_model=params.get("nli_model"),
        max_chunks=int(max_chunks) if max_chunks is not None else None,
        llm_chunk_cap=int(llm_chunk_cap) if llm_chunk_cap is not None else None,
        cache_dir=str(cache_dir) if cache_dir else None,
        workers=int(workers) if workers is not None else None,
    )

    facts_payload = [_fact_to_dict(f) for f in result.facts]
    meta = {**result.summary(), "count": result.n_facts, "grounded": True}
    ref = write_json_artifact(artifacts_dir, "fact_extract_llm", facts_payload)
    return {"facts": artifact("facts", str(ref), meta)}
