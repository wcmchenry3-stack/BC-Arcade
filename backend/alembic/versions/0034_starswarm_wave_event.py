"""add the starswarm ``wave_completed`` event type (#3250)

Revision ID: 0034_starswarm_wave_event
Revises: 0033_games_received_at
Create Date: 2026-10-13

Star Swarm's per-wave stats snapshot (epic #3244) is sent as one
``wave_completed`` gameplay event per wave. ``append_events`` rejects an event
type that is not seeded here (400), so the type must ship before the app does.

Additive. The downgrade deletes the type's ``game_events`` rows first
(``game_events.event_type_id`` is a foreign key to ``event_types``), so a
downgrade discards every stored wave snapshot.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0034_starswarm_wave_event"
down_revision: str | None = "0033_games_received_at"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_STARSWARM = 10


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
                "name": "wave_completed",
                "display_name": "Wave Completed",
                "description": None,
            }
        ],
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM game_events WHERE event_type_id IN "
        f"(SELECT id FROM event_types WHERE game_type_id = {_STARSWARM} "
        "AND name = 'wave_completed')"
    )
    op.execute(
        f"DELETE FROM event_types WHERE game_type_id = {_STARSWARM} AND name = 'wave_completed'"
    )
