"""relax games.outcome check constraint to accept lifecycle vocabulary (#514)

Revision ID: 0003_relax_games_outcome_ck
Revises: 0002_games_events_lookups
Create Date: 2026-04-15

Background
----------
The original `ck_games_outcome` constraint (added in 0002) only accepted the
blackjack result vocabulary `{win, loss, push, blackjack}` plus `abandoned`.
Score-based games (yacht, cascade, twenty48) that send a lifecycle outcome
like `completed` or `kept_playing` were rejected at the DB layer — even
though every one of their frontend screens emits that vocabulary.

#514 documented the symptom (PATCH /games/:id/complete → 400). Prior to
this migration the 400 was raised by the Pydantic/application validator
in `games/service.py:_VALID_OUTCOMES`; under the same migration the DB
constraint would also have rejected the write. This migration and the
companion `_VALID_OUTCOMES` expansion bring both layers in line with the
vocabulary the frontends actually use.

Forward migration
-----------------
Drops the old `ck_games_outcome` and recreates it with the union of both
vocabularies. Uses `batch_alter_table` so SQLite (the CI test DB) can
rewrite the table — SQLite has no ALTER TABLE DROP CONSTRAINT.

Downgrade
---------
Restores the original constraint. Any rows with the new vocabulary
(`completed`, `kept_playing`) would fail the tighter constraint on
downgrade, so the downgrade is only safe on a DB that has not yet
accepted any lifecycle-vocabulary rows.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0003_relax_games_outcome_ck"
down_revision: str | None = "0002_games_events_lookups"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_NEW_CHECK = (
    "outcome IS NULL OR outcome IN "
    "('win','loss','push','blackjack','completed','abandoned','kept_playing')"
)
_OLD_CHECK = "outcome IS NULL OR outcome IN ('win','loss','push','blackjack','abandoned')"


def upgrade() -> None:
    with op.batch_alter_table("games") as batch_op:
        batch_op.drop_constraint("ck_games_outcome", type_="check")
        batch_op.create_check_constraint("ck_games_outcome", _NEW_CHECK)


def downgrade() -> None:
    with op.batch_alter_table("games") as batch_op:
        batch_op.drop_constraint("ck_games_outcome", type_="check")
        batch_op.create_check_constraint("ck_games_outcome", _OLD_CHECK)
