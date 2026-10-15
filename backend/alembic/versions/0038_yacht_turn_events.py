"""add the yacht ``turn_completed`` event type (#3282)

Revision ID: 0038_yacht_turn_events
Revises: 0035_games_event_counters
Create Date: 2026-10-15

Yacht records its play as ``turn_completed`` events (epic #3273): one per
player per round, carrying the rolls, the hold taps, the scored category with
its alternatives, the bonus flags and, for the computer, the oracle's EVs.
``append_events`` rejects an event type that is not seeded here (400), so the
type must ship before the app that sends it. The per-roll ``roll`` and
per-score ``score`` types (0002) stay seeded: older app builds still send them.

Seed only, no schema change. The downgrade deletes the type's ``game_events``
rows first (``game_events.event_type_id`` is a foreign key to ``event_types``),
so a downgrade discards every stored ``turn_completed`` row.

The number is reserved: 0036 and 0037 are in open PRs, and the chain is
re-pointed at merge time.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0038_yacht_turn_events"
down_revision: str | None = "0035_games_event_counters"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_YACHT = 1


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
                "game_type_id": _YACHT,
                "name": "turn_completed",
                "display_name": "Turn Completed",
                "description": None,
            }
        ],
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM game_events WHERE event_type_id IN "
        f"(SELECT id FROM event_types WHERE game_type_id = {_YACHT} AND name = 'turn_completed')"
    )
    op.execute(f"DELETE FROM event_types WHERE game_type_id = {_YACHT} AND name = 'turn_completed'")
