"""GameModule Protocol — single contract for all game modules (#540).

Any object with the declared attributes and methods satisfies this Protocol
without inheriting from it (structural subtyping).

Adding a new game
-----------------
1. Create ``backend/<game>/module.py`` with a class whose instance passes
   ``isinstance(instance, GameModule)``.
2. Register it in ``backend/games/registry.py``.
3. Implement ``stats_shape`` to transform the raw aggregate dict into the
   game's final API shape.  See ``backend/blackjack/module.py`` for an
   example that renames keys; see ``backend/cascade/module.py`` for the
   default pass-through pattern.
4. Define a ``metadata_model`` Pydantic ``BaseModel`` subclass (in the
   game's ``models.py``) and assign it as a class variable.  The generic
   ``POST /games`` endpoint validates incoming ``metadata`` against it.
5. Optionally define a ``result_model`` (also in ``models.py``) describing the
   per-game result block sent on ``PATCH /games/{id}/complete``, or set
   ``result_model = None`` to accept any dict unvalidated.
6. Optionally define ``async reconcile_result(session, game, result) -> dict``
   to correct a validated result against server-side state before it is
   stored — see ``backend/daily_word/module.py`` (#2541). Not part of the
   Protocol: ``games/service.py`` looks it up with ``getattr``.
7. Declare ``board`` — a ``BoardDefinition`` (``games/board.py``) saying how
   the game is ranked — then regenerate ``frontend/src/api/vocab.ts`` with
   ``python backend/scripts/gen_vocab_ts.py`` (#2617).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol, runtime_checkable

from vocab import GameType

if TYPE_CHECKING:
    from pydantic import BaseModel

    from games.board import BoardDefinition


@runtime_checkable
class GameModule(Protocol):
    """Structural interface every game module must satisfy.

    Attributes
    ----------
    game_type:
        The ``GameType`` enum value that identifies this module in the DB and
        the registry.  Must be a class-level constant.

    metadata_model:
        A Pydantic ``BaseModel`` subclass that defines the valid shape for
        ``games.metadata`` when creating a game of this type.  The generic
        ``POST /games`` router validates the incoming ``metadata`` dict
        against this model before writing to the DB.

    result_model:
        A Pydantic ``BaseModel`` subclass for the result block sent on
        ``PATCH /games/{id}/complete`` (#2449), or ``None`` to skip validation.
        Deliberately separate from ``metadata_model`` — those forbid extra keys
        and describe creation-time state only.  The validated result is merged
        into ``games.metadata``.

    board:
        A ``BoardDefinition`` declaring how the game is ranked (metric,
        direction, tie-break, partitions, ``max_value``, ``enabled``), or
        ``None`` if the game declares none (#2617). A game with no leaderboard
        still declares one with ``enabled=False``.

    Methods
    -------
    stats_shape(raw_stats):
        Transform a raw aggregate stats dict (produced by
        ``games/service.py``) into the final shape for the ``/stats/me``
        API response.

        ``raw_stats`` keys
            played         int
            best           int | None   (highest ``final_score``)
            avg            float | None (mean ``final_score``)
            last_played_at datetime | None
            latest_score   int | None   (``final_score`` of most-recent game)
            metadata       dict         (``games.metadata`` of the latest row)

        Return a dict with any of ``played``, ``best``, ``avg``,
        ``last_played_at`` and ``extras`` (a dict of game-specific figures,
        e.g. Blackjack's chips). Omitted keys default to ``None`` / ``{}``.
        The comparable fields (``sessions``, ``completed``, win counts and
        streaks, ``time_played_ms``, ``best_value``) are computed by the
        service from the board and cannot be changed here (#2620).
    """

    game_type: GameType
    metadata_model: type[BaseModel]
    result_model: type[BaseModel] | None
    board: BoardDefinition | None

    def stats_shape(self, raw_stats: dict) -> dict: ...
