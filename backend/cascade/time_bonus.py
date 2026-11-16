"""Cascade's time bonus for a win (#3700): the one source of truth.

A win adds ``round(BONUS_MAX × max(0, 1 − t / PAR_TIME_MS))`` to its merge
score, where ``t`` is the completion's ``duration_ms`` (the app's pausable play
clock, started at the first drop). A loss, an abandon, a win under
``MIN_WIN_MS`` and a win with no ``duration_ms`` get 0. Owner decision
2026-11-16 ("Balanced", from the sim numbers on #3700).

The server always recomputes the bonus (``CascadeResult``) and ignores the one
the app sends. The app mirrors the formula for display only
(``frontend/src/game/cascade/timeBonus.ts``); both sides are checked against
``backend/tests/fixtures/cascade_time_bonus.json``.

Pure constants and one function, no app imports, so the result model and the
Daily Challenge goals (``daily_challenge/definitions.py``) can both use it.
"""

from __future__ import annotations

BONUS_MAX = 20_000
"""``B``: the bonus of a win at ``t`` = 0 (the floor zeroes it in practice)."""

PAR_TIME_MS = 360_000
"""``T``: 6 minutes. A win at or after it earns no bonus."""

MIN_WIN_MS = 20_000
"""The plausibility floor (20 s). The fastest possible win is about 22-25 s
(about 110 drops at the 200 ms drop cooldown); the fastest sim win took 36.9 s.
A shorter ``duration_ms`` is a broken clock or a forged result: the win is
stored, with a bonus of 0, never rejected (a 400 dead-letters the game)."""

BONUS_RULE = 1
"""The version of (``BONUS_MAX``, ``PAR_TIME_MS``, ``MIN_WIN_MS``), stored on
every row the server scores (``bonus_rule``). A retune bumps it, so rows scored
under an older rule can be told apart without a migration."""

WIN = "win"


def time_bonus(outcome: str | None, duration_ms: int | None) -> int:
    """The time bonus for a completion with this ``outcome`` and ``duration_ms``.

    0 unless ``outcome`` is ``win`` and ``duration_ms`` is at least ``MIN_WIN_MS``.
    Exact integer arithmetic, rounding half up (``Math.round`` in the app), so
    the two sides agree on every whole-millisecond ``duration_ms``; Python's
    ``round`` would round half to even and differ on a .5.
    """
    if outcome != WIN or duration_ms is None or duration_ms < MIN_WIN_MS:
        return 0
    remaining = max(0, PAR_TIME_MS - duration_ms)
    # round(BONUS_MAX × remaining / PAR_TIME_MS), half up: floor((2n + d) / 2d).
    return (2 * BONUS_MAX * remaining + PAR_TIME_MS) // (2 * PAR_TIME_MS)
