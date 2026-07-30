"""Filesystem-backed graph persistence: save/load/list ``Graph`` documents.

Each saved graph is one JSON file named ``<uuid4hex>.json`` under a graphs
directory (default: ``studio/backend/data/graphs/``, created on first save).
The stored JSON is the ``Graph`` pydantic model dumped with ``by_alias=True``
so it round-trips through the wire schema exactly (``from`` stays ``from``,
not ``from_``).

The directory is always an explicit parameter (with a module-level default)
rather than a hardcoded path baked into each function, so tests can point
every call at a ``tmp_path`` and never touch the real data directory. The
FastAPI layer (``studio.backend.api``) wires this up via a ``Depends``
override for the same reason.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path

from studio.backend.models import Graph

__all__ = ["DEFAULT_GRAPHS_DIR", "save_graph", "load_graph", "list_graphs"]

DEFAULT_GRAPHS_DIR = Path(__file__).resolve().parent / "data" / "graphs"


def _path_for(graph_id: str, directory: Path) -> Path:
    return directory / f"{graph_id}.json"


def save_graph(graph: Graph, directory: Path = DEFAULT_GRAPHS_DIR) -> str:
    """Persist ``graph`` as a new file under ``directory``; returns its id."""
    directory.mkdir(parents=True, exist_ok=True)
    graph_id = uuid.uuid4().hex
    _path_for(graph_id, directory).write_text(
        graph.model_dump_json(by_alias=True, indent=2), encoding="utf-8"
    )
    return graph_id


def load_graph(graph_id: str, directory: Path = DEFAULT_GRAPHS_DIR) -> Graph | None:
    """Load a previously saved graph, or ``None`` if ``graph_id`` is unknown."""
    path = _path_for(graph_id, directory)
    if not path.exists():
        return None
    return Graph.model_validate_json(path.read_text(encoding="utf-8"))


def list_graphs(directory: Path = DEFAULT_GRAPHS_DIR) -> list[dict]:
    """List saved graphs as lightweight summaries (id + name + modified)."""
    if not directory.exists():
        return []
    entries: list[dict] = []
    for path in sorted(directory.glob("*.json")):
        try:
            graph = Graph.model_validate_json(path.read_text(encoding="utf-8"))
        except ValueError:
            continue  # skip unreadable/corrupt files rather than failing the list
        modified = graph.meta.modified or datetime.fromtimestamp(
            path.stat().st_mtime, tz=timezone.utc
        ).isoformat()
        entries.append({"id": path.stem, "name": graph.name, "modified": modified})
    return entries
