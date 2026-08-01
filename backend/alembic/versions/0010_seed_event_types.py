"""seed event_types for solitaire, hearts, and sudoku (#697)

Revision ID: 0010_seed_event_types
Revises: 0009_add_sudoku_game_type
Create Date: 2026-04-21

Migrations 0007-0009 registered the game_type rows for solitaire (id=6),
hearts (id=7), and sudoku (id=8) but never seeded their event_types. Every
POST /games/:id/events from those games returned 400 (unknown_event_type)
and the SyncWorker dead-lettered the batch — silently dropping all events.

All three screens only emit the two lifecycle events injected automatically
by gameEventClient.startGame / completeGame: game_started and game_ended.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0010_seed_event_types"
down_revision: str | None = "0009_add_sudoku_game_type"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


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
            # solitaire (id=6)
            {
                "game_type_id": 6,
                "name": "game_started",
                "display_name": "Game Started",
                "description": None,
            },
            {
                "game_type_id": 6,
                "name": "game_ended",
                "display_name": "Game Ended",
                "description": None,
            },
            # hearts (id=7)
            {
                "game_type_id": 7,
                "name": "game_started",
                "display_name": "Game Started",
                "description": None,
            },
            {
                "game_type_id": 7,
                "name": "game_ended",
                "display_name": "Game Ended",
                "description": None,
            },
            # sudoku (id=8)
            {
                "game_type_id": 8,
                "name": "game_started",
                "display_name": "Game Started",
                "description": None,
            },
            {
                "game_type_id": 8,
                "name": "game_ended",
                "display_name": "Game Ended",
                "description": None,
            },
        ],
    )


def downgrade() -> None:
    op.execute("DELETE FROM event_types WHERE game_type_id IN (6, 7, 8)")
