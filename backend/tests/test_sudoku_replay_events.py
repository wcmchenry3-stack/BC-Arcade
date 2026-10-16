"""Sudoku ``entries`` events: schema, validation hook, storage, caps, migration 0043
(#3288, epic #3273).

The app (``frontend/src/game/sudoku/replay.ts``) records ``entries`` through the
shared GameRecorder. ``fixtures/sudoku_entries_v1.json`` holds the events two real
seeded games produced (pinned by ``replay.fixture.test.ts``), so a rejection of one
of them here would drop a real game's replay.
"""

from __future__ import annotations

import copy
import json
import logging
import sqlite3
import uuid
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from db.base import get_session_factory
from db.models import GameEntitlement, GameEvent
from games.registry import get_module
from games.replay_caps import DEFAULT_CAP, ROW_OVERHEAD_BYTES, apply_cap, cap_for, event_bytes
from main import app
from observability import report
from sudoku.models import (
    MAX_ENTRIES_BYTES,
    MAX_ENTRIES_PER_EVENT,
    OP_DIGIT,
    OP_ERASE,
    OP_HINT,
    OP_NOTE,
    OP_UNDO,
    validate_entries,
)
from tests._helpers import session_headers as _headers
from tests._migration_helpers import Alembic

client = TestClient(app)

_FIXTURE = Path(__file__).parent / "fixtures" / "sudoku_entries_v1.json"
_SID = str(uuid.uuid4())
_UNDO_LIMIT = 50  # UNDO_STACK_LIMIT in frontend/src/game/sudoku/types.ts


def _games() -> dict[str, dict[str, Any]]:
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))


def _entries_events(game: dict[str, Any]) -> list[dict[str, Any]]:
    return [e for e in game["events"] if e["type"] == "entries"]


def _chunk(entries: list[list[int]], **overrides: Any) -> dict[str, Any]:
    return {"v": 1, "unit": 1, "t_ms": 1000, "i": 0, "e": entries, **overrides}


@pytest.fixture(autouse=True)
def _fresh_drop_throttles(monkeypatch) -> None:
    monkeypatch.setattr("sudoku.models._drop_throttles", {})


@pytest.fixture
def sentry_messages(monkeypatch) -> list[tuple[str, dict]]:
    calls: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        report.sentry_sdk, "capture_message", lambda message, **kw: calls.append((message, kw))
    )
    return calls


# ---------------------------------------------------------------------------
# a reader of the format, in Python: the givens + the entries -> the final grid
# ---------------------------------------------------------------------------


def rebuild(  # noqa: C901 - one branch per op, mirrors the format
    puzzle: str, events: list[dict[str, Any]]
) -> tuple[str, dict[str, str], int]:
    """(values, notes by cell, errors) from the givens and the ``entries`` events alone."""
    values = [int(c) for c in puzzle]
    size = 6 if len(puzzle) == 36 else 9
    box_rows, box_cols = (2, 3) if size == 6 else (3, 3)

    def peer(a: int, b: int) -> bool:
        (ra, ca), (rb, cb) = divmod(a, size), divmod(b, size)
        if a == b:
            return False
        return (
            ra == rb
            or ca == cb
            or (ra // box_rows == rb // box_rows and ca // box_cols == cb // box_cols)
        )

    notes: list[set[int]] = [set() for _ in values]
    errors = 0
    stack: list[tuple[list[int], list[set[int]], int]] = []
    applied = 0

    def push() -> None:
        stack.append((list(values), [set(n) for n in notes], errors))
        if len(stack) > _UNDO_LIMIT:
            stack.pop(0)

    for event in events:
        data = event["data"]
        assert data["i"] == applied, "hole in the entries"
        for entry in data["e"]:
            applied += 1
            op = entry[0]
            if op == OP_DIGIT:
                push()
                values[entry[1]] = entry[2]
                notes[entry[1]].clear()
                if len(entry) == 4:
                    errors += 1
            elif op == OP_NOTE:
                notes[entry[1]] ^= {entry[2]}
                # the engine also trims the digit from a peer that holds it as its value
                for other, v in enumerate(values):
                    if v == entry[2] and peer(entry[1], other):
                        notes[other].discard(entry[2])
            elif op == OP_ERASE:
                push()
                values[entry[1]] = 0
                notes[entry[1]].clear()
            elif op == OP_UNDO:
                values, notes, errors = stack.pop()
            elif op == OP_HINT:
                push()
                values[entry[1]] = entry[2]
                notes[entry[1]].clear()
            else:  # pragma: no cover - the validator keeps these out
                raise AssertionError(op)
    return (
        "".join(map(str, values)),
        {str(i): "".join(map(str, sorted(n))) for i, n in enumerate(notes) if n},
        errors,
    )


# ---------------------------------------------------------------------------
# the real payloads
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("name", ["classic_hard", "mini_easy"])
def test_every_event_the_app_really_records_validates_and_is_stored_as_sent(name: str) -> None:
    game = _games()[name]
    events = _entries_events(game)
    assert len(events) >= 1
    for event in events:
        assert len(json.dumps(event["data"], separators=(",", ":"))) <= MAX_ENTRIES_BYTES
        assert validate_entries(event["data"]) == event["data"]
        assert get_module("sudoku").validate_event("entries", event["data"]) == event["data"]


@pytest.mark.parametrize("name", ["classic_hard", "mini_easy"])
def test_the_givens_and_the_entries_rebuild_the_recorded_final_grid(name: str) -> None:
    game = _games()[name]
    values, notes, errors = rebuild(game["game_started"]["puzzle"], _entries_events(game))
    assert values == game["final"]["values"]
    assert notes == game["final"]["notes"]
    assert errors == game["final"]["errors"]


def test_the_fixture_covers_every_op_and_the_wrong_entry_flag() -> None:
    seen: set[int] = set()
    flagged = 0
    for game in _games().values():
        for event in _entries_events(game):
            for entry in event["data"]["e"]:
                seen.add(entry[0])
                flagged += len(entry) == 4
    assert seen == {OP_DIGIT, OP_NOTE, OP_ERASE, OP_UNDO, OP_HINT}
    assert flagged >= 2


def test_game_started_carries_the_givens_and_stays_valid_metadata() -> None:
    """The puzzle is in the event only: SudokuMetadata forbids unknown keys."""
    from sudoku.models import SudokuMetadata

    for game in _games().values():
        started = game["game_started"]
        assert len(started["puzzle"]) == (36 if started["variant"] == "mini" else 81)
        assert set(started["puzzle"]) <= set("0123456789")
        SudokuMetadata(difficulty=started["difficulty"], variant=started["variant"])
        # stored as sent, like every lifecycle event
        assert get_module("sudoku").validate_event("game_started", started) == started


# ---------------------------------------------------------------------------
# validation: what is rejected
# ---------------------------------------------------------------------------

_OK = _chunk([[OP_DIGIT, 0, 5], [OP_NOTE, 80, 9], [OP_ERASE, 3], [OP_UNDO], [OP_HINT, 4, 1]])


def test_a_valid_chunk_with_every_shape_is_accepted() -> None:
    assert validate_entries(copy.deepcopy(_OK)) == _OK
    assert validate_entries(_chunk([[OP_DIGIT, 7, 3, 1]])) is not None  # the wrong-entry flag


_INVALID = {
    "empty": lambda d: d.clear(),
    "no entries": lambda d: d.__setitem__("e", []),
    "entries is not a list": lambda d: d.__setitem__("e", "x"),
    "an entry is not a list": lambda d: d["e"].__setitem__(0, 5),
    "an empty entry": lambda d: d["e"].__setitem__(0, []),
    "unknown op": lambda d: d["e"].__setitem__(0, [9, 1, 1]),
    "negative op": lambda d: d["e"].__setitem__(0, [-1]),
    "digit with no digit": lambda d: d["e"].__setitem__(0, [OP_DIGIT, 4]),
    "digit with a 5th number": lambda d: d["e"].__setitem__(0, [OP_DIGIT, 4, 5, 1, 0]),
    "a flag on a note": lambda d: d["e"].__setitem__(0, [OP_NOTE, 4, 5, 1]),
    "a flag that is not 1": lambda d: d["e"].__setitem__(0, [OP_DIGIT, 4, 5, 2]),
    "a flag of 0": lambda d: d["e"].__setitem__(0, [OP_DIGIT, 4, 5, 0]),
    "erase with a digit": lambda d: d["e"].__setitem__(0, [OP_ERASE, 4, 5]),
    "undo with a cell": lambda d: d["e"].__setitem__(0, [OP_UNDO, 4]),
    "cell off the grid": lambda d: d["e"].__setitem__(0, [OP_DIGIT, 81, 5]),
    "negative cell": lambda d: d["e"].__setitem__(0, [OP_DIGIT, -1, 5]),
    "digit 0": lambda d: d["e"].__setitem__(0, [OP_DIGIT, 4, 0]),
    "digit 10": lambda d: d["e"].__setitem__(0, [OP_NOTE, 4, 10]),
    "a float": lambda d: d["e"].__setitem__(0, [OP_DIGIT, 4.0, 5]),
    "a string": lambda d: d["e"].__setitem__(0, [OP_DIGIT, "4", 5]),
    "a bool": lambda d: d["e"].__setitem__(0, [OP_DIGIT, 4, True]),
    "a bool op": lambda d: d["e"].__setitem__(0, [False, 4, 5]),
    "too many entries": lambda d: d.__setitem__("e", [[OP_UNDO]] * (MAX_ENTRIES_PER_EVENT + 1)),
    "missing v": lambda d: d.pop("v"),
    "v is 2": lambda d: d.__setitem__("v", 2),
    "v is true": lambda d: d.__setitem__("v", True),
    "v is a string": lambda d: d.__setitem__("v", "1"),
    "missing i": lambda d: d.pop("i"),
    "negative i": lambda d: d.__setitem__("i", -1),
    "i beyond int32": lambda d: d.__setitem__("i", 2**31),
    "missing unit": lambda d: d.pop("unit"),
    "missing t_ms": lambda d: d.pop("t_ms"),
    "t_ms beyond int32": lambda d: d.__setitem__("t_ms", 2**31),
    "an unknown key": lambda d: d.__setitem__("extra", 1),
    "a part number (entries are never split)": lambda d: d.__setitem__("part", 0),
}


@pytest.mark.parametrize("mutate", _INVALID.values(), ids=_INVALID.keys())
def test_an_invalid_chunk_is_dropped_and_reported(mutate, sentry_messages) -> None:
    data = copy.deepcopy(_OK)
    mutate(data)
    assert validate_entries(data) is None
    assert [m for m, _ in sentry_messages] == ["sudoku event: entries invalid"]


def test_an_oversize_chunk_is_dropped_and_reported(sentry_messages) -> None:
    data = _chunk([[OP_DIGIT, 80, 9, 1]] * 50)  # valid, but over the byte cap
    assert len(json.dumps(data, separators=(",", ":"))) > MAX_ENTRIES_BYTES
    assert validate_entries(data) is None
    assert [m for m, _ in sentry_messages] == ["sudoku event: entries oversize"]


def test_a_chunk_at_the_cap_is_kept() -> None:
    data = _chunk([[OP_DIGIT, 80, 9, 1]] * 32, unit=99_999, t_ms=2**31 - 1, i=2**31 - 1)
    size = len(json.dumps(data, separators=(",", ":")))
    assert size <= MAX_ENTRIES_BYTES
    assert validate_entries(data) == data
    # and the cap is not the binding limit for the app's biggest chunk: it has room to spare
    assert size < MAX_ENTRIES_BYTES * 0.85


def test_drop_reports_are_throttled_per_reason(sentry_messages) -> None:
    bad = _chunk([[OP_DIGIT, 99, 5]])
    for _ in range(5):
        assert validate_entries(copy.deepcopy(bad)) is None
    assert [m for m, _ in sentry_messages] == ["sudoku event: entries invalid"]
    big = _chunk([[OP_DIGIT, 80, 9, 1]] * 50)
    assert validate_entries(big) is None  # another reason: its own report
    assert [m for m, _ in sentry_messages][-1] == "sudoku event: entries oversize"


def test_there_is_a_single_alembic_head() -> None:
    from tests._alembic_heads import script_heads

    assert len(script_heads()) == 1


def test_a_dropped_event_is_logged_without_its_values(
    caplog: pytest.LogCaptureFixture, sentry_messages
) -> None:
    data = copy.deepcopy(_OK)
    data["e"][0] = [OP_DIGIT, 123456, 5]
    with caplog.at_level(logging.WARNING, logger="sudoku.models"):
        assert validate_entries(data) is None
    assert "dropped an invalid entries event" in caplog.text
    assert "123456" not in caplog.text
    assert all("123456" not in json.dumps(kw, default=str) for _, kw in sentry_messages)


def test_unserialisable_data_is_dropped_not_raised(sentry_messages) -> None:
    assert validate_entries({"v": 1, "e": {1, 2}}) is None  # type: ignore[dict-item]


def test_the_other_events_of_the_game_pass_through() -> None:
    module = get_module("sudoku")
    assert module.validate_event("game_started", {"anything": [1]}) == {"anything": [1]}
    assert module.validate_event("game_ended", {}) == {}


# ---------------------------------------------------------------------------
# append_events
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
async def _entitlements():
    factory = get_session_factory()
    async with factory() as db:
        for slug in ("sudoku", "yacht"):
            db.add(GameEntitlement(session_id=_SID, game_slug=slug))
        await db.commit()


def _new_game(game_type: str, metadata: dict[str, Any] | None = None) -> str:
    body: dict[str, Any] = {"game_type": game_type}
    if metadata is not None:
        body["metadata"] = metadata
    r = client.post("/games", headers=_headers(_SID), json=body)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _post(gid: str, events: list[dict]):
    return client.post(f"/games/{gid}/events", headers=_headers(_SID), json={"events": events})


async def _stored(gid: str) -> list[GameEvent]:
    async with get_session_factory()() as db:
        rows = await db.execute(
            select(GameEvent)
            .where(GameEvent.game_id == uuid.UUID(gid))
            .order_by(GameEvent.event_index)
        )
        return list(rows.scalars())


async def test_a_whole_recorded_game_is_stored_in_order() -> None:
    game = _games()["classic_hard"]
    gid = _new_game("sudoku", {"difficulty": "hard", "variant": "classic"})
    events = [{"event_index": 0, "event_type": "game_started", "data": game["game_started"]}]
    for n, e in enumerate(_entries_events(game), start=1):
        events.append({"event_index": n, "event_type": "entries", "data": e["data"]})
    r = _post(gid, events)
    assert r.status_code == 200, r.text
    assert r.json()["accepted"] == len(events)
    rows = await _stored(gid)
    assert [row.data for row in rows[1:]] == [e["data"] for e in _entries_events(game)]
    assert rows[0].data["puzzle"] == game["game_started"]["puzzle"]
    values, _, _ = rebuild(rows[0].data["puzzle"], [{"data": row.data} for row in rows[1:]])
    assert values == game["final"]["values"]


async def test_a_mixed_batch_stores_the_valid_chunks_and_drops_the_bad_one(sentry_messages) -> None:
    gid = _new_game("sudoku", {"difficulty": "easy"})
    bad = _chunk([[OP_DIGIT, 99, 5]], i=1)
    r = _post(
        gid,
        [
            {"event_index": 0, "event_type": "entries", "data": _chunk([[OP_DIGIT, 1, 5]])},
            {"event_index": 1, "event_type": "entries", "data": bad},
            {"event_index": 2, "event_type": "game_ended", "data": {"score": 10}},
        ],
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"accepted": 2, "duplicates": 0, "rejected": [], "dropped": 0}
    assert [e.event_index for e in await _stored(gid)] == [0, 2]
    assert [m for m, _ in sentry_messages] == ["sudoku event: entries invalid"]


def test_entries_is_not_an_event_type_of_other_games() -> None:
    gid = _new_game("yacht")
    r = _post(gid, [{"event_index": 0, "event_type": "entries", "data": _chunk([[OP_UNDO]])}])
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# cost: bytes per game, against the caps
# ---------------------------------------------------------------------------


def _heavy_chunks(entries: int) -> list[dict[str, Any]]:
    """`entries` typical entries ([1, cell, digit]: a note) in the app's chunks of 32."""
    out = []
    for first in range(0, entries, 32):
        n = min(32, entries - first)
        e = [[OP_NOTE, 40 + (first + k) % 41, 1 + (first + k) % 9] for k in range(n)]
        out.append(_chunk(e, unit=first // 32 + 1, t_ms=600_000 + first, i=first))
    return out


def test_a_heavy_game_costs_a_few_kilobytes_against_the_40k_epic_budget() -> None:
    """315 entries (the bench's heavy hard game): 10 rows, ~6 KB with the 200 B row overhead."""
    chunks = _heavy_chunks(315)
    assert len(chunks) == 10
    total = sum(event_bytes(c) for c in chunks)
    assert total < 8 * 1024
    assert total < 40 * 1024 / 4  # well under the epic's ~40 KB per uploaded game
    assert apply_cap(DEFAULT_CAP, 0, 0, [event_bytes(c) for c in chunks]).dropped == 0


def test_the_real_fixture_game_is_a_fraction_of_the_budget() -> None:
    for game in _games().values():
        total = sum(event_bytes(e["data"]) for e in _entries_events(game))
        assert total < 2 * 1024


def test_a_game_at_the_devices_session_cap_still_fits_the_default_game_cap() -> None:
    """The device stops recording at 64 KB of JSON (DEFAULT_RECORDING_CONFIG.sessionMaxBytes),
    so a marathon game of notes is bounded there; stored (jsonb text, +200 B a row) it is
    inside DEFAULT_CAP (500 events / 160 KB), so Sudoku needs no cap of its own."""
    session_cap = 64 * 1024
    one = _chunk([[OP_DIGIT, 80, 9, 1]] * 32, unit=99_999, t_ms=2**31 - 1, i=2**31 - 1)
    # a long game's chunks: the longest numbers every time (an over-estimate)
    per_chunk_json = len(json.dumps(one, separators=(",", ":")))
    chunks = session_cap // per_chunk_json
    sizes = [event_bytes(one)] * chunks
    decision = apply_cap(cap_for("sudoku"), 0, 0, sizes)
    assert cap_for("sudoku") is DEFAULT_CAP
    assert decision.dropped == 0
    assert len(sizes) < DEFAULT_CAP.max_events
    assert sum(sizes) < DEFAULT_CAP.max_bytes
    assert ROW_OVERHEAD_BYTES * chunks < sum(sizes)


_MAX_REPLAY_ROWS = 50  # MAX_REPLAY_ROWS in frontend/src/game/sudoku/replay.ts


def test_a_flush_spammed_game_is_bounded_by_the_app_row_limit() -> None:
    """The app hands over a row per leave, so rows are bounded, not only bytes: at the limit
    the worst possible rows (all full, longest numbers) and the tiniest (one entry) both stay
    under the epic's ~40 KB per game and far under DEFAULT_CAP's 500 events."""
    tiny = _chunk([[OP_UNDO]], unit=99_999, t_ms=2**31 - 1, i=2**31 - 1)
    worst = _chunk([[OP_DIGIT, 80, 9, 1]] * 32, unit=99_999, t_ms=2**31 - 1, i=2**31 - 1)
    assert _MAX_REPLAY_ROWS * event_bytes(tiny) < 16 * 1024
    assert _MAX_REPLAY_ROWS * event_bytes(worst) < 40 * 1024
    assert DEFAULT_CAP.max_events >= _MAX_REPLAY_ROWS * 10
    sizes = [event_bytes(worst)] * _MAX_REPLAY_ROWS
    assert apply_cap(DEFAULT_CAP, 0, 0, sizes).dropped == 0


# ---------------------------------------------------------------------------
# migration 0043
# ---------------------------------------------------------------------------

_BEFORE = "0041_mahjong_replay_events"
_REVISION = "0043_sudoku_replay_events"


def _event_names(db_path: Path) -> list[str]:
    with sqlite3.connect(db_path) as conn:
        return [
            r[0]
            for r in conn.execute(
                "SELECT name FROM event_types WHERE game_type_id = 8 ORDER BY name"
            )
        ]


def test_the_migration_adds_and_removes_only_the_entries_event(
    migration_db_path: Path, alembic: Alembic
) -> None:
    alembic("upgrade", _BEFORE)
    before = _event_names(migration_db_path)
    assert "entries" not in before

    alembic("upgrade", _REVISION)
    with sqlite3.connect(migration_db_path) as conn:
        row = conn.execute(
            "SELECT display_name FROM event_types WHERE game_type_id = 8 AND name = 'entries'"
        ).fetchone()
        # a stored entries event, to prove the downgrade clears its dependants
        et = conn.execute(
            "SELECT id FROM event_types WHERE game_type_id = 8 AND name = 'entries'"
        ).fetchone()[0]
        keep = conn.execute(
            "SELECT id FROM event_types WHERE game_type_id = 8 AND name = 'game_ended'"
        ).fetchone()[0]
        gid = uuid.uuid4().hex
        conn.execute(
            "INSERT INTO games (id, session_id, game_type_id, metadata) VALUES (?, 's', 8, '{}')",
            (gid,),
        )
        for idx, type_id in ((0, et), (1, keep)):
            conn.execute(
                "INSERT INTO game_events (game_id, event_index, event_type_id, data) "
                "VALUES (?, ?, ?, '{}')",
                (gid, idx, type_id),
            )
    assert row == ("Entries",)
    assert _event_names(migration_db_path) == sorted([*before, "entries"])

    alembic("downgrade", "-1")
    assert _event_names(migration_db_path) == before
    with sqlite3.connect(migration_db_path) as conn:
        assert conn.execute("SELECT event_index FROM game_events").fetchall() == [(1,)]
        # the other games' event types are untouched
        assert conn.execute(
            "SELECT COUNT(*) FROM event_types WHERE name = 'entries'"
        ).fetchone() == (0,)
