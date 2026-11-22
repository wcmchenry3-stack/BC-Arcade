"""Server-written ``won`` / ``is_complete`` flags for the Daily Challenge (#3996).

The Daily Challenge evaluates one finished game's *facts*: the result block merged
into ``games.metadata``, plus the ``final_score`` and ``duration_ms`` columns
(``daily_challenge.definitions.game_facts``). It never reads ``games.outcome``.
The ``won`` goal reads ``won`` and the ``completed`` ("finish") goal reads
``is_complete``, but the premium games' apps send neither (Blackjack and Hearts
send only the outcome, Star Swarm a plain ``outcome: "completed"``), so the result
model of each writes them from the completion's own ``outcome``, which
``games.sessions._validate_result`` passes in the validation context.

Never taken from the app: a block's own copy is dropped. With no outcome in the
context (a completion that reported none) neither flag is written, so such a row
meets neither goal; every shipped build sends one.

``is_complete`` is true for every outcome but ``abandoned`` (``vocab.GameOutcome``:
win, loss, push, completed and kept_playing are all finishes); ``won`` only for
``win``.
"""

from __future__ import annotations

from typing import Any

from vocab import GameOutcome

FLAG_KEYS = ("won", "is_complete")


def outcome_flags(outcome: str | None, *, has_win: bool = True) -> dict[str, bool]:
    """The flags a completion with this ``outcome`` writes; empty when it has none.

    ``has_win`` is false for a game with no win concept (Star Swarm): it gets only
    ``is_complete``.
    """
    if outcome is None:
        return {}
    flags = {"is_complete": outcome != GameOutcome.ABANDONED.value}
    if has_win:
        flags["won"] = outcome == GameOutcome.WIN.value
    return flags


def with_outcome_flags(data: Any, outcome: str | None, *, has_win: bool = True) -> Any:
    """``data`` (a result block) with the app's ``won`` / ``is_complete`` replaced
    by the ones ``outcome`` implies. Anything that is not a dict passes through."""
    if not isinstance(data, dict):
        return data
    block = {k: v for k, v in data.items() if k not in FLAG_KEYS}
    block.update(outcome_flags(outcome, has_win=has_win))
    return block
