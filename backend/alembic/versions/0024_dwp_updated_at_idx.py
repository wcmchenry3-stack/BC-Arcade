"""index daily_word_progress.updated_at for retention pruning (#2544)

Revision ID: 0024_dwp_updated_at_idx
Revises: 0023_sudoku_free
Create Date: 2026-09-25

Retention (daily_word/retention.py) deletes rows by updated_at at every process
start and then daily. uvicorn runs with --limit-max-requests, so starts are
frequent; without an index each one scans the whole table (#2661 review).
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0024_dwp_updated_at_idx"
down_revision: str | None = "0023_sudoku_free"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index("daily_word_progress_updated_at_idx", "daily_word_progress", ["updated_at"])


def downgrade() -> None:
    op.drop_index("daily_word_progress_updated_at_idx", table_name="daily_word_progress")
