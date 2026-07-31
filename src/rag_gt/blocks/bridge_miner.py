"""Block: bridge_miner [FREE] -- facts -> bridges.

Wraps rag_gt.graph.bridge_index.build_bridge_index + rag_gt.graph.
bridge_linker.build_bridge_pairs verbatim. This is the deterministic ($0),
no-LLM bridge-mining logic the project actually uses to find verified
multi-hop candidate pairs -- NOT rag_gt.allpdf.pipeline._build_graph's
LLM-based TypedSFG structural-edge classifier, which is a different,
non-deterministic mechanism for a different purpose (see TODO.md §3
correction note for this block).

Stage A (build_bridge_index) groups facts sharing a salient cross-page
phrase or standard reference into bridge_groups. Stage B (build_bridge_pairs)
turns those groups into verified fact pairs, applying two correctness-
critical, non-adjustable gates: an anti-fabrication check (the bridge
phrase must appear in BOTH facts, on whole-token boundaries) and a
duplicate check (drop pairs whose two facts say the same thing). Never
loosen either gate here.
"""
from __future__ import annotations

from pathlib import Path

from rag_gt.blocks._common import artifact, read_list_input, write_json_artifact
from rag_gt.graph.bridge_index import build_bridge_index
from rag_gt.graph.bridge_linker import build_bridge_pairs


def run(inputs: dict, params: dict, artifacts_dir: Path | str | None = None) -> dict:
    """``inputs``: ``{"facts": <facts artifact>}`` -- a plain JSON list of
    fact dicts (either the s4_facts shape ``{fact_id, canonical_form,
    page_start}`` or the all_facts shape ``{id, text, doc, page}``;
    ``build_bridge_index`` is schema-agnostic over both).

    ``params``: ``max_pages`` (optional passthrough to ``build_bridge_index``;
    defaults to that function's own default of 4 when omitted).

    Returns ``{"bridges": {"type": "bridges", "ref": <path>, "meta": {...}}}``
    where the artifact payload is ``build_bridge_pairs``'s ``"pairs"`` list
    (matching the shape ``bridges_import.py`` already produces: a plain list
    of pair dicts, each with ``doc, fact_a, fact_b, bridge_entity,
    bridge_norm, bridge_type, pages, content_jaccard, pair_id``).

    Meta-shape choice: ``bridges_import.py``'s meta is just ``{"count":
    ...}``. Here ``meta`` also folds in ``build_bridge_pairs``'s own
    ``"stats"`` dict (``candidate_pairs``, ``dropped_bridge_missing``,
    ``dropped_duplicate``, ``verified_pairs``) so the mining diagnostics
    (how much was mined vs. dropped and why) survive past this block. The
    only consumers of a ``bridges`` artifact (``qa_gen_bridges.py``,
    ``cluster_builder.py``) read the artifact's list payload via
    ``read_list_input``, never its ``meta`` dict, so adding extra meta keys
    here does not break either.
    """
    facts = read_list_input(inputs.get("facts"))

    max_pages = params.get("max_pages")
    if max_pages is not None:
        bridge_index = build_bridge_index(facts, max_pages=int(max_pages))
    else:
        bridge_index = build_bridge_index(facts)

    result = build_bridge_pairs(facts, bridge_index)
    pairs = result["pairs"]

    ref = write_json_artifact(artifacts_dir, "bridge_miner", pairs)
    meta = {"count": len(pairs), **result["stats"]}
    return {"bridges": artifact("bridges", str(ref), meta)}
