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
    # Result vocabulary — games with a concrete winner/loser (Blackjack).
    WIN = "win"
    LOSS = "loss"
    PUSH = "push"
    BLACKJACK = "blackjack"

    # Lifecycle vocabulary — score-based games (Yacht, Cascade, Twenty48, …).
    COMPLETED = "completed"
    ABANDONED = "abandoned"
    KEPT_PLAYING = "kept_playing"
