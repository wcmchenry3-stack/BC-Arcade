"""games event counters + created_at, and the bug_logs retention index (#3298)

Revision ID: 0035_games_event_counters
Revises: 0034_starswarm_wave_event
Create Date: 2026-10-14

``append_events`` caps what a game, and what a session in a rolling 24 h, may
store. Counting ``game_events`` on every append would be O(events), so each game
keeps running totals instead, incremented in the same transaction as the insert:

* ``event_count`` / ``event_bytes``: stored events, and the UTF-8 compact-JSON
  length of their ``data``. ``NOT NULL DEFAULT 0``.
* ``created_at``: the server's own insert time. ``started_at`` is device-reported
  (accepted up to a year back), so a forged request could backdate games out of
  the 24 h window; this column cannot be set by a client.

No backfill: games that exist when this runs start at 0 events / 0 bytes (their
stored events are not counted) and ``created_at`` is the migration time.

Two indexes:

* ``games_session_created_idx (session_id, created_at)`` serves the per-session
  24 h sum.
* ``bug_logs_received_at_idx (received_at)`` serves the daily bug_logs retention
  delete (``logs/retention.py``), which would otherwise scan the table.

Both are built ``CONCURRENTLY`` on Postgres, outside the migration transaction
(``autocommit_block``), as in 0032, so no write to ``games`` / ``bug_logs`` is
blocked. Each build is preceded on Postgres by ``DROP INDEX CONCURRENTLY IF
EXISTS`` so a run interrupted part-way can be re-run. The columns are added first,
in the migration transaction. SQLite builds the indexes inside its transaction.

Additive; the downgrade drops the indexes and the three columns.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0035_games_event_counters"
down_revision: str | None = "0034_starswarm_wave_event"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_INDEXES = (
    ("games_session_created_idx", "games", ["session_id", "created_at"]),
    ("bug_logs_received_at_idx", "bug_logs", ["received_at"]),
)


def upgrade() -> None:
    op.add_column(
        "games", sa.Column("event_count", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column(
        "games", sa.Column("event_bytes", sa.Integer(), nullable=False, server_default="0")
    )
    created_at = sa.Column(
        "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
    if op.get_bind().dialect.name == "sqlite":
        # SQLite cannot ADD COLUMN with a non-constant default, so the copy is rebuilt.
        with op.batch_alter_table("games") as batch:
            batch.add_column(created_at)
    else:
        op.add_column("games", created_at)

    postgres = op.get_context().dialect.name == "postgresql"
    # CREATE INDEX CONCURRENTLY cannot run inside a transaction.
    with op.get_context().autocommit_block():
        for name, table, columns in _INDEXES:
            if postgres:
                op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
            op.create_index(name, table, columns, postgresql_concurrently=True)


def downgrade() -> None:
    with op.get_context().autocommit_block():
        for name, table, _ in reversed(_INDEXES):
            op.drop_index(name, table_name=table, postgresql_concurrently=True, if_exists=True)
    with op.batch_alter_table("games") as batch:
        batch.drop_column("created_at")
        batch.drop_column("event_bytes")
        batch.drop_column("event_count")
