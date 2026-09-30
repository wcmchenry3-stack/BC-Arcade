"""add purchases, purchase_links, purchase_events; extend game_entitlements (#840)

Revision ID: 0031_add_purchases
Revises: 0030_generated_player_names
Create Date: 2026-09-30

The store-purchase schema of docs/IAP.md §8.1:

* ``purchases`` — one row per store purchase, unique on
  ``(platform, store_key)`` (Apple ``originalTransactionId`` / Google
  ``purchaseToken``).
* ``purchase_links`` — which sessions a purchase is linked to (the ownership
  record; the link caps count these rows).
* ``purchase_events`` — audit trail and webhook idempotency (``dedupe_key``).
* ``game_entitlements`` gains ``purchase_id``, ``last_verified_at`` and
  ``source`` (default ``'legacy'``, so every existing row stays a legacy row
  that the purchase recompute never touches). Its ``purchase_id`` foreign key
  is ``ON DELETE SET NULL``: deleting one purchase must not drop access that
  another owned purchase still justifies, so the recompute decides.
* ``purchases.state_changed_at`` orders store state: a transition older than
  it is ignored (out-of-order webhooks, stale client re-posts).

Identity is still the anonymous ``X-Session-ID``; restoring a purchase to a new
session goes through verified store evidence and the capped link rule
(IAP.md §4), not through this schema alone.

``game_entitlements`` is altered in batch mode so the same migration runs on
SQLite (CI's schema check and the test suite), which cannot add a foreign key
with ``ALTER TABLE``. Downgrade drops everything this adds; purchase-derived
``game_entitlements`` rows are deleted first so no access survives without the
purchase that justified it.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "0031_add_purchases"
down_revision: str | None = "0030_generated_player_names"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_JSONB = sa.JSON().with_variant(JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "purchases",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("platform", sa.Text(), nullable=False),
        sa.Column("store_key", sa.Text(), nullable=False),
        sa.Column("product_id", sa.Text(), nullable=False),
        sa.Column("game_slug", sa.Text(), nullable=False),
        sa.Column("state", sa.Text(), nullable=False),
        sa.Column("environment", sa.Text(), nullable=False),
        sa.Column("ownership_type", sa.Text(), server_default="purchased", nullable=False),
        sa.Column("store_transaction_id", sa.Text(), nullable=True),
        sa.Column("account_token", sa.Text(), nullable=True),
        sa.Column("purchased_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("state_changed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revocation_reason", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.CheckConstraint("platform IN ('apple','google')", name="ck_purchases_platform"),
        sa.CheckConstraint(
            "state IN ('pending','owned','revoked','cancelled')", name="ck_purchases_state"
        ),
        sa.CheckConstraint(
            "environment IN ('production','sandbox','test')", name="ck_purchases_environment"
        ),
        sa.CheckConstraint(
            "ownership_type IN ('purchased','family_shared')", name="ck_purchases_ownership_type"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("platform", "store_key", name="uq_purchases_platform_store_key"),
    )
    op.create_index("purchases_game_slug_idx", "purchases", ["game_slug"])
    op.create_index("purchases_state_idx", "purchases", ["state"])

    op.create_table(
        "purchase_links",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("purchase_id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("last_verified_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "source IN ('purchase','restore','sync')", name="ck_purchase_links_source"
        ),
        sa.ForeignKeyConstraint(
            ["purchase_id"],
            ["purchases.id"],
            name="fk_purchase_links_purchase_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("purchase_id", "session_id", name="uq_purchase_links_purchase_session"),
    )
    op.create_index("purchase_links_session_id_idx", "purchase_links", ["session_id"])
    op.create_index(
        "purchase_links_purchase_id_created_at_idx",
        "purchase_links",
        ["purchase_id", "created_at"],
    )

    op.create_table(
        "purchase_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("purchase_id", sa.Uuid(), nullable=True),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("dedupe_key", sa.Text(), nullable=True),
        sa.Column("session_hash", sa.Text(), nullable=True),
        sa.Column("detail", _JSONB, server_default="{}", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["purchase_id"],
            ["purchases.id"],
            name="fk_purchase_events_purchase_id",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("dedupe_key", name="uq_purchase_events_dedupe_key"),
    )
    op.create_index("purchase_events_purchase_id_idx", "purchase_events", ["purchase_id"])

    with op.batch_alter_table("game_entitlements") as batch:
        batch.add_column(sa.Column("purchase_id", sa.Uuid(), nullable=True))
        batch.add_column(sa.Column("last_verified_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("source", sa.Text(), server_default="legacy", nullable=False))
        batch.create_foreign_key(
            "fk_game_entitlements_purchase_id_purchases",
            "purchases",
            ["purchase_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch.create_check_constraint(
            "ck_game_entitlements_source",
            "source IN ('purchase','restore','sync','legacy')",
        )
        batch.create_index("game_entitlements_purchase_id_idx", ["purchase_id"])


def downgrade() -> None:
    # Access derived from a purchase must not outlive the purchase tables.
    op.execute(sa.text("DELETE FROM game_entitlements WHERE source <> 'legacy'"))
    with op.batch_alter_table("game_entitlements") as batch:
        batch.drop_index("game_entitlements_purchase_id_idx")
        batch.drop_constraint("ck_game_entitlements_source", type_="check")
        batch.drop_constraint("fk_game_entitlements_purchase_id_purchases", type_="foreignkey")
        batch.drop_column("source")
        batch.drop_column("last_verified_at")
        batch.drop_column("purchase_id")

    op.drop_index("purchase_events_purchase_id_idx", table_name="purchase_events")
    op.drop_table("purchase_events")
    op.drop_index("purchase_links_purchase_id_created_at_idx", table_name="purchase_links")
    op.drop_index("purchase_links_session_id_idx", table_name="purchase_links")
    op.drop_table("purchase_links")
    op.drop_index("purchases_state_idx", table_name="purchases")
    op.drop_index("purchases_game_slug_idx", table_name="purchases")
    op.drop_table("purchases")
