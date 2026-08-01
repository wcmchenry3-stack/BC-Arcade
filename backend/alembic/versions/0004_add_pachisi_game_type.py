"""add pachisi to game_types lookup table (#538)

Revision ID: 0004_add_pachisi_game_type
Revises: 0003_relax_games_outcome_ck
Create Date: 2026-04-15

Pachisi was shipping as a frontend game type and had its own backend module
before the game_types lookup table existed. This migration brings the DB row
into sync with the GameType enum in backend/vocab.py.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004_add_pachisi_game_type"
down_revision: str | None = "0003_relax_games_outcome_ck"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
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


def downgrade() -> None:
    op.execute("DELETE FROM game_types WHERE name = 'pachisi'")
