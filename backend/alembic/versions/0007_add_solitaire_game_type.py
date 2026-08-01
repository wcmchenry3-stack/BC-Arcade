"""add solitaire to game_types lookup table (#592)

Revision ID: 0007_add_solitaire_game_type
Revises: 0006_remove_pachisi_game_type
Create Date: 2026-04-18

Part of Epic #591 — Klondike Solitaire. Seeds the DB row so the
GameType.SOLITAIRE enum member stays in sync with the game_types lookup
table. The per-game module lives in backend/solitaire/.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007_add_solitaire_game_type"
down_revision: str | None = "0006_remove_pachisi_game_type"
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
                "id": 6,
                "name": "solitaire",
                "display_name": "Solitaire",
                "icon_emoji": "♠️",
                "sort_order": 60,
                "is_active": True,
            }
        ],
    )


def downgrade() -> None:
    op.execute("DELETE FROM game_types WHERE name = 'solitaire'")
