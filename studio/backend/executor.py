"""Executor: run a CompiledPlan's stub blocks in topological order.

Per 02_PHASE2_APP_PLAN.md's "Executor" section: per-block try/except emits
status events (``block_started``, ``block_finished {meta}``,
``block_failed {error}``) — kept here as an in-memory list rather than
pushed over the existing WebSocket, since that channel lives in
``production/`` which this scaffold does not touch. Artifacts are addressed
by a content hash: ``hash(block type + params + input artifact hashes)``.
Re-running a plan against the same cache dict re-executes only the blocks
downstream of whatever changed — nothing else has to be tracked explicitly,
because a changed upstream artifact changes every downstream cache key by
construction (the hash chains through resolved inputs).
"""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field
from typing import Any, Literal

from studio.backend.compiler import CompiledPlan, PlanNode, resolve_inputs

BlockEventType = Literal["block_started", "block_finished", "block_failed", "block_skipped_cache"]


@dataclass(frozen=True)
class BlockEvent:
    block_id: str
    type: BlockEventType
    payload: dict = field(default_factory=dict)


class Executor:
    """Runs a CompiledPlan's blocks in ``plan.order``, caching each block's
    output artifacts under a content-addressed key. Pass the same ``cache``
    dict across runs (e.g. after editing a graph and recompiling) to get
    cache hits for every block upstream of, and unaffected by, the edit."""

    def __init__(self, plan: CompiledPlan, cache: dict[str, dict] | None = None):
        self.plan = plan
        self.cache: dict[str, dict] = cache if cache is not None else {}
        self.events: list[BlockEvent] = []
        self.artifacts: dict[str, dict] = {}

    def run(self) -> dict[str, dict]:
        for block_id in self.plan.order:
            node = self.plan.nodes[block_id]
            resolved_inputs = resolve_inputs(node, self.artifacts)
            cache_key = self._cache_key(node, resolved_inputs)

            cached = self.cache.get(cache_key)
            if cached is not None:
                self.artifacts[block_id] = cached
                self.events.append(BlockEvent(block_id, "block_skipped_cache", {"cache_key": cache_key}))
                continue

            self.events.append(BlockEvent(block_id, "block_started", {"cache_key": cache_key}))
            started = time.perf_counter()
            try:
                outputs = node.spec.run(resolved_inputs, node.params)
            except Exception as exc:  # noqa: BLE001 - surfaced via event, then re-raised
                elapsed = round(time.perf_counter() - started, 4)
                self.events.append(
                    BlockEvent(block_id, "block_failed", {"error": str(exc), "elapsed_sec": elapsed})
                )
                raise

            elapsed = round(time.perf_counter() - started, 4)
            self.cache[cache_key] = outputs
            self.artifacts[block_id] = outputs
            meta = {port_name: artifact.get("meta") for port_name, artifact in outputs.items()}
            self.events.append(
                BlockEvent(block_id, "block_finished", {"meta": meta, "elapsed_sec": elapsed})
            )

        return self.artifacts

    def _cache_key(self, node: PlanNode, resolved_inputs: dict) -> str:
        digest = hashlib.sha256()
        digest.update(node.type.encode("utf-8"))
        digest.update(b"\0")
        digest.update(_stable_json(node.params).encode("utf-8"))
        for port_name in sorted(resolved_inputs):
            digest.update(b"\0")
            digest.update(port_name.encode("utf-8"))
            digest.update(b"\0")
            digest.update(_stable_json(resolved_inputs[port_name]).encode("utf-8"))
        return digest.hexdigest()


def _stable_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, default=str)
