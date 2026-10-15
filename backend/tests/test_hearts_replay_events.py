"""Hearts replay events: schemas, validation hook, storage, caps, migration 0039
(#3283, epic #3273).

The app (``frontend/src/game/hearts/replay.ts``) records ``hand_dealt``,
``pass_committed``, ``trick_completed`` and ``hand_scored`` through the shared
GameRecorder. ``fixtures/hearts_replay_v1.json`` holds the events two real seeded
games produced (pinned by ``replay.fixture.test.ts``), so a rejection of one of
them here would drop a real game's replay.
"""

from __future__ import annotations

import copy
import json
import logging
import re
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
from hearts import events as hearts_events
from hearts.events import (
    EVENT_TYPES,
    HAND_DEALT,
    HAND_SCORED,
    MAX_HAND_DEALT_BYTES,
    MAX_HAND_SCORED_BYTES,
    MAX_PASS_COMMITTED_BYTES,
    MAX_TRICK_COMPLETED_BYTES,
    PASS_COMMITTED,
    TRICK_COMPLETED,
    validate_hearts_event,
)
from hearts.module import module as hearts_module
from main import app
from observability import report
from tests._helpers import session_headers as _headers
from tests._migration_helpers import Alembic

client = TestClient(app)

_FIXTURE = Path(__file__).parent / "fixtures" / "hearts_replay_v1.json"
_SID = str(uuid.uuid4())
_CAPS = {
    HAND_DEALT: MAX_HAND_DEALT_BYTES,
    PASS_COMMITTED: MAX_PASS_COMMITTED_BYTES,
    TRICK_COMPLETED: MAX_TRICK_COMPLETED_BYTES,
    HAND_SCORED: MAX_HAND_SCORED_BYTES,
}


def _games() -> dict[str, list[dict[str, Any]]]:
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))


def _compact(data: Any) -> int:
    return len(json.dumps(data, separators=(",", ":")).encode())


def _first(type_: str, where=lambda d: True) -> dict[str, Any]:
    for e in _games()["six_hands"] + _games()["queen_and_moon"]:
        if e["type"] == type_ and where(e["data"]):
            return copy.deepcopy(e["data"])
    raise AssertionError(f"no {type_} in the fixture")


@pytest.fixture(autouse=True)
def sent(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, dict[str, Any]]]:
    """Sentry messages, captured: a dropped event reports once, by reason only."""
    calls: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(report.sentry_sdk, "capture_message", lambda m, **kw: calls.append((m, kw)))
    return calls


# --- the real payloads -----------------------------------------------------------


def test_the_fixture_has_every_type_a_moon_and_a_queen() -> None:
    events = _games()["six_hands"] + _games()["queen_and_moon"]
    assert {e["type"] for e in events} == set(EVENT_TYPES)
    assert any("m" in e["data"] for e in events if e["type"] == HAND_SCORED)
    assert any(e["data"].get("q") == 1 for e in events if e["type"] == TRICK_COMPLETED)
    assert any("QS" in e["data"]["p"][0] for e in events if e["type"] == PASS_COMMITTED)


@pytest.mark.parametrize("game", ["six_hands", "queen_and_moon"])
def test_every_event_the_app_builds_validates_and_is_stored_as_sent(game: str, sent: list) -> None:
    for e in _games()[game]:
        data = e["data"]
        assert validate_hearts_event(e["type"], copy.deepcopy(data)) == data, e
        assert _compact(data) <= _CAPS[e["type"]]
    assert sent == []


def test_the_worst_honest_event_of_each_type_is_inside_its_cap_with_a_third_to_spare() -> None:
    """Widest digits everywhere: hand 60, a 10-digit ``t_ms``. The frontend test pins the same
    figures (171 / 123 / 112 / 88 B) against the same caps."""
    env = {"v": 1, "unit": 900, "t_ms": 2**31 - 1}
    deck = [
        "2C3C4C5C6C7C8C9CTCJCQCKCAC",
        "2D3D4D5D6D7D8D9DTDJDQDKDAD",
        "2S3S4S5S6S7S8S9STSJSQSKSAS",
        "2H3H4H5H6H7H8H9HTHJHQHKHAH",
    ]
    worst = {
        HAND_DEALT: {**env, "h": 60, "d": 3, "c": deck},
        PASS_COMMITTED: {
            **env,
            "h": 59,
            "p": ["QSAH2C", "3C4C5C", "6D7D8D", "9STSJS"],
            "r": [[9, 9, 9], [9, 9, 9], [9, 9, 9], [9, 9, 9]],
        },
        # QS led from seat 3 wins (the only spade); AH is the other point
        TRICK_COMPLETED: {
            **env,
            "h": 60,
            "n": 13,
            "l": 3,
            "c": "QSAH2C3D",
            "w": 3,
            "pt": 14,
            "hb": 1,
            "q": 1,
            "r": [9, 9, 9, 9],
        },
        HAND_SCORED: {**env, "h": 60, "s": [26, 26, 26, 0], "t": [125, 125, 125, 125], "m": 3},
    }
    sizes = {name: _compact(data) for name, data in worst.items()}
    assert sizes == {HAND_DEALT: 171, PASS_COMMITTED: 123, TRICK_COMPLETED: 112, HAND_SCORED: 88}
    for name, data in worst.items():
        assert sizes[name] <= _CAPS[name] * 0.7, name
        assert validate_hearts_event(name, data) == data, name


# --- the module hook -----------------------------------------------------------------


def test_the_module_checks_the_replay_events_and_passes_the_rest_through() -> None:
    assert get_module("hearts") is hearts_module
    dealt = _first(HAND_DEALT)
    assert hearts_module.validate_event(HAND_DEALT, copy.deepcopy(dealt)) == dealt
    for name in EVENT_TYPES:
        assert hearts_module.validate_event(name, {}) is None
    assert hearts_module.validate_event(
        "game_started", {"initial_score": 0, "preset": "mixed"}
    ) == {
        "initial_score": 0,
        "preset": "mixed",
    }
    assert hearts_module.validate_event("game_ended", {"final_score": 12}) == {"final_score": 12}


# --- malformed payloads -----------------------------------------------------------------


def _with(base: dict[str, Any], **changes: Any) -> dict[str, Any]:
    out = copy.deepcopy(base)
    out.update(changes)
    return out


def _without(base: dict[str, Any], key: str) -> dict[str, Any]:
    out = copy.deepcopy(base)
    del out[key]
    return out


_DEALT = _first(HAND_DEALT, lambda d: d["h"] == 2)  # a pass-right hand
_PASS = _first(PASS_COMMITTED, lambda d: "r" in d)
_QUIET = {"v": 1, "unit": 5, "t_ms": 1000, "h": 2, "n": 1, "l": 2, "c": "2C5C3C4C", "w": 3}
_QUEEN = {
    "v": 1,
    "unit": 9,
    "t_ms": 5000,
    "h": 2,
    "n": 7,
    "l": 2,
    "c": "2DQS9HKD",
    "w": 1,
    "pt": 14,
    "hb": 1,
    "q": 1,
    "r": [0, 6, 0, 5],
}
_SCORED = {"v": 1, "unit": 17, "t_ms": 9000, "h": 2, "s": [13, 0, 13, 0], "t": [13, 0, 13, 0]}
_MOON = {**_SCORED, "s": [26, 0, 26, 26], "t": [26, 0, 26, 26], "m": 1}


def test_the_hand_built_bases_are_valid() -> None:
    for name, data in (
        (HAND_DEALT, _DEALT),
        (PASS_COMMITTED, _PASS),
        (TRICK_COMPLETED, _QUIET),
        (TRICK_COMPLETED, _QUEEN),
        (HAND_SCORED, _SCORED),
        (HAND_SCORED, _MOON),
    ):
        assert validate_hearts_event(name, copy.deepcopy(data)) == data


_BAD: list[Any] = [
    # envelope, every type
    pytest.param(HAND_DEALT, _with(_DEALT, v=2), id="dealt-unknown-version"),
    pytest.param(HAND_DEALT, _with(_DEALT, v=True), id="dealt-version-true"),
    pytest.param(HAND_DEALT, _without(_DEALT, "v"), id="dealt-no-version"),
    pytest.param(HAND_DEALT, _with(_DEALT, unit=-1), id="dealt-negative-unit"),
    pytest.param(HAND_DEALT, _with(_DEALT, unit=2**31), id="dealt-unit-past-int32"),
    pytest.param(HAND_DEALT, _with(_DEALT, t_ms="soon"), id="dealt-time-not-a-number"),
    pytest.param(HAND_DEALT, _with(_DEALT, h=0), id="dealt-hand-zero"),
    pytest.param(HAND_DEALT, _with(_DEALT, h=61), id="dealt-hand-past-the-limit"),
    pytest.param(HAND_DEALT, _with(_DEALT, extra=1), id="dealt-unknown-key"),
    pytest.param(
        HAND_DEALT, _with(_DEALT, actor={"seat": 0, "kind": "human"}), id="dealt-actor-key"
    ),
    pytest.param(HAND_DEALT, _with(_DEALT, part=0, parts=2), id="dealt-split"),
    # hand_dealt
    pytest.param(HAND_DEALT, _without(_DEALT, "c"), id="dealt-no-hands"),
    pytest.param(HAND_DEALT, _with(_DEALT, c=_DEALT["c"][:3]), id="dealt-three-hands"),
    pytest.param(HAND_DEALT, _with(_DEALT, c="x" * 104), id="dealt-hands-a-string"),
    pytest.param(
        HAND_DEALT, _with(_DEALT, c=[_DEALT["c"][0][:-2], *_DEALT["c"][1:]]), id="dealt-12-cards"
    ),
    pytest.param(
        HAND_DEALT,
        _with(_DEALT, c=[_DEALT["c"][0][:-2] + "1S", *_DEALT["c"][1:]]),
        id="dealt-bad-rank",
    ),
    pytest.param(
        HAND_DEALT,
        _with(_DEALT, c=[_DEALT["c"][0][:-2] + "2X", *_DEALT["c"][1:]]),
        id="dealt-bad-suit",
    ),
    pytest.param(
        HAND_DEALT,
        _with(_DEALT, c=[_DEALT["c"][0][:-2] + _DEALT["c"][1][:2], *_DEALT["c"][1:]]),
        id="dealt-a-card-twice",
    ),
    pytest.param(HAND_DEALT, _with(_DEALT, d=0), id="dealt-direction-not-the-hands"),
    pytest.param(HAND_DEALT, _with(_DEALT, d=4), id="dealt-direction-out-of-range"),
    # pass_committed
    pytest.param(PASS_COMMITTED, _without(_PASS, "p"), id="pass-no-cards"),
    pytest.param(PASS_COMMITTED, _with(_PASS, p=_PASS["p"][:3]), id="pass-three-seats"),
    pytest.param(
        PASS_COMMITTED, _with(_PASS, p=[_PASS["p"][0][:4], *_PASS["p"][1:]]), id="pass-two-cards"
    ),
    pytest.param(
        PASS_COMMITTED, _with(_PASS, p=[_PASS["p"][1], *_PASS["p"][1:]]), id="pass-a-card-twice"
    ),
    pytest.param(PASS_COMMITTED, _with(_PASS, h=4), id="pass-on-a-hold-hand"),
    pytest.param(PASS_COMMITTED, _with(_PASS, r=[0, 0, 0]), id="pass-principles-three-seats"),
    pytest.param(PASS_COMMITTED, _with(_PASS, r=[1, 0, 0, 0]), id="pass-seat-principle-not-zero"),
    pytest.param(PASS_COMMITTED, _with(_PASS, r=[[1, 2], 0, 0, 0]), id="pass-two-principles"),
    pytest.param(PASS_COMMITTED, _with(_PASS, r=[[1, 2, 10], 0, 0, 0]), id="pass-principle-ten"),
    pytest.param(
        PASS_COMMITTED, _with(_PASS, r=[[1, 2, -1], 0, 0, 0]), id="pass-principle-negative"
    ),
    # trick_completed
    pytest.param(TRICK_COMPLETED, _with(_QUIET, n=0), id="trick-number-zero"),
    pytest.param(TRICK_COMPLETED, _with(_QUIET, n=14), id="trick-number-fourteen"),
    pytest.param(TRICK_COMPLETED, _with(_QUIET, l=4), id="trick-lead-out-of-range"),
    pytest.param(TRICK_COMPLETED, _with(_QUIET, c="2C5C3C"), id="trick-three-cards"),
    pytest.param(TRICK_COMPLETED, _with(_QUIET, c="2C5C3C2C"), id="trick-a-card-twice"),
    pytest.param(TRICK_COMPLETED, _with(_QUIET, c=["2C", "5C", "3C", "4C"]), id="trick-a-list"),
    pytest.param(TRICK_COMPLETED, _with(_QUIET, w=2), id="trick-winner-wrong"),
    pytest.param(TRICK_COMPLETED, _with(_QUIET, w=4), id="trick-winner-out-of-range"),
    pytest.param(TRICK_COMPLETED, _with(_QUIET, pt=1), id="trick-points-from-nowhere"),
    pytest.param(TRICK_COMPLETED, _with(_QUIET, pt=0), id="trick-zero-points-sent"),
    pytest.param(TRICK_COMPLETED, _without(_QUEEN, "pt"), id="trick-points-missing"),
    pytest.param(TRICK_COMPLETED, _with(_QUEEN, pt=13), id="trick-points-miscounted"),
    pytest.param(TRICK_COMPLETED, _without(_QUEEN, "q"), id="trick-queen-flag-missing"),
    pytest.param(TRICK_COMPLETED, _with(_QUIET, q=1), id="trick-queen-flag-without-queen"),
    pytest.param(TRICK_COMPLETED, _without(_QUEEN, "hb"), id="trick-hearts-played-not-broken"),
    pytest.param(TRICK_COMPLETED, _with(_QUEEN, hb=2), id="trick-broken-flag-not-1"),
    pytest.param(TRICK_COMPLETED, _with(_QUEEN, r=[0, 6, 0]), id="trick-principles-three-plays"),
    pytest.param(TRICK_COMPLETED, _with(_QUEEN, r=[0, 6, 0, 10]), id="trick-principle-ten"),
    pytest.param(TRICK_COMPLETED, _with(_QUEEN, r=[0, 6, 0, True]), id="trick-principle-bool"),
    # hand_scored
    pytest.param(HAND_SCORED, _with(_SCORED, s=[13, 13, 13, 13]), id="scored-deltas-sum-52"),
    pytest.param(HAND_SCORED, _with(_SCORED, s=[27, 0, 0, 0]), id="scored-delta-past-26"),
    pytest.param(HAND_SCORED, _with(_SCORED, s=[13, 0, 13]), id="scored-three-seats"),
    pytest.param(HAND_SCORED, _with(_SCORED, s=[13.0, 0, 13, 0]), id="scored-float"),
    pytest.param(HAND_SCORED, _with(_SCORED, t=[-1, 0, 13, 0]), id="scored-negative-total"),
    pytest.param(HAND_SCORED, _with(_SCORED, t=[13, 0, 13]), id="scored-totals-three-seats"),
    pytest.param(HAND_SCORED, _without(_MOON, "m"), id="scored-moon-without-shooter"),
    pytest.param(HAND_SCORED, _with(_SCORED, m=1), id="scored-shooter-without-moon"),
    pytest.param(HAND_SCORED, _with(_MOON, m=0), id="scored-shooter-took-points"),
    pytest.param(HAND_SCORED, _with(_MOON, m=4), id="scored-shooter-out-of-range"),
]


@pytest.mark.parametrize(("name", "bad"), _BAD)
def test_rejects_a_malformed_payload(name: str, bad: dict[str, Any], sent: list) -> None:
    assert validate_hearts_event(name, bad) is None
    # one report, by type and reason: neither the cards nor the scores reach Sentry
    assert len(sent) == 1
    assert sent[0][0] == f"hearts event: {name} invalid"


@pytest.mark.parametrize("name", EVENT_TYPES)
def test_an_event_over_its_cap_is_dropped_by_bytes(name: str, sent: list) -> None:
    good = {
        HAND_DEALT: _DEALT,
        PASS_COMMITTED: _PASS,
        TRICK_COMPLETED: _QUEEN,
        HAND_SCORED: _MOON,
    }[name]
    padded = {**good, "pad": "x" * _CAPS[name]}
    assert validate_hearts_event(name, padded) is None
    assert [m for m, _ in sent] == [f"hearts event: {name} oversize"]


def test_the_cap_is_inclusive(monkeypatch: pytest.MonkeyPatch, sent: list) -> None:
    size = _compact(_MOON)
    monkeypatch.setitem(hearts_events._CAPS, HAND_SCORED, size)
    assert validate_hearts_event(HAND_SCORED, copy.deepcopy(_MOON)) == _MOON
    monkeypatch.setitem(hearts_events._CAPS, HAND_SCORED, size - 1)
    assert validate_hearts_event(HAND_SCORED, copy.deepcopy(_MOON)) is None
    assert [m for m, _ in sent] == ["hearts event: hand_scored oversize"]


def test_an_unserialisable_payload_is_dropped_not_raised() -> None:
    assert validate_hearts_event(HAND_SCORED, {"v": 1, "s": [object()]}) is None


def test_drop_reports_carry_no_player_data(sent: list, caplog: pytest.LogCaptureFixture) -> None:
    bad = _with(_QUEEN, c="2DQS9HKD", w=3, unit=424242)
    with caplog.at_level(logging.WARNING, logger="hearts.events"):
        assert validate_hearts_event(TRICK_COMPLETED, bad) is None
    text = json.dumps(sent, default=str) + caplog.text
    assert "424242" not in text
    assert "2DQS9HKD" not in text
    assert "dropped an invalid trick_completed" in caplog.text


# --- caps shared with the app ------------------------------------------------------------


def test_the_byte_caps_match_the_apps_registry() -> None:
    ts = (
        Path(__file__).resolve().parents[2]
        / "frontend"
        / "src"
        / "game"
        / "_shared"
        / "eventQueueConfig.ts"
    ).read_text(encoding="utf-8")
    for const, value in (
        ("HEARTS_HAND_DEALT_MAX_BYTES", MAX_HAND_DEALT_BYTES),
        ("HEARTS_PASS_COMMITTED_MAX_BYTES", MAX_PASS_COMMITTED_BYTES),
        ("HEARTS_TRICK_COMPLETED_MAX_BYTES", MAX_TRICK_COMPLETED_BYTES),
        ("HEARTS_HAND_SCORED_MAX_BYTES", MAX_HAND_SCORED_BYTES),
    ):
        m = re.search(rf"export const {const}\s*=\s*(\d+)\s*;", ts)
        assert m, f"{const} not found in eventQueueConfig.ts"
        assert int(m.group(1)) == value, const


def test_every_cap_is_far_under_the_per_event_row_cap() -> None:
    # the app's queue holds 8 KB per row (MAX_EVENT_PAYLOAD_BYTES); these are a few hundred B
    assert max(_CAPS.values()) <= 256
    assert set(_CAPS) == set(hearts_events.EVENT_TYPES)


# --- storage ----------------------------------------------------------------------------------


@pytest.fixture(autouse=True)
async def _entitlements():
    async with get_session_factory()() as db:
        db.add(GameEntitlement(session_id=_SID, game_slug="hearts"))
        await db.commit()


def _new_game() -> str:
    r = client.post("/games", headers=_headers(_SID), json={"game_type": "hearts"})
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


async def test_a_bad_event_is_dropped_and_cuts_the_replay_there(
    sent: list, caplog: pytest.LogCaptureFixture
) -> None:
    gid = _new_game()
    with caplog.at_level(logging.WARNING, logger="hearts.events"):
        r = _post(
            gid,
            [
                {"event_index": 0, "event_type": HAND_DEALT, "data": _DEALT},
                {"event_index": 1, "event_type": TRICK_COMPLETED, "data": _with(_QUIET, w=0)},
                {"event_index": 2, "event_type": TRICK_COMPLETED, "data": _QUIET},
                {"event_index": 3, "event_type": "game_ended", "data": {"final_score": 1}},
            ],
        )
    assert r.status_code == 200, r.text
    # A refused replay event cuts the game's replay there (the stored replay is a prefix by
    # index, #3318), so the good trick after it is dropped with it; the lifecycle row is kept.
    assert r.json() == {"accepted": 2, "duplicates": 0, "rejected": [], "dropped": 1}
    rows = await _stored(gid)
    assert [e.event_index for e in rows] == [0, 3]
    assert rows[0].data == _DEALT
    assert [m for m, _ in sent] == ["hearts event: trick_completed invalid"]
    assert "dropped an invalid trick_completed" in caplog.text


@pytest.mark.parametrize("game", ["six_hands", "queen_and_moon"])
async def test_a_whole_recorded_game_is_stored_whole(game: str, sent: list) -> None:
    events = _games()[game]
    gid = _new_game()
    sent_events = [
        {"event_index": i, "event_type": e["type"], "data": e["data"]} for i, e in enumerate(events)
    ]
    for start in range(0, len(sent_events), 200):  # the app's batch size
        r = _post(gid, sent_events[start : start + 200])
        assert r.status_code == 200, r.text
        assert r.json()["accepted"] == len(sent_events[start : start + 200])
    rows = await _stored(gid)
    assert [(e.event_index, e.data) for e in rows] == [(i, e["data"]) for i, e in enumerate(events)]
    assert sent == []


async def test_an_unseeded_hearts_type_is_still_refused() -> None:
    gid = _new_game()
    r = _post(gid, [{"event_index": 0, "event_type": "card_played", "data": {}}])
    assert r.status_code == 400


# --- the per-game cap ----------------------------------------------------------------------------


def _worst_game(hands: int) -> list[dict[str, Any]]:
    """`hands` hands at the widest digits every number can have (jsonb text adds spaces)."""
    env = {"v": 1, "unit": 900, "t_ms": 2**31 - 1}
    rows: list[dict[str, Any]] = []
    for h in range(1, hands + 1):
        rows.append({**_DEALT, **env, "h": h, "d": (h - 1) % 4})
        if h % 4 != 0:
            rows.append({**_PASS, **env, "h": h})
        rows.extend({**_QUEEN, **env, "h": h, "n": n} for n in range(1, 14))
        rows.append({**_MOON, **env, "h": h, "t": [125, 125, 125, 125]})
    return rows


def test_the_longest_possible_game_is_sixteen_hands() -> None:
    """Every non-moon hand deals 26 points among four players (a moon hand 78), and a game
    ends when one reaches 100: with all four at 99 the total is 396, 15 hands of 26 are 390,
    so a 16th hand always ends the game."""
    assert 26 * 15 <= 4 * 99 < 26 * 16


def test_the_longest_game_at_its_widest_fits_the_default_cap_with_room_to_spare() -> None:
    rows = _worst_game(16)
    sizes = [event_bytes(r) for r in rows]
    assert cap_for("hearts") is DEFAULT_CAP  # Hearts has no override of its own
    decision = apply_cap(DEFAULT_CAP, 0, 0, sizes)
    assert decision.dropped == 0, decision
    assert len(rows) == 16 * 16 - 4  # 16 events a hand, 12 passes
    assert len(rows) <= DEFAULT_CAP.max_events * 0.55
    assert sum(sizes) <= DEFAULT_CAP.max_bytes * 0.6
    assert sum(sizes) == 85_170  # the figure in the cap comment (games/replay_caps.py)
    # and the per-row overhead is a third of what is stored, not the JSON
    assert ROW_OVERHEAD_BYTES * len(rows) < sum(sizes)


def test_a_real_game_costs_under_a_fifth_of_the_cap() -> None:
    games = _games()
    sizes = [event_bytes(e["data"]) for e in games["six_hands"]]
    assert (len(sizes), sum(sizes)) == (95, 30_169)  # the figures in the cap comment
    for game in games.values():
        assert sum(event_bytes(e["data"]) for e in game) <= DEFAULT_CAP.max_bytes * 0.2


# --- migration 0039 ---------------------------------------------------------------------------------

_BEFORE = "0035_games_event_counters"
_REVISION = "0039_hearts_hand_events"
_HEARTS = 7


def _event_names(db_path: Path) -> list[str]:
    with sqlite3.connect(db_path) as conn:
        return [
            r[0]
            for r in conn.execute(
                f"SELECT name FROM event_types WHERE game_type_id = {_HEARTS} ORDER BY name"
            )
        ]


def test_the_migration_adds_and_removes_only_the_hearts_replay_types(
    migration_db_path: Path, alembic: Alembic
) -> None:
    alembic("upgrade", _BEFORE)
    before = _event_names(migration_db_path)
    assert not set(EVENT_TYPES) & set(before)

    alembic("upgrade", _REVISION)
    with sqlite3.connect(migration_db_path) as conn:
        display = dict(
            conn.execute(
                f"SELECT name, display_name FROM event_types WHERE game_type_id = {_HEARTS}"
            ).fetchall()
        )
        ids = {
            name: conn.execute(
                f"SELECT id FROM event_types WHERE game_type_id = {_HEARTS} AND name = ?", (name,)
            ).fetchone()[0]
            for name in ("trick_completed", "game_ended")
        }
        # stored rows, to prove the downgrade clears the new types' dependants only
        gid = uuid.uuid4().hex
        conn.execute(
            f"INSERT INTO games (id, session_id, game_type_id, metadata) VALUES (?, 's', {_HEARTS}, '{{}}')",
            (gid,),
        )
        for idx, type_id in ((0, ids["trick_completed"]), (1, ids["game_ended"])):
            conn.execute(
                "INSERT INTO game_events (game_id, event_index, event_type_id, data) "
                "VALUES (?, ?, ?, '{}')",
                (gid, idx, type_id),
            )
    assert display["hand_dealt"] == "Hand Dealt"
    assert display["trick_completed"] == "Trick Completed"
    assert _event_names(migration_db_path) == sorted([*before, *EVENT_TYPES])

    alembic("downgrade", "-1")
    assert _event_names(migration_db_path) == before
    with sqlite3.connect(migration_db_path) as conn:
        assert conn.execute("SELECT event_index FROM game_events").fetchall() == [(1,)]


def test_the_migration_is_seed_only() -> None:
    src = (
        Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0039_hearts_hand_events.py"
    ).read_text(encoding="utf-8")
    for schema_call in (
        "create_table",
        "add_column",
        "drop_column",
        "create_index",
        "alter_column",
    ):
        assert schema_call not in src
    assert 'down_revision: str | None = "0035_games_event_counters"' in src
