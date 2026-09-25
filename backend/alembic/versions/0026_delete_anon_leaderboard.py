"""delete legacy `*-anon` leaderboard rows (#2622, epic #2519)

Revision ID: 0026_delete_anon_leaderboard
Revises: 0025_merge_0024_heads
Create Date: 2026-09-25

The seven legacy per-game ``POST /<game>/score`` routes write their rows
under a fixed, unattributable session id (``games/leaderboard.py``'s
``SENTINEL_SESSION_SUFFIX = "-anon"``, e.g. ``solitaire-anon``). They can
never be tied to a real player, and the store build that used them was never
released, so every row under these ids is a test play, not real data.

Owner decision §8.6: delete them in one data migration. The generic board
(#2618) already excludes any ``*-anon`` session from ranking, independently
of this cleanup — this migration only removes the rows from the table.

Literal session ids, not imported from ``games/leaderboard.py``: a migration
must keep meaning what it meant when written, even if that module's sentinel
list changes later (see ``0024_drop_blackjack_outcome`` for the same rule).

``game_events.game_id`` has ``ON DELETE CASCADE`` at the schema level
(``0002_games_events_lookups``), but Alembic's migration engine does not turn
on ``PRAGMA foreign_keys`` for its SQLite connection (unlike the app's own
runtime engine in ``db/base.py``), so that cascade is not guaranteed to fire
here. Events are deleted explicitly first instead of relying on it. No other
table has a foreign key to ``games`` (checked ``game_entitlements``, which
keys on ``session_id`` + ``game_slug``, not ``game_id``).

Downgrade is a documented no-op: the deleted rows cannot be restored, and
there is no schema to revert.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0026_delete_anon_leaderboard"
down_revision: str | None = "0025_merge_0024_heads"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The seven sentinels written by the legacy per-game score routes (#2519
# context on issue #2622): solitaire/router.py, mahjong/router.py,
# hearts/router.py, freecell/router.py, sort/router.py, starswarm/router.py,
# yacht/router.py.
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
    """No-op: per owner decision §8.6 this is a one-way cleanup — the deleted
    rows were never attributable to a player and are not restorable."""
