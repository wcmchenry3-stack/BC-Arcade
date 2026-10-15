"""Rebuild a Daily Word board from its ``guess_submitted`` event alone (#3287, #3368, epic #3273).

The Python twin of ``rebuild`` in ``frontend/src/game/daily_word/replay.ts``
(the shared fixture ``tests/fixtures/daily_word_guess_events_v1.json`` keeps the
two agreeing). Used by ``scripts/replay_game.py`` to print a game's board from
its id, and by the tests.

The board is an empty grid plus the game's scored guesses in order; refusals are
only a count (``rj``). Anything that does not fit (no event, more than one, lists
that do not line up, a result as long as the guess is not) is a ``problem``
rather than a guess: a game whose event was never recorded (killed mid-play, or
cut by a cap) says so.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from daily_word.guess_event import GUESS_SUBMITTED, ROWS

_EMOJI = {"c": "G", "p": "Y", "a": "."}


@dataclass
class RebuiltBoard:
    """What the event describes: ``rows`` of ``(guess, result)`` in order."""

    rows: list[tuple[str, str]] = field(default_factory=list)
    display: list[str] = field(default_factory=list)
    refusals: int = 0
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
    found = [data for name, data in events if name == GUESS_SUBMITTED]
    if not found:
        board.problems.append("no guess_submitted event")
        return board
    if len(found) > 1:
        board.problems.append(f"{len(found)} guess_submitted events for one game")
    data = found[-1]
    guesses, results, shown = data.get("g"), data.get("t"), data.get("d")
    if (
        not isinstance(guesses, list)
        or not isinstance(results, list)
        or len(guesses) != len(results)
    ):
        board.problems.append("guesses and results do not line up")
        return board
    for i, (guess, result) in enumerate(zip(guesses, results, strict=True), start=1):
        if not isinstance(guess, str) or not isinstance(result, str) or len(guess) != len(result):
            board.problems.append(f"row {i}: result does not match the guess")
            continue
        board.rows.append((guess, result))
        spelling = shown[i - 1] if isinstance(shown, list) and i <= len(shown) else None
        ok = isinstance(spelling, str) and len(spelling) == len(guess)
        board.display.append(spelling if ok else guess)  # type: ignore[arg-type]
    refused = data.get("rj")
    board.refusals = refused if isinstance(refused, int) else 0
    return board


def render_board(board: RebuiltBoard) -> list[str]:
    """The rebuilt board as plain text lines, for ``scripts/replay_game.py``."""
    lines = ["Daily Word board rebuilt from the guess_submitted event:"]
    for i, ((_, result), shown) in enumerate(zip(board.rows, board.display, strict=True), start=1):
        marks = "".join(_EMOJI.get(c, "?") for c in result)
        lines.append(f"  {i}. {shown}  {marks}")
    if board.refusals:
        lines.append(f"  {board.refusals} refused guesses (not a word / already guessed)")
    state = "won" if board.won else "lost" if board.complete else "unfinished"
    lines.append(f"  {len(board.rows)} scored guesses, {state}")
    lines.extend(f"  PROBLEM {p}" for p in board.problems)
    return lines
