"""add the sudoku ``entries`` event type (#3288)

Revision ID: 0043_sudoku_replay_events
Revises: 0035_games_event_counters
Create Date: 2026-10-15

Sudoku records its play as ``entries`` events (epic #3273): one per chunk of up
to 32 player actions (digits, pencil notes, erases, undos, hints), so a stored
game rebuilds from the givens in ``game_started`` plus its ``entries`` rows.
``append_events`` rejects an event type that is not seeded here (400), so the
type must ship before the app that sends it.

Additive. The downgrade deletes the type's ``game_events`` rows first
(``game_events.event_type_id`` is a foreign key to ``event_types``), so a
downgrade discards every stored ``entries`` row.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0043_sudoku_replay_events"
down_revision: str | None = "0035_games_event_counters"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SUDOKU = 8


def upgrade() -> None:
    event_types = sa.table(
        "event_types",
        sa.column("game_type_id", sa.SmallInteger),
        sa.column("name", sa.Text),
        sa.column("display_name", sa.Text),
        sa.column("description", sa.Text),
    )
    op.bulk_insert(
        event_types,
        [
            {
                "game_type_id": _SUDOKU,
                "name": "entries",
                "display_name": "Entries",
                "description": None,
            }
        ],
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM game_events WHERE event_type_id IN "
        f"(SELECT id FROM event_types WHERE game_type_id = {_SUDOKU} "
        "AND name = 'entries')"
    )
    op.execute(f"DELETE FROM event_types WHERE game_type_id = {_SUDOKU} AND name = 'entries'")
