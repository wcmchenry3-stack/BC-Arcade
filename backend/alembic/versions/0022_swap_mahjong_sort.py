"""make mahjong premium and sort free (owner decision 2026-09-24)

Revision ID: 0022_swap_mahjong_sort
Revises: 0021_add_daily_word_progress
Create Date: 2026-09-24

Mahjong moves to the premium tier (hidden in store builds until IAP, #822) and
Sort (Bottle Sort) takes its place as a free game. Entitlement checks and the
daily challenge's slate logic read ``is_premium`` live, so this row flip is the
whole backend switch.
"""

from collections.abc import Sequence

from sqlalchemy import text

from alembic import op

revision: str = "0022_swap_mahjong_sort"
down_revision: str | None = "0021_add_daily_word_progress"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(text("UPDATE game_types SET is_premium = true WHERE name = 'mahjong'"))
    op.execute(text("UPDATE game_types SET is_premium = false WHERE name = 'sort'"))


def downgrade() -> None:
    op.execute(text("UPDATE game_types SET is_premium = false WHERE name = 'mahjong'"))
    op.execute(text("UPDATE game_types SET is_premium = true WHERE name = 'sort'"))
