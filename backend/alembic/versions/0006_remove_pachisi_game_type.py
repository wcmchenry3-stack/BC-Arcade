"""remove pachisi from game_types lookup table (#550)

Revision ID: 0006_remove_pachisi_game_type
Revises: 0005_add_players_to_games
Create Date: 2026-04-17

Pachisi is being removed (Path A of #550). This migration deletes the row
from game_types so the DB stays in sync with the GameType enum in vocab.py.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006_remove_pachisi_game_type"
down_revision: str | None = "0005_add_players_to_games"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DELETE FROM game_types WHERE name = 'pachisi'")


def downgrade() -> None:
    game_types = sa.table(
        "game_types",
        sa.column("id", sa.SmallInteger),
        sa.column("name", sa.Text),
        sa.column("display_name", sa.Text),
        sa.column("icon_emoji", sa.Text),
        sa.column("sort_order", sa.SmallInteger),
        sa.column("is_active", sa.Boolean),
    )
    op.bulk_insert(
        game_types,
        [
            {
                "id": 5,
                "name": "pachisi",
                "display_name": "Pachisi",
                "icon_emoji": "🎯",
                "sort_order": 50,
                "is_active": True,
            }
        ],
    )
