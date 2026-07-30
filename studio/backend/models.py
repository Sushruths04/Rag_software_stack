"""Graph file schema (schema_version 1).

Exact shape per ``02_PHASE2_APP_PLAN.md`` "Graph file schema" section:

    {
      "schema_version": 1,
      "name": "din_iso_6507 multi-hop GT",
      "blocks": [
        {"id": "b1", "type": "facts_import", "position": {"x": 80, "y": 120},
         "params": {"path": "..."}},
        ...
      ],
      "wires": [
        {"id": "w1", "from": {"block": "b1", "port": "facts"},
                     "to":   {"block": "b2", "port": "facts"}}
      ],
      "meta": {"created": "...", "modified": "...", "notes": ""}
    }

Stored per run AND as saved templates (``production/data/graphs/*.graft.json``
per the plan). ``schema_version`` pins against the block catalog version
(``05_BLOCK_CATALOG.md``); loading an old graph with renamed blocks is meant
to trigger a migration table lookup, never a silent break — that migration
table is out of scope for this backend scaffold.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = 1


class Position(BaseModel):
    """Canvas coordinates for a block node."""

    model_config = ConfigDict(extra="forbid")

    x: float = 0.0
    y: float = 0.0


class BlockInstance(BaseModel):
    """One node placed on the canvas: a reference to a registry block type
    plus its configured params and canvas position."""

    model_config = ConfigDict(extra="forbid")

    id: str
    type: str
    position: Position = Field(default_factory=Position)
    params: dict[str, Any] = Field(default_factory=dict)


class WireEndpoint(BaseModel):
    """One end of a wire: a block id and one of its named ports."""

    model_config = ConfigDict(extra="forbid")

    block: str
    port: str


class Wire(BaseModel):
    """A typed connection between an output port and an input port.

    ``from`` is a Python keyword, so the field is named ``from_`` internally
    and aliased to ``from`` on both parse and dump (``populate_by_name`` lets
    callers construct with either name; ``model_dump(by_alias=True)`` is
    required to get the wire-format ``from`` key back out).
    """

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str
    from_: WireEndpoint = Field(alias="from")
    to: WireEndpoint


class GraphMeta(BaseModel):
    """Free-form run/template metadata. Extra keys are allowed (e.g. an
    ``expert_mode`` flag consulted by the compiler's locked-param rule)."""

    model_config = ConfigDict(extra="allow")

    created: str | None = None
    modified: str | None = None
    notes: str = ""


class Graph(BaseModel):
    """Top-level graph file: the unit saved/loaded as
    ``*.graft.json`` and posted to ``/api/graphs/validate``."""

    model_config = ConfigDict(extra="forbid")

    schema_version: int = SCHEMA_VERSION
    name: str = ""
    blocks: list[BlockInstance] = Field(default_factory=list)
    wires: list[Wire] = Field(default_factory=list)
    meta: GraphMeta = Field(default_factory=GraphMeta)
