"""Daily Word ``guess_submitted`` event: schema, validation hook, storage, replay (#3287).

``fixtures/daily_word_guess_events_v1.json`` is a scripted game exactly as the
app records it (the app's ``replay.fixture.test.ts`` fails when its output
differs), so these tests run against the real payloads. ``guess_submitted`` has
been seeded since migration 0017 and no build ever sent it: there is no older
shape to keep and no migration.
"""

from __future__ import annotations

import copy
import json
import logging
import uuid
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from daily_word import guess_event
from daily_word.guess_event import MAX_GUESS_BYTES, validate_guess
from daily_word.progress import MAX_GUESSES, record_guess
from daily_word.replay import rebuild, render_board
from db.base import get_session_factory
from db.models import DailyWordProgress, GameEvent
from games.module_base import GameModuleBase
from games.registry import get_module
from games.replay_caps import (
    DAILY_WORD_CAP,
    DEFAULT_CAP,
    RETENTION_KEEP_NAMES,
    ROW_OVERHEAD_BYTES,
    cap_for,
)
from main import app
from observability import report
from payload_size import jsonb_bytes
from tests._helpers import session_headers as _headers

client = TestClient(app)

_FIXTURE = Path(__file__).parent / "fixtures" / "daily_word_guess_events_v1.json"
_SID = str(uuid.uuid4())

# The app's own bounds (frontend/src/game/daily_word/replay.ts): refusals recorded per puzzle.
APP_MAX_RECORDED_REJECTIONS = 10


def _fixture() -> dict[str, Any]:
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))


def _events() -> list[dict[str, Any]]:
    return [e["data"] for e in _fixture()["events"]]


def _scored() -> dict[str, Any]:
    return copy.deepcopy(_events()[1])  # crane, accepted


def _refused() -> dict[str, Any]:
    return copy.deepcopy(_events()[0])  # zzzzz, not a word


@pytest.fixture(autouse=True)
def _fresh_report_throttles() -> None:
    guess_event._throttles.clear()


@pytest.fixture
def sentry_messages(monkeypatch) -> list[tuple[str, dict]]:
    calls: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        report.sentry_sdk, "capture_message", lambda message, **kw: calls.append((message, kw))
    )
    return calls


# ---------------------------------------------------------------------------
# the schema, against the real payloads
# ---------------------------------------------------------------------------


def test_every_real_payload_in_the_fixture_is_stored_as_sent() -> None:
    fixture = _fixture()
    assert {e["type"] for e in fixture["events"]} == {"guess_submitted"}
    for e in fixture["events"]:
        assert validate_guess(copy.deepcopy(e["data"])) == e["data"]


def test_the_fixture_has_both_kinds_of_attempt_and_both_refusals() -> None:
    data = _events()
    assert {d.get("rej") for d in data} == {None, "nw", "dup"}
    assert any("t" in d for d in data)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.update(v=2),
        lambda d: d.update(v=True),
        lambda d: d.update(v="1"),
        lambda d: d.update(n=0),
        lambda d: d.update(n=7),
        lambda d: d.update(n=True),
        lambda d: d.update(n="1"),
        lambda d: d.update(unit=-1),
        lambda d: d.update(t_ms=-5),
        lambda d: d.update(t_ms=2**31),
        lambda d: d.update(g=""),
        lambda d: d.update(g=5),
        lambda d: d.update(g="x" * 49),
        lambda d: d.update(t="ccccz"),
        lambda d: d.update(t="CCCCC"),
        lambda d: d.update(t=""),
        lambda d: d.update(t="c" * 17),
        lambda d: d.update(t=["c"]),
        lambda d: d.update(rej="nw"),  # t and rej together
        lambda d: d.pop("t"),  # neither
        lambda d: d.update(answer="slate"),  # unknown key
        lambda d: d.pop("v"),
        lambda d: d.pop("n"),
        lambda d: d.pop("g"),
    ],
)
def test_a_malformed_scored_guess_is_dropped_and_reported(mutate, sentry_messages) -> None:
    data = _scored()
    mutate(data)
    assert validate_guess(data) is None
    assert [m for m, _ in sentry_messages] == ["daily_word event: guess_submitted invalid"]


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.update(rej="other"),
        lambda d: d.update(rej=1),
        lambda d: d.update(rej=""),
        lambda d: d.update(t="ccccc"),  # both
        lambda d: d.pop("rej"),  # neither
    ],
)
def test_a_malformed_refusal_is_dropped(mutate, sentry_messages) -> None:
    data = _refused()
    mutate(data)
    assert validate_guess(data) is None


def test_an_oversize_payload_is_dropped_and_reported_by_reason_only(
    sentry_messages, caplog: pytest.LogCaptureFixture
) -> None:
    data = _scored()
    data["pad"] = "y" * MAX_GUESS_BYTES
    with caplog.at_level(logging.WARNING, logger="daily_word.guess_event"):
        assert validate_guess(data) is None
    assert "oversize guess_submitted" in caplog.text
    ((message, kw),) = sentry_messages
    assert message == "daily_word event: guess_submitted oversize"
    assert "y" * 20 not in json.dumps(kw, default=str)


def test_the_largest_legal_event_is_under_the_cap() -> None:
    # g at its longest, in 3-byte Hindi code points; t at its longest.
    data = _scored()
    data.update(g="आ" * 48, t="c" * 16, unit=2**31 - 1, t_ms=2**31 - 1)
    assert (
        len(json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode()) < MAX_GUESS_BYTES
    )
    assert validate_guess(data) == data


def test_drop_reports_are_throttled_per_reason(sentry_messages) -> None:
    for _ in range(5):
        bad = _scored()
        bad["n"] = 9
        assert validate_guess(bad) is None
    big = _scored()
    big["pad"] = "y" * MAX_GUESS_BYTES
    assert validate_guess(big) is None
    # five invalid drops: one report; the oversize drop is its own reason
    assert [m for m, _ in sentry_messages] == [
        "daily_word event: guess_submitted invalid",
        "daily_word event: guess_submitted oversize",
    ]


def test_an_unserialisable_payload_is_dropped(sentry_messages) -> None:
    data = _scored()
    data["g"] = float("nan")
    assert validate_guess(data) is None


def test_the_error_report_carries_error_types_not_values(sentry_messages) -> None:
    data = _scored()
    data["g"] = "SECRET-VALUE-" + "x" * 5
    data["n"] = 99
    validate_guess(data)
    ((_, kw),) = sentry_messages
    assert "SECRET-VALUE" not in json.dumps(kw, default=str)
    assert kw["extras"]["error_types"]


# ---------------------------------------------------------------------------
# the module hook
# ---------------------------------------------------------------------------


def test_the_module_validates_guess_submitted_and_passes_lifecycle_through() -> None:
    module = get_module("daily_word")
    assert module is not None
    assert module.validate_event("guess_submitted", {}) is None
    assert module.validate_event("guess_submitted", _scored()) == _scored()
    for name in ("game_started", "game_ended"):
        assert module.validate_event(name, {"puzzle_id": "x", "any": 1}) == {
            "puzzle_id": "x",
            "any": 1,
        }


def test_other_games_hooks_are_untouched() -> None:
    assert GameModuleBase.validate_event(get_module("yacht"), "guess_submitted", {}) == {}  # type: ignore[arg-type]
    assert guess_event.GUESS_SUBMITTED == "guess_submitted"


# ---------------------------------------------------------------------------
# append_events
# ---------------------------------------------------------------------------


def _new_game(game_type: str = "daily_word") -> str:
    body: dict[str, Any] = {"game_type": game_type}
    if game_type == "daily_word":
        body["metadata"] = {"puzzle_id": "2026-05-03:en", "language": "en"}
    r = client.post("/games", headers=_headers(_SID), json=body)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _post(gid: str, events: list[dict]):
    return client.post(f"/games/{gid}/events", headers=_headers(_SID), json={"events": events})


def _as_batch(data: list[dict[str, Any]], start: int = 0) -> list[dict[str, Any]]:
    return [
        {"event_index": start + i, "event_type": "guess_submitted", "data": d}
        for i, d in enumerate(data)
    ]


async def _stored(gid: str) -> list[GameEvent]:
    async with get_session_factory()() as db:
        rows = await db.execute(
            select(GameEvent)
            .where(GameEvent.game_id == uuid.UUID(gid))
            .order_by(GameEvent.event_index)
        )
        return list(rows.scalars())


async def test_a_real_game_is_stored_in_order_exactly_as_sent() -> None:
    gid = _new_game()
    r = _post(gid, _as_batch(_events()))
    assert r.status_code == 200, r.text
    assert r.json() == {"accepted": 6, "duplicates": 0, "rejected": [], "dropped": 0}
    rows = await _stored(gid)
    assert [e.event_index for e in rows] == list(range(6))
    assert [e.data for e in rows] == _events()


async def test_a_bad_event_is_dropped_and_cuts_the_replay_there(
    sentry_messages, caplog: pytest.LogCaptureFixture
) -> None:
    """Every server-side drop of a replay row cuts the replay at it (the stored
    replay is always a prefix by index, #3318), so the event after the bad one
    is not stored either; the batch still succeeds, so the app's queue drains."""
    gid = _new_game()
    bad = _scored()
    bad["n"] = 9
    batch = _as_batch([_events()[0], bad, _events()[1]])
    with caplog.at_level(logging.WARNING, logger="daily_word.guess_event"):
        r = _post(gid, batch)
    assert r.status_code == 200, r.text
    assert r.json()["accepted"] == 1
    assert r.json()["rejected"] == []
    assert [e.event_index for e in await _stored(gid)] == [0]
    assert "dropped an invalid guess_submitted" in caplog.text
    assert [m for m, _ in sentry_messages] == ["daily_word event: guess_submitted invalid"]


async def test_lifecycle_events_are_stored_unchanged() -> None:
    gid = _new_game()
    start = {"event_index": 0, "event_type": "game_started", "data": {"puzzle_id": "2026-05-03:en"}}
    end = {"event_index": 1, "event_type": "game_ended", "data": {"anything": [1, 2]}}
    assert _post(gid, [start, end]).json()["accepted"] == 2
    assert [e.data for e in await _stored(gid)] == [start["data"], end["data"]]


def test_guess_submitted_is_not_an_event_type_of_other_games() -> None:
    gid = _new_game("yacht")
    r = _post(gid, _as_batch([_scored()]))
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# cost: bytes per game, the cap, retention
# ---------------------------------------------------------------------------


def test_the_byte_arithmetic_behind_the_cap() -> None:
    sizes = [jsonb_bytes(d) for d in _events()]
    # The scripted game: 6 events, about 70 B each, + 200 B of row overhead each.
    assert sum(sizes) == 416
    assert sum(s + ROW_OVERHEAD_BYTES for s in sizes) == 1_616
    # The largest real event: a five-letter Hindi guess at the largest numbers.
    worst = jsonb_bytes({"n": 6, "g": "आआआआआ", "t": "ccccc", "v": 1, "unit": 6, "t_ms": 2**31 - 1})
    assert worst == 85
    per_row = worst + ROW_OVERHEAD_BYTES
    # The worst game the app sends: 6 scored guesses + the refusal budget.
    app_worst = (6 + APP_MAX_RECORDED_REJECTIONS) * per_row
    assert app_worst == 4_560
    # ... and when it is resumed after a kill, the refusal budget starts again.
    resumed_worst = (6 + 2 * APP_MAX_RECORDED_REJECTIONS) * per_row
    assert resumed_worst == 7_410
    assert cap_for("daily_word") is DAILY_WORD_CAP
    assert DAILY_WORD_CAP.max_events == 32
    assert DAILY_WORD_CAP.max_bytes == 9_600
    assert resumed_worst <= DAILY_WORD_CAP.max_bytes
    assert DAILY_WORD_CAP.max_events >= 6 + 2 * APP_MAX_RECORDED_REJECTIONS
    # It is a tighter ceiling than the default, by a lot.
    assert DAILY_WORD_CAP.max_bytes < DEFAULT_CAP.max_bytes // 10


def test_retention_keeps_guess_submitted() -> None:
    # Daily Word stats depend on it (#3279 / owner decision #3317).
    assert "guess_submitted" in RETENTION_KEEP_NAMES


async def test_a_flood_of_guesses_stops_at_the_games_cap() -> None:
    gid = _new_game()
    flood = [copy.deepcopy(_events()[0]) for _ in range(DAILY_WORD_CAP.max_events + 20)]
    r = _post(gid, _as_batch(flood))
    assert r.status_code == 200, r.text
    rows = await _stored(gid)
    assert len(rows) == DAILY_WORD_CAP.max_events
    assert [e.event_index for e in rows] == list(range(DAILY_WORD_CAP.max_events))


# ---------------------------------------------------------------------------
# replay: the board rebuilt from the events alone
# ---------------------------------------------------------------------------


def _pairs() -> list[tuple[str, dict[str, Any]]]:
    return [(e["type"], e["data"]) for e in _fixture()["events"]]


def test_the_fixture_rebuilds_to_a_won_board() -> None:
    board = rebuild(_pairs())
    assert board.problems == []
    assert board.guesses == _fixture()["scored_guesses"]
    assert (board.won, board.complete) == (True, True)
    assert board.refused == [(1, "zzzzz", "nw"), (2, "crane", "dup")]


async def test_the_rebuilt_guesses_are_what_daily_word_progress_holds() -> None:
    sid = str(uuid.uuid4())
    puzzle = _fixture()["puzzle"]["puzzle_id"]
    fixture = _fixture()
    async with get_session_factory()() as db:
        for guess in fixture["scored_guesses"]:
            await record_guess(
                db, session_id=sid, puzzle_id=puzzle, guess=guess, won=guess == fixture["answer"]
            )
    async with get_session_factory()() as db:
        row = (
            await db.execute(select(DailyWordProgress).where(DailyWordProgress.session_id == sid))
        ).scalar_one()
    board = rebuild(_pairs())
    assert board.guesses == list(row.guesses)
    assert board.won is bool(row.solved)
    assert len(board.rows) <= MAX_GUESSES


def test_a_lost_game_is_complete_after_six_rows() -> None:
    words = ["crane", "least", "stale", "plate", "slant", "slats"]
    events = [
        ("guess_submitted", {"n": i + 1, "g": w, "t": "aaaaa", "v": 1, "unit": i + 1, "t_ms": i})
        for i, w in enumerate(words)
    ]
    board = rebuild(events)
    assert (board.won, board.complete, board.problems) == (False, True, [])


def test_a_gap_or_a_bad_result_is_a_problem_not_a_guess() -> None:
    events = _pairs()
    assert rebuild(events[3:4]).problems == ["row 2 recorded after 0 rows"]
    broken = ("guess_submitted", {"n": 1, "g": "crane", "t": "cc"})
    assert rebuild([broken]).problems == ["row 1: result does not match the guess"]
    assert rebuild([("guess_submitted", {"g": "crane"})]).problems == [
        "a guess without a row or a word"
    ]
    # other event types are ignored
    assert rebuild([("game_ended", {})]).rows == []


def test_the_board_renders_as_text() -> None:
    text = "\n".join(render_board(rebuild(_pairs())))
    assert "1. crane  ..G.G" in text
    assert "2. least  YYGYY" in text
    assert "4. slate  GGGGG" in text
    assert "refused on row 1: zzzzz (nw)" in text
    assert "4 scored guesses, won" in text
