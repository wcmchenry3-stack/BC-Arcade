"""Leaderboard board definitions (#2617, epic #2519).

Each ``GameModule`` declares how its game is ranked in one place, its
``board`` attribute. The server, the app (through the generated
``frontend/src/api/vocab.ts``) and the docs all read that declaration instead
of per-game leaderboard code.

This module only declares. ``games/leaderboard.py`` ranks boards, looks up
ranks and enforces the caps from these definitions (#2618); stats read them
from #2620.

Every board is a class-level singleton shared by all requests, so the model
is frozen and every container field is a tuple: nothing on a board can be
mutated after the module is imported.

Which rows count
----------------
A row is a candidate for a board, or for the per-game "best" in stats, when it
is not abandoned and, if ``qualifying_outcomes`` is set, its ``outcome`` is one
of those values (Daily Word counts wins only).

Ordering a board
----------------
1. ``metric`` in ``direction`` (``desc``: higher is better; ``asc``: lower is
   better).
2. ``tiebreak``, when set, e.g. ``("total_moves", "asc")`` for Sort.
3. ``FINAL_TIEBREAK``: ``completed_at asc`` (the earlier entry wins). It is
   always applied last and is never declared on a board.

Where values live
-----------------
``metric`` is either ``SCORE_METRIC`` (``"final_score"``, the ``games``
column) or a key in ``games.metadata``, which holds the creation-time metadata
merged with the validated result block. ``tiebreak`` and ``partitions`` keys
always live in ``games.metadata``. A row that predates a partition key is read
with that key's ``partition_defaults`` value (Sudoku rows from before #748 have
no ``variant`` and belong to ``classic``).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from vocab import GameOutcome

Direction = Literal["asc", "desc"]
"""``desc``: higher is better. ``asc``: lower is better (e.g. FreeCell moves)."""

SCORE_METRIC = "final_score"
"""The ``games.final_score`` column. Any other ``metric`` is a metadata key."""

FINAL_TIEBREAK: tuple[str, Direction] = ("completed_at", "asc")
"""Breaks the last tie on every board: the earlier entry ranks higher."""

_COUNTABLE_OUTCOMES = frozenset(o.value for o in GameOutcome) - {GameOutcome.ABANDONED.value}


class BoardDefinition(BaseModel):
    """How one game is ranked on its leaderboard.

    Attributes
    ----------
    metric:
        What is ranked: ``SCORE_METRIC`` or a ``games.metadata`` key.
    direction:
        ``desc`` if a higher ``metric`` is better, ``asc`` if lower is better.
    tiebreak:
        Optional ``(metadata key, direction)`` applied before ``FINAL_TIEBREAK``.
    label_key:
        i18n key for the metric's label, e.g. ``"score"``, ``"moves"``,
        ``"level"``. The client never has to know what the number means.
    partitions:
        ``games.metadata`` keys that split the game into separate boards, one
        per combination of values, e.g. ``("difficulty", "variant")``.
    partition_defaults:
        ``(partition key, value)`` pairs: the value to assume when a row's
        metadata lacks that key (or holds ``null``). Every key is one of
        ``partitions`` and appears once. Read it with ``partition_default``.
    max_value:
        Highest legitimate ``metric`` value on any of the game's boards, for
        submission validation (absorbs #2215). ``None`` means the game has no
        natural ceiling.
    partition_max_values:
        ``(partition key, partition value, cap)`` triples: a tighter ceiling
        for rows in that partition, e.g. ``("difficulty", "easy", 100)`` for
        Sudoku. Every key is one of ``partitions``, each ``(key, value)``
        appears once, and each cap is at most ``max_value``, which must be set.
        Read it with ``max_value_for``.
    qualifying_outcomes:
        ``games.outcome`` values that count toward the board and the per-game
        "best" in stats, e.g. ``("win",)`` for Daily Word, whose best is the
        fewest guesses in a won game. ``None`` means every non-abandoned row
        counts. ``abandoned`` is never allowed here: abandoned rows never count.
    enabled:
        ``False`` for games with no leaderboard (Blackjack, Daily Word). Their
        ``metric``, ``direction``, ``label_key`` and ``qualifying_outcomes``
        still describe the per-game "best" shown in stats.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    metric: str = Field(min_length=1)
    direction: Direction
    tiebreak: tuple[str, Direction] | None = None
    label_key: str = Field(min_length=1)
    partitions: tuple[str, ...] = ()
    partition_defaults: tuple[tuple[str, str], ...] = ()
    max_value: int | None = Field(default=None, ge=0)
    partition_max_values: tuple[tuple[str, str, int], ...] = ()
    qualifying_outcomes: tuple[str, ...] | None = None
    enabled: bool = True

    @model_validator(mode="after")
    def _check_consistency(self) -> BoardDefinition:
        if len(set(self.partitions)) != len(self.partitions):
            raise ValueError(f"duplicate partition keys: {self.partitions}")

        default_keys = [key for key, _ in self.partition_defaults]
        if len(set(default_keys)) != len(default_keys):
            raise ValueError(f"duplicate partition_defaults keys: {default_keys}")
        unknown = [key for key in default_keys if key not in self.partitions]
        if unknown:
            raise ValueError(f"partition_defaults keys {unknown} are not in partitions")

        if self.partition_max_values and self.max_value is None:
            raise ValueError("partition_max_values needs an overall max_value")
        seen: set[tuple[str, str]] = set()
        for key, value, cap in self.partition_max_values:
            if key not in self.partitions:
                raise ValueError(f"partition_max_values key {key!r} is not in partitions")
            if (key, value) in seen:
                raise ValueError(f"duplicate partition_max_values entry {key}={value}")
            seen.add((key, value))
            if cap < 0:
                raise ValueError(f"partition_max_values cap for {key}={value} is negative")
            if self.max_value is not None and cap > self.max_value:
                raise ValueError(
                    f"partition_max_values cap {cap} for {key}={value} exceeds max_value"
                )

        if self.qualifying_outcomes is not None:
            outcomes = self.qualifying_outcomes
            if not outcomes:
                raise ValueError("qualifying_outcomes must be None or non-empty")
            if len(set(outcomes)) != len(outcomes):
                raise ValueError(f"duplicate qualifying_outcomes: {outcomes}")
            bad = [o for o in outcomes if o not in _COUNTABLE_OUTCOMES]
            if bad:
                raise ValueError(f"qualifying_outcomes {bad} are not countable GameOutcomes")
        return self

    def partition_default(self, key: str) -> str | None:
        """The value assumed for partition *key* when a row lacks it, or ``None``."""
        return next((value for k, value in self.partition_defaults if k == key), None)

    def max_value_for(self, partition: Mapping[str, Any]) -> int | None:
        """The effective cap for a row in *partition* (its metadata, or any dict).

        Missing or ``None`` partition keys take their ``partition_defaults``
        value. The result is the lowest of ``max_value`` and every
        ``partition_max_values`` cap that matches; ``None`` if the game is
        uncapped. Keys outside ``partitions`` are ignored.
        """
        caps = [] if self.max_value is None else [self.max_value]
        for key, value, cap in self.partition_max_values:
            actual = partition.get(key)
            if actual is None:
                actual = self.partition_default(key)
            if actual == value:
                caps.append(cap)
        return min(caps) if caps else None
