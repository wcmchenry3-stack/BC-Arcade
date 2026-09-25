"""Shared read-side predicates over the ``games`` table (#2468 / #2472).

One definition of "the player actually finished this game", imported by every
leaderboard, the rank query and the ``/stats`` aggregates, so the read side
cannot drift apart game by game.
"""

from __future__ import annotations

from sqlalchemy import ColumnElement, or_

from db.models import Game
from vocab import GameOutcome


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
