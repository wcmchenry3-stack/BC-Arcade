"""Shared read-side predicates over the ``games`` table (#2468 / #2472).

One definition of "the player actually finished this game", imported by every
leaderboard, the rank query and the ``/stats`` aggregates, so the read side
cannot drift apart game by game.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import ColumnElement, or_

from db.jsonx import json_is_true
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


def not_swept() -> ColumnElement[bool]:
    """NULL-safe "the stale-session sweep did not close this row" (#2621).

    The flag is absent on almost every row. Only JSON ``true`` counts as swept,
    matching :func:`is_swept`. ``json_is_true`` compiles per dialect and never
    casts the flag: a cast to boolean would fail the whole query on a value
    that is not a boolean literal (Postgres rejects ``CAST('maybe' AS
    BOOLEAN)``), so both bodies compare JSON values, and its negation is the
    dialect's NULL-safe inequality, so a missing key reads as not swept.
    """
    return ~json_is_true(Game.game_metadata, SWEPT_KEY)


def is_swept(metadata: dict[str, Any] | None) -> bool:
    """Python-side twin of :func:`not_swept` for a loaded row's metadata."""
    return (metadata or {}).get(SWEPT_KEY) is True


def without_swept(data: dict[str, Any] | None) -> dict[str, Any]:
    """A copy of *data* without the sweep flag (client input, or a row being completed)."""
    return {k: v for k, v in (data or {}).items() if k != SWEPT_KEY}
