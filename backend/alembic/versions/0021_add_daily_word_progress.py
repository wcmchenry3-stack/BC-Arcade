"""add daily_word_progress table (#2197)

Revision ID: 0021_add_daily_word_progress
Revises: 0020_swap_yacht_blackjack
Create Date: 2026-09-24

Daily Word kept no server-side guess state, so GET /daily-word/answer handed out
today's word to any caller with no session and no guesses made, and the 6-guess
limit lived only in the client (the real ceiling was the 20/hour rate limit).
This table is the authority for how many guesses a session has spent on a
puzzle. See daily_word/progress.py.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "0021_add_daily_word_progress"
down_revision: str | None = "0020_swap_yacht_blackjack"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_JSONB = sa.JSON().with_variant(JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "daily_word_progress",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Text(), nullable=False),
        sa.Column("puzzle_id", sa.Text(), nullable=False),
        sa.Column("guesses", _JSONB, nullable=False),
        sa.Column("solved", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "session_id", "puzzle_id", name="uq_daily_word_progress_session_puzzle"
        ),
    )


def downgrade() -> None:
    op.drop_table("daily_word_progress")
