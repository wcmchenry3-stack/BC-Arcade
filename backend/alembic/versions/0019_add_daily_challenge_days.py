"""add daily_challenge_days table (#2493)

Revision ID: 0019_add_daily_challenge_days
Revises: 0018_rename_merge_display_name
Create Date: 2026-09-22

Freezes each day's daily-challenge assignment the first time it is requested,
so retuning the goal pool or DAILY_CHALLENGE_SALT afterward only ever affects
days not yet frozen — never a day a player has already seen or a streak has
already been scored against. See daily_challenge/schedule.py.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "0019_add_daily_challenge_days"
down_revision: str | None = "0018_rename_merge_display_name"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_JSONB = sa.JSON().with_variant(JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "daily_challenge_days",
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("slate", sa.Text(), nullable=False),
        sa.Column("template_id", sa.Text(), nullable=False),
        sa.Column("goals", _JSONB, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("date", "slate"),
    )


def downgrade() -> None:
    op.drop_table("daily_challenge_days")
