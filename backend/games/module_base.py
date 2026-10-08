"""``GameModuleBase``: the declarative base every game module subclasses (#2995).

A game module is a class of declarations, one per game: ``game_type``,
``metadata_model``, ``result_model``, ``has_winner`` and ``board``. The three
methods below are the optional hooks, each with a default that changes
nothing, so a game overrides only the ones it needs. The shared backend calls
every hook on every module, with no ``getattr`` lookups:

- ``stats_shape``: the game-specific part of its ``/stats/me`` entry. The
  default is ``default_stats_shape``; only Blackjack overrides it.
- ``derive_final_score``: the ``final_score`` to store for a completion.
  The default stores the one the client sent; Blackjack overrides it (#2745).
- ``reconcile_result``: corrects a validated result block against
  server-side state before it is stored. The default returns it unchanged;
  Daily Word overrides it (#2541).

``games.protocol.GameModule`` is the structural contract the shared code is
typed against; a subclass of this base satisfies it. See
``docs/GAME-CONTRACT.md`` §1.3 for how to add a game.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, ClassVar

from games.protocol import default_stats_shape

if TYPE_CHECKING:
    from pydantic import BaseModel
    from sqlalchemy.ext.asyncio import AsyncSession

    from db.models import Game
    from games.board import BoardDefinition
    from vocab import GameType

# Declarations a subclass must make itself: they have no sensible default.
_REQUIRED = ("game_type", "metadata_model", "board")


class GameModuleBase:
    """Defaults for every game module; see the module docstring.

    A subclass must declare ``game_type``, ``metadata_model`` and ``board``
    (``TypeError`` at class creation otherwise). ``result_model`` defaults to
    ``None`` (any result dict is accepted unvalidated) and ``has_winner`` to
    ``False`` (a score-only game), but every registered module declares
    ``has_winner`` explicitly (``tests/test_game_module_protocol.py``).
    """

    game_type: ClassVar[GameType]
    metadata_model: ClassVar[type[BaseModel]]
    result_model: ClassVar[type[BaseModel] | None] = None
    has_winner: ClassVar[bool] = False
    board: ClassVar[BoardDefinition]

    def __init_subclass__(cls, **kwargs: Any) -> None:
        super().__init_subclass__(**kwargs)
        missing = [name for name in _REQUIRED if not hasattr(cls, name)]
        if missing:
            raise TypeError(f"{cls.__name__} must declare {', '.join(missing)}")

    def stats_shape(self, raw_stats: dict) -> dict:
        """The game-specific part of the ``/stats/me`` entry (#2620).

        See ``GameModule`` for the ``raw_stats`` keys and the return shape.
        """
        return default_stats_shape(raw_stats)

    def derive_final_score(
        self, final_score: int | None, outcome: str | None, result: Mapping[str, Any]
    ) -> int | None:
        """The ``final_score`` to store for a completion.

        ``result`` is the validated result block. A game whose score is part of
        that block fills in a missing ``final_score`` from it; raising
        ``ValueError`` rejects a ``final_score`` that contradicts it (400).
        """
        return final_score

    async def reconcile_result(
        self, session: AsyncSession, game: Game, result: dict[str, Any]
    ) -> dict[str, Any]:
        """The validated result block corrected against server-side state.

        Runs after ``result_model`` validation, only for a game that declares
        a ``result_model``.
        """
        return result
