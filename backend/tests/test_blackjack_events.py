"""Blackjack replay events: validation, storage, replay script, migration 0040 (#3284, epic #3273).

The app (``frontend/src/game/blackjack/replay.ts``) records a run one round at a
time. ``fixtures/blackjack_replay_v1.json`` is a scripted run as the app recorded
it (a split with a double and a dealer bust, a double, a natural, a player bust and
a dealer bust); the app's golden test keeps it equal to what the recorder emits,
and the tests below hold the backend to it: every event validates and is stored as
sent, and the replay prints every card.
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

from blackjack.events import EVENT_TYPES, MAX_EVENT_BYTES, validate_hand_event
from blackjack.replay import hand_value, render_rounds, rounds
from db.base import get_session_factory
from db.models import GameEntitlement, GameEvent
from games.registry import get_module
from main import app
from observability import report
from tests._helpers import session_headers as _headers
from tests._migration_helpers import Alembic

client = TestClient(app)

_FIXTURE = Path(__file__).parent / "fixtures" / "blackjack_replay_v1.json"
_SID = str(uuid.uuid4())


def _run() -> dict[str, Any]:
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))


def _events(run: dict[str, Any] | None = None) -> list[tuple[str, dict[str, Any]]]:
    return [(e["type"], e["data"]) for e in (run or _run())["events"]]


@pytest.fixture(autouse=True)
def sent(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, dict[str, Any]]]:
    """Sentry messages, captured: a dropped event reports once, by reason only."""
    calls: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(report.sentry_sdk, "capture_message", lambda m, **kw: calls.append((m, kw)))
    return calls


# ---------------------------------------------------------------------------
# the app's real payloads
# ---------------------------------------------------------------------------


def test_the_fixture_is_the_run_the_story_names() -> None:
    types = [t for t, _ in _events()]
    assert set(types) == EVENT_TYPES
    actions = [d["a"] for t, d in _events() if t == "player_action"]
    assert "p" in actions and "d" in actions  # a split and a double
    assert any(d.get("b") == 1 for t, d in _events() if t == "dealer_played")  # a dealer bust


def test_every_real_event_validates_and_is_stored_as_sent() -> None:
    module = get_module("blackjack")
    for name, data in _events():
        assert module.validate_event(name, copy.deepcopy(data)) == data, (name, data)


def test_the_real_events_are_inside_the_byte_cap() -> None:
    for name, data in _events():
        assert len(json.dumps(data, separators=(",", ":"))) <= MAX_EVENT_BYTES, (name, data)


def test_lifecycle_events_pass_through() -> None:
    module = get_module("blackjack")
    assert module.validate_event("game_started", {"starting_chips": 100}) == {"starting_chips": 100}
    assert module.validate_event("game_ended", {"outcome": "win"}) == {"outcome": "win"}


@pytest.mark.parametrize("name", sorted(EVENT_TYPES))
def test_an_empty_payload_is_dropped(name: str) -> None:
    assert validate_hand_event(name, {}) is None


def _first(name: str) -> dict[str, Any]:
    return copy.deepcopy(next(d for t, d in _events() if t == name))


def _with(name: str, **changes: Any) -> dict[str, Any]:
    data = _first(name)
    data.update(changes)
    return data


def _without(name: str, key: str) -> dict[str, Any]:
    data = _first(name)
    del data[key]
    return data


def _action(kind: str) -> dict[str, Any]:
    return copy.deepcopy(next(d for t, d in _events() if t == "player_action" and d["a"] == kind))


@pytest.mark.parametrize(
    ("name", "bad"),
    [
        pytest.param("bet_placed", _with("bet_placed", v=2), id="bet-unknown-version"),
        pytest.param("bet_placed", _with("bet_placed", v=True), id="bet-version-true"),
        pytest.param("bet_placed", _with("bet_placed", amount=0), id="bet-zero"),
        pytest.param("bet_placed", _with("bet_placed", amount=1.5), id="bet-fractional"),
        pytest.param("bet_placed", _with("bet_placed", chips_remaining=-1), id="negative-chips"),
        pytest.param("bet_placed", _with("bet_placed", extra=1), id="bet-unknown-key"),
        pytest.param("bet_placed", _without("bet_placed", "unit"), id="bet-no-unit"),
        pytest.param("bet_placed", _with("bet_placed", t_ms=-1), id="negative-time"),
        pytest.param("hand_dealt", _with("hand_dealt", p=["TS"]), id="one-player-card"),
        pytest.param("hand_dealt", _with("hand_dealt", p=["TS", "9D", "2C"]), id="three-dealt"),
        pytest.param("hand_dealt", _with("hand_dealt", d=["6C", "1D"]), id="not-a-card"),
        pytest.param("hand_dealt", _with("hand_dealt", d=["6C", "7X"]), id="not-a-suit"),
        pytest.param("hand_dealt", _with("hand_dealt", p=["10S", "9D"]), id="ten-is-T"),
        pytest.param("hand_dealt", _with("hand_dealt", p=["ts", "9D"]), id="lowercase-card"),
        pytest.param("hand_dealt", _with("hand_dealt", sh=0), id="no-shoe"),
        pytest.param("hand_dealt", _with("hand_dealt", rem=-1), id="negative-remaining"),
        pytest.param("hand_dealt", _without("hand_dealt", "d"), id="no-dealer-cards"),
        pytest.param("hand_dealt", _with("hand_dealt", dealer_up_card={}), id="mixed-shapes"),
        pytest.param("player_action", _with("player_action", a="x"), id="unknown-action"),
        pytest.param("player_action", _with("player_action", i=-1), id="negative-hand"),
        pytest.param("player_action", _with("player_action", i=99), id="hand-too-high"),
        pytest.param("player_action", {**_action("h"), "c": None}, id="hit-without-a-card"),
        pytest.param("player_action", {**_action("s"), "c": "TS"}, id="stand-with-a-card"),
        pytest.param("player_action", {**_action("d"), "c": "ZZ"}, id="double-bad-card"),
        pytest.param("player_action", {**_action("p"), "h": None}, id="split-without-hands"),
        pytest.param("player_action", {**_action("p"), "h": [["8S", "3D"]]}, id="split-one-hand"),
        pytest.param(
            "player_action", {**_action("p"), "h": [["8S"], ["8H", "KC"]]}, id="split-short-hand"
        ),
        pytest.param(
            "player_action",
            {**_action("h"), "h": [["8S", "3D"], ["8H", "KC"]]},
            id="hit-with-hands",
        ),
        pytest.param("dealer_played", _with("dealer_played", t=16), id="dealer-under-17"),
        pytest.param("dealer_played", _with("dealer_played", t=40), id="dealer-over-31"),
        pytest.param("dealer_played", _with("dealer_played", b=1, t=20), id="bust-flag-no-bust"),
        pytest.param("dealer_played", _without("dealer_played", "b"), id="bust-total-no-flag"),
        pytest.param("dealer_played", _with("dealer_played", b=True), id="bust-true"),
        pytest.param("dealer_played", _with("dealer_played", b=0), id="bust-zero"),
        pytest.param("dealer_played", _with("dealer_played", h="9"), id="dealer-bad-hole"),
        pytest.param("dealer_played", _with("dealer_played", d=["TS"] * 15), id="too-many-draws"),
        pytest.param("hand_resolved", _with("hand_resolved", o="won"), id="unknown-outcome"),
        pytest.param("hand_resolved", _with("hand_resolved", c=["TS"]), id="one-card-hand"),
        pytest.param("hand_resolved", _with("hand_resolved", c=["TS"] * 15), id="fifteen-cards"),
        pytest.param("hand_resolved", _with("hand_resolved", p="10"), id="payout-string"),
        pytest.param("hand_resolved", _with("hand_resolved", ch=-5), id="negative-chips-after"),
        pytest.param("hand_resolved", _with("hand_resolved", p=2**31), id="payout-past-int32"),
        pytest.param("hand_resolved", _without("hand_resolved", "c"), id="no-cards"),
        pytest.param("hand_resolved", _with("hand_resolved", actor={"seat": 0}), id="actor-key"),
    ],
)
def test_a_malformed_event_is_dropped_with_one_report_by_reason(
    name: str, bad: dict[str, Any], sent: list
) -> None:
    assert validate_hand_event(name, bad) is None
    assert len(sent) == 1
    assert sent[0][0] == f"blackjack event: {name} invalid"


def test_an_event_over_the_byte_cap_is_dropped(sent: list) -> None:
    data = _first("hand_resolved")
    data["c"] = ["TS"] * 14
    data["pad"] = "x" * MAX_EVENT_BYTES
    assert validate_hand_event("hand_resolved", data) is None
    assert [m for m, _ in sent] == ["blackjack event: hand_resolved oversize"]


def test_the_widest_possible_event_is_accepted() -> None:
    """A hand of 14 cards with the widest envelope: 166 B, the longest the app can send."""
    env = {"v": 1, "unit": 99_999, "t_ms": 86_400_000}
    widest = {
        "i": 3,
        "o": "blackjack",
        "p": -2_000_000_000,
        "ch": 2_000_000_000,
        "c": ["TD"] * 14,
        **env,
    }
    assert len(json.dumps(widest, separators=(",", ":"))) <= MAX_EVENT_BYTES
    assert validate_hand_event("hand_resolved", widest) == widest


def test_an_event_at_the_byte_cap_is_accepted_and_one_byte_over_is_not(sent: list) -> None:
    def padded(extra: int) -> dict[str, Any]:
        # a legacy-shaped payload (no ``v``) may carry extra keys: size it with one
        legacy = {
            "hand_index": 0,
            "outcome": "win",
            "payout_delta": 10,
            "chips_after": 110,
            "pad": "",
        }
        size = len(json.dumps(legacy, separators=(",", ":")))
        legacy["pad"] = "x" * (MAX_EVENT_BYTES - size + extra)
        return legacy

    at_cap = padded(0)
    assert len(json.dumps(at_cap, separators=(",", ":"))) == MAX_EVENT_BYTES
    assert validate_hand_event("hand_resolved", at_cap) == at_cap
    assert validate_hand_event("hand_resolved", padded(1)) is None
    assert len(sent) == 1


def test_an_unserialisable_payload_is_dropped_not_raised() -> None:
    assert validate_hand_event("hand_resolved", {"i": object()}) is None


def test_drop_reports_carry_no_player_data(sent: list) -> None:
    bad = _with("hand_resolved", o="won", ch=424_242, unit=777)
    assert validate_hand_event("hand_resolved", bad) is None
    text = json.dumps(sent, default=str)
    assert "424242" not in text
    assert "777" not in text


def test_the_byte_cap_matches_the_apps_registry() -> None:
    ts = (
        Path(__file__).resolve().parents[2]
        / "frontend"
        / "src"
        / "game"
        / "_shared"
        / "eventQueueConfig.ts"
    ).read_text(encoding="utf-8")
    m = re.search(r"export const BLACKJACK_EVENT_MAX_BYTES\s*=\s*(\d+)\s*;", ts)
    assert m, "BLACKJACK_EVENT_MAX_BYTES not found in eventQueueConfig.ts"
    assert int(m.group(1)) == MAX_EVENT_BYTES


# ---------------------------------------------------------------------------
# builds from before #3284
# ---------------------------------------------------------------------------

# What BlackjackGameContext sent before: no envelope, no ``v``.
_CARD = {"suit": "♠", "rank": "10"}
OLD_BUILD_EVENTS = [
    ("bet_placed", {"amount": 50, "chips_remaining": 950}),
    (
        "hand_dealt",
        {
            "player_hand": [_CARD, {"suit": "♥", "rank": "7"}],
            "dealer_up_card": {"suit": "♦", "rank": "K"},
            "is_player_blackjack": False,
        },
    ),
    ("hand_dealt", {"player_hand": [_CARD], "dealer_up_card": None, "is_player_blackjack": False}),
    ("player_action", {"action": "hit", "hand_index": 0, "hand_value_after": 19}),
    ("player_action", {"action": "split", "hand_index": 1, "hand_value_after": 17}),
    (
        "hand_resolved",
        {"hand_index": 0, "outcome": "blackjack", "payout_delta": 75, "chips_after": 1075},
    ),
    ("hand_resolved", {"hand_index": 1, "outcome": "lose", "payout_delta": -50, "chips_after": 0}),
]


@pytest.mark.parametrize(
    ("name", "data"),
    OLD_BUILD_EVENTS,
    ids=[f"{n}-{i}" for i, (n, _) in enumerate(OLD_BUILD_EVENTS)],
)
def test_an_older_builds_event_is_still_accepted_and_stored_as_sent(
    name: str, data: dict[str, Any], sent: list
) -> None:
    module = get_module("blackjack")
    assert module.validate_event(name, copy.deepcopy(data)) == data
    assert sent == []


@pytest.mark.parametrize(
    ("name", "bad"),
    [
        ("bet_placed", {"amount": -5, "chips_remaining": 1}),
        ("bet_placed", {"amount": 5}),
        ("hand_dealt", {"dealer_up_card": None}),
        ("hand_dealt", {"player_hand": "TS"}),
        ("player_action", {"action": "surrender", "hand_index": 0, "hand_value_after": 5}),
        ("player_action", {"action": "hit", "hand_index": 0}),
        ("hand_resolved", {"hand_index": 0, "outcome": "win"}),
        (
            "hand_resolved",
            {"hand_index": 0, "outcome": "win", "payout_delta": "x", "chips_after": 1},
        ),
    ],
)
def test_a_malformed_older_event_is_still_dropped(name: str, bad: dict[str, Any]) -> None:
    assert validate_hand_event(name, bad) is None


def test_there_is_no_older_dealer_played() -> None:
    """The type is new: without a ``v`` it has no shape to accept."""
    data = _first("dealer_played")
    del data["v"]
    assert validate_hand_event("dealer_played", data) is None


def test_the_two_shapes_do_not_mix() -> None:
    """A ``v`` selects the strict current schema: old keys beside it are an unknown-key error."""
    mixed = {**_first("hand_resolved"), "outcome": "win"}
    assert validate_hand_event("hand_resolved", mixed) is None


# ---------------------------------------------------------------------------
# append_events
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
async def _entitlements():
    async with get_session_factory()() as db:
        db.add(GameEntitlement(session_id=_SID, game_slug="blackjack"))
        await db.commit()


def _new_game() -> str:
    r = client.post("/games", headers=_headers(_SID), json={"game_type": "blackjack"})
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


async def test_the_real_run_is_stored_whole_in_order() -> None:
    gid = _new_game()
    events = [
        {"event_index": i, "event_type": name, "data": data}
        for i, (name, data) in enumerate(_events())
    ]
    r = _post(gid, events)
    assert r.status_code == 200, r.text
    assert r.json()["accepted"] == len(events)
    rows = await _stored(gid)
    assert [r_.data for r_ in rows] == [d for _, d in _events()]


async def test_an_older_builds_batch_is_accepted() -> None:
    gid = _new_game()
    events = [
        {"event_index": i, "event_type": name, "data": data}
        for i, (name, data) in enumerate(OLD_BUILD_EVENTS)
    ]
    r = _post(gid, events)
    assert r.status_code == 200, r.text
    assert r.json() == {"accepted": len(events), "duplicates": 0, "rejected": [], "dropped": 0}


async def test_a_mixed_batch_stores_the_valid_events_and_drops_the_bad_one(
    sent: list, caplog: pytest.LogCaptureFixture
) -> None:
    gid = _new_game()
    bad = _with("hand_dealt", p=["TS"])
    with caplog.at_level(logging.WARNING, logger="blackjack.events"):
        r = _post(
            gid,
            [
                {"event_index": 0, "event_type": "bet_placed", "data": _first("bet_placed")},
                {"event_index": 1, "event_type": "hand_dealt", "data": bad},
                {"event_index": 2, "event_type": "game_ended", "data": {"score": 10}},
            ],
        )
    assert r.status_code == 200, r.text
    assert r.json() == {"accepted": 2, "duplicates": 0, "rejected": [], "dropped": 0}
    assert [e.event_index for e in await _stored(gid)] == [0, 2]
    assert "dropped an invalid hand_dealt" in caplog.text
    assert [m for m, _ in sent] == ["blackjack event: hand_dealt invalid"]


def test_dealer_played_is_not_an_event_type_of_other_games() -> None:
    r = client.post("/games", headers=_headers(_SID), json={"game_type": "yacht"})
    if r.status_code != 200:  # no yacht entitlement for this session: not what is tested
        pytest.skip("yacht not available to the test session")
    gid = r.json()["id"]
    r = _post(gid, [{"event_index": 0, "event_type": "dealer_played", "data": {}}])
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# the replay prints every card
# ---------------------------------------------------------------------------


def _all_cards(events: list[tuple[str, dict[str, Any]]]) -> set[str]:
    """Every card code anywhere in the events."""
    found: set[str] = set()

    def walk(x: Any) -> None:
        if isinstance(x, str) and re.fullmatch(r"[A2-9TJQK][SHDC]", x):
            found.add(x)
        elif isinstance(x, list):
            for y in x:
                walk(y)
        elif isinstance(x, dict):
            for y in x.values():
                walk(y)

    for _, data in events:
        walk(data)
    return found


def test_the_replay_shows_every_card_of_a_session_with_a_split_and_a_dealer_bust() -> None:
    text = "\n".join(render_rounds(_events()))
    cards = _all_cards(_events())
    assert len(cards) > 20
    for card in cards:
        assert re.search(rf"\b{card}\b", text), f"{card} is missing from the replay"
    # the split, the double and the dealer's bust are in it
    assert "split    hand 1 -> 8S 3D | 8H KC" in text
    assert "double   hand 1 draws 9S -> 8S 3D 9S = 20" in text
    assert "dealer   hole 6C draws TS -> 6C TD TS = 26 BUST" in text
    assert "hand 1 8S 3D 9S = 20 WIN +20" in text
    assert "hand 2 8H KC = 18 WIN +10" in text


def test_the_replay_rebuilds_the_chip_count() -> None:
    run = _run()
    out = render_rounds(_events(run))
    assert out[-1] == f"run: 5 rounds, chips {run['starting_chips']} -> {run['final_chips']}"
    rebuilt = rounds(_events(run))
    assert [r.unit for r in rebuilt] == [1, 2, 3, 4, 5]
    assert rebuilt[0].chips_before == run["starting_chips"]
    assert rebuilt[-1].chips_after == run["final_chips"]


def test_the_replay_hand_values_follow_the_engine() -> None:
    assert hand_value(["8S", "3D", "9S"]) == 20
    assert hand_value(["AS", "KD"]) == 21
    assert hand_value(["AS", "AH", "9C"]) == 21
    assert hand_value(["TS", "6D", "KH"]) == 26


def test_an_older_builds_rounds_are_listed_without_cards() -> None:
    text = "\n".join(render_rounds(OLD_BUILD_EVENTS))
    assert "recorded by an older build" in text


def test_a_round_with_events_missing_is_shown_as_far_as_it_goes() -> None:
    events = [(n, d) for n, d in _events() if n != "bet_placed"]
    text = "\n".join(render_rounds(events))
    assert "bet ?" in text
    assert "8S 3D" in text


def test_the_script_prints_the_rounds_for_a_blackjack_game() -> None:
    import importlib.util
    import sys

    path = Path(__file__).parent.parent / "scripts" / "replay_game.py"
    spec = importlib.util.spec_from_file_location("replay_game_bj", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules["replay_game_bj"] = mod
    spec.loader.exec_module(mod)
    game = mod.GameRow(
        id=uuid.uuid4(),
        game_type="blackjack",
        started_at=None,
        completed_at=None,
        outcome="abandoned",
        final_score=None,
        duration_ms=None,
        metadata={},
    )
    rows = [mod.EventRow(i, name, None, data) for i, (name, data) in enumerate(_events())]
    text = mod.render(game, rows, max_chars=40)  # payloads cut short: the rounds are not
    assert "blackjack rounds, rebuilt from the events:" in text
    for card in _all_cards(_events()):
        assert re.search(rf"\b{card}\b", text.split("blackjack rounds")[1])
    other = mod.GameRow(**{**game.__dict__, "game_type": "yacht"})
    assert "blackjack rounds" not in mod.render(other, rows)


# ---------------------------------------------------------------------------
# migration 0040
# ---------------------------------------------------------------------------

_BEFORE = "0035_games_event_counters"
_REVISION = "0040_blackjack_dealer_events"


def _event_names(db_path: Path) -> list[str]:
    with sqlite3.connect(db_path) as conn:
        return [
            r[0]
            for r in conn.execute(
                "SELECT name FROM event_types WHERE game_type_id = 3 ORDER BY name"
            )
        ]


def test_the_migration_adds_and_removes_only_the_dealer_event(
    migration_db_path: Path, alembic: Alembic
) -> None:
    alembic("upgrade", _BEFORE)
    before = _event_names(migration_db_path)
    assert "dealer_played" not in before
    assert "hand_dealt" in before  # seeded long ago, untouched

    alembic("upgrade", _REVISION)
    with sqlite3.connect(migration_db_path) as conn:
        row = conn.execute(
            "SELECT display_name FROM event_types WHERE game_type_id = 3 AND name = 'dealer_played'"
        ).fetchone()
        et = conn.execute(
            "SELECT id FROM event_types WHERE game_type_id = 3 AND name = 'dealer_played'"
        ).fetchone()[0]
        keep = conn.execute(
            "SELECT id FROM event_types WHERE game_type_id = 3 AND name = 'hand_resolved'"
        ).fetchone()[0]
        # a stored dealer_played row, to prove the downgrade clears its dependants
        gid = uuid.uuid4().hex
        conn.execute(
            "INSERT INTO games (id, session_id, game_type_id, metadata) VALUES (?, 's', 3, '{}')",
            (gid,),
        )
        for idx, type_id in ((0, et), (1, keep)):
            conn.execute(
                "INSERT INTO game_events (game_id, event_index, event_type_id, data) "
                "VALUES (?, ?, ?, '{}')",
                (gid, idx, type_id),
            )
    assert row == ("Dealer Played",)
    assert _event_names(migration_db_path) == sorted([*before, "dealer_played"])

    alembic("downgrade", "-1")
    assert _event_names(migration_db_path) == before
    with sqlite3.connect(migration_db_path) as conn:
        assert conn.execute("SELECT event_index FROM game_events").fetchall() == [(1,)]


def test_the_migration_changes_no_schema(migration_db_path: Path, alembic: Alembic) -> None:
    alembic("upgrade", _BEFORE)

    def schema() -> list[tuple[str, str]]:
        with sqlite3.connect(migration_db_path) as conn:
            return sorted(
                (n, s or "") for n, s in conn.execute("SELECT name, sql FROM sqlite_master")
            )

    before = schema()
    alembic("upgrade", _REVISION)
    assert schema() == before
