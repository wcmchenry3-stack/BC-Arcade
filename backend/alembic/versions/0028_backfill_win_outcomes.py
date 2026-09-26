"""backfill ``win`` on older Mahjong, Twenty48 and Blackjack rows (#2703, epic #2519)

Revision ID: 0028_backfill_win_outcomes
Revises: 0027_players_display_name
Create Date: 2026-09-26

Mahjong (#2627), Blackjack (#2628) and Twenty48 (#2631) now record ``win`` /
``loss``. Their games from older app builds are stored as ``completed`` (or
``kept_playing`` for Twenty48), so ``/stats/me`` counted none of those wins.
This rewrites a row to ``win`` only where the stored result says for certain
that the game was won. Every other row is left as it is.

The result block a build sends on ``PATCH /games/{id}/complete`` is merged into
``games.metadata`` (``merge_result_metadata``), so that is where the rules read.

* **Mahjong:** ``outcome = 'completed'`` and ``metadata.won`` is JSON ``true``.
  Older builds sent ``won: true`` only when the board was cleared, and
  ``won: false`` on every other path.
* **Twenty48:** ``outcome`` is ``completed`` or ``kept_playing`` and
  ``metadata.highest_tile`` is a JSON number >= 2048: the 2048 tile was reached,
  which #2631 records as the win. A ``completed`` row below 2048 (or with no
  ``highest_tile``, from builds before the result block) is left alone.
* **Blackjack:** ``outcome = 'completed'`` and ``metadata.final_chips`` is a JSON
  number > 0. Older builds wrote ``completed`` on exactly two paths: running out
  of chips, which sends ``final_chips: 0`` explicitly, and Cash Out, offered only
  on the Victory screen, where the chips are at or above the run's goal (#2628
  counts that as a win). A bust after Keep Playing (a win under #2628, but
  ``final_chips`` 0) can't be told apart from a plain bust, and rows from builds
  before the result block (#2450) carry no ``final_chips``: both stay.

Only JSON values of the right type match. The predicates never cast a stored
value, so a malformed row (a game with no ``result_model`` once took any result
block) cannot raise and fail the migration: on Postgres they compare ``jsonb``
to ``jsonb`` after a ``jsonb_typeof`` check, on SQLite they use ``json_type``.

Batches: per game, the ids of matching rows are read in id order, at most
``_BATCH`` at a time (keyset on ``id``), and each batch is one ``UPDATE ...
WHERE id IN (...)`` that repeats the rule, so a row changed in between is not
touched. It runs inside the migration's transaction, like every migration here.
``alembic upgrade --sql`` cannot read ids back, so offline mode renders one
set-based ``UPDATE`` per game with the same rule instead.

Idempotent: every rule requires the old outcome, so a second run matches no row.

Literal values, not imported from the app: a migration must keep meaning what
it meant when written (see ``0026_delete_anon_leaderboard``).

Downgrade is a documented no-op: a backfilled ``win`` can't be told apart from a
``win`` a current build recorded.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import Connection

from alembic import context, op

revision: str = "0028_backfill_win_outcomes"
down_revision: str | None = "0027_players_display_name"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_log = logging.getLogger(f"alembic.{revision}")

_JSONB = sa.JSON().with_variant(JSONB(), "postgresql")
# Ids per SELECT and per UPDATE ... IN (...). Kept under SQLite's historical
# 999 bound-parameter limit together with the rule's own parameters.
_BATCH = 500
_WIN = "win"

_games = sa.table(
    "games",
    sa.column("id", sa.Uuid()),
    sa.column("game_type_id", sa.SmallInteger()),
    sa.column("completed_at", sa.DateTime(timezone=True)),
    sa.column("outcome", sa.Text()),
    sa.column("metadata", _JSONB),
)
_game_types = sa.table("game_types", sa.column("id", sa.SmallInteger()), sa.column("name"))


def _is_json_true(key: str, dialect: str) -> sa.ColumnElement[bool]:
    """``metadata[key]`` is JSON ``true`` (not ``1``, not ``"true"``)."""
    if dialect == "postgresql":
        return _games.c.metadata[key] == sa.cast(sa.literal("true"), JSONB)
    return sa.func.json_type(_games.c.metadata, f"$.{key}") == "true"


def _is_number_over(key: str, bound: int, dialect: str, *, inclusive: bool) -> sa.ColumnElement:
    """``metadata[key]`` is a JSON number ``>= bound`` (or ``> bound``).

    Postgres: ``jsonb_typeof`` = 'number' AND a ``jsonb`` to ``jsonb``
    comparison, which orders numbers numerically and never casts, so neither
    a string nor a huge number can raise, whatever order the two run in.
    SQLite: ``json_type`` is 'integer' or 'real', then ``json_extract``.
    """
    if dialect == "postgresql":
        node = _games.c.metadata[key]
        is_number = sa.func.jsonb_typeof(node) == "number"
        limit = sa.cast(sa.literal(str(bound)), JSONB)
    else:
        path = f"$.{key}"
        node = sa.func.json_extract(_games.c.metadata, path)
        is_number = sa.func.json_type(_games.c.metadata, path).in_(("integer", "real"))
        limit = sa.literal(bound)
    return sa.and_(is_number, node >= limit if inclusive else node > limit)


def win_rules(dialect: str) -> dict[str, sa.ColumnElement[bool]]:
    """Per game type, the rule for an older row that was certainly a win."""
    outcome = _games.c.outcome
    return {
        "mahjong": sa.and_(outcome == "completed", _is_json_true("won", dialect)),
        "twenty48": sa.and_(
            outcome.in_(("completed", "kept_playing")),
            _is_number_over("highest_tile", 2048, dialect, inclusive=True),
        ),
        "blackjack": sa.and_(
            outcome == "completed",
            _is_number_over("final_chips", 0, dialect, inclusive=False),
        ),
    }


def _where(game_type: str, rule: sa.ColumnElement[bool]) -> sa.ColumnElement[bool]:
    game_type_id = (
        sa.select(_game_types.c.id).where(_game_types.c.name == game_type).scalar_subquery()
    )
    return sa.and_(
        _games.c.game_type_id == game_type_id,
        _games.c.completed_at.is_not(None),
        rule,
    )


def _select_batch(where: sa.ColumnElement[bool], after: object | None) -> sa.Select:
    stmt = sa.select(_games.c.id).where(where).order_by(_games.c.id).limit(_BATCH)
    if after is not None:
        stmt = stmt.where(_games.c.id > after)
    return stmt


def _update_batch(where: sa.ColumnElement[bool], ids: list) -> sa.Update:
    return _games.update().where(_games.c.id.in_(ids), where).values(outcome=_WIN)


def backfill(conn: Connection) -> dict[str, int]:
    """Rewrite the certain wins to ``win`` in batches; rows changed per game type."""
    changed: dict[str, int] = {}
    for game_type, rule in win_rules(conn.dialect.name).items():
        where = _where(game_type, rule)
        after = None
        total = 0
        while True:
            ids = [row[0] for row in conn.execute(_select_batch(where, after))]
            if not ids:
                break
            total += conn.execute(_update_batch(where, ids)).rowcount
            if len(ids) < _BATCH:
                break
            after = ids[-1]
        changed[game_type] = total
    return changed


def upgrade() -> None:
    if context.is_offline_mode():
        # --sql: no ids to read back, so one set-based UPDATE per game type.
        for game_type, rule in win_rules(op.get_context().dialect.name).items():
            op.execute(_games.update().where(_where(game_type, rule)).values(outcome=_WIN))
        return
    changed = backfill(op.get_bind())
    _log.info("backfilled win outcomes: %s", changed)


def downgrade() -> None:
    """No-op: a backfilled ``win`` can't be told apart from one a current build
    recorded, so there is no old value to restore."""
