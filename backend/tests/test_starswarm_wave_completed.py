"""Star Swarm ``wave_completed`` event: schema, validation hook, storage (#3250).

The payload is the v1 wire form pinned on epic #3244; the app's engine builds
it in parallel. ``fixtures/starswarm_wave_stats_v1.json`` is shared with the
frontend parity test (#3252).
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
from games.module_base import GameModuleBase
from games.registry import get_module
from main import app
from observability import report
from starswarm import models
from starswarm.models import (
    MAX_WAVE_STATS_BYTES,
    validate_wave_completed,
)
from tests._helpers import session_headers as _headers
from tests._migration_helpers import Alembic

client = TestClient(app)

_FIXTURE = Path(__file__).parent / "fixtures" / "starswarm_wave_stats_v1.json"
_SID = str(uuid.uuid4())


def _fixture() -> dict[str, Any]:
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))


@pytest.fixture
def sentry_messages(monkeypatch) -> list[tuple[str, dict]]:
    calls: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        report.sentry_sdk, "capture_message", lambda message, **kw: calls.append((message, kw))
    )
    return calls


# ---------------------------------------------------------------------------
# model
# ---------------------------------------------------------------------------


def test_the_shared_fixture_validates_and_round_trips_sparse() -> None:
    data = _fixture()
    assert len(json.dumps(data, separators=(",", ":"))) <= MAX_WAVE_STATS_BYTES
    out = validate_wave_completed(data)
    assert out == data  # sparse wire form is stored as sent, nothing densified
    assert "_flags" not in out


def test_the_fixture_has_a_key_from_every_registry() -> None:
    d = _fixture()
    pu = d["powerUps"]
    seen = {
        "POWERUP_TYPES": set(pu["collected"]),
        "POWERUP_SOURCES": {s for v in pu["spawned"].values() for s in v},
        "ENEMY_TIERS": set(d["combat"]["spawned"]),
        "ASTEROID_KINDS": set(d["rocks"]["spawned"]),
        "ROCK_BREAKERS": set(d["rocks"]["broken"]),
        "HIT_CAUSES": set(d["damage"]["hits"]),
        "BUDDY_HIT_CAUSES": set(d["buddy"]["hits"]),
        "HIT_RESULTS": set(d["rocks"]["playerHits"]),
        "KILL_METHODS": {m for v in d["combat"]["kills"].values() for m in v},
        "CARRIER_STAGES": set(d["carrier"]["stageReachedMs"]),
    }
    for name, keys in seen.items():
        assert set(getattr(models, name)) == keys, name


def test_a_dense_payload_validates() -> None:
    data = _fixture()
    dense_pu = {t: 0 for t in models.POWERUP_TYPES}
    data["powerUps"]["missed"] = {**dense_pu, "lightning": 1}
    data["combat"]["kills"] = {t: {m: 0 for m in models.KILL_METHODS} for t in models.ENEMY_TIERS}
    data["combat"]["kills"]["Grunt"]["shot"] = 5
    data["damage"]["hits"] = {c: {r: 0 for r in models.HIT_RESULTS} for c in models.HIT_CAUSES}
    out = validate_wave_completed(data)
    assert out is not None
    assert out["powerUps"]["missed"] == data["powerUps"]["missed"]


def test_only_the_required_fields_are_needed() -> None:
    minimal = {
        "v": 1,
        "wave": 1,
        "difficulty": "Ensign",
        "outcome": "cleared",
        "dev": False,
        "pacing": {},
        "score": {"total": 0},
        "rout": {"triggered": False, "atMs": None},
        "damage": {"deathCause": None},
    }
    assert validate_wave_completed(minimal) == minimal


def test_an_unknown_powerup_is_kept_and_logged(caplog: pytest.LogCaptureFixture) -> None:
    data = _fixture()
    data["powerUps"]["collected"]["tractor"] = 1
    data["powerUps"]["spawned"]["tractor"] = {"kill": 1, "orbit": 1}
    with caplog.at_level(logging.WARNING, logger="starswarm.models"):
        out = validate_wave_completed(data)
    assert out is not None
    assert out["powerUps"]["collected"]["tractor"] == 1
    assert out["powerUps"]["spawned"]["tractor"] == {"kill": 1, "orbit": 1}
    assert "powerUps.collected.tractor" in caplog.text
    assert "powerUps.spawned.tractor.orbit" in caplog.text


def test_unknown_top_level_and_section_keys_are_dropped() -> None:
    data = _fixture()
    data["futureSection"] = {"x": 1}
    data["pacing"]["newField"] = 3
    out = validate_wave_completed(data)
    assert out is not None
    assert "futureSection" not in out
    assert "newField" not in out["pacing"]


def _bad(mutate) -> dict[str, Any]:
    data = copy.deepcopy(_fixture())
    mutate(data)
    return data


_INVALID = {
    "negative counter": lambda d: d["combat"].__setitem__("shotsFired", -1),
    "negative keyed counter": lambda d: d["rocks"]["broken"].__setitem__("player", -2),
    "float counter": lambda d: d["combat"].__setitem__("shotsHit", 1.5),
    "string counter": lambda d: d["combat"].__setitem__("shotsHit", "12"),
    "bool counter": lambda d: d["combat"].__setitem__("shotsHit", True),
    "huge counter": lambda d: d["combat"].__setitem__("shotsHit", 10**12),
    "missing v": lambda d: d.pop("v"),
    "v is 2": lambda d: d.__setitem__("v", 2),
    "v is a string": lambda d: d.__setitem__("v", "1"),
    "wave 0": lambda d: d.__setitem__("wave", 0),
    "missing wave": lambda d: d.pop("wave"),
    "bad outcome": lambda d: d.__setitem__("outcome", "won"),
    "dev is not a bool": lambda d: d.__setitem__("dev", 1),
    "missing pacing": lambda d: d.pop("pacing"),
    "missing score": lambda d: d.pop("score"),
    "missing rout": lambda d: d.pop("rout"),
    "missing deathCause": lambda d: d["damage"].pop("deathCause"),
    "unknown deathCause": lambda d: d["damage"].__setitem__("deathCause", "laser"),
    "section is not an object": lambda d: d.__setitem__("combat", []),
    "table is not an object": lambda d: d["powerUps"].__setitem__("collected", 3),
}


@pytest.mark.parametrize("mutate", _INVALID.values(), ids=_INVALID.keys())
def test_an_invalid_payload_is_dropped_and_reported(mutate, sentry_messages) -> None:
    assert validate_wave_completed(_bad(mutate)) is None
    assert [m for m, _ in sentry_messages] == ["starswarm event: wave_completed invalid"]


def test_an_oversize_payload_is_dropped_and_reported(sentry_messages) -> None:
    data = _fixture()
    data["score"]["pts"] = {f"src{i}": 1 for i in range(48)}
    data["score"]["total"] = 48
    data["powerUps"]["collected"] = {f"kind{i:03}": 1 for i in range(200)}
    assert len(json.dumps(data, separators=(",", ":"))) > MAX_WAVE_STATS_BYTES
    assert validate_wave_completed(data) is None
    assert [m for m, _ in sentry_messages] == ["starswarm event: wave_completed oversize"]


def test_a_payload_at_the_cap_is_kept() -> None:
    data = _fixture()
    data["score"] = {"total": 0}
    data["powerUps"] = {"collected": {}}
    size = len(json.dumps(data, separators=(",", ":")))
    data["powerUps"]["activeMs"] = {}
    # grow the unknown-key table until just under the cap
    i = 0
    while size < MAX_WAVE_STATS_BYTES - 40:
        data["powerUps"]["activeMs"][f"k{i:04}"] = 1
        i += 1
        size = len(json.dumps(data, separators=(",", ":")))
    assert size <= MAX_WAVE_STATS_BYTES
    assert validate_wave_completed(data) is not None


def test_a_score_mismatch_is_flagged_not_dropped(caplog: pytest.LogCaptureFixture) -> None:
    data = _fixture()
    data["score"]["total"] += 1
    with caplog.at_level(logging.WARNING, logger="starswarm.models"):
        out = validate_wave_completed(data)
    assert out is not None
    assert out["_flags"] == ["score_mismatch"]
    assert "score_mismatch" in caplog.text


def test_collecting_more_than_spawned_is_flagged_not_dropped() -> None:
    data = _fixture()
    data["powerUps"]["collected"]["bomb"] = 5
    out = validate_wave_completed(data)
    assert out is not None
    assert out["_flags"] == ["powerup_collected_exceeds_spawned"]


def test_a_client_sent_flags_key_is_not_trusted() -> None:
    data = _fixture()
    data["_flags"] = ["forged"]
    out = validate_wave_completed(data)
    assert out is not None
    assert "_flags" not in out


# ---------------------------------------------------------------------------
# the hook
# ---------------------------------------------------------------------------


def test_the_default_hook_passes_an_event_through() -> None:
    data = {"anything": [1, 2]}
    assert GameModuleBase.validate_event(get_module("yacht"), "roll", data) is data  # type: ignore[arg-type]
    assert get_module("yacht").validate_event("wave_completed", data) is data


def test_starswarm_lifecycle_events_pass_through() -> None:
    module = get_module("starswarm")
    assert module.validate_event("game_started", {"x": 1}) == {"x": 1}
    assert module.validate_event("game_ended", {}) == {}


# ---------------------------------------------------------------------------
# append_events
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
async def _entitlements():
    factory = get_session_factory()
    async with factory() as db:
        for slug in ("starswarm", "yacht"):
            db.add(GameEntitlement(session_id=_SID, game_slug=slug))
        await db.commit()


def _new_game(game_type: str) -> str:
    r = client.post("/games", headers=_headers(_SID), json={"game_type": game_type})
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


async def test_a_mixed_batch_stores_the_valid_events_and_drops_the_bad_one(
    sentry_messages, caplog: pytest.LogCaptureFixture
) -> None:
    gid = _new_game("starswarm")
    bad = _fixture()
    bad["wave"] = 0
    with caplog.at_level(logging.WARNING, logger="starswarm.models"):
        r = _post(
            gid,
            [
                {"event_index": 0, "event_type": "wave_completed", "data": _fixture()},
                {"event_index": 1, "event_type": "wave_completed", "data": bad},
                {"event_index": 2, "event_type": "game_ended", "data": {"score": 10}},
            ],
        )
    assert r.status_code == 200, r.text
    # The dropped event is not counted as stored; the client still gets a 2xx.
    assert r.json() == {"accepted": 2, "duplicates": 0, "rejected": []}
    rows = await _stored(gid)
    assert [e.event_index for e in rows] == [0, 2]
    assert rows[0].data == _fixture()
    assert "dropped an invalid wave_completed" in caplog.text
    assert [m for m, _ in sentry_messages] == ["starswarm event: wave_completed invalid"]


async def test_a_flagged_event_is_stored_with_its_flags() -> None:
    gid = _new_game("starswarm")
    data = _fixture()
    data["score"]["total"] += 7
    assert (
        _post(gid, [{"event_index": 0, "event_type": "wave_completed", "data": data}]).json()[
            "accepted"
        ]
        == 1
    )
    (row,) = await _stored(gid)
    assert row.data["_flags"] == ["score_mismatch"]


async def test_another_games_events_are_untouched() -> None:
    gid = _new_game("yacht")
    payload = {"dice": [1, 2, 3], "wave": 0, "v": 9}
    r = _post(gid, [{"event_index": 0, "event_type": "roll", "data": payload}])
    assert r.json()["accepted"] == 1
    (row,) = await _stored(gid)
    assert row.data == payload


def test_wave_completed_is_not_an_event_type_of_other_games() -> None:
    gid = _new_game("yacht")
    r = _post(gid, [{"event_index": 0, "event_type": "wave_completed", "data": {}}])
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# migration 0034
# ---------------------------------------------------------------------------

_BEFORE = "0033_games_received_at"
_REVISION = "0034_starswarm_wave_event"


def _event_names(db_path: Path) -> list[str]:
    with sqlite3.connect(db_path) as conn:
        return [
            r[0]
            for r in conn.execute(
                "SELECT name FROM event_types WHERE game_type_id = 10 ORDER BY name"
            )
        ]


def test_the_migration_adds_and_removes_only_the_wave_event(
    migration_db_path: Path, alembic: Alembic
) -> None:
    alembic("upgrade", _BEFORE)
    before = _event_names(migration_db_path)
    assert "wave_completed" not in before

    alembic("upgrade", _REVISION)
    with sqlite3.connect(migration_db_path) as conn:
        row = conn.execute(
            "SELECT display_name FROM event_types WHERE game_type_id = 10 AND name = 'wave_completed'"
        ).fetchone()
        # a stored wave event, to prove the downgrade clears its dependants
        et = conn.execute(
            "SELECT id FROM event_types WHERE game_type_id = 10 AND name = 'wave_completed'"
        ).fetchone()[0]
        keep = conn.execute(
            "SELECT id FROM event_types WHERE game_type_id = 10 AND name = 'game_ended'"
        ).fetchone()[0]
        gid = uuid.uuid4().hex
        conn.execute(
            "INSERT INTO games (id, session_id, game_type_id, metadata) VALUES (?, 's', 10, '{}')",
            (gid,),
        )
        for idx, type_id in ((0, et), (1, keep)):
            conn.execute(
                "INSERT INTO game_events (game_id, event_index, event_type_id, data) "
                "VALUES (?, ?, ?, '{}')",
                (gid, idx, type_id),
            )
    assert row == ("Wave Completed",)
    assert _event_names(migration_db_path) == sorted([*before, "wave_completed"])

    alembic("downgrade", "-1")
    assert _event_names(migration_db_path) == before
    with sqlite3.connect(migration_db_path) as conn:
        assert conn.execute("SELECT event_index FROM game_events").fetchall() == [(1,)]


# ---------------------------------------------------------------------------
# client-controlled keys never reach the log or Sentry
# ---------------------------------------------------------------------------

_NASTY = "evil\n" + "x" * 300


def test_a_hostile_key_in_an_error_path_is_not_logged_or_reported(
    sentry_messages, caplog: pytest.LogCaptureFixture
) -> None:
    data = _fixture()
    data["combat"]["kills"][_NASTY] = {"shot": -1}
    data["combat"]["spawned"][_NASTY] = "nope"
    with caplog.at_level(logging.WARNING, logger="starswarm.models"):
        assert validate_wave_completed(data) is None
    assert "evil" not in caplog.text
    assert "xxxx" not in caplog.text
    _, kw = sentry_messages[0]
    assert "evil" not in repr(kw)
    assert "xxxx" not in repr(kw)
    fields = kw["extras"]["fields"] if "extras" in kw else repr(kw)
    assert "combat.kills.<key>.shot" in fields
    assert "<key>" in caplog.text


def test_error_paths_are_deduplicated_and_capped(sentry_messages) -> None:
    data = _fixture()
    for i in range(30):
        data["rocks"]["broken"][f"k{i}"] = -1
    data["rocks"]["spawned"] = {f"s{i}": "x" for i in range(30)}
    assert validate_wave_completed(data) is None
    _, kw = sentry_messages[0]
    paths = [p for p in kw["extras"]["fields"].split(", ") if p]
    assert len(paths) == len(set(paths)) <= 10


def test_unknown_table_keys_are_capped_truncated_and_escaped(
    caplog: pytest.LogCaptureFixture,
) -> None:
    data = _fixture()
    for i in range(8):
        data["powerUps"]["collected"][f"new{i}\n" + "y" * 20] = 1
    with caplog.at_level(logging.WARNING, logger="starswarm.models"):
        assert validate_wave_completed(data) is not None
    (record,) = [r for r in caplog.records if "unregistered" in r.getMessage()]
    message = record.getMessage()
    assert "\n" not in message
    assert "new5" not in message
    assert message.count("new") == 5
    assert message.endswith("...")
    assert "8 unregistered" in message
