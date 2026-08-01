"""add is_premium + category to game_types (#1049)

Revision ID: 0014_game_types_premium_cat
Revises: 0013_add_freecell_game_type
Create Date: 2026-04-30

Adds is_premium (bool, default false) and category (text, default 'other')
to game_types, then seeds correct values for all existing rows.

Game IDs: 1=yacht 2=twenty48 3=blackjack 4=cascade 6=solitaire
          7=hearts 8=sudoku 9=mahjong 10=starswarm 11=freecell
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import text

from alembic import op

revision: str = "0014_game_types_premium_cat"
down_revision: str | None = "0013_add_freecell_game_type"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PREMIUM_IDS = (1, 4, 7, 8, 10)  # yacht, cascade, hearts, sudoku, starswarm

_CATEGORIES = {
    1: "dice",  # yacht
    2: "puzzle",  # twenty48
    3: "card",  # blackjack
    4: "arcade",  # cascade
    6: "card",  # solitaire
    7: "card",  # hearts
    8: "puzzle",  # sudoku
    9: "puzzle",  # mahjong
    10: "arcade",  # starswarm
    11: "card",  # freecell
}


def upgrade() -> None:
    op.add_column(
        "game_types",
        sa.Column("is_premium", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "game_types",
        sa.Column("category", sa.Text(), nullable=False, server_default="other"),
    )

    # SQLite stores DEFAULT false as the text string "false" on existing rows
    # (not the integer 0), which SQLAlchemy's Boolean mapper reads back as True.
    # Explicit UPDATEs after ADD COLUMN guarantee correct values on both backends.
    # Use SQL boolean literals (false/true) — PostgreSQL rejects 0/1 for BOOLEAN.
    op.execute(text("UPDATE game_types SET is_premium = false"))
    op.execute(text(f"UPDATE game_types SET is_premium = true WHERE id IN {_PREMIUM_IDS}"))

    for game_id, cat in _CATEGORIES.items():
        op.execute(
            text("UPDATE game_types SET category = :cat WHERE id = :id").bindparams(
                cat=cat, id=game_id
            )
        )


def downgrade() -> None:
    op.drop_column("game_types", "category")
    op.drop_column("game_types", "is_premium")
