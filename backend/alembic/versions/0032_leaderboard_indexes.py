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
  rows through it.

Additive only: no data changes. Downgrade drops both indexes.
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
    op.create_index(
        "games_game_type_completed_idx",
        "games",
        ["game_type_id", "completed_at"],
        postgresql_where=sa.text(_COMPLETED),
        sqlite_where=sa.text(_COMPLETED),
    )
    op.create_index(
        "games_game_type_duration_idx",
        "games",
        ["game_type_id", "duration_ms"],
        postgresql_where=sa.text(_DURATION),
        sqlite_where=sa.text(_DURATION),
    )


def downgrade() -> None:
    op.drop_index("games_game_type_duration_idx", table_name="games")
    op.drop_index("games_game_type_completed_idx", table_name="games")
