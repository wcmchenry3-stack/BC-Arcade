"""add the sort ``moves`` event type (#3387)

Revision ID: 0047_sort_replay_events
Revises: 0046_starswarm_wave_timeline
Create Date: 2026-11-13

Bottle Sort records its play as ``moves`` events (epic #3383): one per chunk of
up to 25 actions (pours, undos, hints and rewinds), so a stored level rebuilds
from the level number and catalog version in ``game_started``. ``append_events``
rejects an event type that is not seeded here (400), so the type must ship
before the app that sends it. Sort sent no gameplay event before, so nothing
older stays seeded alongside it.

Additive. The downgrade deletes the type's ``game_events`` rows first
(``game_events.event_type_id`` is a foreign key to ``event_types``), so a
downgrade discards every stored ``moves`` row.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0047_sort_replay_events"
down_revision: str | None = "0046_starswarm_wave_timeline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SORT = 12


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
                "game_type_id": _SORT,
                "name": "moves",
                "display_name": "Moves",
                "description": None,
            }
        ],
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM game_events WHERE event_type_id IN "
        f"(SELECT id FROM event_types WHERE game_type_id = {_SORT} AND name = 'moves')"
    )
    op.execute(f"DELETE FROM event_types WHERE game_type_id = {_SORT} AND name = 'moves'")
