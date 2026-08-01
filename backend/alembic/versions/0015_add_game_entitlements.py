"""add game_entitlements table (#1050)

Revision ID: 0015_add_game_entitlements
Revises: 0014_game_types_premium_cat
Create Date: 2026-04-30
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0015_add_game_entitlements"
down_revision: str | None = "0014_game_types_premium_cat"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "game_entitlements",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Text(), nullable=False),
        sa.Column("game_slug", sa.Text(), nullable=False),
        sa.Column(
            "granted_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "game_slug", name="uq_game_entitlements_session_slug"),
    )
    op.create_index(
        "game_entitlements_session_id_idx",
        "game_entitlements",
        ["session_id"],
    )


def downgrade() -> None:
    op.drop_index("game_entitlements_session_id_idx", table_name="game_entitlements")
    op.drop_table("game_entitlements")
