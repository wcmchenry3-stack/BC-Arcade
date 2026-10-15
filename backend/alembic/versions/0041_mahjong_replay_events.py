"""add the mahjong ``moves`` event type (#3285)

Revision ID: 0041_mahjong_replay_events
Revises: 0035_games_event_counters
Create Date: 2026-10-15

Mahjong records its play as ``moves`` events (epic #3273): one per chunk of up
to 25 actions (matched pairs, undos, hints and shuffles), so a stored game
rebuilds from the deal seed in ``game_started``. ``append_events`` rejects an
event type that is not seeded here (400), so the type must ship before the app
that sends it. Mahjong sent no gameplay event before, so nothing older stays
seeded alongside it.

Additive. The downgrade deletes the type's ``game_events`` rows first
(``game_events.event_type_id`` is a foreign key to ``event_types``), so a
downgrade discards every stored ``moves`` row.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0041_mahjong_replay_events"
down_revision: str | None = "0035_games_event_counters"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_MAHJONG = 9


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
                "game_type_id": _MAHJONG,
                "name": "moves",
                "display_name": "Moves",
                "description": None,
            }
        ],
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM game_events WHERE event_type_id IN "
        f"(SELECT id FROM event_types WHERE game_type_id = {_MAHJONG} AND name = 'moves')"
    )
    op.execute(f"DELETE FROM event_types WHERE game_type_id = {_MAHJONG} AND name = 'moves'")
