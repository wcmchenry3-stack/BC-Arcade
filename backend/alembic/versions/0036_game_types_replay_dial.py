"""game_types replay dial: replay_enabled + replay_sample_rate (#3279)

Revision ID: 0036_game_types_replay_dial
Revises: 0038_yacht_turn_events
Create Date: 2026-10-15

The server-side dial for gameplay replays (epic #3273, carrier decided in #3307),
served per game on ``GET /games/catalog``:

* ``replay_enabled BOOLEAN NOT NULL DEFAULT true``: the per-game kill switch. Off,
  the app records nothing for the game and ``append_events`` drops its replay rows
  (lifecycle rows are still stored), as ``REPLAY_RECORDING_ENABLED=false`` does for
  every game.
* ``replay_sample_rate REAL NOT NULL DEFAULT 0.10``, ``CHECK (0 <= rate <= 1)``: the
  share of sessions that upload their full replay; the rest send lifecycle rows and
  a compact summary, unless an error upgrades them. The CHECK is the rate's cap.

Both are written by an admin (SQL) and by the storage-budget job
(``games.replay_storage``), which lowers every rate at 90 % of the budget. Nothing
else writes them.

Every existing row gets the defaults (explicit ``UPDATE`` too: SQLite's ``ADD
COLUMN`` default is not always read back as a boolean). ``ADD COLUMN`` with a
constant default is metadata-only on Postgres 11+, and the CHECK scans a table of a
dozen rows, so the brief ``ACCESS EXCLUSIVE`` lock is not a concern. SQLite has no
``ADD CONSTRAINT``, so the table is rebuilt there (``batch_alter_table``).

The downgrade drops the constraint and both columns.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import text

from alembic import op

revision: str = "0036_game_types_replay_dial"
down_revision: str | None = "0038_yacht_turn_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CHECK = "ck_game_types_replay_sample_rate"
DEFAULT_SAMPLE_RATE = 0.10


def upgrade() -> None:
    with op.batch_alter_table("game_types") as batch:
        batch.add_column(
            sa.Column("replay_enabled", sa.Boolean(), nullable=False, server_default=sa.true())
        )
        batch.add_column(
            sa.Column(
                "replay_sample_rate",
                sa.REAL(),
                nullable=False,
                server_default=text(str(DEFAULT_SAMPLE_RATE)),
            )
        )
        batch.create_check_constraint(_CHECK, "replay_sample_rate BETWEEN 0 AND 1")
    op.execute(
        text(
            "UPDATE game_types SET replay_enabled = true, "
            f"replay_sample_rate = {DEFAULT_SAMPLE_RATE}"
        )
    )


def downgrade() -> None:
    with op.batch_alter_table("game_types") as batch:
        batch.drop_constraint(_CHECK, type_="check")
        batch.drop_column("replay_sample_rate")
        batch.drop_column("replay_enabled")
