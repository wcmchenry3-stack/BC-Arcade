"""add mahjong to game_types lookup table and seed lifecycle events (#871)

Revision ID: 0011_add_mahjong_game_type
Revises: 0010_seed_event_types
Create Date: 2026-04-26

Part of Epic #870 — Mahjong Solitaire. Seeds the DB row so the
GameType.MAHJONG enum member stays in sync with the game_types lookup
table, and immediately seeds the two lifecycle event_types so
gameEventClient.startGame / completeGame work on first deploy.
The per-game module lives in backend/mahjong/.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0011_add_mahjong_game_type"
down_revision: str | None = "0010_seed_event_types"
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
                "id": 9,
                "name": "mahjong",
                "display_name": "Mahjong Solitaire",
                "icon_emoji": "🀄",
                "sort_order": 90,
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
                "game_type_id": 9,
                "name": "game_started",
                "display_name": "Game Started",
                "description": None,
            },
            {
                "game_type_id": 9,
                "name": "game_ended",
                "display_name": "Game Ended",
                "description": None,
            },
        ],
    )


def downgrade() -> None:
    op.execute("DELETE FROM event_types WHERE game_type_id = 9")
    op.execute("DELETE FROM game_types WHERE name = 'mahjong'")
