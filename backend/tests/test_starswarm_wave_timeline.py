"""Star Swarm ``wave_timeline`` event: validation, storage, safety (#3394).

The contract is docs/games/starswarm-diagnostics.md; the shared fixture
``fixtures/starswarm_wave_timeline_v1.json`` holds the three worked examples,
a worst case and one ``invalid`` case per check. The code table and limits are
held equal to it by ``test_starswarm_wave_timeline_parity.py``.
"""

from __future__ import annotations

import copy
import json
import logging
import sqlite3
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from db.base import get_session_factory
from db.models import EventType, Game, GameEntitlement, GameEvent, GameType
from games import replay_caps, replay_storage
from games.registry import get_module
from main import app
from observability import report
from payload_size import json_bytes
from starswarm import timeline
from starswarm.timeline import (
    MAX_WAVE_TIMELINE_BYTES,
    WAVE_TIMELINE,
    validate_wave_timeline,
)
from tests._helpers import session_headers as _headers
from tests._migration_helpers import Alembic

client = TestClient(app)

_FIXTURE = Path(__file__).parent / "fixtures" / "starswarm_wave_timeline_v1.json"
_SID = str(uuid.uuid4())


def _fixture() -> dict[str, Any]:
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))


def _valid(name: str) -> dict[str, Any]:
    return copy.deepcopy(next(v for v in _fixture()["valid"] if v["name"] == name)["payload"])


_KNOWN_KEYS = ("v", "ev", "wave", "outcome", "dev", "ovf", "e")


@pytest.fixture(autouse=True)
def _fresh_throttles(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(timeline, "_throttles", {})


@pytest.fixture
def sentry_messages(monkeypatch) -> list[tuple[str, dict]]:
    calls: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        report.sentry_sdk, "capture_message", lambda message, **kw: calls.append((message, kw))
    )
    return calls


# ---------------------------------------------------------------------------
# valid payloads
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("case", _fixture()["valid"], ids=lambda c: c["name"])
def test_every_valid_fixture_case_is_stored_as_sent(case: dict[str, Any]) -> None:
    assert json_bytes(case["payload"]) == case["compactBytes"]
    assert case["compactBytes"] <= MAX_WAVE_TIMELINE_BYTES
    out = validate_wave_timeline(copy.deepcopy(case["payload"]))
    assert out == case["payload"]
    assert "_flags" not in out


def test_the_worked_examples_match_the_design_doc_sizes() -> None:
    sizes = {v["name"]: (v["compactBytes"], v["jsonbBytes"]) for v in _fixture()["valid"]}
    assert sizes["cleared_wave_2"] == (182, 226)
    assert sizes["carrier_final_stand_wave_6"] == (173, 215)
    assert sizes["died_wave_7"] == (169, 213)


def test_the_worst_case_is_a_full_buffer_inside_the_per_event_cap() -> None:
    worst = _valid("worst_case")
    assert len(worst["e"]) == 32
    assert json_bytes(worst) <= MAX_WAVE_TIMELINE_BYTES
    assert validate_wave_timeline(worst) is not None


def test_a_dev_wave_is_stored_flagged_dev_not_dropped() -> None:
    data = _valid("died_wave_7")
    data["dev"] = True
    out = validate_wave_timeline(data)
    assert out is not None and out["dev"] is True


def test_the_engine_version_is_stored_not_interpreted() -> None:
    for ev in (1, 7, 65535):
        data = _valid("died_wave_7")
        data["ev"] = ev
        out = validate_wave_timeline(data)
        assert out is not None and out["ev"] == ev


def test_a_payload_at_the_byte_cap_is_kept_and_one_over_is_dropped(sentry_messages) -> None:
    data = _valid("died_wave_7")
    data["pad"] = ""  # an unknown key counts toward the size, and is not stored
    data["pad"] = "x" * (MAX_WAVE_TIMELINE_BYTES - json_bytes(data))
    assert json_bytes(data) == MAX_WAVE_TIMELINE_BYTES
    assert validate_wave_timeline(copy.deepcopy(data)) == _valid("died_wave_7")
    data["pad"] += "x"
    assert validate_wave_timeline(data) is None
    assert [m for m, _ in sentry_messages] == ["starswarm event: wave_timeline oversize"]


# ---------------------------------------------------------------------------
# the invalid / flag cases of the fixture
# ---------------------------------------------------------------------------

_INVALID = _fixture()["invalid"]


def test_the_fixture_covers_every_check_of_the_contract() -> None:
    names = {c["name"] for c in _INVALID}
    for needed in (
        "v_is_bool",
        "v_is_float",
        "entry_bool_as_int",
        "entry_float",
        "entry_negative",
        "t_over_65535",
        "hull_hit_arity_short",
        "hull_hit_x_64",
        "t_decreasing",
        "no_terminal",
        "terminal_not_last",
        "two_terminals",
        "terminal_code_does_not_match_died",
        "terminal_code_does_not_match_cleared",
        "thirty_three_entries",
        "oversize_extra_key",
        "ovf_two_long",
        "unknown_code_kept",
        "nine_pickups",
        "nine_transitions",
        "thirty_one_ordinary_without_lethal",
        "duplicate_consecutive_entries",
        "client_sent_flags_and_unknown_keys_removed",
    ):
        assert needed in names, needed
    assert len(names) == len(_INVALID)


def _expected_stored(payload: dict[str, Any]) -> dict[str, Any]:
    return {k: payload[k] for k in _KNOWN_KEYS}


@pytest.mark.parametrize("case", _INVALID, ids=lambda c: c["name"])
def test_an_invalid_or_flagged_fixture_case_behaves_as_the_fixture_says(
    case: dict[str, Any], sentry_messages
) -> None:
    out = validate_wave_timeline(copy.deepcopy(case["payload"]))
    expect: str = case["expect"]
    if expect.startswith("drop:"):
        reason = expect.split(":", 1)[1]
        assert out is None
        assert [m for m, _ in sentry_messages] == [f"starswarm event: wave_timeline {reason}"]
        return
    assert out is not None
    assert sentry_messages == []  # a flag is logged, never reported
    stored = _expected_stored(case["payload"])
    if expect == "keep":
        assert out == stored
    else:
        assert expect.startswith("keep+flag:")
        flag = expect.split(":", 1)[1]
        assert out == {**stored, "_flags": [flag]}


# ---------------------------------------------------------------------------
# specific rules, one at a time
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("bad", [True, False, 1.0, 0.5, "1", None, [1]])
def test_a_non_int_never_passes_as_a_parameter(bad: Any) -> None:
    data = _valid("died_wave_7")
    data["e"][2][3] = bad
    assert validate_wave_timeline(data) is None


def test_equal_timestamps_are_fine_but_a_decrease_is_not() -> None:
    data = _valid("died_wave_7")
    assert data["e"][-2][0] == data["e"][-1][0]
    assert validate_wave_timeline(data) is not None
    data["e"][-1][0] -= 1
    assert validate_wave_timeline(data) is None


def _one_entry_wave(entry: list[int], terminal: bool) -> dict[str, Any]:
    return {
        "v": 1,
        "ev": 1,
        "wave": 1,
        "outcome": "died",
        "dev": False,
        "ovf": [0, 0, 0],
        "e": [entry] if terminal else [entry, [20, 9, 0]],
    }


def test_every_known_code_accepts_its_bounds_and_rejects_one_past() -> None:
    for code, spec in timeline.CODES.items():
        terminal = spec.cls == "T"
        if terminal and code == 8:
            continue  # WAVE_CLEARED has no parameter and cannot end a died wave
        for j, p in enumerate(spec.params, start=2):
            base = [10, code] + [pp.lo for pp in spec.params]
            for value, ok in ((p.lo, True), (p.hi, True), (p.lo - 1, False), (p.hi + 1, False)):
                entry = list(base)
                entry[j] = value
                got = validate_wave_timeline(_one_entry_wave(entry, terminal))
                assert (got is not None) == ok, (spec.name, p.name, value)


@pytest.mark.parametrize("code", sorted(timeline.CODES))
def test_every_known_code_rejects_a_wrong_arity(code: int) -> None:
    spec = timeline.CODES[code]
    for arity in (spec.arity - 1, spec.arity + 1):
        entry = [10, code, *([0] * (arity - 2))] if arity >= 2 else [10]
        data = _one_entry_wave(entry, spec.cls == "T")
        assert validate_wave_timeline(data) is None, (spec.name, arity)


def test_terminal_must_be_unique_last_and_match_the_outcome() -> None:
    died = _valid("died_wave_7")
    died["outcome"] = "cleared"
    assert validate_wave_timeline(died) is None  # RUN_LOST in a cleared wave
    cleared = _valid("cleared_wave_2")
    cleared["e"].append([402, 8])
    assert validate_wave_timeline(cleared) is None  # two terminals
    cleared = _valid("cleared_wave_2")
    cleared["e"].insert(5, [300, 9, 0])
    assert validate_wave_timeline(cleared) is None  # a RUN_LOST in a cleared wave


def test_32_entries_are_kept_and_33_are_not() -> None:
    data = _valid("worst_case")
    assert len(data["e"]) == 32 and validate_wave_timeline(data) is not None
    data["e"].insert(0, [0, 13])
    assert validate_wave_timeline(data) is None


def test_ovf_saturated_values_are_kept() -> None:
    data = _valid("died_wave_7")
    data["ovf"] = [65535, 0, 65535]
    out = validate_wave_timeline(data)
    assert out is not None and out["ovf"] == [65535, 0, 65535]


def test_unknown_code_is_kept_and_flagged_not_dropped(caplog: pytest.LogCaptureFixture) -> None:
    data = _valid("died_wave_7")
    data["e"].insert(1, [30, 77, 1, 2])
    with caplog.at_level(logging.WARNING, logger="starswarm.timeline"):
        out = validate_wave_timeline(data)
    assert out is not None
    assert out["e"][1] == [30, 77, 1, 2]
    assert out["_flags"] == ["unknown_code"]
    assert "unknown_code" in caplog.text


def test_several_flags_come_back_in_a_fixed_order() -> None:
    data = _valid("died_wave_7")
    data["e"][1:1] = [[21 + i, 20, 0] for i in range(9)]  # 10 power-ups: quota
    data["e"].insert(1, [20, 77])  # unknown code
    data["e"].insert(2, [20, 77])  # duplicate of the one before
    out = validate_wave_timeline(data)
    assert out is not None
    assert out["_flags"] == ["unknown_code", "quota", "duplicate_entry"]


def test_a_terminal_wave_with_a_rescued_lethal_blow_is_not_a_duplicate() -> None:
    # LIFE_LOST 0 then BONUS_LIFE at the same t (a same-tick rescue), then a real death
    data = {
        "v": 1,
        "ev": 1,
        "wave": 3,
        "outcome": "died",
        "dev": False,
        "ovf": [0, 0, 0],
        "e": [[50, 2, 1, 10, 0], [50, 3, 1, 1], [90, 2, 1, 10, 0], [90, 9, 1]],
    }
    out = validate_wave_timeline(data)
    assert out == data


def test_the_overflow_counts_and_terminal_wave_are_accepted_together() -> None:
    # a full buffer: 30 ordinary + the lethal slot + the terminal slot, with refusals counted
    data = {
        "v": 1,
        "ev": 1,
        "wave": 12,
        "outcome": "died",
        "dev": False,
        "ovf": [4, 2, 1],
        "e": [[i, 1, i % 4, i, 1] for i in range(30)] + [[40, 2, 3, 5, 0], [41, 9, 3]],
    }
    assert validate_wave_timeline(data) == data


def test_a_non_dict_payload_is_dropped_not_raised(sentry_messages) -> None:
    assert validate_wave_timeline([1, 2]) is None  # type: ignore[arg-type]
    assert validate_wave_timeline({"v": 1, "x": float("nan")}) is None
    assert [m for m, _ in sentry_messages] == ["starswarm event: wave_timeline invalid"]


def test_an_unserializable_payload_counts_as_oversize(sentry_messages) -> None:
    assert validate_wave_timeline({"v": object()}) is None  # type: ignore[dict-item]
    assert [m for m, _ in sentry_messages] == ["starswarm event: wave_timeline oversize"]


def test_validation_does_not_mutate_its_input() -> None:
    data = _valid("died_wave_7")
    data["_flags"] = ["forged"]
    data["extra"] = 1
    before = copy.deepcopy(data)
    out = validate_wave_timeline(data)
    assert data == before
    assert out is not None and "_flags" not in out and "extra" not in out
    out["e"][0][0] = 999
    assert data == before


# ---------------------------------------------------------------------------
# reports: throttled per reason, paths and reasons only
# ---------------------------------------------------------------------------


def test_a_drop_report_is_throttled_to_one_per_reason(
    sentry_messages, caplog: pytest.LogCaptureFixture
) -> None:
    bad = _valid("died_wave_7")
    bad["wave"] = 0
    big = _valid("died_wave_7")
    big["pad"] = "x" * 2000
    with caplog.at_level(logging.WARNING, logger="starswarm.timeline"):
        for _ in range(64):  # a bad build: one per wave of a run
            assert validate_wave_timeline(copy.deepcopy(bad)) is None
        for _ in range(5):
            assert validate_wave_timeline(copy.deepcopy(big)) is None
    assert [m for m, _ in sentry_messages] == [
        "starswarm event: wave_timeline invalid",
        "starswarm event: wave_timeline oversize",
    ]
    # the log line stays per event
    assert caplog.text.count("dropped a wave_timeline (invalid)") == 64
    assert caplog.text.count("dropped a wave_timeline (oversize)") == 5


def test_the_report_window_reopens(monkeypatch: pytest.MonkeyPatch, sentry_messages) -> None:
    now = [1000.0]
    monkeypatch.setattr(report.time, "monotonic", lambda: now[0])
    bad = _valid("died_wave_7")
    bad["wave"] = 0
    validate_wave_timeline(copy.deepcopy(bad))
    now[0] += replay_caps.CAP_REPORT_WINDOW_S - 1
    validate_wave_timeline(copy.deepcopy(bad))
    assert len(sentry_messages) == 1
    now[0] += 2
    validate_wave_timeline(copy.deepcopy(bad))
    assert len(sentry_messages) == 2


def test_a_report_carries_a_fixed_path_and_a_reason_never_a_value(
    sentry_messages, caplog: pytest.LogCaptureFixture
) -> None:
    nasty = "evil\n" + "x" * 100
    data = _valid("died_wave_7")
    data["outcome"] = nasty
    data[nasty] = nasty
    with caplog.at_level(logging.WARNING, logger="starswarm.timeline"):
        assert validate_wave_timeline(data) is None
    _, kw = sentry_messages[0]
    assert kw["extras"] == {"fields": "outcome"}
    assert kw["fingerprint"] == ["starswarm-wave-timeline-dropped", "invalid"]
    assert kw["tags"] == {"game_type": "starswarm", "reason": "invalid"}
    assert "evil" not in repr(kw) and "evil" not in caplog.text


def test_an_entry_fault_reports_its_index_not_its_content(sentry_messages) -> None:
    data = _valid("died_wave_7")
    data["e"][2][3] = 64
    assert validate_wave_timeline(data) is None
    assert sentry_messages[0][1]["extras"] == {"fields": "e.2.3"}


# ---------------------------------------------------------------------------
# the hook and the pipeline
# ---------------------------------------------------------------------------


def test_the_module_routes_wave_timeline_to_the_validator() -> None:
    module = get_module("starswarm")
    assert module.validate_event(WAVE_TIMELINE, {}) is None
    data = _valid("died_wave_7")
    assert module.validate_event(WAVE_TIMELINE, copy.deepcopy(data)) == data
    # wave_completed and lifecycle routing is unchanged
    assert module.validate_event("wave_completed", {}) is None
    assert module.validate_event("game_ended", {"s": 1}) == {"s": 1}


def test_wave_timeline_is_not_an_event_type_of_other_games() -> None:
    assert get_module("yacht").validate_event(WAVE_TIMELINE, {"a": 1}) == {"a": 1}


@pytest.fixture
async def _entitlements():
    factory = get_session_factory()
    async with factory() as db:
        db.add(GameEntitlement(session_id=_SID, game_slug="starswarm"))
        db.add(GameEntitlement(session_id=_SID, game_slug="yacht"))
        await db.commit()


def _new_game(game_type: str = "starswarm") -> str:
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


def _wave_completed() -> dict[str, Any]:
    path = Path(__file__).parent / "fixtures" / "starswarm_wave_stats_v1.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _ev(i: int, name: str, data: dict[str, Any]) -> dict[str, Any]:
    return {"event_index": i, "event_type": name, "data": data}


async def test_timelines_are_stored_beside_wave_completed(_entitlements) -> None:
    gid = _new_game()
    good = _valid("died_wave_7")
    r = _post(
        gid,
        [
            _ev(0, "wave_completed", _wave_completed()),
            _ev(1, "wave_timeline", good),
            _ev(2, "game_ended", {"score": 10}),
        ],
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"accepted": 3, "duplicates": 0, "rejected": [], "dropped": 0}
    rows = await _stored(gid)
    assert [e.event_index for e in rows] == [0, 1, 2]
    assert rows[1].data == good


async def test_a_malformed_timeline_never_touches_wave_completed_or_completion(
    _entitlements, sentry_messages
) -> None:
    """The app sends every ``wave_completed`` first, then the timelines (the death's first)."""
    gid = _new_game()
    bad_shape = _valid("died_wave_7")
    bad_shape["e"][2][3] = 64
    oversize = _valid("died_wave_7")
    oversize["pad"] = "x" * 2000
    r = _post(
        gid,
        [
            _ev(0, "wave_completed", _wave_completed()),
            _ev(1, "wave_completed", _wave_completed()),
            _ev(2, "wave_timeline", _valid("died_wave_7")),
            _ev(3, "wave_timeline", bad_shape),
            _ev(4, "wave_timeline", oversize),
            _ev(5, "wave_timeline", {"garbage": [1, 2, 3]}),
            _ev(6, "game_ended", {"score": 10}),
        ],
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"accepted": 4, "duplicates": 0, "rejected": [], "dropped": 0}
    rows = await _stored(gid)
    assert [e.event_index for e in rows] == [0, 1, 2, 6]
    assert rows[0].data == _wave_completed()  # the run's wave_completed rows are intact
    assert rows[1].data == _wave_completed()
    assert rows[2].data == _valid("died_wave_7")
    assert [m for m, _ in sentry_messages] == [
        "starswarm event: wave_timeline invalid",
        "starswarm event: wave_timeline oversize",
    ]  # three drops, two reports (throttled per reason)

    # and the run still completes and ranks as before
    done = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(_SID),
        json={"final_score": 500, "outcome": "completed", "result": {"wave_reached": 2}},
    )
    assert done.status_code == 200, done.text
    assert [e.event_index for e in await _stored(gid)] == [0, 1, 2, 6]


async def test_a_refused_timeline_cuts_only_the_replay_rows_after_it(_entitlements) -> None:
    """Like every refused replay row (``replay_cut``), a refused timeline ends the stored
    replay at its index: later timelines go, the earlier ``wave_completed`` rows stay."""
    gid = _new_game()
    bad = _valid("died_wave_7")
    bad["wave"] = 0
    r = _post(
        gid,
        [
            _ev(0, "wave_completed", _wave_completed()),
            _ev(1, "wave_completed", _wave_completed()),
            _ev(2, "wave_timeline", bad),
            _ev(3, "wave_timeline", _valid("cleared_wave_2")),
            _ev(4, "game_ended", {"score": 10}),
        ],
    )
    assert r.status_code == 200, r.text
    assert [e.event_index for e in await _stored(gid)] == [0, 1, 4]


async def test_a_flagged_timeline_is_stored_with_its_flags(_entitlements) -> None:
    gid = _new_game()
    data = _valid("died_wave_7")
    data["e"].insert(1, [30, 77, 1])
    assert _post(gid, [_ev(0, "wave_timeline", data)]).json()["accepted"] == 1
    (row,) = await _stored(gid)
    assert row.data["_flags"] == ["unknown_code"]
    assert row.data["e"][1] == [30, 77, 1]


async def test_older_clients_that_send_only_wave_completed_are_unaffected(
    _entitlements, sentry_messages
) -> None:
    gid = _new_game()
    r = _post(
        gid,
        [
            _ev(0, "game_started", {}),
            _ev(1, "wave_completed", _wave_completed()),
            _ev(2, "game_ended", {"score": 1}),
        ],
    )
    assert r.json() == {"accepted": 3, "duplicates": 0, "rejected": [], "dropped": 0}
    assert sentry_messages == []
    assert [e.data for e in await _stored(gid)][1] == _wave_completed()


async def test_a_duplicate_timeline_batch_is_idempotent(_entitlements) -> None:
    gid = _new_game()
    events = [_ev(0, "wave_timeline", _valid("died_wave_7"))]
    assert _post(gid, events).json()["accepted"] == 1
    again = _post(gid, events).json()
    assert (again["accepted"], again["duplicates"]) == (0, 1)
    assert len(await _stored(gid)) == 1


async def test_wave_timeline_is_rejected_for_other_games(_entitlements) -> None:
    gid = _new_game("yacht")
    r = _post(gid, [_ev(0, "wave_timeline", {})])
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# retention: an ordinary replay row, not on the keep-list
# ---------------------------------------------------------------------------


def test_wave_timeline_is_not_on_either_keep_list() -> None:
    assert "wave_timeline" not in replay_caps.RETENTION_KEEP_NAMES
    assert "wave_timeline" not in replay_storage.KEPT_EVENT_NAMES
    assert replay_caps.is_replay_event("wave_timeline")
    assert replay_caps.is_replay_event("wave_completed")
    assert "wave_completed" in replay_storage.KEPT_EVENT_NAMES


async def _game_with(names: list[str], when: datetime) -> uuid.UUID:
    async with get_session_factory()() as db:
        type_id = (
            await db.execute(select(GameType.id).where(GameType.name == "starswarm"))
        ).scalar_one()
        ids = dict(
            (
                await db.execute(
                    select(EventType.name, EventType.id).where(EventType.game_type_id == type_id)
                )
            ).all()
        )
        game = Game(
            session_id=str(uuid.uuid4()), game_type_id=type_id, game_metadata={}, players=[]
        )
        db.add(game)
        await db.flush()
        db.add_all(
            GameEvent(
                game_id=game.id,
                event_index=i,
                event_type_id=ids[name],
                data={"n": i},
                occurred_at=when,
            )
            for i, name in enumerate(names)
        )
        await db.commit()
        return game.id


async def _names(gid: uuid.UUID) -> list[str]:
    async with get_session_factory()() as db:
        rows = await db.execute(
            select(EventType.name)
            .join(GameEvent, GameEvent.event_type_id == EventType.id)
            .where(GameEvent.game_id == gid)
            .order_by(GameEvent.event_index)
        )
        return list(rows.scalars())


async def test_retention_prunes_timelines_after_30_days_and_keeps_wave_completed() -> None:
    now = datetime.now(UTC)
    names = ["game_started", "wave_completed", "wave_timeline", "game_ended"]
    old = await _game_with(names, now - timedelta(days=31))
    fresh = await _game_with(names, now - timedelta(days=29))
    async with get_session_factory()() as db:
        await replay_storage.prune_replay_events(db, now=now, keep=timedelta(days=30))
    assert await _names(old) == ["game_started", "wave_completed", "game_ended"]
    assert await _names(fresh) == names


# ---------------------------------------------------------------------------
# migration 0046
# ---------------------------------------------------------------------------

_BEFORE = "0037_twenty48_moves_event"
_REVISION = "0046_starswarm_wave_timeline"


def _event_names(db_path: Path) -> list[str]:
    with sqlite3.connect(db_path) as conn:
        return [
            r[0]
            for r in conn.execute(
                "SELECT name FROM event_types WHERE game_type_id = 10 ORDER BY name"
            )
        ]


def test_the_migration_adds_and_removes_only_the_timeline_event(
    migration_db_path: Path, alembic: Alembic
) -> None:
    alembic("upgrade", _BEFORE)
    before = _event_names(migration_db_path)
    assert "wave_timeline" not in before
    assert "wave_completed" in before

    alembic("upgrade", _REVISION)
    with sqlite3.connect(migration_db_path) as conn:
        row = conn.execute(
            "SELECT display_name FROM event_types WHERE game_type_id = 10 AND name = 'wave_timeline'"
        ).fetchone()
        ids = {
            name: conn.execute(
                "SELECT id FROM event_types WHERE game_type_id = 10 AND name = ?", (name,)
            ).fetchone()[0]
            for name in ("wave_timeline", "wave_completed", "game_ended")
        }
        gid = uuid.uuid4().hex
        conn.execute(
            "INSERT INTO games (id, session_id, game_type_id, metadata) VALUES (?, 's', 10, '{}')",
            (gid,),
        )
        for idx, name in enumerate(("wave_timeline", "wave_completed", "game_ended")):
            conn.execute(
                "INSERT INTO game_events (game_id, event_index, event_type_id, data) "
                "VALUES (?, ?, ?, '{}')",
                (gid, idx, ids[name]),
            )
    assert row == ("Wave Timeline",)
    assert _event_names(migration_db_path) == sorted([*before, "wave_timeline"])

    alembic("downgrade", "-1")
    assert _event_names(migration_db_path) == before
    with sqlite3.connect(migration_db_path) as conn:
        # the timeline row went with its type; wave_completed and lifecycle rows stay
        assert conn.execute(
            "SELECT event_index FROM game_events ORDER BY event_index"
        ).fetchall() == [(1,), (2,)]
