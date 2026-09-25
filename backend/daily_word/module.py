"""Daily Word GameModule descriptor (#1187).

Satisfies the GameModule Protocol from games/protocol.py via
structural subtyping — no inheritance required.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from daily_word.models import DailyWordMetadata, DailyWordResult
from daily_word.progress import recorded_guess_count
from games.board import BoardDefinition
from games.protocol import default_stats_shape
from vocab import GameType

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from db.models import Game


class DailyWordModule:
    game_type = GameType.DAILY_WORD
    metadata_model = DailyWordMetadata
    result_model = DailyWordResult
    has_winner = True
    # No leaderboard; fewest guesses in a *won* game is the per-game "best" in
    # stats. A loss uses every guess and is not a best, so only wins qualify.
    board = BoardDefinition(
        metric="guesses_used",
        direction="asc",
        label_key="guesses",
        qualifying_outcomes=("win",),
        enabled=False,
    )

    def stats_shape(self, raw_stats: dict) -> dict:
        return default_stats_shape(raw_stats)

    async def reconcile_result(
        self, session: AsyncSession, game: Game, result: dict[str, Any]
    ) -> dict[str, Any]:
        """Raise ``guesses_used`` to the server's own count (#2541).

        The daily challenge's hard goal is "win within N guesses", and the
        client's count can be low: an app build older than #2541 counts its own
        board, which falls behind the server when a guess's response is lost,
        and a tampered client can send anything. The guess record is the
        authority, so the reported count is never allowed below it.

        Only ever raised, never lowered: guesses scored while the record was
        unreachable (#2542) leave no row, so a record can legitimately be
        *below* the true count, and trusting it downward would credit the goal
        for a longer win. With no row at all, the client's count stands.

        A mitigation, like the rest of #2197: sessions and the ``puzzle_id`` in
        the creation metadata are both client-asserted until #1047.
        """
        reported = result.get("guesses_used")
        puzzle_id = (game.game_metadata or {}).get("puzzle_id")
        if not isinstance(reported, int) or not isinstance(puzzle_id, str):
            return result
        recorded = await recorded_guess_count(
            session, session_id=game.session_id, puzzle_id=puzzle_id
        )
        if recorded is None or recorded <= reported:
            return result
        return {**result, "guesses_used": recorded}


module = DailyWordModule()
