"""games, events, bug_logs, and lookup tables (#363)

Revision ID: 0002_games_events_lookups
Revises: 0001_baseline
Create Date: 2026-04-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "0002_games_events_lookups"
down_revision: str | None = "0001_baseline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_JSONB = sa.JSON().with_variant(JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "game_types",
        sa.Column("id", sa.SmallInteger(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.Text(), nullable=False, unique=True),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column("icon_emoji", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.create_table(
        "event_types",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "game_type_id",
            sa.SmallInteger(),
            sa.ForeignKey("game_types.id"),
            nullable=False,
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("deprecated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("game_type_id", "name", name="uq_event_types_game_name"),
    )

    op.create_table(
        "games",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("session_id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column(
            "game_type_id",
            sa.SmallInteger(),
            sa.ForeignKey("game_types.id"),
            nullable=False,
        ),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("final_score", sa.Integer(), nullable=True),
        sa.Column("outcome", sa.Text(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("metadata", _JSONB, nullable=False, server_default="{}"),
        sa.CheckConstraint(
            "outcome IS NULL OR outcome IN ('win','loss','push','blackjack','abandoned')",
            name="ck_games_outcome",
        ),
    )
    op.create_index(
        "games_session_id_started_at_idx",
        "games",
        ["session_id", "started_at"],
    )
    op.create_index(
        "games_user_id_started_at_idx",
        "games",
        ["user_id", "started_at"],
        postgresql_where=sa.text("user_id IS NOT NULL"),
        sqlite_where=sa.text("user_id IS NOT NULL"),
    )
    op.create_index(
        "games_game_type_score_idx",
        "games",
        ["game_type_id", "final_score"],
        postgresql_where=sa.text("final_score IS NOT NULL"),
        sqlite_where=sa.text("final_score IS NOT NULL"),
    )

    op.create_table(
        "game_events",
        sa.Column(
            "game_id",
            sa.Uuid(),
            sa.ForeignKey("games.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("event_index", sa.Integer(), primary_key=True, nullable=False),
        sa.Column(
            "event_type_id",
            sa.Integer(),
            sa.ForeignKey("event_types.id"),
            nullable=False,
        ),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("data", _JSONB, nullable=False),
    )
    op.create_index(
        "game_events_event_type_id_idx",
        "game_events",
        ["event_type_id"],
    )

    op.create_table(
        "bug_logs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("session_id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("logged_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("level", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("context", _JSONB, nullable=False, server_default="{}"),
        sa.CheckConstraint("level IN ('warn','error','fatal')", name="ck_bug_logs_level"),
    )
    op.create_index("bug_logs_session_logged_idx", "bug_logs", ["session_id", "logged_at"])
    op.create_index("bug_logs_level_logged_idx", "bug_logs", ["level", "logged_at"])
    op.create_index("bug_logs_source_idx", "bug_logs", ["source"])

    # ---- seed data ----
    game_types = sa.table(
        "game_types",
        sa.column("id", sa.SmallInteger),
        sa.column("name", sa.Text),
        sa.column("display_name", sa.Text),
        sa.column("icon_emoji", sa.Text),
        sa.column("sort_order", sa.SmallInteger),
        sa.column("is_active", sa.Boolean),
    )
    op.bulk_insert(
        game_types,
        [
            {
                "id": 1,
                "name": "yacht",
                "display_name": "Yacht",
                "icon_emoji": "🎲",
                "sort_order": 10,
                "is_active": True,
            },
            {
                "id": 2,
                "name": "twenty48",
                "display_name": "2048",
                "icon_emoji": "🔢",
                "sort_order": 20,
                "is_active": True,
            },
            {
                "id": 3,
                "name": "blackjack",
                "display_name": "Blackjack",
                "icon_emoji": "🃏",
                "sort_order": 30,
                "is_active": True,
            },
            {
                "id": 4,
                "name": "cascade",
                "display_name": "Cascade",
                "icon_emoji": "🍉",
                "sort_order": 40,
                "is_active": True,
            },
        ],
    )

    event_types = sa.table(
        "event_types",
        sa.column("game_type_id", sa.SmallInteger),
        sa.column("name", sa.Text),
        sa.column("display_name", sa.Text),
        sa.column("description", sa.Text),
    )

    _baseline = [
        # yacht
        (1, "game_started", "Game Started", None),
        (1, "roll", "Dice Roll", None),
        (1, "score", "Category Scored", None),
        (1, "game_ended", "Game Ended", None),
        # 2048
        (2, "game_started", "Game Started", None),
        (2, "move", "Move", None),
        (2, "game_ended", "Game Ended", None),
        # blackjack
        (3, "game_started", "Game Started", None),
        (3, "bet_placed", "Bet Placed", None),
        (3, "hand_dealt", "Hand Dealt", None),
        (3, "player_action", "Player Action", None),
        (3, "hand_resolved", "Hand Resolved", None),
        (3, "game_ended", "Game Ended", None),
        # cascade
        (4, "game_started", "Game Started", None),
        (4, "drop", "Fruit Drop", None),
        (4, "merge", "Fruit Merge", None),
        (4, "game_ended", "Game Ended", None),
    ]
    op.bulk_insert(
        event_types,
        [
            {"game_type_id": gt, "name": n, "display_name": dn, "description": d}
            for gt, n, dn, d in _baseline
        ],
    )


def downgrade() -> None:
    op.drop_index("bug_logs_source_idx", table_name="bug_logs")
    op.drop_index("bug_logs_level_logged_idx", table_name="bug_logs")
    op.drop_index("bug_logs_session_logged_idx", table_name="bug_logs")
    op.drop_table("bug_logs")

    op.drop_index("game_events_event_type_id_idx", table_name="game_events")
    op.drop_table("game_events")

    op.drop_index("games_game_type_score_idx", table_name="games")
    op.drop_index("games_user_id_started_at_idx", table_name="games")
    op.drop_index("games_session_id_started_at_idx", table_name="games")
    op.drop_table("games")

    op.drop_table("event_types")
    op.drop_table("game_types")
