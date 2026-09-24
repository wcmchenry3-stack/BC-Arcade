"""make blackjack premium and yacht free (owner decision 2026-09-23)

Revision ID: 0020_swap_yacht_blackjack
Revises: 0019_add_daily_challenge_days
Create Date: 2026-09-23

Blackjack is simulated gambling: shipping it in v1.0 would rate the whole app
13+/18+ on the App Store and PEGI 18 in Europe. It moves to the premium tier
(hidden in store builds until IAP, #822) and Yacht — dice, no gambling — takes
its place as a free game. Entitlement checks and the daily challenge's slate
logic read ``is_premium`` live, so this row flip is the whole backend switch.
"""

from collections.abc import Sequence

from sqlalchemy import text

from alembic import op

revision: str = "0020_swap_yacht_blackjack"
down_revision: str | None = "0019_add_daily_challenge_days"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(text("UPDATE game_types SET is_premium = true WHERE name = 'blackjack'"))
    op.execute(text("UPDATE game_types SET is_premium = false WHERE name = 'yacht'"))


def downgrade() -> None:
    op.execute(text("UPDATE game_types SET is_premium = false WHERE name = 'blackjack'"))
    op.execute(text("UPDATE game_types SET is_premium = true WHERE name = 'yacht'"))
