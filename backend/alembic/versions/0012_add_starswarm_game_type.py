"""add starswarm to game_types lookup table (#898)

Revision ID: 0012_add_starswarm_game_type
Revises: 0011_add_mahjong_game_type
Create Date: 2026-04-26

Migrates the Starswarm leaderboard from in-memory storage to DB-backed
persistence. Seeds the game_types row so GameType.STARSWARM stays in sync
with the lookup table.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0012_add_starswarm_game_type"
down_revision: str | None = "0011_add_mahjong_game_type"
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
                "id": 10,
                "name": "starswarm",
                "display_name": "Starswarm",
                "icon_emoji": "⭐",
                "sort_order": 100,
                "is_active": True,
            }
        ],
    )

    event_types = sa.table(
        "event_types",
        sa.column("game_type_id", sa.SmallInteger),
        sa.column("name", sa.Text),
        sa.column("display_name", sa.Text),
        sa.column("description", sa.Text),
    )
    op.bulk_insert(
        event_types,
        [
            {
                "game_type_id": 10,
                "name": "game_started",
                "display_name": "Game Started",
                "description": None,
            },
            {
                "game_type_id": 10,
                "name": "game_ended",
                "display_name": "Game Ended",
                "description": None,
            },
        ],
    )


def downgrade() -> None:
    op.execute("DELETE FROM event_types WHERE game_type_id = 10")
    op.execute("DELETE FROM game_types WHERE name = 'starswarm'")
