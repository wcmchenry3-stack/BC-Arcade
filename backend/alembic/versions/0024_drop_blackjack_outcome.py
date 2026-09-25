"""drop the never-written ``blackjack`` outcome from ck_games_outcome (#2619)

Revision ID: 0024_drop_blackjack_outcome
Revises: 0023_sudoku_free
Create Date: 2026-09-25

``GameOutcome.BLACKJACK`` was part of the original Blackjack result vocabulary
(0002) but no client ever wrote it: a Blackjack run win is ``win`` (#2628). The
enum member is removed in ``vocab.py``; this rebuilds the CHECK constraint to
match. See ``vocab.GameOutcome`` for what every remaining value means.

Constraint-only. Before the rebuild, any ``blackjack`` rows are rewritten to
``win`` so the tighter constraint cannot fail on a database that somehow holds
one (none are expected).

Downgrade restores the constraint with ``blackjack`` accepted again. Rows
rewritten to ``win`` stay ``win`` — the two are indistinguishable afterwards,
and ``win`` is valid under both constraints.
"""

from collections.abc import Sequence

from sqlalchemy import text

from alembic import op

revision: str = "0024_drop_blackjack_outcome"
down_revision: str | None = "0023_sudoku_free"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Literal, not built from vocab.GameOutcome: a migration must keep meaning what
# it meant when written, even after the enum changes again.
_NEW_CHECK = (
    "outcome IS NULL OR outcome IN ('win','loss','push','completed','abandoned','kept_playing')"
)
_OLD_CHECK = (
    "outcome IS NULL OR outcome IN "
    "('win','loss','push','blackjack','completed','abandoned','kept_playing')"
)


def upgrade() -> None:
    op.execute(text("UPDATE games SET outcome = 'win' WHERE outcome = 'blackjack'"))
    with op.batch_alter_table("games") as batch_op:
        batch_op.drop_constraint("ck_games_outcome", type_="check")
        batch_op.create_check_constraint("ck_games_outcome", _NEW_CHECK)


def downgrade() -> None:
    with op.batch_alter_table("games") as batch_op:
        batch_op.drop_constraint("ck_games_outcome", type_="check")
        batch_op.create_check_constraint("ck_games_outcome", _OLD_CHECK)
