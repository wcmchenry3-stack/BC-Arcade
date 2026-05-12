"""add daily_word to game_types lookup table (#1187)

Revision ID: 0017_add_daily_word_game_type
Revises: 0016_add_sort_game_type
Create Date: 2026-05-02

Seeds the game_types row for Daily Word (free tier, category='word')
and adds event_types game_started, game_ended, and guess_submitted.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0017_add_daily_word_game_type"
down_revision: Union[str, None] = "0016_add_sort_game_type"
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
                "id": 13,
                "name": "daily_word",
                "display_name": "Daily Word",
                "icon_emoji": "📝",
                "sort_order": 130,
                "is_active": True,
                "is_premium": False,
                "category": "word",
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
                "game_type_id": 13,
                "name": "game_started",
                "display_name": "Game Started",
                "description": None,
            },
            {
                "game_type_id": 13,
                "name": "game_ended",
                "display_name": "Game Ended",
                "description": None,
            },
            {
                "game_type_id": 13,
                "name": "guess_submitted",
                "display_name": "Guess Submitted",
                "description": None,
            },
        ],
    )


def downgrade() -> None:
    op.execute("DELETE FROM event_types WHERE game_type_id = 13")
    op.execute("DELETE FROM game_types WHERE name = 'daily_word'")
