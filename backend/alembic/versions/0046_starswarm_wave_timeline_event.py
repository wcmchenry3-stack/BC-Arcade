"""add the starswarm ``wave_timeline`` event type (#3394)

Revision ID: 0046_starswarm_wave_timeline
Revises: 0037_twenty48_moves_event
Create Date: 2026-10-21

Star Swarm's per-wave critical-event timeline (epic #3390) is sent as one
``wave_timeline`` gameplay event per kept wave close, beside ``wave_completed``.
``append_events`` rejects an event type that is not seeded here (400), so the
type must ship before the app does: deploy the backend (this migration) first.
Older apps never send it.

Additive. The downgrade deletes the type's ``game_events`` rows first
(``game_events.event_type_id`` is a foreign key to ``event_types``), so a
downgrade discards every stored timeline. ``wave_completed`` rows are untouched.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0046_starswarm_wave_timeline"
down_revision: str | None = "0037_twenty48_moves_event"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_STARSWARM = 10
_NAME = "wave_timeline"


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
                "game_type_id": _STARSWARM,
                "name": _NAME,
                "display_name": "Wave Timeline",
                "description": None,
            }
        ],
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM game_events WHERE event_type_id IN "
        f"(SELECT id FROM event_types WHERE game_type_id = {_STARSWARM} "
        f"AND name = '{_NAME}')"
    )
    op.execute(f"DELETE FROM event_types WHERE game_type_id = {_STARSWARM} AND name = '{_NAME}'")
