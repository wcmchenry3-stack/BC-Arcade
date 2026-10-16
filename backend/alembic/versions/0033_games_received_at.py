"""games.received_at: server receipt time for the leaderboard's last tie-break (#2765)

Revision ID: 0033_games_received_at
Revises: 0032_leaderboard_indexes
Create Date: 2026-10-13

Tied entries were ordered by the device-reported ``completed_at``, which the
server accepts anywhere in [now - 1 year, now + 24 h]: a slow clock or a forged
request won every tie. ``received_at`` is the server's own time when the
completion arrived (``PATCH /games/{id}/complete``; the stale-game sweep stamps
it with the same value it gives ``completed_at``).

Nullable: an in-progress game has none. Existing rows are backfilled with their
``completed_at``, the best the server knows. The boards order by
``coalesce(received_at, completed_at)``.

No index: no board uses the tie key as an index condition (the one-per-player
window sorts by session first; see 0032), so ``received_at`` needs none.

Additive; the downgrade drops the column.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0033_games_received_at"
down_revision: str | None = "0032_leaderboard_indexes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("games", sa.Column("received_at", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE games SET received_at = completed_at WHERE completed_at IS NOT NULL")


def downgrade() -> None:
    with op.batch_alter_table("games") as batch:
        batch.drop_column("received_at")
