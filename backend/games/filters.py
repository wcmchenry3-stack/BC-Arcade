"""Shared read-side predicates over the ``games`` table (#2468 / #2472).

One definition of "the player actually finished this game", imported by every
leaderboard, the rank query and the ``/stats`` aggregates, so the read side
cannot drift apart game by game.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import Boolean, ColumnElement, or_
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.sql.functions import FunctionElement

from db.models import Game
from vocab import GameOutcome

# Metadata flag on a row the stale-session sweep closed (#2621). Server-written
# only: create_game and complete_game strip it from anything a client sends.
SWEPT_KEY = "swept"


def not_abandoned() -> ColumnElement[bool]:
    """NULL-safe "the player did not quit this game".

    ``Game.outcome`` is nullable — rows written before the vocabulary existed,
    and completions that report no outcome, both leave it NULL — and in SQL
    ``NULL != 'abandoned'`` evaluates to NULL, not true, so a bare ``!=`` would
    silently drop every one of those rows from leaderboards and stats.

    Deliberately not ``outcome == COMPLETED``: every other value — ``win`` /
    ``loss`` / ``push`` and ``kept_playing`` — is a legitimate finish that must
    still rank and count. What each value means is documented once, on
    ``vocab.GameOutcome``.
    """
    return or_(Game.outcome.is_(None), Game.outcome != GameOutcome.ABANDONED.value)


class _NotSwept(FunctionElement):
    """``metadata.swept`` is not JSON ``true`` (NULL-safe, never casts).

    Compiled per dialect below. A cast of the flag to boolean would fail the
    whole query on a value that is not a boolean literal (Postgres rejects
    ``CAST('maybe' AS BOOLEAN)``), so both branches compare JSON values
    instead, and a missing key reads as not swept.
    """

    type = Boolean()
    inherit_cache = True
    name = "not_swept"


@compiles(_NotSwept)
def _not_swept_postgresql(element: _NotSwept, compiler: Any, **kw: Any) -> str:
    (column,) = element.clauses
    flag = f"({compiler.process(column, **kw)} -> '{SWEPT_KEY}')"
    return f"({flag} IS DISTINCT FROM 'true'::jsonb)"


@compiles(_NotSwept, "sqlite")
def _not_swept_sqlite(element: _NotSwept, compiler: Any, **kw: Any) -> str:
    # json_type() reports 'true' only for JSON true (never for 1 or "true");
    # IS NOT is SQLite's NULL-safe inequality.
    (column,) = element.clauses
    return f"(json_type({compiler.process(column, **kw)}, '$.{SWEPT_KEY}') IS NOT 'true')"


def not_swept() -> ColumnElement[bool]:
    """NULL-safe "the stale-session sweep did not close this row" (#2621).

    The flag is absent on almost every row. Only JSON ``true`` counts as swept,
    matching :func:`is_swept`.
    """
    return _NotSwept(Game.game_metadata)


def is_swept(metadata: dict[str, Any] | None) -> bool:
    """Python-side twin of :func:`not_swept` for a loaded row's metadata."""
    return (metadata or {}).get(SWEPT_KEY) is True


def without_swept(data: dict[str, Any] | None) -> dict[str, Any]:
    """A copy of *data* without the sweep flag (client input, or a row being completed)."""
    return {k: v for k, v in (data or {}).items() if k != SWEPT_KEY}
