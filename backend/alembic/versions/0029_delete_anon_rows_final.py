"""delete legacy `*-anon` leaderboard rows again, after the routes are gone (#2644)

Revision ID: 0029_delete_anon_rows_final
Revises: 0028_backfill_win_outcomes
Create Date: 2026-09-26

Repeats ``0026_delete_anon_leaderboard`` (#2622). The legacy per-game
``POST /<game>/score`` routes wrote their rows under a fixed, unattributable
session id (``solitaire-anon`` and so on), and kept doing so after 0026 ran
until #2644 deleted the routes. This repeats the cleanup once the routes are
gone. It does not leave the table permanently clean: the deploy runs
``alembic upgrade head`` when the new instance starts, while the old instance
keeps serving ``POST /<game>/score`` until the swap, so rows written in that
window survive this migration. The generic board's ``*-anon`` filter
(``games/leaderboard.py``) stays as the guard that keeps them off every board.

Literal session ids, not imported from application code: a migration must keep
meaning what it meant when written (see ``0024_drop_blackjack_outcome``). The
list is 0026's, unchanged: these seven are the only ids the legacy routes ever
wrote (Cascade and Sudoku named existing session rows instead).

Events are deleted explicitly before their games, as in 0026: Alembic's SQLite
connection doesn't enable ``PRAGMA foreign_keys``, so the schema's
``ON DELETE CASCADE`` on ``game_events.game_id`` isn't guaranteed to fire here.

Downgrade is a documented no-op: the deleted rows cannot be restored, and
there is no schema to revert.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0029_delete_anon_rows_final"
down_revision: str | None = "0028_backfill_win_outcomes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The seven sentinels written by the removed legacy per-game score routes
# (#2622 context; the same list as 0026).
_SENTINEL_SESSIONS = (
    "solitaire-anon",
    "mahjong-anon",
    "hearts-anon",
    "freecell-anon",
    "sort-anon",
    "starswarm-anon",
    "yacht-anon",
)

_games = sa.table("games", sa.column("id"), sa.column("session_id"))
_game_events = sa.table("game_events", sa.column("game_id"))


def upgrade() -> None:
    sentinel_game_ids = sa.select(_games.c.id).where(_games.c.session_id.in_(_SENTINEL_SESSIONS))
    op.execute(_game_events.delete().where(_game_events.c.game_id.in_(sentinel_game_ids)))
    op.execute(_games.delete().where(_games.c.session_id.in_(_SENTINEL_SESSIONS)))


def downgrade() -> None:
    """No-op: a one-way cleanup, like 0026 (owner decision §8.6). The deleted
    rows were never attributable to a player and are not restorable."""
