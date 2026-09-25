"""add `players` (one display name per player) and backfill it (#2624, epic #2519)

Revision ID: 0027_players_display_name
Revises: 0026_delete_anon_leaderboard
Create Date: 2026-09-25

Owner decision 17: a player's display name lives on the player (keyed by the
app's ``X-Session-ID``), not on each game row, so a rename applies to all of
their history. Every board reads it from this table instead of
``games.metadata.player_name``.

Backfill: one row per real session that has a completed game with a non-blank
``metadata.player_name``, using the name on its most recently completed named
row (ties broken by row id, so the result is deterministic). Sentinel
``*-anon`` sessions (the legacy ``POST /<game>/score`` rows #2622 deletes) are
skipped. Names are trimmed and cut to 32 characters, as the name validator and
the board did; a row whose name is blank after trimming counts as unnamed.

The backfill runs in Python over a streamed, ordered read, so the one query is
the same on SQLite (CI) and Postgres (prod): SQLAlchemy's JSON ``as_string()``
renders ``json_extract`` on SQLite and ``->>`` on JSONB. Only named, completed,
non-sentinel rows are read; one name per session is kept in memory.

Constants are literal, not imported from the app: a migration must keep
meaning what it meant when written (see ``0026_delete_anon_leaderboard``).

Downgrade drops the table. Names set after the upgrade through
``PUT /players/me`` are lost; names attached through ``PATCH /games/{id}/name``
are also on their game rows and would be backfilled again on re-upgrade.
"""

from collections.abc import Iterable, Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "0027_players_display_name"
down_revision: str | None = "0026_delete_anon_leaderboard"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_JSONB = sa.JSON().with_variant(JSONB(), "postgresql")

_MAX_NAME_LENGTH = 32
_SENTINEL_SUFFIX = "-anon"
_BATCH = 1000

_games = sa.table(
    "games",
    sa.column("id", sa.Uuid()),
    sa.column("session_id", sa.Text()),
    sa.column("completed_at", sa.DateTime(timezone=True)),
    sa.column("metadata", _JSONB),
)
_players = sa.table("players", sa.column("session_id", sa.Text()), sa.column("display_name"))


def _clean(raw: object) -> str | None:
    """Trimmed and cut to 32 characters, or None when blank."""
    if raw is None:
        return None
    name = str(raw).strip()[:_MAX_NAME_LENGTH].rstrip()
    return name or None


def latest_names(rows: Iterable[tuple[str, object]]) -> dict[str, str]:
    """``session_id -> name`` from rows ordered newest completion first per session.

    The first non-blank name seen for a session wins, so a session whose
    latest named row holds only whitespace falls back to its previous name.
    """
    names: dict[str, str] = {}
    for session_id, raw in rows:
        if session_id in names or session_id.endswith(_SENTINEL_SUFFIX):
            continue
        name = _clean(raw)
        if name is not None:
            names[session_id] = name
    return names


def upgrade() -> None:
    op.create_table(
        "players",
        sa.Column("session_id", sa.Text(), nullable=False),
        sa.Column("display_name", sa.Text(), nullable=False),
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
        sa.CheckConstraint(
            f"length(display_name) BETWEEN 1 AND {_MAX_NAME_LENGTH}",
            name="ck_players_display_name_length",
        ),
        sa.PrimaryKeyConstraint("session_id"),
    )

    name = _games.c.metadata["player_name"].as_string()
    stmt = (
        sa.select(_games.c.session_id, name)
        .where(
            _games.c.completed_at.is_not(None),
            name.is_not(None),
            _games.c.session_id.not_like(f"%{_SENTINEL_SUFFIX}"),
        )
        .order_by(_games.c.session_id, _games.c.completed_at.desc(), _games.c.id.desc())
        # Streamed (a server-side cursor on Postgres). Set on this statement,
        # not the connection: a connection-level yield_per would wrap the
        # INSERTs below in a cursor too, which Postgres rejects.
        .execution_options(yield_per=_BATCH)
    )
    bind = op.get_bind()
    # Fully read before any insert runs on the same connection.
    names = latest_names((row[0], row[1]) for row in bind.execute(stmt))

    batch = [{"session_id": sid, "display_name": n} for sid, n in names.items()]
    for start in range(0, len(batch), _BATCH):
        bind.execute(_players.insert(), batch[start : start + _BATCH])


def downgrade() -> None:
    op.drop_table("players")
