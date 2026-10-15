"""add the twenty48 ``moves`` event type (#3286)

Revision ID: 0037_twenty48_moves_event
Revises: 0045_replay_sample_rate_full
Create Date: 2026-10-15

2048 records its play as ``moves`` events (epic #3273): one per chunk of up to
25 swipes, each move carrying its direction, the tile it spawned and the
score, so a stored game rebuilds from the opening board. ``append_events``
rejects an event type that is not seeded here (400), so the type must ship
before the app that sends it. The per-swipe ``move`` type (0002) stays seeded:
older app builds still send it.

Additive. The downgrade deletes the type's ``game_events`` rows first
(``game_events.event_type_id`` is a foreign key to ``event_types``), so a
downgrade discards every stored ``moves`` row.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0037_twenty48_moves_event"
down_revision: str | None = "0045_replay_sample_rate_full"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TWENTY48 = 2


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
                "game_type_id": _TWENTY48,
                "name": "moves",
                "display_name": "Moves",
                "description": None,
            }
        ],
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM game_events WHERE event_type_id IN "
        f"(SELECT id FROM event_types WHERE game_type_id = {_TWENTY48} AND name = 'moves')"
    )
    op.execute(f"DELETE FROM event_types WHERE game_type_id = {_TWENTY48} AND name = 'moves'")
