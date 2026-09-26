"""backfill ``win`` on older Mahjong, Twenty48 and Blackjack rows (#2703, epic #2519)

Revision ID: 0028_backfill_win_outcomes
Revises: 0027_players_display_name
Create Date: 2026-09-26

Mahjong (#2627), Blackjack (#2628) and Twenty48 (#2631) now record ``win`` /
``loss``. Their games from older app builds are stored as ``completed`` (or
``kept_playing`` for Twenty48), so ``/stats/me`` counted none of those wins.
This rewrites a stored row to ``win`` only where its stored result proves the
game was won; every other row is left as it is.

The rules are not repeated here: they are ``games.legacy_outcomes``, which
``games.service.complete_game`` also applies to each row an older build
completes from now on, so the two can't drift apart. That module's docstring
says what each rule is and why it is certain. This is a deliberate exception to
the "literal values, not imported from the app" rule of the other data
migrations: the rules only ever describe builds that are already released.

One set-based ``UPDATE games ... WHERE <rule>`` per game type, the same
statement online and in ``alembic upgrade --sql``. It runs inside the
migration's transaction, so splitting it into batches would hold the same locks
for as long; the affected rows are a small part of ``games``.

Idempotent: every rule requires the old outcome, so a second run matches no row.

Downgrade is a documented no-op: a backfilled ``win`` can't be told apart from a
``win`` a current build recorded.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence

from alembic import context, op
from games.legacy_outcomes import LEGACY_OUTCOMES, win_update

revision: str = "0028_backfill_win_outcomes"
down_revision: str | None = "0027_players_display_name"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_log = logging.getLogger(f"alembic.{revision}")


def upgrade() -> None:
    dialect = op.get_context().dialect.name
    if context.is_offline_mode():
        for game_type in LEGACY_OUTCOMES:
            op.execute(win_update(game_type, dialect))
        return
    bind = op.get_bind()
    changed = {
        game_type: bind.execute(win_update(game_type, dialect)).rowcount
        for game_type in LEGACY_OUTCOMES
    }
    _log.info("backfilled win outcomes: %s", changed)


def downgrade() -> None:
    """No-op: a backfilled ``win`` can't be told apart from one a current build
    recorded, so there is no old value to restore."""
