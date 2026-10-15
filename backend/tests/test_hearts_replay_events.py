"""Hearts replay events: schemas, validation hook, storage, caps, migration 0039
(#3283, epic #3273).

The app (``frontend/src/game/hearts/replay.ts``) records ``hand_opened`` and
``hand_played`` through the shared GameRecorder, two rows a hand.
``fixtures/hearts_replay_v1.json`` holds the events three real seeded games
produced (pinned by ``replay.fixture.test.ts``), so a rejection of one of them
here would drop a real game's replay.
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
from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi.testclient import TestClient
from sqlalchemy import select

from db.base import get_session_factory
from db.models import GameEntitlement, GameEvent
from games.registry import get_module
from games.replay_caps import DEFAULT_CAP, ROW_OVERHEAD_BYTES, apply_cap, cap_for, event_bytes
from hearts import events as hearts_events
from hearts.events import (
    EVENT_TYPES,
    HAND_OPENED,
    HAND_PLAYED,
    MAX_HAND_OPENED_BYTES,
    MAX_HAND_PLAYED_BYTES,
    validate_hearts_event,
)
from hearts.module import module as hearts_module
from main import app
from observability import report
from tests._alembic_heads import BACKEND, script_heads
from tests._helpers import session_headers as _headers
from tests._migration_helpers import Alembic

client = TestClient(app)

_FIXTURE = Path(__file__).parent / "fixtures" / "hearts_replay_v1.json"
_SID = str(uuid.uuid4())
_CAPS = {HAND_OPENED: MAX_HAND_OPENED_BYTES, HAND_PLAYED: MAX_HAND_PLAYED_BYTES}
WORST_IN_PARTS_BYTES = 28_494
_GAME_NAMES = ("six_hands", "queen_and_moon", "two_hands_in_parts")


def _games() -> dict[str, list[dict[str, Any]]]:
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))


def _compact(data: Any) -> int:
    return len(json.dumps(data, separators=(",", ":")).encode())


def _first(type_: str, where=lambda d: True) -> dict[str, Any]:
    for game in _games().values():
        for e in game:
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


def test_the_fixture_has_both_types_a_moon_a_queen_passed_and_parts() -> None:
    events = [e for g in _games().values() for e in g]
    assert {e["type"] for e in events} == set(EVENT_TYPES)
    assert any("m" in e["data"] for e in events if e["type"] == HAND_PLAYED)
    assert any(
        "QS" in e["data"]["p"][0] for e in events if e["type"] == HAND_OPENED and "p" in e["data"]
    )
    assert any("p" not in e["data"] for e in events if e["type"] == HAND_OPENED)  # a hold hand
    assert any("n" in e["data"] for e in events if e["type"] == HAND_PLAYED)  # a part


@pytest.mark.parametrize("game", _GAME_NAMES)
def test_every_event_the_app_builds_validates_and_is_stored_as_sent(game: str, sent: list) -> None:
    for e in _games()[game]:
        data = e["data"]
        assert validate_hearts_event(e["type"], copy.deepcopy(data)) == data, e
        assert _compact(data) <= _CAPS[e["type"]]
    assert sent == []


def _worst() -> dict[str, dict[str, Any]]:
    """Widest digits everywhere: hand 59/60, a 10-digit ``t_ms``."""
    env = {"v": 1, "unit": 900, "t_ms": 2**31 - 1}
    deck = [
        "2C3C4C5C6C7C8C9CTCJCQCKCAC",
        "2D3D4D5D6D7D8D9DTDJDQDKDAD",
        "2S3S4S5S6S7S8S9STSJSQSKSAS",
        "2H3H4H5H6H7H8H9HTHJHQHKHAH",
    ]
    plays = "".join(
        f"{r}{s}" for r in "23456789TJQKA" for s in "CDHS"
    )  # 52 distinct cards in some order
    return {
        HAND_OPENED: {
            **env,
            "h": 59,
            "d": 2,
            "c": deck,
            "p": ["QSAH2C", "3C4C5C", "6D7D8D", "9STSJS"],
            "r": "888888888888",
        },
        HAND_PLAYED: {
            **env,
            "h": 60,
            "l": 3,
            "c": plays,
            "r": "8888" * 13,
            "s": [26, 26, 26, 0],
            "t": [125, 125, 125, 125],
            "m": 3,
        },
    }


def test_the_worst_honest_event_of_each_type_is_inside_its_cap_with_a_third_to_spare() -> None:
    """The frontend test pins the same figures (232 / 264 B) against the same caps."""
    worst = _worst()
    # the deck above passes (hand opened) only if the passed cards are the seat's own: use a real deal
    worst[HAND_OPENED]["c"] = [
        "2C3C4C5C6C7C8C9CTCJCQCKCAC",
        "2D3D4D5D6D7D8D9DTDJDQDKDAD",
        "2S3S4S5S6S7S8S9STSJSQSKSAS",
        "2H3H4H5H6H7H8H9HTHJHQHKHAH",
    ]
    worst[HAND_OPENED]["p"] = ["2C3C4C", "2D3D4D", "2S3S4S", "2H3H4H"]
    sizes = {name: _compact(data) for name, data in worst.items()}
    assert sizes == {HAND_OPENED: 232, HAND_PLAYED: 264}
    for name, data in worst.items():
        assert sizes[name] <= _CAPS[name] * 0.7, name
        assert validate_hearts_event(name, data) == data, name


# --- the module hook -----------------------------------------------------------------


def test_the_module_checks_the_replay_events_and_passes_the_rest_through() -> None:
    assert get_module("hearts") is hearts_module
    opened = _first(HAND_OPENED)
    assert hearts_module.validate_event(HAND_OPENED, copy.deepcopy(opened)) == opened
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


def _without(base: dict[str, Any], *keys: str) -> dict[str, Any]:
    out = copy.deepcopy(base)
    for key in keys:
        del out[key]
    return out


_OPENED = _first(HAND_OPENED, lambda d: d["h"] == 2 and "p" in d)  # a pass-right hand
_HOLD = _first(HAND_OPENED, lambda d: "p" not in d)
_WITH_R = _with(_OPENED, r="000884000800")
_PLAYED = _first(HAND_PLAYED, lambda d: "s" in d and "n" not in d and "m" not in d)
_PART = _first(HAND_PLAYED, lambda d: "s" not in d)
_MOON = _first(HAND_PLAYED, lambda d: "m" in d)
_TAIL = _first(HAND_PLAYED, lambda d: "n" in d and "s" in d)


def test_the_hand_built_bases_are_valid() -> None:
    for name, data in (
        (HAND_OPENED, _OPENED),
        (HAND_OPENED, _HOLD),
        (HAND_OPENED, _WITH_R),
        (HAND_PLAYED, _PLAYED),
        (HAND_PLAYED, _PART),
        (HAND_PLAYED, _MOON),
        (HAND_PLAYED, _TAIL),
    ):
        assert validate_hearts_event(name, copy.deepcopy(data)) == data


def _swap_card(hands: list[str], seat: int, card: str) -> list[str]:
    """Hand ``seat`` with its first card replaced by ``card``."""
    out = list(hands)
    out[seat] = card + out[seat][2:]
    return out


_BAD: list[Any] = [
    # envelope, every type
    pytest.param(HAND_OPENED, _with(_OPENED, v=2), id="opened-unknown-version"),
    pytest.param(HAND_OPENED, _with(_OPENED, v=True), id="opened-version-true"),
    pytest.param(HAND_OPENED, _without(_OPENED, "v"), id="opened-no-version"),
    pytest.param(HAND_OPENED, _with(_OPENED, unit=-1), id="opened-negative-unit"),
    pytest.param(HAND_OPENED, _with(_OPENED, unit=2**31), id="opened-unit-past-int32"),
    pytest.param(HAND_OPENED, _with(_OPENED, t_ms="soon"), id="opened-time-not-a-number"),
    pytest.param(HAND_OPENED, _with(_OPENED, h=0), id="opened-hand-zero"),
    pytest.param(HAND_OPENED, _with(_OPENED, h=61), id="opened-hand-past-the-limit"),
    pytest.param(HAND_OPENED, _with(_OPENED, extra=1), id="opened-unknown-key"),
    pytest.param(
        HAND_OPENED, _with(_OPENED, actor={"seat": 0, "kind": "human"}), id="opened-actor-key"
    ),
    pytest.param(HAND_OPENED, _with(_OPENED, part=0, parts=2), id="opened-split"),
    # hand_opened
    pytest.param(HAND_OPENED, _without(_OPENED, "c"), id="opened-no-hands"),
    pytest.param(HAND_OPENED, _with(_OPENED, c=_OPENED["c"][:3]), id="opened-three-hands"),
    pytest.param(HAND_OPENED, _with(_OPENED, c="x" * 104), id="opened-hands-a-string"),
    pytest.param(
        HAND_OPENED,
        _with(_OPENED, c=[_OPENED["c"][0][:-2], *_OPENED["c"][1:]]),
        id="opened-12-cards",
    ),
    pytest.param(
        HAND_OPENED,
        _with(_OPENED, c=[_OPENED["c"][0][:-2] + "1S", *_OPENED["c"][1:]]),
        id="opened-bad-rank",
    ),
    pytest.param(
        HAND_OPENED,
        _with(_OPENED, c=[_OPENED["c"][0][:-2] + "2X", *_OPENED["c"][1:]]),
        id="opened-bad-suit",
    ),
    pytest.param(
        HAND_OPENED,
        _with(_OPENED, c=_swap_card(_OPENED["c"], 0, _OPENED["c"][1][:2])),
        id="opened-a-card-twice",
    ),
    pytest.param(HAND_OPENED, _with(_OPENED, d=0), id="opened-direction-not-the-hands"),
    pytest.param(HAND_OPENED, _with(_OPENED, d=4), id="opened-direction-out-of-range"),
    pytest.param(HAND_OPENED, _without(_OPENED, "p"), id="opened-pass-hand-without-a-pass"),
    pytest.param(HAND_OPENED, _with(_HOLD, p=_OPENED["p"]), id="opened-hold-hand-with-a-pass"),
    pytest.param(HAND_OPENED, _with(_HOLD, r="000000000001"), id="opened-hold-hand-principles"),
    pytest.param(HAND_OPENED, _with(_OPENED, p=_OPENED["p"][:3]), id="opened-pass-three-seats"),
    pytest.param(
        HAND_OPENED,
        _with(_OPENED, p=[_OPENED["p"][0][:4], *_OPENED["p"][1:]]),
        id="opened-pass-two-cards",
    ),
    pytest.param(
        HAND_OPENED,
        _with(_OPENED, p=[_OPENED["p"][1], *_OPENED["p"][1:]]),
        id="opened-pass-a-card-twice",
    ),
    pytest.param(
        HAND_OPENED,
        _with(_OPENED, p=[_OPENED["c"][1][:6], *_OPENED["p"][1:]]),
        id="opened-passed-a-card-not-dealt",
    ),
    pytest.param(HAND_OPENED, _with(_OPENED, r="12345"), id="opened-principles-wrong-length"),
    pytest.param(HAND_OPENED, _with(_OPENED, r="00088400080x"), id="opened-principles-not-digits"),
    # hand_played
    pytest.param(HAND_PLAYED, _without(_PLAYED, "c"), id="played-no-plays"),
    pytest.param(HAND_PLAYED, _without(_PLAYED, "l"), id="played-no-lead"),
    pytest.param(HAND_PLAYED, _with(_PLAYED, l=4), id="played-lead-out-of-range"),
    pytest.param(HAND_PLAYED, _with(_PLAYED, n=1), id="played-first-trick-sent-as-1"),
    pytest.param(HAND_PLAYED, _with(_PLAYED, n=14), id="played-trick-fourteen"),
    pytest.param(HAND_PLAYED, _with(_PLAYED, c=_PLAYED["c"][:-2]), id="played-a-trick-short"),
    pytest.param(
        HAND_PLAYED, _with(_PLAYED, c=_PLAYED["c"][:96]), id="played-12-tricks-with-a-score"
    ),
    pytest.param(HAND_PLAYED, _with(_PLAYED, c=_PLAYED["c"] + "2C2C2C2C"), id="played-14-tricks"),
    pytest.param(
        HAND_PLAYED,
        _with(_PLAYED, c=_PLAYED["c"][:96] + _PLAYED["c"][:8]),
        id="played-a-card-twice",
    ),
    pytest.param(HAND_PLAYED, _with(_PLAYED, c=["2C", "3C", "4C", "5C"]), id="played-a-list"),
    pytest.param(HAND_PLAYED, _with(_PART, n=12), id="played-part-runs-past-13"),
    pytest.param(
        HAND_PLAYED, _with(_PART, r="0" * len(_PART["c"])), id="played-principles-all-zero"
    ),
    pytest.param(HAND_PLAYED, _with(_PART, r="12"), id="played-principles-wrong-length"),
    pytest.param(
        HAND_PLAYED, _with(_PART, s=_PLAYED["s"], t=_PLAYED["t"]), id="played-part-with-a-score"
    ),
    pytest.param(HAND_PLAYED, _without(_PLAYED, "s"), id="played-ends-the-hand-without-a-score"),
    pytest.param(HAND_PLAYED, _without(_PLAYED, "t"), id="played-ends-the-hand-without-totals"),
    pytest.param(HAND_PLAYED, _with(_PLAYED, s=[13, 13, 13, 13]), id="played-deltas-sum-52"),
    pytest.param(HAND_PLAYED, _with(_PLAYED, s=[27, 0, 0, 0]), id="played-delta-past-26"),
    pytest.param(HAND_PLAYED, _with(_PLAYED, s=[13, 0, 13]), id="played-three-seats"),
    pytest.param(HAND_PLAYED, _with(_PLAYED, s=[13.0, 0, 13, 0]), id="played-float"),
    pytest.param(HAND_PLAYED, _with(_PLAYED, t=[-1, 0, 13, 0]), id="played-negative-total"),
    pytest.param(HAND_PLAYED, _without(_MOON, "m"), id="played-moon-without-shooter"),
    pytest.param(HAND_PLAYED, _with(_PLAYED, m=1), id="played-shooter-without-moon"),
    pytest.param(
        HAND_PLAYED, _with(_MOON, m=(_MOON["m"] + 1) % 4), id="played-shooter-took-points"
    ),
    pytest.param(HAND_PLAYED, _with(_MOON, m=4), id="played-shooter-out-of-range"),
    pytest.param(HAND_PLAYED, _with(_PART, m=1), id="played-moon-on-a-part"),
]


@pytest.mark.parametrize(("name", "bad"), _BAD)
def test_rejects_a_malformed_payload(name: str, bad: dict[str, Any], sent: list) -> None:
    assert validate_hearts_event(name, bad) is None
    # one report, by type and reason: neither the cards nor the scores reach Sentry
    assert len(sent) == 1
    assert sent[0][0] == f"hearts event: {name} invalid"


@pytest.mark.parametrize("name", EVENT_TYPES)
def test_an_event_over_its_cap_is_dropped_by_bytes(name: str, sent: list) -> None:
    good = {HAND_OPENED: _OPENED, HAND_PLAYED: _PLAYED}[name]
    padded = {**good, "pad": "x" * _CAPS[name]}
    assert validate_hearts_event(name, padded) is None
    assert [m for m, _ in sent] == [f"hearts event: {name} oversize"]


def test_the_cap_is_inclusive(monkeypatch: pytest.MonkeyPatch, sent: list) -> None:
    size = _compact(_MOON)
    monkeypatch.setitem(hearts_events._CAPS, HAND_PLAYED, size)
    assert validate_hearts_event(HAND_PLAYED, copy.deepcopy(_MOON)) == _MOON
    monkeypatch.setitem(hearts_events._CAPS, HAND_PLAYED, size - 1)
    assert validate_hearts_event(HAND_PLAYED, copy.deepcopy(_MOON)) is None
    assert [m for m, _ in sent] == ["hearts event: hand_played oversize"]


def test_an_unserialisable_payload_is_dropped_not_raised() -> None:
    assert validate_hearts_event(HAND_PLAYED, {"v": 1, "s": [object()]}) is None


def test_drop_reports_carry_no_player_data(sent: list, caplog: pytest.LogCaptureFixture) -> None:
    bad = _with(_PLAYED, unit=424242, s=[13, 13, 13, 13])
    with caplog.at_level(logging.WARNING, logger="hearts.events"):
        assert validate_hearts_event(HAND_PLAYED, bad) is None
    text = json.dumps(sent, default=str) + caplog.text
    assert "424242" not in text
    assert _PLAYED["c"][:8] not in text
    assert "dropped an invalid hand_played" in caplog.text


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
        ("HEARTS_HAND_OPENED_MAX_BYTES", MAX_HAND_OPENED_BYTES),
        ("HEARTS_HAND_PLAYED_MAX_BYTES", MAX_HAND_PLAYED_BYTES),
    ):
        m = re.search(rf"export const {const}\s*=\s*(\d+)\s*;", ts)
        assert m, f"{const} not found in eventQueueConfig.ts"
        assert int(m.group(1)) == value, const


def test_every_cap_is_far_under_the_per_event_row_cap() -> None:
    # the app's queue holds 8 KB per row (MAX_EVENT_PAYLOAD_BYTES); these are a few hundred B
    assert max(_CAPS.values()) <= 512
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
                {"event_index": 0, "event_type": HAND_OPENED, "data": _OPENED},
                {
                    "event_index": 1,
                    "event_type": HAND_PLAYED,
                    "data": _with(_PLAYED, s=[1, 1, 1, 1]),
                },
                {"event_index": 2, "event_type": HAND_PLAYED, "data": _PLAYED},
                {"event_index": 3, "event_type": "game_ended", "data": {"final_score": 1}},
            ],
        )
    assert r.status_code == 200, r.text
    # A refused replay event cuts the game's replay there (the stored replay is a prefix by
    # index, #3318), so the good row after it is dropped with it; the lifecycle row is kept.
    assert r.json() == {"accepted": 2, "duplicates": 0, "rejected": [], "dropped": 1}
    rows = await _stored(gid)
    assert [e.event_index for e in rows] == [0, 3]
    assert rows[0].data == _OPENED
    assert [m for m, _ in sent] == ["hearts event: hand_played invalid"]
    assert "dropped an invalid hand_played" in caplog.text


@pytest.mark.parametrize("game", _GAME_NAMES)
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
    r = _post(gid, [{"event_index": 0, "event_type": "not_a_hearts_event", "data": {}}])
    assert r.status_code == 400


async def test_the_replaced_four_event_design_was_never_seeded() -> None:
    gid = _new_game()
    for name in ("hand_dealt", "pass_committed", "trick_completed", "hand_scored"):
        assert _post(gid, [{"event_index": 0, "event_type": name, "data": {}}]).status_code == 400


# --- the per-game cap ----------------------------------------------------------------------------


def _worst_game(hands: int) -> list[dict[str, Any]]:
    """`hands` hands at the widest digits every number can have (jsonb text adds spaces)."""
    worst = _worst()
    rows: list[dict[str, Any]] = []
    for h in range(1, hands + 1):
        rows.append({**worst[HAND_OPENED], "h": h, "d": (h - 1) % 4})
        rows.append({**worst[HAND_PLAYED], "h": h})
    return rows


def test_the_longest_possible_game_is_sixteen_hands() -> None:
    """Every non-moon hand deals 26 points among four players (a moon hand 78), and a game
    ends when one reaches 100: with all four at 99 the total is 396, 15 hands of 26 are 390,
    so a 16th hand always ends the game."""
    assert 26 * 15 <= 4 * 99 < 26 * 16


def test_the_longest_game_at_its_widest_fits_the_default_cap_and_the_40kb_plan() -> None:
    rows = _worst_game(16)
    sizes = [event_bytes(r) for r in rows]
    assert cap_for("hearts") is DEFAULT_CAP  # Hearts has no override of its own
    assert apply_cap(DEFAULT_CAP, 0, 0, sizes).dropped == 0
    assert len(rows) == 32
    assert len(rows) <= DEFAULT_CAP.max_events * 0.1
    # the epic plans 40 KB a game (DATA-INVENTORY §2a): the longest game at the widest digits
    # stays under it, row overhead included
    assert sum(sizes) == 15_054  # the figure in the cap comment (games/replay_caps.py)
    assert sum(sizes) < 40 * 1024 / 2
    # and the row overhead is under half of what is stored, not two thirds
    assert ROW_OVERHEAD_BYTES * len(rows) < sum(sizes) * 0.5


def _worst_game_in_parts(hands: int, parts: int = 3) -> list[dict[str, Any]]:
    """The costliest game the app can make: backgrounded after the first trick again and again.
    A hand is its opening, `parts` one-trick parts (the cap, hearts/replay.ts ``MAX_PARTS_PER_HAND``)
    and a last row with the other 10 tricks and the score, the widest digits throughout; the
    last hand is left instead (one more one-trick part, no score)."""
    worst = _worst()
    plays = worst[HAND_PLAYED]["c"]
    env = {"v": 1, "unit": 900, "t_ms": 2**31 - 1}
    rows: list[dict[str, Any]] = []
    for h in range(1, hands + 1):
        rows.append({**worst[HAND_OPENED], "h": h, "d": (h - 1) % 4})
        for k in range(parts):
            part = {**env, "h": h, "l": 3, "c": plays[k * 8 : k * 8 + 8], "r": "8888"}
            if k:
                part["n"] = k + 1
            rows.append(part)
        last = {
            **env,
            "h": h,
            "n": parts + 1,
            "l": 3,
            "c": plays[parts * 8 :],
            "r": "8" * (52 - 4 * parts),
        }
        if h == hands:  # the game is left instead of finished
            rows.append(
                {
                    **env,
                    "h": h,
                    "n": parts + 1,
                    "l": 3,
                    "c": plays[parts * 8 : parts * 8 + 8],
                    "r": "8888",
                }
            )
        else:
            rows.append({**last, **{k: v for k, v in worst[HAND_PLAYED].items() if k in "stm"}})
    return rows


def test_the_costliest_game_with_every_part_the_app_can_make_stays_under_the_40kb_plan() -> None:
    """Background after every trick, blur after every trick, 16 hands: the app caps a hand at
    3 parts before its last row, so a hand is at most 5 rows, not 14."""
    rows = _worst_game_in_parts(16)
    sizes = [event_bytes(r) for r in rows]
    assert apply_cap(DEFAULT_CAP, 0, 0, sizes).dropped == 0
    assert len(rows) == 16 * 5
    assert (
        sum(sizes) == WORST_IN_PARTS_BYTES
    )  # the figure in the cap comment (games/replay_caps.py)
    assert sum(sizes) < 40 * 1024
    # unbounded (a part after every one of 12 tricks) it would not: the reason for the cap
    unbounded = [event_bytes(r) for r in _worst_game_in_parts(16, parts=12)]
    assert sum(unbounded) > 40 * 1024


def test_a_real_game_costs_about_ten_kb_stored() -> None:
    games = _games()
    six = [event_bytes(e["data"]) for e in games["six_hands"]]
    assert (len(six), sum(six)) == (12, 5_392)  # the figures in the cap comment
    for game in games.values():
        assert sum(event_bytes(e["data"]) for e in game) < 40 * 1024 / 4


# --- migration 0039 ---------------------------------------------------------------------------------

_REVISION = "0039_hearts_hand_events"
_HEARTS = 7


def _before() -> str:
    """The revision 0039 sits on: read from the script, so re-pointing it at merge breaks nothing."""
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    cfg.set_main_option("prepend_sys_path", "")
    down = ScriptDirectory.from_config(cfg).get_revision(_REVISION).down_revision
    assert isinstance(down, str)
    return down


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
    alembic("upgrade", _before())
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
            for name in ("hand_played", "game_ended")
        }
        # stored rows, to prove the downgrade clears the new types' dependants only
        gid = uuid.uuid4().hex
        conn.execute(
            f"INSERT INTO games (id, session_id, game_type_id, metadata) VALUES (?, 's', {_HEARTS}, '{{}}')",
            (gid,),
        )
        for idx, type_id in ((0, ids["hand_played"]), (1, ids["game_ended"])):
            conn.execute(
                "INSERT INTO game_events (game_id, event_index, event_type_id, data) "
                "VALUES (?, ?, ?, '{}')",
                (gid, idx, type_id),
            )
    assert display["hand_opened"] == "Hand Opened"
    assert display["hand_played"] == "Hand Played"
    assert _event_names(migration_db_path) == sorted([*before, *EVENT_TYPES])

    alembic("downgrade", "-1")
    assert _event_names(migration_db_path) == before
    with sqlite3.connect(migration_db_path) as conn:
        assert conn.execute("SELECT event_index FROM game_events").fetchall() == [(1,)]


def test_the_migration_is_seed_only_and_the_chain_has_one_head() -> None:
    src = (BACKEND / "alembic" / "versions" / "0039_hearts_hand_events.py").read_text(
        encoding="utf-8"
    )
    for schema_call in (
        "create_table",
        "add_column",
        "drop_column",
        "create_index",
        "alter_column",
    ):
        assert schema_call not in src
    # the parent can change when the chain does: only the shape of the chain is pinned
    assert len(script_heads()) == 1
    assert _before()
