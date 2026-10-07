"""index games for the duration and metadata leaderboards (#2965)

Revision ID: 0032_leaderboard_indexes
Revises: 0031_add_purchases
Create Date: 2026-10-07

Every board query filters on ``game_type_id`` and ``completed_at IS NOT NULL``
(``games.leaderboard.board_filters``). Until now the only board-shaped index
was ``games_game_type_score_idx (game_type_id, final_score) WHERE final_score
IS NOT NULL``, which a board that does not rank ``final_score`` cannot use, so
the Mahjong (``duration_ms``) and Sort (``metadata.level_reached``) boards
planned a sequential scan of every game row on each read.

* ``games_game_type_duration_idx (game_type_id, duration_ms) WHERE duration_ms
  IS NOT NULL AND completed_at IS NOT NULL``: a ``duration_ms`` board (Mahjong)
  seeks to its game type and its ``[min_value, cap]`` range.
* ``games_game_type_completed_idx (game_type_id, completed_at) WHERE
  completed_at IS NOT NULL``: every board's base predicate. A metadata board
  (Sort) has no indexable metric column and reads its game type's finished
  rows through it, seeking on ``game_type_id`` only. No board uses
  ``completed_at`` as an index condition or sort key (the one-per-player
  window sorts by session first); it is there for a future "recent finished
  games of this type" read. A one-column ``(game_type_id) WHERE completed_at
  IS NOT NULL`` index serves the boards identically: on Postgres 16 with
  3,000,000 rows the Sort plan is the same bitmap scan with ``Index Cond:
  (game_type_id = ...)`` either way (median 58 ms vs 57 ms; 19 MB vs 25 MB).

Both are built ``CONCURRENTLY`` on Postgres, outside the migration
transaction (``autocommit_block``): a plain ``CREATE INDEX`` holds a SHARE
lock on ``games``, blocking every write, for the whole build while the
previous instance still serves traffic during a deploy. If a concurrent build
fails it leaves an INVALID index of that name; drop it and rerun the upgrade.
SQLite ignores the flag. Downgrade drops both, also concurrently.

Additive only: no data changes.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0032_leaderboard_indexes"
down_revision: str | None = "0031_add_purchases"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_COMPLETED = "completed_at IS NOT NULL"
_DURATION = "duration_ms IS NOT NULL AND completed_at IS NOT NULL"


def upgrade() -> None:
    # CREATE INDEX CONCURRENTLY cannot run inside a transaction.
    with op.get_context().autocommit_block():
        op.create_index(
            "games_game_type_completed_idx",
            "games",
            ["game_type_id", "completed_at"],
            postgresql_where=sa.text(_COMPLETED),
            sqlite_where=sa.text(_COMPLETED),
            postgresql_concurrently=True,
        )
        op.create_index(
            "games_game_type_duration_idx",
            "games",
            ["game_type_id", "duration_ms"],
            postgresql_where=sa.text(_DURATION),
            sqlite_where=sa.text(_DURATION),
            postgresql_concurrently=True,
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.drop_index(
            "games_game_type_duration_idx", table_name="games", postgresql_concurrently=True
        )
        op.drop_index(
            "games_game_type_completed_idx", table_name="games", postgresql_concurrently=True
        )
