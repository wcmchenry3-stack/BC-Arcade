"""add the blackjack ``dealer_played`` event type (#3284)

Revision ID: 0040_blackjack_dealer_events
Revises: 0035_games_event_counters
Create Date: 2026-10-15

Blackjack records the dealer's play (epic #3273): hole card, the cards it
drew, its final total or bust, as one ``dealer_played`` event per round the
dealer plays. ``append_events`` rejects an event type that is not seeded here
(400), so the type must ship before the app that sends it. The other four
Blackjack hand types (``bet_placed``, ``hand_dealt``, ``player_action``,
``hand_resolved``, seeded by 0002) keep their names; only their payloads grew,
and the game module still accepts the old shapes.

Seed only, no schema change. The downgrade deletes the type's ``game_events``
rows first (``game_events.event_type_id`` is a foreign key to ``event_types``),
so a downgrade discards every stored ``dealer_played`` row.

``down_revision`` is the dev head at the time of writing. 0036-0039 are
reserved for stories in open PRs; the chain is re-pointed when this merges.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0040_blackjack_dealer_events"
down_revision: str | None = "0035_games_event_counters"
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
                "name": "dealer_played",
                "display_name": "Dealer Played",
                "description": None,
            }
        ],
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM game_events WHERE event_type_id IN "
        f"(SELECT id FROM event_types WHERE game_type_id = {_BLACKJACK} "
        "AND name = 'dealer_played')"
    )
    op.execute(
        f"DELETE FROM event_types WHERE game_type_id = {_BLACKJACK} AND name = 'dealer_played'"
    )
