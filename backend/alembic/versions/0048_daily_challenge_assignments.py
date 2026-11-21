"""add daily_challenge_assignments table (#3992)

Revision ID: 0048_daily_challenge_assignments
Revises: 0047_sort_replay_events
Create Date: 2026-11-21

Per-install pinned daily-challenge goals: the first /status or /upcoming that
needs a (session, local date) stores that install's goals here, and every later
read (and the streak's replay of that day) returns them unchanged. See
daily_challenge/assignments.py and docs/DAILY-CHALLENGE.md §4.

Compact by design (~250 B a row with its primary-key index, measured; see
docs/DATA-INVENTORY.md): a native uuid session id, the goals as compact JSON
text, and nullable columns that are NULL in the common case. Pruned daily after
DAILY_CHALLENGE_ASSIGNMENT_RETENTION_DAYS (daily_challenge/retention.py).

Additive. The downgrade drops the table, so it discards every pinned
assignment; the service then serves the shared frozen templates, as before.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0048_daily_challenge_assignments"
down_revision: str | None = "0047_sort_replay_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "daily_challenge_assignments",
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("local_date", sa.Date(), nullable=False),
        sa.Column("goals", sa.Text(), nullable=False),
        sa.Column("bonus", sa.Text(), nullable=True),
        sa.Column("template_id", sa.Text(), nullable=True),
        sa.Column("slate", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("session_id", "local_date"),
    )


def downgrade() -> None:
    op.drop_table("daily_challenge_assignments")
