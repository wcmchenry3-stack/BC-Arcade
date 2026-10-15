"""add the blackjack ``round_played`` event type (#3284)

Revision ID: 0040_blackjack_round_event
Revises: 0038_yacht_turn_events
Create Date: 2026-10-15

Blackjack records a round (epic #3273) as one ``round_played`` event: the bet,
the deal, every action with the card it drew, and the dealer's play. One row
per round keeps the 200 B per-row server overhead off every action.
``append_events`` rejects an event type that is not seeded here (400), so the
type must ship before the app that sends it. The other Blackjack types
(``bet_placed``, ``hand_dealt``, ``player_action``, ``hand_resolved``, seeded by
0002) keep their names: older builds still send the first three, and
``hand_resolved`` grew its payload.

Seed only, no schema change. The downgrade deletes the type's ``game_events``
rows first (``game_events.event_type_id`` is a foreign key to ``event_types``),
so a downgrade discards every stored ``round_played`` row.

``down_revision`` is the dev head at the time of writing (Yacht, 0038). 0039 and 0036-0037 are
reserved for stories in open PRs; the chain is re-pointed when this merges.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0040_blackjack_round_event"
down_revision: str | None = "0038_yacht_turn_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_BLACKJACK = 3


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
                "game_type_id": _BLACKJACK,
                "name": "round_played",
                "display_name": "Round Played",
                "description": None,
            }
        ],
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM game_events WHERE event_type_id IN "
        f"(SELECT id FROM event_types WHERE game_type_id = {_BLACKJACK} "
        "AND name = 'round_played')"
    )
    op.execute(
        f"DELETE FROM event_types WHERE game_type_id = {_BLACKJACK} AND name = 'round_played'"
    )
