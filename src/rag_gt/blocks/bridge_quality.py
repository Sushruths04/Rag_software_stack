"""Block: bridge_quality [FREE] -- bridges -> bridges.

Wraps rag_gt.allpdf.bridge_quality.surface_ok verbatim: a free (no-LLM),
deterministic surface-quality gate applied to each bridge pair's
``bridge_entity``. ``surface_ok`` returns ``(ok, detail)``:

* ``ok is True`` -- ``detail`` is the surface to USE going forward. This is
  either the input unchanged, or a REPAIRED surface for a known OCR-split
  pattern (e.g. "di erent" -> "different", "nite number" -> "finite
  number"). The pair's ``bridge_entity``/``bridge_norm`` are overwritten
  with ``detail`` whenever it differs from the input -- the repaired text
  must actually flow downstream, not just be checked and discarded.
* ``ok is False`` -- ``detail`` is a short rejection reason
  ("empty"/"junk_surface"/"too_short"/"no_content_token") and the pair is
  dropped from the output.

``surface_ok``'s JUNK_SURFACES reject list and structural checks are
correctness-critical (Phase 1 debug plan T2, kills finding F1 -- 9 measured
junk bridge surfaces in a shipped dataset); this block calls it as-is and
never adjusts its internals.

Note on params: the OLD stub (studio/backend/stubs.py:154) and its Pydantic
params model (studio/backend/params.py's BridgeQualityParams) both declare
an ``idf_floor`` float param (a made-up "drop the bottom X% by IDF" stub
behavior). ``surface_ok`` has no IDF concept at all -- it is a fixed
seed-list + structural gate, not a corpus-frequency filter -- so there is no
real-function equivalent. ``idf_floor`` is accepted (to avoid raising on an
unknown-but-harmless key) and silently ignored here; it is NOT wired to any
behavior. The Pydantic model still validates fine since studio.backend.
params.py's strict "extra=forbid" schema only gates params AT THE STUDIO
LAYER against the field names it itself declares -- it never inspects this
module's run() signature, so an extra unused key does not break anything
downstream.
"""
from __future__ import annotations

from collections import Counter
from pathlib import Path

from rag_gt.allpdf.bridge_quality import surface_ok
from rag_gt.blocks._common import artifact, read_list_input, write_json_artifact


def run(inputs: dict, params: dict, artifacts_dir: Path | str | None = None) -> dict:
    """``inputs``: ``{"bridges": <bridges artifact>}`` -- a plain list of
    bridge-pair dicts, from either ``bridge_miner`` or ``bridges_import``.

    ``params``: none of the real function's behavior is parametrized;
    ``idf_floor`` (if present, from the old stub's params model) is accepted
    and ignored -- see module docstring.

    Returns ``{"bridges": {"type": "bridges", "ref": <path>, "meta": {...}}}``
    where the payload is the filtered+repaired pair list and ``meta``
    includes ``count`` plus rejection stats: ``dropped`` (total dropped) and
    ``dropped_reasons`` (a ``{reason: count}`` breakdown, e.g.
    ``{"junk_surface": 3, "too_short": 1}``).
    """
    pairs = read_list_input(inputs.get("bridges"))

    kept: list = []
    dropped_reasons: Counter = Counter()

    for pair in pairs:
        entity = pair.get("bridge_entity")
        ok, detail = surface_ok(entity)
        if not ok:
            dropped_reasons[detail] += 1
            continue
        if detail != entity:
            pair = {**pair, "bridge_entity": detail, "bridge_norm": detail.strip().lower()}
        kept.append(pair)

    ref = write_json_artifact(artifacts_dir, "bridge_quality", kept)
    meta = {
        "count": len(kept),
        "dropped": sum(dropped_reasons.values()),
        "dropped_reasons": dict(dropped_reasons),
    }
    return {"bridges": artifact("bridges", str(ref), meta)}
