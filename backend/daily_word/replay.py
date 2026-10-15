"""Rebuild a Daily Word board from its ``guess_submitted`` events alone (#3287, epic #3273).

The Python twin of ``rebuild`` in ``frontend/src/game/daily_word/replay.ts``
(the shared fixture ``tests/fixtures/daily_word_guess_events_v1.json`` keeps the
two agreeing). Used by ``scripts/replay_game.py`` to print a game's board from
its id, and by the tests.

The board is an empty grid plus the scored guesses in order; a refused guess
(``rej``) spends no row and is listed apart. Anything that does not fit (a row
recorded out of order, a result as long as the guess is not) is a ``problem``
rather than a guess: a game resumed after a kill, or one whose events were cut by
a cap, says so.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from daily_word.guess_event import GUESS_SUBMITTED, ROWS

_EMOJI = {"c": "G", "p": "Y", "a": "."}


@dataclass
class RebuiltBoard:
    """What the events describe: ``rows`` of ``(guess, result)`` in order."""

    rows: list[tuple[str, str]] = field(default_factory=list)
    refused: list[tuple[int, str, str]] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)

    @property
    def won(self) -> bool:
        return bool(self.rows) and set(self.rows[-1][1]) == {"c"}

    @property
    def complete(self) -> bool:
        return self.won or len(self.rows) >= ROWS

    @property
    def guesses(self) -> list[str]:
        """The scored guesses in order: what ``DailyWordProgress.guesses`` holds."""
        return [guess for guess, _ in self.rows]


def rebuild(events: Iterable[tuple[str, dict[str, Any]]]) -> RebuiltBoard:
    """The board ``(event type, data)`` pairs describe, played from an empty one."""
    board = RebuiltBoard()
    for name, data in events:
        if name != GUESS_SUBMITTED:
            continue
        n, guess, result, refusal = data.get("n"), data.get("g"), data.get("t"), data.get("rej")
        if not isinstance(n, int) or not isinstance(guess, str):
            board.problems.append("a guess without a row or a word")
        elif isinstance(refusal, str):
            board.refused.append((n, guess, refusal))
        elif not isinstance(result, str) or len(result) != len(guess):
            board.problems.append(f"row {n}: result does not match the guess")
        elif n != len(board.rows) + 1:
            board.problems.append(f"row {n} recorded after {len(board.rows)} rows")
        else:
            board.rows.append((guess, result))
    return board


def render_board(board: RebuiltBoard) -> list[str]:
    """The rebuilt board as plain text lines, for ``scripts/replay_game.py``."""
    lines = ["Daily Word board rebuilt from guess_submitted events:"]
    for i, (guess, result) in enumerate(board.rows, start=1):
        marks = "".join(_EMOJI.get(c, "?") for c in result)
        lines.append(f"  {i}. {guess}  {marks}")
    for n, guess, why in board.refused:
        lines.append(f"  refused on row {n}: {guess} ({why})")
    state = "won" if board.won else "lost" if board.complete else "unfinished"
    lines.append(f"  {len(board.rows)} scored guesses, {state}")
    lines.extend(f"  PROBLEM {p}" for p in board.problems)
    return lines
