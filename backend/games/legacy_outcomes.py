"""Older app builds' certain wins, stored as ``win`` (#2703, epic #2519).

Mahjong (#2627), Blackjack (#2628) and Twenty48 (#2631) record ``win`` /
``loss`` now. Builds before those changes record a finished game as
``completed`` (or ``kept_playing`` for Twenty48), and builds still installed
keep doing so. Where the stored result proves that such a game was won, the row
is stored as ``win``, so win counts and streaks in ``/stats/me`` include it.

This is the live copy of the rules, as SQL: ``games.service.complete_game``
runs :func:`win_update` for the one row it just completed, in the same
transaction, so rows from older builds that arrive later are stored as ``win``.
Migration ``0028_backfill_win_outcomes`` applied the same rules once to every
row stored before it, from its own frozen copy (a migration must keep meaning
what it meant when written). ``tests/test_legacy_outcomes_parity.py`` checks
that the two compile to the same SQL; see it before changing a rule here.

The rules (the result block a build sends is merged into ``games.metadata``):

* **Mahjong:** ``completed`` and ``metadata.won`` is JSON ``true``. Older builds
  sent ``won: true`` only for a cleared board.
* **Blackjack:** ``completed`` and ``metadata.final_chips`` is a JSON number
  above 0. Older builds wrote ``completed`` on exactly two paths: out of chips,
  which sends ``final_chips: 0``, and Cash Out, offered only on the Victory
  screen, at or above the run's goal. A bust after Keep Playing (a win under
  #2628) can't be told from a plain bust, and builds before the result block
  (#2450) send no ``final_chips``: those rows stay ``completed``.
* **Twenty48:** ``completed`` / ``kept_playing``, ``metadata.highest_tile`` is a
  JSON number >= 2048, *and* the row's ``game_started`` event holds an
  ``initial_board`` of 16 JSON numbers all below 2048. Older builds closed a
  session with ``kept_playing`` at the win card, and reopening a board that
  already held 2048 opened a new session that could end ``kept_playing`` or
  ``completed`` again, so ``highest_tile`` alone would count one board several
  times. Tiles never shrink, so exactly one session of a board starts below
  2048 and ends at or above it: the one where 2048 was first reached. Every
  build that sends a result block (#2450 on) sends the opening board as the
  ``game_started`` event's ``initial_board`` (``useGameSync.start`` since
  #549, ``gameEventClient.startGame`` since #369). A row whose event is
  missing (evicted from the device queue, or truncated) stays as it is.

Only JSON values of the right type match, and no stored value is ever cast, so
a malformed row can't raise: on Postgres the rules compare ``jsonb`` to
``jsonb`` after ``jsonb_typeof``; on SQLite every JSON function reads the
document through ``json_valid`` first, so text that isn't JSON reads as NULL.

Where ``metadata`` holds an ``outcome`` key (the Twenty48 result block repeats
the row's outcome), it is set to ``win`` too, so the row and its result agree;
a missing key is not added. Every rule requires the old outcome, so running an
update twice changes nothing.
"""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

_JSONB = sa.JSON().with_variant(JSONB(), "postgresql")

WIN = "win"
# The first tile that is a Twenty48 win.
TWENTY48_WIN_TILE = 2048
_BOARD_CELLS = 16

# Per game type, the outcomes older builds recorded for a finish.
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


def might_be_legacy_win(game_type: str, outcome: str | None) -> bool:
    """Cheap pre-check: can a row of this type and outcome match a rule?"""
    return outcome in LEGACY_OUTCOMES.get(game_type, ())


def _jsonb(text: str) -> sa.ColumnElement:
    return sa.cast(sa.literal(text, sa.Text), JSONB)


def _valid_doc(column: sa.ColumnElement) -> sa.ColumnElement:
    """SQLite: the JSON document, or NULL when the text isn't valid JSON."""
    return sa.case((sa.func.json_valid(column) == 1, column))


def _is_json_true(key: str, dialect: str) -> sa.ColumnElement[bool]:
    """``metadata[key]`` is JSON ``true`` (not ``1``, not ``"true"``)."""
    if dialect == "postgresql":
        return games.c.metadata[key] == _jsonb("true")
    return sa.func.json_type(_valid_doc(games.c.metadata), f"$.{key}") == "true"


def _is_number_over(key: str, bound: int, dialect: str, *, inclusive: bool) -> sa.ColumnElement:
    """``metadata[key]`` is a JSON number ``>= bound`` (or ``> bound``)."""
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
    """The row's ``game_started`` event holds an ``initial_board`` of 16 JSON
    numbers, every one below 2048."""
    ge = _game_events.alias("started_event")
    et = _event_types.alias("started_type")
    if dialect == "postgresql":
        board = ge.c.data["initial_board"]
        # jsonb_array_length / jsonb_array_elements raise on a non-array, so
        # they only ever see an array.
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


def win_rule(game_type: str, dialect: str) -> sa.ColumnElement[bool]:
    """The rule for a row of *game_type* that an older build stored for a win."""
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
    """``metadata`` with an existing ``outcome`` key set to ``win`` (never added)."""
    if dialect == "postgresql":
        return sa.func.jsonb_set(
            games.c.metadata,
            sa.cast(sa.literal("{outcome}", sa.Text), ARRAY(sa.Text)),
            _jsonb(f'"{WIN}"'),
            sa.false(),
            type_=_JSONB,
        )
    # Only rewritten when the key is there, so other rows keep their text as is.
    has_outcome = sa.func.json_type(_valid_doc(games.c.metadata), "$.outcome").is_not(None)
    return sa.case(
        (has_outcome, sa.func.json_replace(games.c.metadata, "$.outcome", WIN)),
        else_=games.c.metadata,
    )


def win_update(game_type: str, dialect: str, *, game_id: uuid.UUID | None = None) -> sa.Update:
    """``UPDATE games`` storing ``win`` on the rows of *game_type* the rule
    matches: every such row, or only *game_id*."""
    game_type_id = (
        sa.select(_game_types.c.id).where(_game_types.c.name == game_type).scalar_subquery()
    )
    where = [
        games.c.game_type_id == game_type_id,
        games.c.completed_at.is_not(None),
        win_rule(game_type, dialect),
    ]
    if game_id is not None:
        where.insert(0, games.c.id == game_id)
    return games.update().where(*where).values(outcome=WIN, metadata=_metadata_outcome_win(dialect))
