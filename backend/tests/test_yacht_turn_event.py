"""Yacht ``turn_completed`` event: schema, validation hook, storage, migration 0038 (#3282).

``fixtures/yacht_turn_events_v1.json`` is what the app records for a scripted
13-round vs-computer game (``frontend/src/game/yacht/__tests__/replay.test.ts``
writes and checks it), so a rejection here would drop a real game's replay.
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
from db.models import GameEvent
from games.module_base import GameModuleBase
from games.registry import get_module
from games.replay_caps import DEFAULT_CAP, ROW_OVERHEAD_BYTES, cap_for, json_bytes
from main import app
from observability import report
from tests._helpers import session_headers as _headers
from tests._migration_helpers import Alembic
from yacht import turn_event
from yacht.models import CATEGORY_MAX
from yacht.module import module as yacht_module
from yacht.turn_event import (
    CATEGORY_ORDER,
    MAX_HOLD_CHANGES,
    MAX_TURN_BYTES,
    TURN_COMPLETED,
    validate_turn,
)

client = TestClient(app)

_FRONTEND = Path(__file__).resolve().parents[2] / "frontend" / "src"
_FIXTURE = Path(__file__).parent / "fixtures" / "yacht_turn_events_v1.json"
_SID = str(uuid.uuid4())


def _fixture() -> dict[str, Any]:
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))


def _turns() -> list[dict[str, Any]]:
    return [e["data"] for e in _fixture()["events"]]


@pytest.fixture
def sent(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, dict[str, Any]]]:
    """Sentry messages, captured: a dropped event reports once, by reason only."""
    turn_event._throttles.clear()  # the per-reason throttle is process-wide
    calls: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(report.sentry_sdk, "capture_message", lambda m, **kw: calls.append((m, kw)))
    return calls


def _with(**changes: Any) -> dict[str, Any]:
    data = copy.deepcopy(_turns()[2])  # the human's joker turn: flags, yc, no ev
    data.update(changes)
    return data


# ---------------------------------------------------------------------------
# the module hook
# ---------------------------------------------------------------------------


def test_the_module_checks_turn_completed_and_passes_everything_else_through() -> None:
    assert get_module("yacht") is yacht_module
    turn = _turns()[0]
    assert yacht_module.validate_event(TURN_COMPLETED, copy.deepcopy(turn)) == turn
    assert yacht_module.validate_event(TURN_COMPLETED, {}) is None
    # lifecycle events, and the per-roll / per-score events older builds send: stored as sent
    old_roll = {"held": [False] * 5, "dice": [1, 2, 3, 4, 5], "rolls_used_after": 1}
    assert yacht_module.validate_event("roll", dict(old_roll)) == old_roll
    old_score = {"category": "ones", "value": 3, "is_joker": False, "available_alternatives": {}}
    assert yacht_module.validate_event("score", dict(old_score)) == old_score
    started = {"v": 1, "mode": "vs", "cpu_type": "oracle", "difficulty": "hard"}
    assert yacht_module.validate_event("game_started", dict(started)) == started
    assert yacht_module.validate_event("game_ended", {"a": 1}) == {"a": 1}
    assert GameModuleBase.validate_event(yacht_module, TURN_COMPLETED, {}) == {}  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# what the app records is accepted, as sent
# ---------------------------------------------------------------------------


def test_every_event_of_the_apps_recorded_game_is_accepted_as_sent() -> None:
    events = _fixture()["events"]
    assert len(events) == 26
    for e in events:
        assert e["type"] == TURN_COMPLETED
        assert validate_turn(copy.deepcopy(e["data"])) == e["data"]


def test_the_fixture_covers_the_optional_parts() -> None:
    turns = _turns()
    for key in ("h", "jk", "yb", "ub", "yc", "ev", "alt", "actor"):
        assert any(key in t for t in turns), key
    assert any(len(t["rolls"]) == 3 for t in turns)
    assert any(len(r) == 2 for t in turns for r in t["rolls"])  # a hold mask


def test_a_solo_turn_has_no_actor_and_a_turn_with_no_alternatives_is_fine() -> None:
    last = {k: v for k, v in _turns()[24].items() if k not in ("actor", "alt", "ev", "h")}
    assert validate_turn(last) == last


def test_a_turn_can_carry_the_largest_values_the_app_can_send() -> None:
    worst = {
        "v": 1,
        "unit": 26,
        "t_ms": 7_200_000,
        "actor": {"seat": 1, "kind": "cpu"},
        "r": 13,
        "rolls": [[[6] * 5], [[6] * 5, 31], [[6] * 5, 31]],
        "h": [[3, 4, 1]] * MAX_HOLD_CHANGES,
        "ro": 2,
        "s": [12, 50],
        "alt": [12, 50] * 12,
        "jk": 1,
        "yb": 1,
        "ub": 1,
        "yc": 12,
        "us": 105,
        "tot": 1575,
        "ev": [1234.5, 1234.5],
    }
    size = len(json.dumps(worst, separators=(",", ":")))
    assert size < 500 < MAX_TURN_BYTES
    assert validate_turn(copy.deepcopy(worst)) == worst


def test_future_cpu_types_fit_the_actor() -> None:
    data = _with(actor={"seat": 1, "kind": "cpu", "cpu_type": "oracle", "difficulty": "hard"})
    assert validate_turn(data) is not None


# ---------------------------------------------------------------------------
# malformed and oversized events are dropped, by reason, with no player data
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad",
    [
        pytest.param(_with(v=2), id="unknown-version"),
        pytest.param(_with(v=True), id="version-true"),
        pytest.param(_with(v=1.0), id="version-float"),
        pytest.param({k: v for k, v in _turns()[0].items() if k != "v"}, id="no-version"),
        pytest.param({k: v for k, v in _turns()[0].items() if k != "rolls"}, id="no-rolls"),
        pytest.param({k: v for k, v in _turns()[0].items() if k != "s"}, id="no-score"),
        pytest.param(_with(r=0), id="round-zero"),
        pytest.param(_with(r=14), id="round-14"),
        pytest.param(_with(rolls=[]), id="no-roll"),
        pytest.param(_with(rolls=[[[1, 2, 3, 4, 5]]] * 4), id="four-rolls"),
        pytest.param(_with(rolls=[[[1, 2, 3, 4]]]), id="four-dice"),
        pytest.param(_with(rolls=[[[1, 2, 3, 4, 7]]]), id="die-seven"),
        pytest.param(_with(rolls=[[[0, 2, 3, 4, 5]]]), id="die-zero"),
        pytest.param(_with(rolls=[[[1, 2, 3, 4, True]]]), id="die-bool"),
        pytest.param(_with(rolls=[[[1, 2, 3, 4, 5], 32]]), id="mask-32"),
        pytest.param(_with(rolls=[[[1, 2, 3, 4, 5], 0]]), id="mask-zero-is-omitted"),
        pytest.param(_with(rolls=[[[1, 2, 3, 4, 5], 1, 2]]), id="roll-too-long"),
        pytest.param(_with(rolls="rolls"), id="rolls-not-a-list"),
        pytest.param(_with(h=[]), id="empty-hold-list"),
        pytest.param(_with(h=[[0, 1, 1]]), id="tap-after-roll-zero"),
        pytest.param(_with(h=[[1, 5, 1]]), id="tap-die-five"),
        pytest.param(_with(h=[[1, 1, 2]]), id="tap-held-two"),
        pytest.param(_with(h=[[1, 1, 1]] * (MAX_HOLD_CHANGES + 1)), id="too-many-taps"),
        pytest.param(_with(ro=0), id="offset-zero-is-omitted"),
        pytest.param(_with(ro=3), id="offset-three"),
        pytest.param(_with(s=[13, 5]), id="category-13"),
        pytest.param(_with(s=[-1, 5]), id="category-negative"),
        pytest.param(_with(s=["ones", 3]), id="category-name"),
        pytest.param(_with(s=[0, 51]), id="value-51"),
        pytest.param(_with(s=[0, -1]), id="value-negative"),
        pytest.param(_with(s=[0]), id="short-score"),
        pytest.param(_with(alt=[0]), id="odd-alternatives"),
        pytest.param(_with(alt=[0, 1, 2]), id="odd-alternatives-3"),
        pytest.param(_with(alt=[13, 0]), id="alternative-category-13"),
        pytest.param(_with(alt=[0, 51]), id="alternative-value-51"),
        pytest.param(_with(alt=[0, 1] * 13), id="too-many-alternatives"),
        pytest.param(_with(jk=True), id="flag-true"),
        pytest.param(_with(yb=2), id="flag-two"),
        pytest.param(_with(ub=0), id="flag-zero-is-omitted"),
        pytest.param(_with(yc=13), id="bonus-count-13"),
        pytest.param(_with(yc=0), id="bonus-count-zero-is-omitted"),
        pytest.param(_with(us=106), id="upper-subtotal-106"),
        pytest.param(_with(tot=1576), id="total-1576"),
        pytest.param(_with(tot=-1), id="total-negative"),
        pytest.param(_with(ev=[1, 2, 3]), id="ev-three"),
        pytest.param(_with(ev=[-1, 2]), id="ev-negative"),
        pytest.param(_with(ev=["a", "b"]), id="ev-strings"),
        pytest.param(_with(unit=-1), id="negative-unit"),
        pytest.param(_with(t_ms="soon"), id="time-not-a-number"),
        pytest.param(_with(extra=1), id="unknown-key"),
        pytest.param(_with(actor={"seat": 2, "kind": "cpu"}), id="seat-two"),
        pytest.param(_with(actor={"seat": 0, "kind": "bot"}), id="kind-bot"),
        pytest.param(_with(actor={"seat": 0, "kind": "human", "x": 1}), id="actor-extra-key"),
        pytest.param(_with(actor="human"), id="actor-not-an-object"),
    ],
)
def test_rejects_a_malformed_payload(bad: dict[str, Any], sent: list) -> None:
    assert validate_turn(bad) is None
    # one report, by reason
    assert len(sent) == 1
    assert "invalid" in sent[0][0]


def test_rejects_an_oversized_payload_by_bytes(sent: list) -> None:
    huge = _with(pad="x" * MAX_TURN_BYTES)
    assert validate_turn(huge) is None
    assert len(sent) == 1
    assert "oversize" in sent[0][0]


def test_a_bad_build_reports_once_per_reason_not_once_per_turn(
    sent: list, caplog: pytest.LogCaptureFixture
) -> None:
    """26 dropped turns a game must not be 26 Sentry events (#3293); every drop is still logged."""
    with caplog.at_level(logging.WARNING, logger="yacht.turn_event"):
        for _ in range(26):
            assert validate_turn(_with(r=0)) is None
        for _ in range(5):
            assert validate_turn(_with(pad="x" * MAX_TURN_BYTES)) is None
    assert [m for m, _ in sent] == [
        "yacht event: turn_completed invalid",
        "yacht event: turn_completed oversize",
    ]
    assert caplog.text.count("dropped an invalid turn_completed") == 26
    assert caplog.text.count("dropped an oversize turn_completed") == 5


def test_the_report_comes_again_after_the_window(
    sent: list, monkeypatch: pytest.MonkeyPatch
) -> None:
    now = [1000.0]
    monkeypatch.setattr("observability.report.time.monotonic", lambda: now[0])
    assert validate_turn(_with(r=0)) is None
    now[0] += turn_event._REPORT_WINDOW_S - 1
    assert validate_turn(_with(r=0)) is None
    assert len(sent) == 1
    now[0] += 2
    assert validate_turn(_with(r=0)) is None
    assert len(sent) == 2


def test_an_unserialisable_payload_is_dropped_not_raised() -> None:
    assert validate_turn({"v": 1, "rolls": [object()]}) is None


def test_drop_reports_carry_no_player_data(sent: list) -> None:
    bad = _with(s=[13, 424_242], unit=777)
    assert validate_turn(bad) is None
    text = json.dumps(sent, default=str)
    assert "424242" not in text
    assert "777" not in text


# ---------------------------------------------------------------------------
# the app's constants and vocabulary
# ---------------------------------------------------------------------------


def test_the_byte_cap_matches_the_apps_registry() -> None:
    ts = (_FRONTEND / "game" / "_shared" / "eventQueueConfig.ts").read_text(encoding="utf-8")
    m = re.search(r"export const YACHT_TURN_MAX_BYTES\s*=\s*(\d+)\s*;", ts)
    assert m, "YACHT_TURN_MAX_BYTES not found in eventQueueConfig.ts"
    assert int(m.group(1)) == MAX_TURN_BYTES
    # and the registry entry uses it
    assert re.search(r"turn_completed\s*:\s*\{[^}]*maxBytes\s*:\s*YACHT_TURN_MAX_BYTES", ts)


def test_category_indexes_match_the_engines_order() -> None:
    ts = (_FRONTEND / "game" / "yacht" / "engine.ts").read_text(encoding="utf-8")
    block = re.search(r"export const CATEGORIES = \[(.*?)\] as const", ts, re.DOTALL)
    assert block, "CATEGORIES not found in engine.ts"
    assert tuple(re.findall(r'"(\w+)"', block.group(1))) == CATEGORY_ORDER
    assert set(CATEGORY_ORDER) == set(CATEGORY_MAX)


def test_a_whole_game_fits_the_per_game_replay_cap_with_room_to_spare() -> None:
    """The arithmetic in the ``DEFAULT_CAP`` comment (games/replay_caps.py): Yacht has no override."""
    cap = cap_for("yacht")
    assert cap == DEFAULT_CAP
    events = _fixture()["events"]
    game_bytes = sum(json_bytes(e["data"]) + ROW_OVERHEAD_BYTES for e in events)
    assert (len(events), game_bytes) == (26, 10_811)
    worst = {
        "v": 1,
        "unit": 26,
        "t_ms": 7_200_000,
        "actor": {"seat": 1, "kind": "cpu"},
        "r": 13,
        "rolls": [[[6] * 5], [[6] * 5, 31], [[6] * 5, 31]],
        "h": [[3, 4, 1]] * MAX_HOLD_CHANGES,
        "ro": 2,
        "s": [12, 50],
        "alt": [12, 50] * 12,
        "jk": 1,
        "yb": 1,
        "ub": 1,
        "yc": 12,
        "us": 105,
        "tot": 1575,
        "ev": [1234.5, 1234.5],
    }
    assert json_bytes(worst) == 556
    worst_game = 26 * (json_bytes(worst) + ROW_OVERHEAD_BYTES)
    assert worst_game == 19_656
    assert worst_game < cap.max_bytes * 0.13
    assert cap.max_events * 0.06 > 26


def test_the_hold_tap_cap_matches_the_app() -> None:
    ts = (_FRONTEND / "game" / "yacht" / "replay.ts").read_text(encoding="utf-8")
    m = re.search(r"export const MAX_HOLD_CHANGES\s*=\s*(\d+)\s*;", ts)
    assert m
    assert int(m.group(1)) == MAX_HOLD_CHANGES


# ---------------------------------------------------------------------------
# append_events
# ---------------------------------------------------------------------------


def _new_game() -> str:
    r = client.post(
        "/games",
        headers=_headers(_SID),
        json={"game_type": "yacht", "metadata": {"mode": "vs", "difficulty": "hard"}},
    )
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


async def test_a_whole_recorded_game_is_stored_as_sent() -> None:
    gid = _new_game()
    events = [
        {"event_index": i, "event_type": e["type"], "data": e["data"]}
        for i, e in enumerate(_fixture()["events"])
    ]
    r = _post(gid, events)
    assert r.status_code == 200, r.text
    assert r.json() == {"accepted": 26, "duplicates": 0, "rejected": [], "dropped": 0}
    rows = await _stored(gid)
    assert [row.data for row in rows] == [e["data"] for e in _fixture()["events"]]


async def test_a_mixed_batch_stores_the_valid_turns_and_drops_the_bad_one(
    sent, caplog: pytest.LogCaptureFixture
) -> None:
    gid = _new_game()
    good, bad = _turns()[0], _with(rolls=[[[1, 2, 3, 4, 9]]])
    with caplog.at_level(logging.WARNING, logger="yacht.turn_event"):
        r = _post(
            gid,
            [
                {"event_index": 0, "event_type": "turn_completed", "data": good},
                {"event_index": 1, "event_type": "turn_completed", "data": bad},
                {"event_index": 2, "event_type": "game_ended", "data": {"score": 10}},
            ],
        )
    assert r.status_code == 200, r.text
    assert r.json() == {"accepted": 2, "duplicates": 0, "rejected": [], "dropped": 0}
    assert [e.event_index for e in await _stored(gid)] == [0, 2]
    assert "dropped an invalid turn_completed" in caplog.text
    assert [m for m, _ in sent] == ["yacht event: turn_completed invalid"]


async def test_builds_from_before_3282_still_store_roll_and_score() -> None:
    gid = _new_game()
    roll = {"held": [False] * 5, "dice": [1, 2, 3, 4, 5], "rolls_used_after": 1}
    score = {
        "category": "ones",
        "value": 1,
        "is_joker": False,
        "available_alternatives": {"ones": 1},
    }
    r = _post(
        gid,
        [
            {"event_index": 0, "event_type": "roll", "data": roll},
            {"event_index": 1, "event_type": "score", "data": score},
        ],
    )
    assert r.json()["accepted"] == 2
    assert [e.data for e in await _stored(gid)] == [roll, score]


def test_turn_completed_is_not_an_event_type_of_other_games() -> None:
    r = client.post("/games", headers=_headers(_SID), json={"game_type": "twenty48"})
    assert r.status_code == 200, r.text
    resp = _post(
        r.json()["id"], [{"event_index": 0, "event_type": "turn_completed", "data": _turns()[0]}]
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# migration 0038
# ---------------------------------------------------------------------------

_BEFORE = "0035_games_event_counters"
_REVISION = "0038_yacht_turn_events"


def _event_names(db_path: Path) -> list[str]:
    with sqlite3.connect(db_path) as conn:
        return [
            r[0]
            for r in conn.execute(
                "SELECT name FROM event_types WHERE game_type_id = 1 ORDER BY name"
            )
        ]


def _tables(db_path: Path) -> dict[str, str]:
    with sqlite3.connect(db_path) as conn:
        return dict(conn.execute("SELECT name, sql FROM sqlite_master ORDER BY name").fetchall())


def test_the_migration_adds_and_removes_only_the_turn_event(
    migration_db_path: Path, alembic: Alembic
) -> None:
    alembic("upgrade", _BEFORE)
    before = _event_names(migration_db_path)
    schema_before = _tables(migration_db_path)
    assert "turn_completed" not in before
    assert {"roll", "score"} <= set(before)

    alembic("upgrade", _REVISION)
    with sqlite3.connect(migration_db_path) as conn:
        row = conn.execute(
            "SELECT display_name FROM event_types WHERE game_type_id = 1 AND name = 'turn_completed'"
        ).fetchone()
        et = conn.execute(
            "SELECT id FROM event_types WHERE game_type_id = 1 AND name = 'turn_completed'"
        ).fetchone()[0]
        keep = conn.execute(
            "SELECT id FROM event_types WHERE game_type_id = 1 AND name = 'game_ended'"
        ).fetchone()[0]
        gid = uuid.uuid4().hex
        conn.execute(
            "INSERT INTO games (id, session_id, game_type_id, metadata) VALUES (?, 's', 1, '{}')",
            (gid,),
        )
        # a stored turn, to prove the downgrade clears its dependants (and only those)
        for idx, type_id in ((0, et), (1, keep)):
            conn.execute(
                "INSERT INTO game_events (game_id, event_index, event_type_id, data) "
                "VALUES (?, ?, ?, '{}')",
                (gid, idx, type_id),
            )
    assert row == ("Turn Completed",)
    assert _event_names(migration_db_path) == sorted([*before, "turn_completed"])
    # seed only: no table or index changed
    assert _tables(migration_db_path) == schema_before

    alembic("downgrade", "-1")
    assert _event_names(migration_db_path) == before
    with sqlite3.connect(migration_db_path) as conn:
        assert conn.execute("SELECT event_index FROM game_events").fetchall() == [(1,)]
    assert _tables(migration_db_path) == schema_before
