"""games.event_count / event_bytes / created_at: per-game and per-session event ceilings (#3298)

Revision ID: 0035_games_event_counters
Revises: 0034_starswarm_wave_event
Create Date: 2026-10-14

``append_events`` caps what a game, and what a session in a rolling 24 h, may
store. Counting ``game_events`` on every append would be O(events), so each game
keeps running totals instead, incremented in the same transaction as the insert:

* ``event_count`` / ``event_bytes``: stored events, and the compact-JSON length
  of their ``data``. ``NOT NULL DEFAULT 0``.
* ``created_at``: the server's own insert time. ``started_at`` is device-reported
  (accepted up to a year back), so a forged request could backdate games out of
  the 24 h window; this column cannot be set by a client.

No backfill: games that exist when this runs start at 0 events / 0 bytes (their
stored events are not counted) and ``created_at`` is the migration time.

``games_session_created_idx (session_id, created_at)`` serves the per-session
sum. Additive; the downgrade drops the index and the three columns.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0035_games_event_counters"
down_revision: str | None = "0034_starswarm_wave_event"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "games", sa.Column("event_count", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column(
        "games", sa.Column("event_bytes", sa.Integer(), nullable=False, server_default="0")
    )
    if op.get_bind().dialect.name == "sqlite":
        # SQLite cannot ADD COLUMN with a non-constant default, so the copy is rebuilt.
        with op.batch_alter_table("games") as batch:
            batch.add_column(
                sa.Column(
                    "created_at",
                    sa.DateTime(timezone=True),
                    nullable=False,
                    server_default=sa.func.now(),
                )
            )
    else:
        op.add_column(
            "games",
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )
    op.create_index("games_session_created_idx", "games", ["session_id", "created_at"])


def downgrade() -> None:
    op.drop_index("games_session_created_idx", table_name="games")
    with op.batch_alter_table("games") as batch:
        batch.drop_column("created_at")
        batch.drop_column("event_bytes")
        batch.drop_column("event_count")
