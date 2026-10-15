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
    assert set(types) == {"round_played", "hand_resolved"}
    assert types.count("round_played") == 5
    actions = [a[0] for t, d in _events() if t == "round_played" for a in d.get("a", [])]
    assert "p" in actions and "d" in actions  # a split and a double
    assert any(d.get("dl", {}).get("b") == 1 for t, d in _events() if t == "round_played")


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


def _round(**changes: Any) -> dict[str, Any]:
    """The fixture's first round (a split, a double, a stand, a dealer bust) with changes."""
    data = _first("round_played")
    data.update(changes)
    return data


@pytest.mark.parametrize(
    ("name", "bad"),
    [
        pytest.param("round_played", _round(v=2), id="round-unknown-version"),
        pytest.param("round_played", _round(v=True), id="round-version-true"),
        pytest.param("round_played", _without("round_played", "unit"), id="round-no-unit"),
        pytest.param("round_played", _round(t_ms=-1), id="negative-time"),
        pytest.param("round_played", _round(extra=1), id="round-unknown-key"),
        pytest.param("round_played", _without("round_played", "b"), id="no-bet"),
        pytest.param("round_played", _round(b=[0, 100]), id="zero-bet"),
        pytest.param("round_played", _round(b=[10]), id="bet-one-item"),
        pytest.param("round_played", _round(b=[10.5, 100]), id="fractional-bet"),
        pytest.param("round_played", _round(b=[50, 40]), id="bet-over-chips"),
        pytest.param("round_played", _round(b=[True, 100]), id="bet-true"),
        pytest.param("round_played", _without("round_played", "p"), id="no-deal-not-resumed"),
        pytest.param("round_played", _round(p=["TS"]), id="one-player-card"),
        pytest.param("round_played", _round(p=["TS", "9D", "2C"]), id="three-dealt"),
        pytest.param("round_played", _round(d=["6C", "1D"]), id="not-a-card"),
        pytest.param("round_played", _round(d=["6C", "7X"]), id="not-a-suit"),
        pytest.param("round_played", _round(p=["10S", "9D"]), id="ten-is-T"),
        pytest.param("round_played", _round(p=["ts", "9D"]), id="lowercase-card"),
        pytest.param("round_played", _round(sh=0), id="no-shoe"),
        pytest.param("round_played", _round(rem=-1), id="negative-remaining"),
        pytest.param("round_played", _without("round_played", "d"), id="no-dealer-cards"),
        pytest.param("round_played", _round(r=0), id="resumed-zero"),
        pytest.param("round_played", _round(r=True), id="resumed-true"),
        pytest.param("round_played", _round(a="hit"), id="actions-not-a-list"),
        pytest.param("round_played", _round(a=[["x", 0]]), id="unknown-action"),
        pytest.param("round_played", _round(a=[["h", 0]]), id="hit-without-a-card"),
        pytest.param("round_played", _round(a=[["h", 0, "ZZ"]]), id="hit-bad-card"),
        pytest.param("round_played", _round(a=[["s", 0, "TS"]]), id="stand-with-a-card"),
        pytest.param("round_played", _round(a=[["h", -1, "TS"]]), id="negative-hand"),
        pytest.param("round_played", _round(a=[["h", 99, "TS"]]), id="hand-too-high"),
        pytest.param("round_played", _round(a=[["h", True, "TS"]]), id="hand-true"),
        pytest.param("round_played", _round(a=[["p", 0]]), id="split-without-hands"),
        pytest.param("round_played", _round(a=[["p", 0, [["8S", "3D"]]]]), id="split-one-hand"),
        pytest.param(
            "round_played", _round(a=[["p", 0, [["8S"], ["8H", "KC"]]]]), id="split-short-hand"
        ),
        pytest.param("round_played", _round(a=[["d", 0, "9S", "x"]]), id="action-four-items"),
        pytest.param("round_played", _round(a=[["s", 0]] * 97), id="too-many-actions"),
        pytest.param("round_played", _round(dl={"d": [], "t": 16}), id="dealer-under-17"),
        pytest.param("round_played", _round(dl={"d": [], "t": 40}), id="dealer-over-31"),
        pytest.param("round_played", _round(dl={"d": [], "t": 20, "b": 1}), id="bust-no-bust"),
        pytest.param("round_played", _round(dl={"d": [], "t": 26}), id="bust-total-no-flag"),
        pytest.param("round_played", _round(dl={"d": [], "t": 26, "b": True}), id="bust-true"),
        pytest.param("round_played", _round(dl={"d": [], "t": 26, "b": 0}), id="bust-zero"),
        pytest.param("round_played", _round(dl={"d": ["TS"] * 23, "t": 20}), id="dealer-23-draws"),
        pytest.param("round_played", _round(dl={"t": 20}), id="dealer-no-draws-key"),
        pytest.param(
            "round_played", _round(dl={"d": [], "t": 20, "h": "6C"}), id="dealer-extra-key"
        ),
        pytest.param("hand_resolved", _with("hand_resolved", v=2), id="resolved-unknown-version"),
        pytest.param("hand_resolved", _with("hand_resolved", o="won"), id="unknown-outcome"),
        pytest.param("hand_resolved", _with("hand_resolved", i=-1), id="negative-hand-index"),
        pytest.param("hand_resolved", _with("hand_resolved", i=99), id="hand-index-too-high"),
        pytest.param("hand_resolved", _with("hand_resolved", c=["TS"]), id="one-card-hand"),
        pytest.param("hand_resolved", _with("hand_resolved", c=["TS"] * 23), id="23-cards"),
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


def test_a_resumed_round_has_no_deal_and_is_accepted() -> None:
    data = _round(r=1, a=[["s", 0]])
    del data["p"]
    assert validate_hand_event("round_played", data) == data


@pytest.mark.parametrize("field", ["p", "dl", "r"])
def test_an_explicit_null_is_rejected_where_the_app_omits_the_field(field: str) -> None:
    """``{"p": null, "r": 1}`` used to pass and then crash the replay: absent or a value, never null."""
    data = _round(r=1)
    data[field] = None
    assert validate_hand_event("round_played", data) is None


def test_a_round_without_actions_or_a_dealer_is_accepted() -> None:
    """A natural: the bet and the deal, nothing else."""
    data = _round()
    del data["a"], data["dl"]
    assert validate_hand_event("round_played", data) == data


@pytest.mark.parametrize("name", ["bet_placed", "hand_dealt", "player_action"])
def test_the_per_action_types_are_for_older_builds_only(name: str, sent: list) -> None:
    """New builds send ``round_played``: those three with a ``v`` are dropped."""
    legacy = next(d for n, d in OLD_BUILD_EVENTS if n == name)
    assert validate_hand_event(name, {**legacy, "v": 1, "unit": 1, "t_ms": 0}) is None
    assert len(sent) == 1


# a hand can hold 21 cards without busting (aces and twos from a 6-deck shoe), plus the busting draw
_ACES = ["AS", "AH", "AD", "AC"] * 5 + ["2S", "2H"]  # 22 cards: 20 aces, two 2s


def test_a_hand_of_22_cards_is_accepted_everywhere_and_23_is_not() -> None:
    assert len(_ACES) == 22
    resolved = _with("hand_resolved", c=_ACES)
    assert validate_hand_event("hand_resolved", resolved) == resolved
    dealer = _round(dl={"d": _ACES, "t": 26, "b": 1})
    assert validate_hand_event("round_played", dealer) == dealer
    assert validate_hand_event("hand_resolved", _with("hand_resolved", c=_ACES + ["2C"])) is None
    assert (
        validate_hand_event("round_played", _round(dl={"d": _ACES + ["2C"], "t": 26, "b": 1}))
        is None
    )


def test_the_widest_legal_events_fit_the_byte_cap() -> None:
    """Widest legal hand_resolved (22 cards) and round_played (one hand hit 20 times, a dealer
    drawing 22, the widest numbers and envelope): both well under the cap the app shares."""
    env = {"v": 1, "unit": 99_999, "t_ms": 86_400_000}
    resolved = {
        "i": 3,
        "o": "blackjack",
        "p": -2_000_000_000,
        "ch": 2_000_000_000,
        "c": _ACES,
        **env,
    }
    widest_round = {
        "b": [2_000_000_000, 2_000_000_000],
        "p": ["AS", "AH"],
        "d": ["AD", "AC"],
        "sh": 832,
        "rem": 832,
        "a": [["h", 0, c] for c in _ACES[2:]],
        "dl": {"d": _ACES, "t": 26, "b": 1},
        **env,
    }
    sizes = {
        n: len(json.dumps(d, separators=(",", ":")))
        for n, d in {"hand_resolved": resolved, "round_played": widest_round}.items()
    }
    assert sizes == {"hand_resolved": 206, "round_played": 517}
    assert max(sizes.values()) <= MAX_EVENT_BYTES
    assert validate_hand_event("hand_resolved", resolved) == resolved
    assert validate_hand_event("round_played", widest_round) == widest_round


def _four_hand_round(hits_per_hand: int) -> dict[str, Any]:
    """A round split to four hands (three splits, the engine's most) and each hit many times."""
    env = {"v": 1, "unit": 99_999, "t_ms": 86_400_000}
    actions: list[list[Any]] = [
        ["p", 0, [["8S", "8D"], ["8H", "8C"]]],
        ["p", 0, [["8S", "AS"], ["8D", "AH"]]],
        ["p", 2, [["8H", "AD"], ["8C", "AC"]]],
    ]
    actions += [["h", hand, "2S"] for hand in range(4) for _ in range(hits_per_hand)]
    actions += [["s", hand] for hand in range(4)]
    return {
        "b": [2_000_000_000, 2_000_000_000],
        "p": ["8S", "8H"],
        "d": ["TD", "6C"],
        "sh": 832,
        "rem": 832,
        "a": actions,
        "dl": {"d": ["2S"] * 12, "t": 26, "b": 1},
        **env,
    }


def test_a_four_hand_re_split_is_wider_than_the_single_hand_worst_case_but_fits_the_cap() -> None:
    """The 517 B round (one hand hit 20 times) is the widest SINGLE-hand round. Splitting to four
    hands and hitting each ten times is about 850-950 B: wider, and still under the cap."""
    wide = _four_hand_round(hits_per_hand=10)
    size = len(json.dumps(wide, separators=(",", ":")))
    assert 850 <= size <= 950, size
    assert size < MAX_EVENT_BYTES
    assert validate_hand_event("round_played", wide) == wide


def test_an_event_over_the_byte_cap_is_dropped(sent: list) -> None:
    data = _first("hand_resolved")
    data["pad"] = "x" * MAX_EVENT_BYTES
    assert validate_hand_event("hand_resolved", data) is None
    assert [m for m, _ in sent] == ["blackjack event: hand_resolved oversize"]


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


def test_there_is_no_older_round_played() -> None:
    """The type is new: without a ``v`` it has no shape to accept."""
    data = _first("round_played")
    del data["v"]
    assert validate_hand_event("round_played", data) is None


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
    bad = _round(p=["TS"])
    with caplog.at_level(logging.WARNING, logger="blackjack.events"):
        r = _post(
            gid,
            [
                {"event_index": 0, "event_type": "round_played", "data": _first("round_played")},
                {"event_index": 1, "event_type": "round_played", "data": bad},
                {"event_index": 2, "event_type": "game_ended", "data": {"score": 10}},
            ],
        )
    assert r.status_code == 200, r.text
    assert r.json() == {"accepted": 2, "duplicates": 0, "rejected": [], "dropped": 0}
    assert [e.event_index for e in await _stored(gid)] == [0, 2]
    assert "dropped an invalid round_played" in caplog.text
    assert [m for m, _ in sent] == ["blackjack event: round_played invalid"]


def test_round_played_is_not_an_event_type_of_other_games() -> None:
    r = client.post("/games", headers=_headers(_SID), json={"game_type": "yacht"})
    if r.status_code != 200:  # no yacht entitlement for this session: not what is tested
        pytest.skip("yacht not available to the test session")
    gid = r.json()["id"]
    r = _post(gid, [{"event_index": 0, "event_type": "round_played", "data": {}}])
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
    assert "deal     you 8S 8H | dealer hole 6C up TD" in text
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
    events = [(n, d) for n, d in _events() if n != "round_played"]
    text = "\n".join(render_rounds(events))
    assert "bet ?" in text
    assert "8S 3D 9S = 20 WIN +20" in text  # the hands' cards are still in hand_resolved


def test_a_round_resumed_after_a_kill_is_shown_as_such() -> None:
    data = _first("round_played")
    del data["p"]
    data["r"] = 1
    data["a"] = [["s", 0]]
    text = "\n".join(render_rounds([("round_played", data)]))
    assert "resumed  after the app was killed" in text
    assert "stand    hand 1 (earlier events missing)" in text


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
_REVISION = "0040_blackjack_round_event"


def _event_names(db_path: Path) -> list[str]:
    with sqlite3.connect(db_path) as conn:
        return [
            r[0]
            for r in conn.execute(
                "SELECT name FROM event_types WHERE game_type_id = 3 ORDER BY name"
            )
        ]


def test_the_migration_adds_and_removes_only_the_round_event(
    migration_db_path: Path, alembic: Alembic
) -> None:
    alembic("upgrade", _BEFORE)
    before = _event_names(migration_db_path)
    assert "round_played" not in before
    assert "hand_dealt" in before  # seeded long ago, untouched

    alembic("upgrade", _REVISION)
    with sqlite3.connect(migration_db_path) as conn:
        row = conn.execute(
            "SELECT display_name FROM event_types WHERE game_type_id = 3 AND name = 'round_played'"
        ).fetchone()
        et = conn.execute(
            "SELECT id FROM event_types WHERE game_type_id = 3 AND name = 'round_played'"
        ).fetchone()[0]
        keep = conn.execute(
            "SELECT id FROM event_types WHERE game_type_id = 3 AND name = 'hand_resolved'"
        ).fetchone()[0]
        # a stored round_played row, to prove the downgrade clears its dependants
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
    assert row == ("Round Played",)
    assert _event_names(migration_db_path) == sorted([*before, "round_played"])

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


# ---------------------------------------------------------------------------
# the replay groups hand_resolved by unit
# ---------------------------------------------------------------------------


def _split_bust_round(unit: int, chips_before: int) -> list[tuple[str, dict[str, Any]]]:
    """A split whose first hand busts on its hit: 8S KC + TS = 28, 8H 2D stands, the dealer draws 5S."""
    env = {"v": 1, "unit": unit, "t_ms": unit * 1000}
    chips_after = chips_before - 20
    return [
        (
            "round_played",
            {
                "b": [10, chips_before],
                "p": ["8S", "8H"],
                "d": ["6C", "TD"],
                "sh": 312,
                "rem": 100,
                "a": [["p", 0, [["8S", "KC"], ["8H", "2D"]]], ["h", 0, "TS"], ["s", 1]],
                "dl": {"d": ["5S"], "t": 21},
                **env,
            },
        ),
        (
            "hand_resolved",
            {"i": 0, "o": "lose", "p": -10, "ch": chips_after, "c": ["8S", "KC", "TS"], **env},
        ),
        (
            "hand_resolved",
            {"i": 1, "o": "lose", "p": -10, "ch": chips_after, "c": ["8H", "2D"], **env},
        ),
    ]


def test_a_split_whose_first_hand_busts_is_one_round_with_both_results() -> None:
    first, second = _split_bust_round(1, 100), _split_bust_round(2, 80)
    text = "\n".join(render_rounds(first + second))
    assert text.count("round ") == 2
    out = rounds(first + second)
    assert [len(r.results) for r in out] == [2, 2]
    assert [r.chips_after for r in out] == [80, 60]


def test_rows_stored_with_the_busted_hand_before_its_round_still_group_by_unit() -> None:
    """Before the app held an early bust until its round, that hand_resolved was recorded first,
    with the chips from before the round. By unit it still belongs to its own round."""
    first = _split_bust_round(1, 100)
    second = _split_bust_round(2, 80)
    early = (first[1][0], {**first[1][1], "ch": 100})
    stored = [early, first[0], first[2], *second]
    out = rounds(stored)
    assert [r.unit for r in out] == [1, 2]
    assert [len(r.results) for r in out] == [2, 2]
    assert out[0].bet == 10 and out[0].chips_before == 100  # the round_played filled the orphan


def test_a_missing_round_played_does_not_attach_its_hands_to_the_round_before() -> None:
    first, second = _split_bust_round(1, 100), _split_bust_round(2, 80)
    out = rounds(first + second[1:])  # round 2's round_played was evicted
    assert [r.unit for r in out] == [1, 2]
    assert len(out[0].results) == 2
    assert len(out[1].results) == 2
    assert out[1].bet is None and not out[1].steps
    text = "\n".join(render_rounds(first + second[1:]))
    assert "round 2  bet ?" in text


def test_a_repeated_unit_with_r_1_is_a_resume_of_that_round() -> None:
    first = _split_bust_round(1, 100)
    resumed = {
        "b": [10, 100],
        "d": ["6C", "TD"],
        "sh": 312,
        "rem": 90,
        "a": [["s", 1]],
        "r": 1,
        "v": 1,
        "unit": 1,
        "t_ms": 50,
    }
    out = rounds([first[0], ("round_played", resumed), *first[1:]])
    assert len(out) == 1
    assert out[0].resumed
    assert len(out[0].results) == 2
    assert "resumed  after the app was killed" in "\n".join(
        render_rounds([first[0], ("round_played", resumed)])
    )


def test_events_without_a_unit_group_by_position() -> None:
    """Older builds' hand_resolved carry no unit."""
    events = [
        ("round_played", _first("round_played")),
        ("hand_resolved", {"i": 0, "o": "win", "p": 1, "ch": 2, "c": ["TS", "9D"]}),
    ]
    out = rounds(events)
    assert len(out) == 1 and len(out[0].results) == 1
