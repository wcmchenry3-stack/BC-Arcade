"""add sort to game_types lookup table (#1173)

Revision ID: 0016_add_sort_game_type
Revises: 0015_add_game_entitlements
Create Date: 2026-05-02

Part of issues #1173/#1174 — Sort Puzzle. Seeds the DB row so the
GameType.SORT enum member stays in sync with the game_types lookup
table. The per-game module lives in backend/sort/.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0016_add_sort_game_type"
down_revision: Union[str, None] = "0015_add_game_entitlements"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    game_types = sa.table(
        "game_types",
        sa.column("id", sa.SmallInteger),
        sa.column("name", sa.Text),
        sa.column("display_name", sa.Text),
        sa.column("icon_emoji", sa.Text),
        sa.column("sort_order", sa.SmallInteger),
        sa.column("is_active", sa.Boolean),
        sa.column("is_premium", sa.Boolean),
        sa.column("category", sa.Text),
    )
    op.bulk_insert(
        game_types,
        [
            {
                "id": 12,
                "name": "sort",
                "display_name": "Sort",
                "icon_emoji": "🍾",
                "sort_order": 120,
                "is_active": True,
                "is_premium": True,
                "category": "puzzle",
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
                "game_type_id": 12,
                "name": "game_started",
                "display_name": "Game Started",
                "description": None,
            },
            {
                "game_type_id": 12,
                "name": "game_ended",
                "display_name": "Game Ended",
                "description": None,
            },
        ],
    )


def downgrade() -> None:
    op.execute("DELETE FROM event_types WHERE game_type_id = 12")
    op.execute("DELETE FROM game_types WHERE name = 'sort'")
