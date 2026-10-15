"""add the hearts replay event types (#3283)

Revision ID: 0039_hearts_hand_events
Revises: 0045_replay_sample_rate_full
Create Date: 2026-10-15

Hearts records its play as two gameplay events a hand (epic #3273):
``hand_opened`` (the four starting hands and the cards each seat passed) and
``hand_played`` (the hand's tricks, and its deltas and running totals), so a
stored game rebuilds every hand and every seat's score. ``append_events`` rejects an event type that is not seeded
here (400), so the types must ship before the app that sends them.

Seed only, no schema change. Additive. The downgrade deletes the types'
``game_events`` rows first (``game_events.event_type_id`` is a foreign key to
``event_types``), so a downgrade discards every stored Hearts replay row.

The number 0039 is not the next in the chain: it sits on 0045_replay_sample_rate_full, the
head when this was written (0036-0038 and 0044-0045 are other stories').
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0039_hearts_hand_events"
down_revision: str | None = "0045_replay_sample_rate_full"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_HEARTS = 7  # game_types.id, 0008_add_hearts_game_type
_TYPES: tuple[tuple[str, str], ...] = (
    ("hand_opened", "Hand Opened"),
    ("hand_played", "Hand Played"),
)


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
                "game_type_id": _HEARTS,
                "name": name,
                "display_name": display_name,
                "description": None,
            }
            for name, display_name in _TYPES
        ],
    )


def downgrade() -> None:
    names = ", ".join(f"'{name}'" for name, _ in _TYPES)
    op.execute(
        "DELETE FROM game_events WHERE event_type_id IN "
        f"(SELECT id FROM event_types WHERE game_type_id = {_HEARTS} AND name IN ({names}))"
    )
    op.execute(f"DELETE FROM event_types WHERE game_type_id = {_HEARTS} AND name IN ({names})")
