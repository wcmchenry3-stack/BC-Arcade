"""add the solitaire and freecell ``moves`` event types (#3289)

Revision ID: 0044_card_game_moves_events
Revises: 0036_game_types_replay_dial
Create Date: 2026-10-15

Solitaire and FreeCell record their play as ``moves`` events (epic #3273): one
per chunk of up to 25 actions (moves, stock draws, undos, hints, auto-complete
steps), so a stored game rebuilds from the deal seed in ``game_started`` plus
its ``moves`` rows in ``event_index`` order. ``append_events`` rejects an event
type that is not seeded here (400), so the types must ship before the app that
sends them. Neither game sent a per-move event before, so no older type stays
behind.

Additive. The downgrade deletes the types' ``game_events`` rows first
(``game_events.event_type_id`` is a foreign key to ``event_types``), so a
downgrade discards every stored ``moves`` row of both games.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0044_card_game_moves_events"
down_revision: str | None = "0036_game_types_replay_dial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SOLITAIRE = 6
_FREECELL = 11
_GAMES = (_SOLITAIRE, _FREECELL)


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
                "game_type_id": game,
                "name": "moves",
                "display_name": "Moves",
                "description": None,
            }
            for game in _GAMES
        ],
    )


def downgrade() -> None:
    ids = ", ".join(str(g) for g in _GAMES)
    op.execute(
        "DELETE FROM game_events WHERE event_type_id IN "
        f"(SELECT id FROM event_types WHERE game_type_id IN ({ids}) AND name = 'moves')"
    )
    op.execute(f"DELETE FROM event_types WHERE game_type_id IN ({ids}) AND name = 'moves'")
