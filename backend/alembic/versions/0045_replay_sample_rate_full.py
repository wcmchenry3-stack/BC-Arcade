"""Sample every session's replay: replay_sample_rate = 1.0 for every game (#3279)

Revision ID: 0045_replay_sample_rate_full
Revises: 0044_card_game_moves_events
Create Date: 2026-10-15

Owner decision on epic #3273: while play volume is low, every session uploads its
full replay. Data only: the column default (0.10, migration 0036) is unchanged, so
a game type added later starts sampled. The dial stays live: an admin can lower a
rate with SQL, and the storage-budget job (``games.replay_storage``) still turns
every rate down at 90 % of the budget.

The downgrade puts every game back to 0036's default rate.
"""

from collections.abc import Sequence

from sqlalchemy import text

from alembic import op

revision: str = "0045_replay_sample_rate_full"
down_revision: str | None = "0044_card_game_moves_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FULL_SAMPLE_RATE = 1.0
PREVIOUS_SAMPLE_RATE = 0.10


def upgrade() -> None:
    op.execute(text(f"UPDATE game_types SET replay_sample_rate = {FULL_SAMPLE_RATE}"))


def downgrade() -> None:
    op.execute(text(f"UPDATE game_types SET replay_sample_rate = {PREVIOUS_SAMPLE_RATE}"))
