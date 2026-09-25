"""merge the two 0024 heads

Revision ID: 0025_merge_0024_heads
Revises: 0024_drop_blackjack_outcome, 0024_dwp_updated_at_idx
Create Date: 2026-09-25

#2655 (``0024_drop_blackjack_outcome``) and #2661 (``0024_dwp_updated_at_idx``)
both revise ``0023_sudoku_free`` and merged to ``dev`` minutes apart, leaving two
heads: ``alembic upgrade head`` refuses to run, so the test suite and the next
deploy's migration step fail (``test_migrations_have_a_single_head``).

A merge revision, not a renumber: either 0024 may already be applied to a
database, and renaming an applied revision would strand it. The two are
independent (a CHECK constraint on ``games.outcome`` and an index on
``daily_word_progress.updated_at``), so their order does not matter and this
revision has no operations of its own.
"""

from collections.abc import Sequence

revision: str = "0025_merge_0024_heads"
down_revision: str | Sequence[str] | None = (
    "0024_drop_blackjack_outcome",
    "0024_dwp_updated_at_idx",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
