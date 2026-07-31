"""TDD: rag_gt.blocks.bridge_quality wraps rag_gt.allpdf.bridge_quality.
surface_ok verbatim (TODO.md §3/§8). Direct unit coverage of surface_ok's
accept/reject/repair rules already lives in tests/test_bridge_quality.py;
this file adds only the thin block-adapter (artifact in/out + meta shape,
and that a REPAIRED surface actually flows into the output pair) coverage
on top, following the pattern in tests/test_blocks_facts_bridges_import.py.
"""
from __future__ import annotations

import json

from rag_gt.blocks.bridge_quality import run


def _pair(bridge_entity: str, pair_id: str) -> dict:
    return {
        "doc": "d",
        "fact_a": f"d_F{pair_id}a",
        "fact_b": f"d_F{pair_id}b",
        "bridge_entity": bridge_entity,
        "bridge_norm": bridge_entity.strip().lower(),
        "bridge_type": "TERM",
        "pages": [1, 2],
        "content_jaccard": 0.1,
        "pair_id": pair_id,
    }


def _bridges_artifact(pairs: list, tmp_path) -> dict:
    ref = tmp_path / "bridges_in.json"
    ref.write_text(json.dumps(pairs), encoding="utf-8")
    return {"type": "bridges", "ref": str(ref), "meta": {"count": len(pairs)}}


def test_clean_bridge_entity_is_kept_unchanged(tmp_path):
    pairs = [_pair("Vickers microhardness", "P1")]
    out = run({"bridges": _bridges_artifact(pairs, tmp_path)}, {}, artifacts_dir=tmp_path)

    kept = json.loads(open(out["bridges"]["ref"], encoding="utf-8").read())
    assert len(kept) == 1
    assert kept[0]["bridge_entity"] == "Vickers microhardness"
    assert kept[0]["pair_id"] == "P1"
    assert out["bridges"]["meta"]["count"] == 1
    assert out["bridges"]["meta"]["dropped"] == 0


def test_junk_surface_is_dropped_and_counted_in_stats(tmp_path):
    pairs = [_pair("Vickers microhardness", "P1"), _pair("less than", "P2")]
    out = run({"bridges": _bridges_artifact(pairs, tmp_path)}, {}, artifacts_dir=tmp_path)

    kept = json.loads(open(out["bridges"]["ref"], encoding="utf-8").read())
    kept_ids = {p["pair_id"] for p in kept}
    assert kept_ids == {"P1"}

    meta = out["bridges"]["meta"]
    assert meta["count"] == 1
    assert meta["dropped"] == 1
    assert meta["dropped_reasons"] == {"junk_surface": 1}


def test_ocr_split_surface_is_repaired_in_output_not_just_kept(tmp_path):
    pairs = [_pair("di erent", "P1")]
    out = run({"bridges": _bridges_artifact(pairs, tmp_path)}, {}, artifacts_dir=tmp_path)

    kept = json.loads(open(out["bridges"]["ref"], encoding="utf-8").read())
    assert len(kept) == 1
    # Not just "not dropped" -- the actual field value must change.
    assert kept[0]["bridge_entity"] == "different"
    assert kept[0]["bridge_entity"] != "di erent"
    assert kept[0]["bridge_norm"] == "different"
    assert out["bridges"]["meta"]["count"] == 1
    assert out["bridges"]["meta"]["dropped"] == 0


def test_idf_floor_param_is_accepted_and_ignored(tmp_path):
    """The old stub's idf_floor param has no real-function equivalent in
    surface_ok (a fixed seed-list + structural gate, not an IDF filter). It
    must not raise and must not change behavior."""
    pairs = [_pair("Vickers microhardness", "P1"), _pair("less than", "P2")]
    out = run({"bridges": _bridges_artifact(pairs, tmp_path)}, {"idf_floor": 0.9}, artifacts_dir=tmp_path)

    kept = json.loads(open(out["bridges"]["ref"], encoding="utf-8").read())
    assert {p["pair_id"] for p in kept} == {"P1"}
    assert out["bridges"]["meta"]["count"] == 1
