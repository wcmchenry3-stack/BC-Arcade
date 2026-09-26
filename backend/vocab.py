"""Shared vocabulary enums — single source of truth for string constants that
cross system boundaries (Python ↔ DB ↔ TypeScript).

Import from here, never redefine elsewhere. The DB CHECK constraint in
db/models.py and the TypeScript types in frontend/src/api/vocab.ts are both
derived from these enums.

To add a new game type:
  1. Add a member to GameType below.
  2. Write an Alembic migration that inserts the new row into game_types.
  3. Re-run: python scripts/gen_vocab_ts.py > ../frontend/src/api/vocab.ts

To add or rename an outcome:
  1. Update GameOutcome below.
  2. Generate a new Alembic migration (the CHECK constraint rebuilds from the enum).
  3. Re-run: python scripts/gen_vocab_ts.py > ../frontend/src/api/vocab.ts
"""

from __future__ import annotations

from enum import Enum


class GameType(str, Enum):
    """All active game types. Authority: this enum + the game_types DB table.

    The CI test tests/test_vocab.py asserts that every member here has a
    matching row in game_types, and vice versa. Adding a game requires both
    a new member here and an Alembic migration that inserts the DB row.
    """

    YACHT = "yacht"
    TWENTY48 = "twenty48"
    BLACKJACK = "blackjack"
    CASCADE = "cascade"
    SOLITAIRE = "solitaire"
    HEARTS = "hearts"
    SUDOKU = "sudoku"
    MAHJONG = "mahjong"
    STARSWARM = "starswarm"
    FREECELL = "freecell"
    SORT = "sort"
    DAILY_WORD = "daily_word"


class GameOutcome(str, Enum):
    """What ``games.outcome`` records for one game session — the one place its
    meaning is written down (#2519 decision 11, PR #2592). Every other docstring
    points here instead of restating it.

    Result vocabulary — a finished game in a game that can record a winner
    (``GameModule.has_winner`` is true; that flag is set only once the client
    writes win / loss / push, and a ``completed`` row from such a game is still
    "no winner", not a win):

    * ``win`` / ``loss`` — the player won or lost.
    * ``push`` — a tie (the player and the opponent finished level).

    Which games record them, and when:

    * Yacht — vs the computer only: ``win`` / ``loss`` / ``push`` on the
      final scorecard. Solo Yacht has no opponent and records ``completed``.
    * Hearts — ``win`` / ``loss`` / ``push`` when the match ends.
    * Daily Word — ``win`` when the word is solved, ``loss`` when the guesses
      run out.
    * Mahjong — ``win`` when the board is cleared (#2627), ``loss`` when the
      player leaves a deadlocked board (#2592). Builds before #2627 recorded
      a cleared board as ``completed``; migration 0028 rewrote the rows
      already stored with ``metadata.won`` true to ``win`` (#2703).
    * Blackjack — per run (#2628): ``win`` when the run reached its goal, at
      any point (Keep Playing and a later bust-out is still a win); ``loss``
      when the chips ran out before the goal; ``abandoned`` when the player
      left before the goal. Builds before #2628 recorded ``completed``;
      migration 0028 rewrote the stored Cash Outs (``metadata.final_chips``
      > 0) to ``win``. A bust after Keep Playing can't be told from a plain
      bust, so it stays ``completed`` (#2703).
    * Twenty48 — ``win`` when the 2048 tile appears (the row keeps the score
      at that moment; Keep Playing after it is untracked), ``loss`` on a game
      over without it (#2631). Older builds' ``completed`` / ``kept_playing``
      rows stay valid; migration 0028 rewrote the stored ones with
      ``metadata.highest_tile`` >= 2048 to ``win`` (#2703).

    The client maps its result card to these values in one function,
    ``frontend/src/game/_shared/recordedOutcome.ts`` (win→win, loss→loss,
    draw→push, ended→completed).

    Lifecycle vocabulary:

    * ``completed`` — a finished game with no win concept (score-only games:
      Solitaire, FreeCell, Sudoku, Cascade, Sort, Star Swarm, solo Yacht).
      Win rate for these games is "—", never 0 %.
    * ``kept_playing`` — legacy: Twenty48 builds before #2631 closed the
      session this way when the player kept going past 2048. New builds record
      ``win`` instead; older rows and builds that still send it stay valid,
      and it counts as a finish with no winner.
    * ``abandoned`` — the player quit. Excluded from leaderboards, stats and
      XP by ``games.filters.not_abandoned()``.

    ``NULL`` (rows from before this vocabulary, or a completion that sent no
    outcome) counts as a finish, like every value except ``abandoned``.
    """

    # Result vocabulary — games with a winner.
    WIN = "win"
    LOSS = "loss"
    PUSH = "push"

    # Lifecycle vocabulary.
    COMPLETED = "completed"
    ABANDONED = "abandoned"
    KEPT_PLAYING = "kept_playing"
