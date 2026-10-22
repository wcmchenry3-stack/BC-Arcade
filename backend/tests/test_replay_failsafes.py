"""The replay fail-safe suite, server side (#3399, part 2 of #3294, epic #3273).

One place to look for the backend half of every replay safeguard. The device
half is ``frontend/src/game/_shared/__tests__/failsafes.test.ts``. Each test
here fails if its safeguard is removed; "(a)" tests are written for this suite,
"(b)" tests re-check a safeguard that has a strong test elsewhere, through the
public API, and name that test.

| #  | Safeguard                                   | Test                                                    | Kind | Mutation check (the test fails if ...)                                          |
|----|---------------------------------------------|---------------------------------------------------------|------|---------------------------------------------------------------------------------|
| 3a | env kill switch REPLAY_RECORDING_ENABLED    | test_env_kill_switch_drops_replay_rows_with_a_2xx       | (b)  | sessions.replay_recording_on ignores the env flag                               |
| 3b | catalog dial game_types.replay_enabled      | test_catalog_dial_off_drops_replay_rows_with_a_2xx      | (b)  | sessions.replay_recording_on ignores row.replay_enabled                         |
| 3c | the env switch reaches the app via catalog  | test_env_kill_switch_reads_off_in_the_catalog           | (b)  | the catalog serves the row's flag without folding in the env flag               |
| 4  | sample rate is served as set (0 and 1)      | test_catalog_serves_the_sample_rate_as_set              | (a)  | the catalog serves a constant rate instead of game_types.replay_sample_rate     |
| 5a | per-game event cap cuts a clean prefix      | test_event_cap_cuts_a_clean_prefix_and_still_succeeds   | (b)  | apply_cap / _within_caps never stops at max_events                              |
| 5b | per-game byte cap cuts a clean prefix       | test_byte_cap_cuts_a_clean_prefix_and_still_succeeds    | (b)  | apply_cap / _within_caps never stops at max_bytes                               |
| 5c | a capped batch is a 2xx, so no retry storm  | test_a_capped_batch_is_a_2xx_and_a_resend_adds_nothing  | (a)  | an over-cap batch is rejected (4xx/5xx) instead of dropped                      |
| 5d | cap reports are throttled (Sentry bound)    | test_cap_reports_to_sentry_are_throttled                | (b)  | report_cap_reached skips its per-game-type hourly throttle                      |
| 5e | every game's cap is bounded                 | test_every_games_cap_is_finite_and_bounded              | (a)  | a game's cap is removed, or the default is raised past the ceiling              |
| 5f | 90 % storage budget turns every rate to 0   | test_ninety_percent_of_the_budget_turns_every_rate_to_zero | (b) | check_storage_budget skips turn_down_sampling                                 |
| 5g | the turn-down needs 90 %, not less          | test_below_ninety_percent_leaves_the_rates_alone        | (a)  | EXCEEDED_THRESHOLD lowered (turn-down fires at 75 %)                            |
| 5h | the database plan trips it too              | test_a_full_database_turns_the_rates_down_too           | (a)  | read_budget ignores the database-vs-plan ratio                                  |

Existing tests re-checked here: tests/test_replay_dial.py, tests/test_replay_caps.py,
tests/test_replay_storage.py.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from db.base import get_session_factory
from db.models import EventType, Game, GameEntitlement, GameEvent, GameType
from games import catalog_cache, replay_caps, replay_storage, sessions
from games.filters import REPLAY_CAPPED_KEY, REPLAY_CUTOFF_KEY, REPLAY_PAUSED_KEY
from games.replay_caps import CAPS_BY_GAME_TYPE, DEFAULT_CAP, ReplayCap, event_bytes
from games.replay_storage import StorageSize, check_storage_budget
from observability import report
from settings import Settings
from tests._helpers import session_headers as _headers

MB = 1024 * 1024


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
async def _yacht_entitlement(session_id: str) -> None:
    async with get_session_factory()() as db:
        db.add(GameEntitlement(session_id=session_id, game_slug="yacht"))
        await db.commit()


@pytest.fixture(autouse=True)
async def _restore_the_dial():
    """Put every game's dial back as it was, so this file runs on a shared Postgres too."""
    async with get_session_factory()() as db:
        saved = (
            await db.execute(
                select(GameType.id, GameType.replay_enabled, GameType.replay_sample_rate)
            )
        ).all()
    yield
    async with get_session_factory()() as db:
        for type_id, enabled, rate in saved:
            await db.execute(
                update(GameType)
                .where(GameType.id == type_id)
                .values(replay_enabled=enabled, replay_sample_rate=rate)
            )
        await db.commit()
    catalog_cache.invalidate()


@pytest.fixture
def sent(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, dict[str, Any]]]:
    """Every Sentry message the server sends, with the cap throttles fresh."""
    calls: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(report.sentry_sdk, "capture_message", lambda m, **kw: calls.append((m, kw)))
    monkeypatch.setattr(replay_caps, "_throttles", {})
    return calls


async def _set_dial(name: str, *, enabled: bool | None = None, rate: float | None = None) -> None:
    values: dict[str, Any] = {}
    if enabled is not None:
        values["replay_enabled"] = enabled
    if rate is not None:
        values["replay_sample_rate"] = rate
    async with get_session_factory()() as db:
        await db.execute(update(GameType).where(GameType.name == name).values(**values))
        await db.commit()
    catalog_cache.invalidate()


async def _rates() -> dict[str, float]:
    async with get_session_factory()() as db:
        rows = await db.execute(select(GameType.name, GameType.replay_sample_rate))
        return {name: round(float(rate), 4) for name, rate in rows}


def _catalog(client: TestClient) -> dict[str, dict[str, Any]]:
    r = client.get("/games/catalog")
    assert r.status_code == 200
    return {item["name"]: item for item in r.json()["items"]}


def _new_game(client: TestClient, sid: str) -> str:
    r = client.post("/games", headers=_headers(sid), json={"game_type": "yacht"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _roll(i: int) -> dict[str, Any]:
    return {"event_index": i, "event_type": "roll", "data": {"dice": [1, 2, 3, 4, 5]}}


def _started() -> dict[str, Any]:
    return {"event_index": 0, "event_type": "game_started", "data": {}}


def _ended(i: int) -> dict[str, Any]:
    return {"event_index": i, "event_type": "game_ended", "data": {}}


def _post(client: TestClient, sid: str, gid: str, events: list[dict]) -> dict:
    r = client.post(f"/games/{gid}/events", headers=_headers(sid), json={"events": events})
    assert r.status_code == 200, r.text  # a 2xx whatever was dropped: the device never retries
    return r.json()


async def _stored(gid: str) -> list[tuple[int, str]]:
    async with get_session_factory()() as db:
        rows = await db.execute(
            select(GameEvent.event_index, EventType.name)
            .join(EventType, EventType.id == GameEvent.event_type_id)
            .where(GameEvent.game_id == uuid.UUID(gid))
            .order_by(GameEvent.event_index)
        )
        return [tuple(r) for r in rows]


async def _metadata(gid: str) -> dict:
    async with get_session_factory()() as db:
        game = await db.get(Game, uuid.UUID(gid))
        assert game is not None
        return game.game_metadata


def _cap_yacht(monkeypatch: pytest.MonkeyPatch, cap: ReplayCap) -> None:
    monkeypatch.setitem(CAPS_BY_GAME_TYPE, "yacht", cap)


# ---------------------------------------------------------------------------
# 3. Kill switch off: replay rows are dropped with a 2xx, lifecycle rows land
# ---------------------------------------------------------------------------


async def test_env_kill_switch_drops_replay_rows_with_a_2xx(
    client: TestClient, session_id: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(b) tests/test_replay_caps.py::test_the_kill_switch_drops_replay_and_keeps_lifecycle."""
    monkeypatch.setattr(sessions, "_settings", Settings.isolated(REPLAY_RECORDING_ENABLED=False))
    gid = _new_game(client, session_id)
    body = _post(client, session_id, gid, [_started(), _roll(1), _roll(2), _ended(3)])
    assert body["accepted"] == 2 and body["dropped"] == 2
    assert await _stored(gid) == [(0, "game_started"), (3, "game_ended")]
    assert (await _metadata(gid))[REPLAY_PAUSED_KEY] is True


async def test_catalog_dial_off_drops_replay_rows_with_a_2xx(
    client: TestClient, session_id: str
) -> None:
    """(b) tests/test_replay_dial.py::test_a_game_switched_off_drops_replay_rows_with_a_paused_cut..."""
    gid = _new_game(client, session_id)
    assert _post(client, session_id, gid, [_started(), _roll(1)])["accepted"] == 2
    await _set_dial("yacht", enabled=False)  # the admin's per-game kill switch
    body = _post(client, session_id, gid, [_roll(2), _roll(3), _ended(4)])
    assert body["accepted"] == 1 and body["dropped"] == 2
    assert await _stored(gid) == [(0, "game_started"), (1, "roll"), (4, "game_ended")]
    metadata = await _metadata(gid)
    assert metadata[REPLAY_CUTOFF_KEY] == 2 and metadata[REPLAY_PAUSED_KEY] is True


def test_env_kill_switch_reads_off_in_the_catalog(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(b) tests/test_replay_dial.py::test_the_env_kill_switch_turns_every_game_off_in_the_catalog.

    This is how the env flag reaches the app: the app has no flag of its own,
    it records nothing for a game whose catalog entry says ``enabled: false``.
    """
    assert {i["replay"]["enabled"] for i in _catalog(client).values()} == {True}
    monkeypatch.setattr(sessions, "_settings", Settings.isolated(REPLAY_RECORDING_ENABLED=False))
    assert {i["replay"]["enabled"] for i in _catalog(client).values()} == {False}


# ---------------------------------------------------------------------------
# 4. Sample rate: the server serves it, the app samples (D3-A)
# ---------------------------------------------------------------------------


async def test_catalog_serves_the_sample_rate_as_set(client: TestClient) -> None:
    """The app's 0 % / 100 % behaviour (failsafes.test.ts) rests on the catalog carrying the rate."""
    await _set_dial("yacht", rate=0.0)
    await _set_dial("hearts", rate=1.0)
    items = _catalog(client)
    assert items["yacht"]["replay"] == {"enabled": True, "sample_rate": 0.0}
    assert items["hearts"]["replay"] == {"enabled": True, "sample_rate": 1.0}


# ---------------------------------------------------------------------------
# 5. Server-side caps cut cleanly
# ---------------------------------------------------------------------------


async def test_event_cap_cuts_a_clean_prefix_and_still_succeeds(
    client: TestClient, session_id: str, monkeypatch: pytest.MonkeyPatch, sent
) -> None:
    """(b) tests/test_replay_caps.py::test_a_batch_past_the_event_cap_stores_up_to_the_cap_and_reports_once."""
    _cap_yacht(monkeypatch, ReplayCap(max_events=3, max_bytes=1_000_000))
    gid = _new_game(client, session_id)
    body = _post(client, session_id, gid, [_started()] + [_roll(i) for i in range(1, 7)])
    assert body["accepted"] == 4 and body["dropped"] == 3  # lifecycle + the first 3 replay rows
    # A clean prefix by index: no hole, nothing past the cut.
    assert await _stored(gid) == [(0, "game_started"), (1, "roll"), (2, "roll"), (3, "roll")]
    assert (await _metadata(gid))[REPLAY_CAPPED_KEY] is True
    # The game is full: more replay is dropped, the lifecycle row still lands.
    body = _post(client, session_id, gid, [_roll(7), _ended(8)])
    assert body["accepted"] == 1 and body["dropped"] == 1
    assert (await _stored(gid))[-1] == (8, "game_ended")
    assert len(await _stored(gid)) == 5


async def test_byte_cap_cuts_a_clean_prefix_and_still_succeeds(
    client: TestClient, session_id: str, monkeypatch: pytest.MonkeyPatch, sent
) -> None:
    """(b) tests/test_replay_caps.py::test_the_byte_cap_counts_stored_and_new_replay_bytes_with_overhead."""
    size = event_bytes(_roll(0)["data"])
    # Two rows fit (slack for the database's spaced JSON); a third does not.
    _cap_yacht(monkeypatch, ReplayCap(max_events=1_000, max_bytes=size * 2 + 10))
    gid = _new_game(client, session_id)
    body = _post(client, session_id, gid, [_roll(i) for i in range(1, 6)])
    assert body["accepted"] == 2 and body["dropped"] == 3
    assert [i for i, _ in await _stored(gid)] == [1, 2]
    assert sent[0][1]["contexts"]["replay_cap"]["reason"] == "bytes"


async def test_a_capped_batch_is_a_2xx_and_a_resend_adds_nothing(
    client: TestClient, session_id: str, monkeypatch: pytest.MonkeyPatch, sent
) -> None:
    """A device that is told the batch failed would retry it; a capped one must drain.

    ``_post`` asserts the 200. Sending the same batch again (what a retrying
    device would do) stores nothing more and sends no second report.
    """
    _cap_yacht(monkeypatch, ReplayCap(max_events=2, max_bytes=1_000_000))
    gid = _new_game(client, session_id)
    batch = [_roll(i) for i in range(1, 6)]
    _post(client, session_id, gid, batch)
    stored = await _stored(gid)
    assert [i for i, _ in stored] == [1, 2]
    for _ in range(3):
        body = _post(client, session_id, gid, batch)
        assert body["rejected"] == []
    assert await _stored(gid) == stored
    assert len(sent) == 1


def test_cap_reports_to_sentry_are_throttled(
    monkeypatch: pytest.MonkeyPatch, sent: list[tuple[str, dict[str, Any]]]
) -> None:
    """(b) tests/test_replay_caps.py::test_report_cap_reached_is_throttled_per_game_type_and_kind."""
    cap = ReplayCap(1, 100)
    decision = replay_caps.apply_cap(cap, 1, 0, [1])
    for _ in range(500):  # a day of capped games of one type
        replay_caps.report_cap_reached("yacht", decision, cap)
    assert len(sent) == 1


def test_every_games_cap_is_finite_and_bounded() -> None:
    """No game, listed or not, may store without a ceiling (Free plan: 500 MB for everything)."""
    ceiling_bytes = 1 * MB  # the largest per-game byte cap today is Cascade's 900 KB
    ceiling_events = 3_000
    caps = [DEFAULT_CAP, *CAPS_BY_GAME_TYPE.values()]
    for cap in caps:
        assert 0 < cap.max_events <= ceiling_events
        assert 0 < cap.max_bytes <= ceiling_bytes
    assert replay_caps.cap_for("a_game_with_no_override") is DEFAULT_CAP
    assert replay_caps.cap_for(None) is DEFAULT_CAP


# ---------------------------------------------------------------------------
# 5. The storage budget turns every sample rate to 0 at 90 %
# ---------------------------------------------------------------------------


async def _check(*, events_mb: int, database_mb: int = 20) -> None:
    async def measure(_session) -> StorageSize:
        return StorageSize(events_bytes=events_mb * MB, database_bytes=database_mb * MB)

    async with get_session_factory()() as db:
        await check_storage_budget(db, budget=100 * MB, plan=500 * MB, measure=measure)


async def test_ninety_percent_of_the_budget_turns_every_rate_to_zero(sent) -> None:
    """(b) tests/test_replay_dial.py::test_at_90_percent_every_rate_goes_to_zero_and_the_one_report_says_so."""
    await _set_dial("hearts", rate=0.5)
    await _set_dial("yacht", rate=1.0)
    before = await _rates()
    assert max(before.values()) > 0
    await _check(events_mb=90)
    assert set((await _rates()).values()) == {0.0}
    assert len(sent) == 1  # one report, and it says how many games were lowered
    assert sent[0][1]["contexts"]["replay_storage"]["sample_rates_lowered"] > 0


async def test_below_ninety_percent_leaves_the_rates_alone(sent) -> None:
    await _set_dial("hearts", rate=0.5)
    before = await _rates()
    await _check(events_mb=89)
    assert await _rates() == before
    await _check(events_mb=75)  # reports a warning, still no turn-down
    assert await _rates() == before


async def test_a_full_database_turns_the_rates_down_too(sent) -> None:
    """Replay storage is fine; the whole database (the Free plan's 500 MB) is at 90 %."""
    await _set_dial("hearts", rate=0.5)
    await _check(events_mb=10, database_mb=450)
    assert set((await _rates()).values()) == {replay_storage.BUDGET_TURN_DOWN_RATE} == {0.0}
