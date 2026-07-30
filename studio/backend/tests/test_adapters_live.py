"""Tests for the live block registry: build_registry(use_stubs=False) and
studio.backend.adapters_live.REGISTRY_LIVE.

Live adapters wrap real rag_gt.blocks.* (05_BLOCK_CATALOG.md M0 milestone)
for exactly the 10 FREE-spine blocks named in the task (chunks_import,
facts_import, bridges_import, qa_import, chunker, neighbor_sampler,
cluster_builder, index_builder, evaluator, report); the other 23 block types
must remain the untouched stub REGISTRY entries. Default build_registry()
(use_stubs=True) must return REGISTRY unchanged so the existing 84
stub-based tests are unaffected.
"""
from __future__ import annotations

import inspect

from studio.backend.registry import REGISTRY, build_registry

LIVE_BLOCK_TYPES = {
    "chunks_import", "facts_import", "bridges_import", "qa_import", "chunker",
    "neighbor_sampler", "cluster_builder", "index_builder", "evaluator", "report",
}

# The 3 PAID generation blocks (M4b): qa_gen_pairs, qa_gen_clusters,
# qa_gen_bridges now have real rag_gt.blocks.* adapters too. These tests only
# check registry wiring (spec.run identity/signature/cost class) -- NEVER
# invoke .run(), so no LLM (real or fake) is ever touched here. Execution
# with a FakeLLM is covered end-to-end in test_run_endpoint.py instead.
PAID_LIVE_BLOCK_TYPES = {"qa_gen_pairs", "qa_gen_clusters", "qa_gen_bridges"}


def test_build_registry_default_is_stub_registry_unchanged():
    reg = build_registry()
    assert reg == REGISTRY
    for block_type, spec in reg.items():
        assert spec.run is REGISTRY[block_type].run


def test_build_registry_use_stubs_true_explicit_matches_default():
    assert build_registry(use_stubs=True) == REGISTRY


def test_build_registry_live_swaps_exactly_the_10_free_spine_blocks():
    reg_live = build_registry(use_stubs=False)

    assert set(reg_live.keys()) == set(REGISTRY.keys())  # same 33 block types
    for block_type, spec in reg_live.items():
        if block_type in LIVE_BLOCK_TYPES or block_type in PAID_LIVE_BLOCK_TYPES:
            assert spec.run is not REGISTRY[block_type].run, f"{block_type} should be swapped"
        else:
            assert spec.run is REGISTRY[block_type].run, f"{block_type} must stay a stub"


def test_build_registry_live_preserves_ports_params_cost_class():
    reg_live = build_registry(use_stubs=False)
    for block_type in LIVE_BLOCK_TYPES:
        live_spec = reg_live[block_type]
        stub_spec = REGISTRY[block_type]
        assert live_spec.type == stub_spec.type
        assert live_spec.cost == stub_spec.cost
        assert live_spec.inputs == stub_spec.inputs
        assert live_spec.outputs == stub_spec.outputs
        assert live_spec.params is stub_spec.params
        sig = inspect.signature(live_spec.run)
        assert list(sig.parameters) == ["inputs", "params"]


def test_build_registry_live_swaps_the_3_paid_generation_blocks():
    """qa_gen_pairs/qa_gen_clusters/qa_gen_bridges (05_BLOCK_CATALOG.md §3
    items 15-17) now have real rag_gt.blocks.* adapters (M4b) -- same
    _wrap() closure pattern as the 9 FREE-spine blocks. This test only
    resolves the registry lookup; it never calls .run(), so no LLM (real or
    fake) is touched here."""
    reg_live = build_registry(use_stubs=False)
    for block_type in PAID_LIVE_BLOCK_TYPES:
        live_spec = reg_live[block_type]
        stub_spec = REGISTRY[block_type]
        assert live_spec.run is not stub_spec.run, f"{block_type} should be swapped"
        assert live_spec.type == stub_spec.type
        assert live_spec.cost == "paid" == stub_spec.cost
        assert live_spec.inputs == stub_spec.inputs
        assert live_spec.outputs == stub_spec.outputs
        assert live_spec.params is stub_spec.params
        assert live_spec.estimate is stub_spec.estimate
        sig = inspect.signature(live_spec.run)
        assert list(sig.parameters) == ["inputs", "params"]


def test_registry_live_module_level_convenience_matches_build_registry_false():
    from studio.backend.adapters_live import REGISTRY_LIVE

    reg_live = build_registry(use_stubs=False)
    assert set(REGISTRY_LIVE.keys()) == set(reg_live.keys())
    for block_type in LIVE_BLOCK_TYPES | PAID_LIVE_BLOCK_TYPES:
        assert REGISTRY_LIVE[block_type].run is reg_live[block_type].run


def test_importing_registry_module_alone_does_not_import_rag_gt():
    """build_registry(True)/REGISTRY must stay import-cheap: rag_gt is only
    touched once build_registry(use_stubs=False) (or adapters_live) is
    actually reached, not merely by importing studio.backend.registry."""
    import subprocess
    import sys
    from pathlib import Path

    worktree_root = Path(__file__).resolve().parents[3]
    code = (
        "import sys\n"
        "import studio.backend.registry as r\n"
        "print('rag_gt' in sys.modules)\n"
        "r.build_registry()\n"
        "print('rag_gt' in sys.modules)\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=str(worktree_root),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    assert lines == ["False", "False"], result.stdout
