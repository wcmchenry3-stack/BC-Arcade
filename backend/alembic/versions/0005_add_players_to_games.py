"""add players[] JSONB column to games (#543)

Revision ID: 0005_add_players_to_games
Revises: 0004_add_pachisi_game_type
Create Date: 2026-04-17

Adds a first-class ``players`` JSONB column to the ``games`` table.
Existing rows default to ``[]``; new rows are populated by the API from
the creating session (single-element list today, extensible for multiplayer).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "0005_add_players_to_games"
down_revision: str | None = "0004_add_pachisi_game_type"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# JSONB on Postgres, JSON on SQLite (mirrors db/models.py _JSONB pattern).
_JSONB_TYPE = sa.JSON().with_variant(JSONB(), "postgresql")


def upgrade() -> None:
    op.add_column(
        "games",
        sa.Column(
            "players",
            _JSONB_TYPE,
            nullable=False,
            server_default="[]",
        ),
    )


def downgrade() -> None:
    op.drop_column("games", "players")
