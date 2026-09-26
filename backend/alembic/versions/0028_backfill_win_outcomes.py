"""backfill ``win`` on older Mahjong, Twenty48 and Blackjack rows (#2703, epic #2519)

Revision ID: 0028_backfill_win_outcomes
Revises: 0027_players_display_name
Create Date: 2026-09-26

Mahjong (#2627), Blackjack (#2628) and Twenty48 (#2631) now record ``win`` /
``loss``. Their games from older app builds are stored as ``completed`` (or
``kept_playing`` for Twenty48), so ``/stats/me`` counted none of those wins.
This rewrites a stored row to ``win`` only where its stored result proves the
game was won; every other row is left as it is.

The rules below are a frozen copy of ``games.legacy_outcomes``, the live copy
that ``games.service.complete_game`` applies to each row an older build
completes from now on. That module's docstring says what each rule is and why
it is certain. The copy is deliberate: a migration must keep meaning what it
meant when written (see ``0026_delete_anon_leaderboard``), so a later edit to
the helper must not change what a fresh ``alembic upgrade`` does here.
``tests/test_legacy_outcomes_parity.py`` checks that both compile to the same
SQL today. Never edit this copy once released.

In short, a row becomes ``win`` when:

* Mahjong: ``completed`` and ``metadata.won`` is JSON ``true``;
* Blackjack: ``completed`` and ``metadata.final_chips`` is a JSON number > 0;
* Twenty48: ``completed`` / ``kept_playing``, ``metadata.highest_tile`` is a
  JSON number >= 2048, and its ``game_started`` event's ``initial_board`` is
  16 JSON numbers all below 2048 (the session that first reached 2048).

Where ``metadata`` has an ``outcome`` key it is set to ``win`` too. No stored
value is ever cast; on SQLite every JSON function reads through ``json_valid``.

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

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

from alembic import context, op

revision: str = "0028_backfill_win_outcomes"
down_revision: str | None = "0027_players_display_name"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_log = logging.getLogger(f"alembic.{revision}")

# ---------------------------------------------------------------------------
# Frozen copy of games.legacy_outcomes as of this revision. Do not edit.
# ---------------------------------------------------------------------------

_JSONB = sa.JSON().with_variant(JSONB(), "postgresql")

WIN = "win"
TWENTY48_WIN_TILE = 2048
_BOARD_CELLS = 16

LEGACY_OUTCOMES: dict[str, tuple[str, ...]] = {
    "mahjong": ("completed",),
    "twenty48": ("completed", "kept_playing"),
    "blackjack": ("completed",),
}

games = sa.table(
    "games",
    sa.column("id", sa.Uuid()),
    sa.column("game_type_id", sa.SmallInteger()),
    sa.column("completed_at", sa.DateTime(timezone=True)),
    sa.column("outcome", sa.Text()),
    sa.column("metadata", _JSONB),
)
_game_types = sa.table("game_types", sa.column("id", sa.SmallInteger()), sa.column("name"))
_game_events = sa.table(
    "game_events",
    sa.column("game_id", sa.Uuid()),
    sa.column("event_type_id", sa.Integer()),
    sa.column("data", _JSONB),
)
_event_types = sa.table("event_types", sa.column("id", sa.Integer()), sa.column("name"))


def _jsonb(text: str) -> sa.ColumnElement:
    return sa.cast(sa.literal(text, sa.Text), JSONB)


def _valid_doc(column: sa.ColumnElement) -> sa.ColumnElement:
    return sa.case((sa.func.json_valid(column) == 1, column))


def _is_json_true(key: str, dialect: str) -> sa.ColumnElement[bool]:
    if dialect == "postgresql":
        return games.c.metadata[key] == _jsonb("true")
    return sa.func.json_type(_valid_doc(games.c.metadata), f"$.{key}") == "true"


def _is_number_over(key: str, bound: int, dialect: str, *, inclusive: bool) -> sa.ColumnElement:
    if dialect == "postgresql":
        node = games.c.metadata[key]
        is_number = sa.func.jsonb_typeof(node) == "number"
        limit = _jsonb(str(bound))
    else:
        doc = _valid_doc(games.c.metadata)
        node = sa.func.json_extract(doc, f"$.{key}")
        is_number = sa.func.json_type(doc, f"$.{key}").in_(("integer", "real"))
        limit = sa.literal(bound)
    return sa.and_(is_number, node >= limit if inclusive else node > limit)


def _started_below_win_tile(dialect: str) -> sa.ColumnElement[bool]:
    ge = _game_events.alias("started_event")
    et = _event_types.alias("started_type")
    if dialect == "postgresql":
        board = ge.c.data["initial_board"]
        cells = sa.case((sa.func.jsonb_typeof(board) == "array", board), else_=_jsonb("[]"))
        tile = (
            sa.func.jsonb_array_elements(cells)
            .table_valued(sa.column("value", JSONB))
            .alias("tile")
        )
        bad_tile = (
            sa.select(sa.literal(1))
            .select_from(tile)
            .where(
                sa.or_(
                    sa.func.jsonb_typeof(tile.c.value) != "number",
                    tile.c.value >= _jsonb(str(TWENTY48_WIN_TILE)),
                )
            )
            .exists()
        )
        board_ok = sa.and_(sa.func.jsonb_array_length(cells) == _BOARD_CELLS, ~bad_tile)
    else:
        doc = _valid_doc(ge.c.data)
        path = "$.initial_board"
        tile = sa.func.json_each(doc, path).table_valued("value", "type").alias("tile")
        bad_tile = (
            sa.select(sa.literal(1))
            .select_from(tile)
            .where(
                sa.or_(
                    tile.c.type.not_in(("integer", "real")),
                    tile.c.value >= TWENTY48_WIN_TILE,
                )
            )
            .exists()
        )
        board_ok = sa.and_(
            sa.func.json_type(doc, path) == "array",
            sa.func.json_array_length(doc, path) == _BOARD_CELLS,
            ~bad_tile,
        )
    return (
        sa.select(sa.literal(1))
        .select_from(ge.join(et, ge.c.event_type_id == et.c.id))
        .where(ge.c.game_id == games.c.id, et.c.name == "game_started", board_ok)
        .exists()
    )


def _win_rule(game_type: str, dialect: str) -> sa.ColumnElement[bool]:
    outcome = games.c.outcome.in_(LEGACY_OUTCOMES[game_type])
    if game_type == "mahjong":
        return sa.and_(outcome, _is_json_true("won", dialect))
    if game_type == "blackjack":
        return sa.and_(outcome, _is_number_over("final_chips", 0, dialect, inclusive=False))
    if game_type == "twenty48":
        return sa.and_(
            outcome,
            _is_number_over("highest_tile", TWENTY48_WIN_TILE, dialect, inclusive=True),
            _started_below_win_tile(dialect),
        )
    raise ValueError(f"no legacy win rule for {game_type!r}")


def _metadata_outcome_win(dialect: str) -> sa.ColumnElement:
    if dialect == "postgresql":
        return sa.func.jsonb_set(
            games.c.metadata,
            sa.cast(sa.literal("{outcome}", sa.Text), ARRAY(sa.Text)),
            _jsonb(f'"{WIN}"'),
            sa.false(),
            type_=_JSONB,
        )
    has_outcome = sa.func.json_type(_valid_doc(games.c.metadata), "$.outcome").is_not(None)
    return sa.case(
        (has_outcome, sa.func.json_replace(games.c.metadata, "$.outcome", WIN)),
        else_=games.c.metadata,
    )


def win_update(game_type: str, dialect: str) -> sa.Update:
    """``UPDATE games`` storing ``win`` on every row of *game_type* the rule matches."""
    game_type_id = (
        sa.select(_game_types.c.id).where(_game_types.c.name == game_type).scalar_subquery()
    )
    return (
        games.update()
        .where(
            games.c.game_type_id == game_type_id,
            games.c.completed_at.is_not(None),
            _win_rule(game_type, dialect),
        )
        .values(outcome=WIN, metadata=_metadata_outcome_win(dialect))
    )


# ---------------------------------------------------------------------------


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
