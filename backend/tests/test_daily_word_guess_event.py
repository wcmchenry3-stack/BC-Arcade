"""Daily Word ``guess_submitted`` event: schema, validation hook, storage, replay (#3287, #3368).

``fixtures/daily_word_guess_events_v1.json`` holds scripted games (English,
French with accents, Hindi) exactly as the app records them, one
``guess_submitted`` per game (the app's ``replay.fixture.test.ts`` fails when its
output differs), so these tests run against the real payloads. The event has been
seeded since migration 0017 and no build ever sent it: there is no older shape to
keep and no migration.
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
from daily_word.router import _score_guess
from db.base import get_session_factory
from db.models import DailyWordProgress, GameEvent
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
_CODE = {"correct": "c", "present": "p", "absent": "a"}


def _games() -> list[dict[str, Any]]:
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))["games"]


def _game(label: str) -> dict[str, Any]:
    return next(g for g in _games() if g["label"].startswith(label))


def _data(label: str = "english") -> dict[str, Any]:
    return copy.deepcopy(_game(label)["events"][0]["data"])


def _pairs(label: str = "english") -> list[tuple[str, dict[str, Any]]]:
    return [(e["type"], e["data"]) for e in _game(label)["events"]]


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


def test_every_real_game_in_the_fixture_is_stored_as_sent() -> None:
    games = _games()
    assert len(games) >= 3
    for game in games:
        assert len(game["events"]) == 1, "one guess_submitted per game"
        (event,) = game["events"]
        assert event["type"] == "guess_submitted"
        assert validate_guess(copy.deepcopy(event["data"])) == event["data"]


def test_the_fixture_covers_accents_hindi_and_refusals() -> None:
    assert "d" in _data("french")
    assert "d" not in _data("english")
    assert any(ord(c) > 0x900 for g in _data("hindi")["g"] for c in g)
    assert _data("english")["rj"] == 2


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.update(v=2),
        lambda d: d.update(v=True),
        lambda d: d.update(v="1"),
        lambda d: d.update(unit=-1),
        lambda d: d.update(t_ms=-5),
        lambda d: d.update(t_ms=2**31),
        lambda d: d.update(g=[]),
        lambda d: d.update(g="crane"),
        lambda d: d.update(g=["crane"] * 7, t=["aacac"] * 7),
        lambda d: d.update(g=[""], t=["a"]),
        lambda d: d.update(g=[5], t=["a"]),
        lambda d: d.update(g=["x" * 17], t=["a" * 17]),
        lambda d: d.update(t=["aacac"]),  # fewer results than guesses
        lambda d: d.update(t=["aacaz", "ppcpp", "cpcpc", "ccccc"]),
        lambda d: d.update(t=["AACAC", "ppcpp", "cpcpc", "ccccc"]),
        lambda d: d.update(t=["", "ppcpp", "cpcpc", "ccccc"]),
        lambda d: d.update(t="aacac"),
        lambda d: d.update(t=["c", "ppcpp", "cpcpc", "ccccc"]),  # a row's result too short
        lambda d: d.update(t=["aacacc", "ppcpp", "cpcpc", "ccccc"]),  # ... and too long
        lambda d: d.update(g=["crane", "le ast", "stale", "slate"]),  # whitespace
        lambda d: d.update(g=["crane", "least\n", "stale", "slate"]),  # control character
        lambda d: d.update(g=["crane", "Least", "stale", "slate"]),  # not folded lower-case
        lambda d: d.update(g=["12345", "least", "stale", "slate"]),  # digits (#3372)
        lambda d: d.update(g=["crane", "!!!!!", "stale", "slate"]),  # punctuation (#3372)
        lambda d: d.update(g=["crane", "ab-cd", "stale", "slate"]),  # hyphen (#3372)
        lambda d: d.update(g=["😀abcd", "least", "stale", "slate"]),  # emoji (#3372)
        lambda d: d.update(g=["ab$cd", "least", "stale", "slate"]),  # symbol (#3372)
        lambda d: d.update(d=["c12ne", "least", "stale", "slate"]),  # digit in the display spelling
        lambda d: d.update(g=["\ud800abcd", "least", "stale", "slate"]),  # lone surrogate
        lambda d: d.update(d=["cr\x00ne", "least", "stale", "slate"]),
        lambda d: d.update(d=["crane", "least", "stale", "slate"]),  # d equals g
        lambda d: d.update(d=["cräne", "least", "stale", "slate"][:3]),  # not aligned
        lambda d: d.update(d=["cräne", "leas", "stale", "slate"]),  # wrong length
        lambda d: d.update(rj=0),
        lambda d: d.update(rj=100),
        lambda d: d.update(rj=True),
        lambda d: d.update(rj="2"),
        lambda d: d.update(n=1),  # the old per-guess shape
        lambda d: d.update(rej="nw"),
        lambda d: d.update(answer="slate"),
        lambda d: d.pop("v"),
        lambda d: d.pop("g"),
        lambda d: d.pop("t"),
    ],
)
def test_a_malformed_game_is_dropped_and_reported(mutate, sentry_messages) -> None:
    data = _data()
    mutate(data)
    assert validate_guess(data) is None
    assert [m for m, _ in sentry_messages] == ["daily_word event: guess_submitted invalid"]


def test_letters_with_combining_marks_still_pass() -> None:
    # Hindi needs marks (category M); a decomposed accent is a letter then a mark (#3372)
    data = _data()
    data["g"][0] = "état"
    assert validate_guess(copy.deepcopy(data)) == data


def test_a_per_guess_event_of_the_older_design_is_rejected(sentry_messages) -> None:
    old = {"n": 2, "g": "crane", "t": "aacac", "v": 1, "unit": 2, "t_ms": 5}
    assert validate_guess(old) is None
    refused = {"n": 1, "g": "zzzzz", "rej": "nw", "v": 1, "unit": 1, "t_ms": 5}
    assert validate_guess(refused) is None


def test_an_oversize_payload_is_dropped_and_reported_by_reason_only(
    sentry_messages, caplog: pytest.LogCaptureFixture
) -> None:
    data = _data()
    data["pad"] = "y" * MAX_GUESS_BYTES
    with caplog.at_level(logging.WARNING, logger="daily_word.guess_event"):
        assert validate_guess(data) is None
    assert "oversize guess_submitted" in caplog.text
    ((message, kw),) = sentry_messages
    assert message == "daily_word event: guess_submitted oversize"
    assert "y" * 20 not in json.dumps(kw, default=str)


def test_the_largest_legal_games_are_under_the_cap() -> None:
    big = 2**31 - 1
    worst = {
        "french, six accented guesses": {
            "g": ["aerer"] * 6,
            "t": ["cpaca"] * 6,
            "d": ["aérer"] * 6,
            "rj": 99,
        },
        "hindi, six guesses": {"g": ["अंजाम"] * 6, "t": ["ccaaa"] * 6, "rj": 99},
        "the longest guesses the size check lets through (the size cap, not the schema, is the real bound)": {
            "g": ["आ" * 16] * 2,
            "t": ["c" * 16] * 2,
        },
    }
    for label, body in worst.items():
        data = {**body, "v": 1, "unit": 1, "t_ms": big}
        compact = len(json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode())
        assert compact < MAX_GUESS_BYTES, label
        assert validate_guess(data) == data, label


def test_an_unserialisable_payload_is_dropped(sentry_messages) -> None:
    data = _data()
    data["g"] = [float("nan")]
    assert validate_guess(data) is None


def test_the_error_report_carries_error_types_not_values(sentry_messages) -> None:
    data = _data()
    data["g"] = ["SECRET-VALUE"]
    data["t"] = ["a"]
    data["rj"] = 500
    validate_guess(data)
    ((_, kw),) = sentry_messages
    assert "SECRET-VALUE" not in json.dumps(kw, default=str)
    assert kw["extras"]["error_types"]


def test_drop_reports_are_throttled_per_reason(sentry_messages) -> None:
    for _ in range(5):
        bad = _data()
        bad["rj"] = 0
        assert validate_guess(bad) is None
    big = _data()
    big["pad"] = "y" * MAX_GUESS_BYTES
    assert validate_guess(big) is None
    # five invalid drops: one report; the oversize drop is its own reason
    assert [m for m, _ in sentry_messages] == [
        "daily_word event: guess_submitted invalid",
        "daily_word event: guess_submitted oversize",
    ]


# ---------------------------------------------------------------------------
# the module hook
# ---------------------------------------------------------------------------


def test_the_module_validates_guess_submitted_and_passes_lifecycle_through() -> None:
    module = get_module("daily_word")
    assert module is not None
    assert module.validate_event("guess_submitted", {}) is None
    assert module.validate_event("guess_submitted", _data()) == _data()
    for name in ("game_started", "game_ended"):
        assert module.validate_event(name, {"puzzle_id": "x", "any": 1}) == {
            "puzzle_id": "x",
            "any": 1,
        }


def test_other_games_hooks_are_untouched() -> None:
    module = get_module("yacht")
    assert module is not None
    assert module.validate_event("guess_submitted", {}) == {}


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


@pytest.mark.parametrize("label", ["english", "french", "hindi"])
async def test_a_real_game_is_stored_exactly_as_sent(label: str) -> None:
    gid = _new_game()
    r = _post(gid, _as_batch([_data(label)]))
    assert r.status_code == 200, r.text
    assert r.json() == {"accepted": 1, "duplicates": 0, "rejected": [], "dropped": 0}
    (row,) = await _stored(gid)
    assert row.data == _data(label)


async def test_a_bad_event_is_dropped_with_a_2xx(
    sentry_messages, caplog: pytest.LogCaptureFixture
) -> None:
    gid = _new_game()
    bad = _data()
    bad["rj"] = 0
    with caplog.at_level(logging.WARNING, logger="daily_word.guess_event"):
        r = _post(gid, _as_batch([bad]))
    assert r.status_code == 200, r.text
    assert r.json()["accepted"] == 0
    assert await _stored(gid) == []
    assert "dropped an invalid guess_submitted" in caplog.text
    assert [m for m, _ in sentry_messages] == ["daily_word event: guess_submitted invalid"]


async def test_a_lone_surrogate_is_dropped_with_a_2xx_not_a_500(
    bypass_strict_json, sentry_messages
) -> None:
    gid = _new_game()
    bad = _data()
    bad["g"] = ["\ud800abcd"]
    bad["t"] = ["ccccc"]
    # sent as the escaped text "\\ud800" a real client would send (the test client
    # cannot encode a lone surrogate itself)
    body = json.dumps({"events": _as_batch([bad])})
    assert "\\ud800" in body
    r = client.post(
        f"/games/{gid}/events",
        headers={**_headers(_SID), "Content-Type": "application/json"},
        content=body,
    )
    assert r.status_code == 200, r.text
    assert r.json()["accepted"] == 0
    assert await _stored(gid) == []
    assert [m for m, _ in sentry_messages] == ["daily_word event: guess_submitted invalid"]


@pytest.mark.parametrize("guess", ["12345", "!!!!!", "ab-cd", "😀abcd", "ab$cd"])
async def test_a_non_letter_guess_is_dropped_and_nothing_is_stored(guess, sentry_messages) -> None:
    # #3372: printable non-letters are not Daily Word guesses
    gid = _new_game()
    bad = _data()
    bad["g"] = [guess, "least", "stale", "slate"]
    r = _post(gid, _as_batch([bad]))
    assert r.status_code == 200, r.text
    assert r.json()["accepted"] == 0
    assert await _stored(gid) == []
    assert [m for m, _ in sentry_messages] == ["daily_word event: guess_submitted invalid"]


async def test_lifecycle_events_are_stored_unchanged() -> None:
    gid = _new_game()
    start = {"event_index": 0, "event_type": "game_started", "data": {"puzzle_id": "2026-05-03:en"}}
    end = {"event_index": 1, "event_type": "game_ended", "data": {"anything": [1, 2]}}
    assert _post(gid, [start, end]).json()["accepted"] == 2
    assert [e.data for e in await _stored(gid)] == [start["data"], end["data"]]


def test_guess_submitted_is_not_an_event_type_of_other_games() -> None:
    gid = _new_game("yacht")
    r = _post(gid, _as_batch([_data()]))
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# cost: bytes per game, the cap, retention
# ---------------------------------------------------------------------------


def test_the_byte_arithmetic_behind_the_cap() -> None:
    # Each fixture game is one row: its JSON as stored + the row overhead.
    sizes = {g["label"].split(",")[0]: jsonb_bytes(g["events"][0]["data"]) for g in _games()}
    assert sizes == {"english": 129, "french": 148, "hindi": 141}
    per_game = {k: v + ROW_OVERHEAD_BYTES for k, v in sizes.items()}
    assert max(per_game.values()) == 348
    # The worst real game: six accented guesses and 99 refusals.
    worst = jsonb_bytes(
        {
            "g": ["aerer"] * 6,
            "t": ["cpaca"] * 6,
            "d": ["aérer"] * 6,
            "rj": 99,
            "v": 1,
            "unit": 1,
            "t_ms": 2**31 - 1,
        }
    )
    assert worst == 238
    assert worst + ROW_OVERHEAD_BYTES == 438  # about 500 B with overhead, the target
    assert cap_for("daily_word") is DAILY_WORD_CAP
    assert (DAILY_WORD_CAP.max_events, DAILY_WORD_CAP.max_bytes) == (4, 2_400)
    # four of the largest legal events still fit the byte cap
    assert DAILY_WORD_CAP.max_bytes >= 4 * (MAX_GUESS_BYTES + ROW_OVERHEAD_BYTES)
    # a tiny share of the 40 KB a fully recorded game is planned at, and of the default cap
    assert 438 < 40 * 1024 // 90
    assert DAILY_WORD_CAP.max_bytes < DEFAULT_CAP.max_bytes // 50


def test_retention_keeps_guess_submitted() -> None:
    # Daily Word stats depend on it (#3279 / owner decision #3317).
    assert "guess_submitted" in RETENTION_KEEP_NAMES


async def test_a_flood_of_games_stops_at_the_games_cap() -> None:
    gid = _new_game()
    flood = [_data() for _ in range(DAILY_WORD_CAP.max_events + 20)]
    r = _post(gid, _as_batch(flood))
    assert r.status_code == 200, r.text
    rows = await _stored(gid)
    assert len(rows) == DAILY_WORD_CAP.max_events
    assert [e.event_index for e in rows] == list(range(DAILY_WORD_CAP.max_events))


# ---------------------------------------------------------------------------
# replay: the board rebuilt from the event alone
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("label", ["english", "french", "hindi"])
def test_each_fixture_game_rebuilds_to_a_won_board(label: str) -> None:
    game = _game(label)
    board = rebuild(_pairs(label))
    assert board.problems == []
    assert board.guesses == game["scored_guesses"]
    assert (board.won, board.complete) == (True, True)


def test_the_accented_spellings_survive_the_rebuild() -> None:
    board = rebuild(_pairs("french"))
    assert board.display == ["aérer", "allée", "année"]
    assert rebuild(_pairs("english")).refusals == 2


@pytest.mark.parametrize("label", ["english", "french", "hindi"])
def test_the_recorded_results_are_what_the_servers_scoring_gives(label: str) -> None:
    """Not a tautology: the guesses are re-scored by the server's own algorithm
    against the puzzle's answer, and must give exactly the results the app recorded."""
    game = _game(label)
    data = game["events"][0]["data"]
    for guess, recorded in zip(data["g"], data["t"], strict=True):
        scored = "".join(_CODE[t["status"]] for t in _score_guess(game["answer"], guess))
        assert scored == recorded, guess
    assert data["g"][-1] == game["answer"]


async def test_the_rebuilt_guesses_are_what_daily_word_progress_holds() -> None:
    """Drive the real guess path with the recorded guesses; the rows it keeps are the event's."""
    game = _game("english")
    sid = str(uuid.uuid4())
    recorded = game["events"][0]["data"]
    puzzle = game["puzzle"]["puzzle_id"]
    async with get_session_factory()() as db:
        for guess, result in zip(recorded["g"], recorded["t"], strict=True):
            await record_guess(
                db, session_id=sid, puzzle_id=puzzle, guess=guess, won=set(result) == {"c"}
            )
    async with get_session_factory()() as db:
        row = (
            await db.execute(select(DailyWordProgress).where(DailyWordProgress.session_id == sid))
        ).scalar_one()
    board = rebuild(_pairs("english"))
    assert board.guesses == list(row.guesses)
    assert board.won is bool(row.solved)
    assert len(board.rows) <= MAX_GUESSES


def test_a_lost_game_is_complete_after_six_rows() -> None:
    words = ["crane", "least", "stale", "plate", "slant", "slats"]
    data = {"g": words, "t": ["aaaaa"] * 6, "v": 1, "unit": 1, "t_ms": 9}
    assert validate_guess(copy.deepcopy(data)) == data
    board = rebuild([("guess_submitted", data)])
    assert (board.won, board.complete, board.problems) == (False, True, [])


def test_a_missing_doubled_or_broken_event_is_a_problem_not_a_guess() -> None:
    assert rebuild([("game_ended", {})]).problems == ["no guess_submitted event"]
    twice = _pairs() * 2
    assert rebuild(twice).problems == ["2 guess_submitted events for one game"]
    assert rebuild([("guess_submitted", {"g": ["crane"], "t": []})]).problems == [
        "guesses and results do not line up"
    ]
    assert rebuild([("guess_submitted", {"g": ["crane"], "t": ["cc"]})]).problems == [
        "row 1: result does not match the guess"
    ]


def test_the_board_renders_as_text() -> None:
    text = "\n".join(render_board(rebuild(_pairs("french"))))
    assert "1. aérer  GY.G." in text
    assert "3. année  GGGGG" in text
    assert "1 refused guesses" in text
    assert "3 scored guesses, won" in text
