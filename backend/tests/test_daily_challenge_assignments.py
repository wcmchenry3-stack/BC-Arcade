"""Per-install pinned daily-challenge assignments (#3992).

Pin on serve (/status and /upcoming), concurrent first requests, the 3-day cap,
the kill switch, retention, DELETE /me, the streak's use of pinned rows, the
reserved ``bonus`` field, and the compact row encoding.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select, text

from daily_challenge import assignments, retention, service
from daily_challenge.assignments import (
    MAX_DAYS_AHEAD,
    Assignment,
    decode_goals,
    derived_template_id,
    encode_goals,
)
from daily_challenge.definitions import (
    FREE_GOAL_POOL,
    Template,
    _at_least,
    _won,
    local_day,
    pick_template,
)
from daily_challenge.streak import compute_streak
from db.base import get_engine, get_session_factory
from db.models import DailyChallengeAssignment, DailyChallengeDay, Game, GameType
from games import replay_storage
from jobs import lifespan as jobs_lifespan
from settings import Settings
from tests._helpers import session_headers as _headers
from tests._helpers import set_dev_override

needs_db = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping daily-challenge assignment tests",
)

_SCORE = FREE_GOAL_POOL["twenty48"][0]  # final_score >= 500
_LEVEL = FREE_GOAL_POOL["sort"][0]  # final_score >= 3
_MOVES = _at_least("solitaire", "moves", 10, "easy")  # the pre-#3993 easy goal
_SHARED = Template("shared_for_tests", (_SCORE, _LEVEL, _MOVES))
# Differs from the shared template: a twenty48 game with a 128 tile meets two of these.
_TILE = _at_least("twenty48", "highest_tile", 64, "easy")
_PERSONAL = (_SCORE, _TILE, _MOVES)


@pytest.fixture(autouse=True)
def shared_template(monkeypatch: pytest.MonkeyPatch) -> Template:
    """Every route and the streak see the same fixed shared template."""
    set_dev_override(monkeypatch, "")
    for target in ("service", "router", "streak"):
        monkeypatch.setattr(
            f"daily_challenge.{target}.template_for", lambda _day, _slate="free": _SHARED
        )
    return _SHARED


def _kill_switch_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DAILY_CHALLENGE_PERSONALIZED", "false")
    monkeypatch.setattr(assignments, "_settings", None)


async def _rows(sid: str | None = None) -> list[DailyChallengeAssignment]:
    async with get_session_factory()() as db:
        stmt = select(DailyChallengeAssignment).order_by(DailyChallengeAssignment.local_date)
        if sid is not None:
            stmt = stmt.where(DailyChallengeAssignment.session_id == uuid.UUID(sid))
        return list((await db.execute(stmt)).scalars())


async def _pin(sid: str, day: date, goals=_PERSONAL, **extra) -> None:
    async with get_session_factory()() as db:
        db.add(
            DailyChallengeAssignment(
                session_id=uuid.UUID(sid), local_date=day, goals=encode_goals(goals), **extra
            )
        )
        await db.commit()


async def _played() -> str:
    """A session with one finished game: only such a session pins (the write ceiling)."""
    sid = str(uuid.uuid4())
    await _play_twenty48(sid, date(2026, 10, 1))
    return sid


def _ids(goals: list[dict]) -> list[str]:
    return [g["id"] for g in goals]


# ---------------------------------------------------------------------------
# Encoding — compact, and rebuilt through goal_from_spec
# ---------------------------------------------------------------------------


def test_goals_round_trip_through_the_compact_encoding() -> None:
    goals = (_SCORE, _won("daily_word", "medium"), _TILE)
    text = encode_goals(goals)
    assert decode_goals(text) == goals
    assert json.loads(text)[0] == ["twenty48", "final_score_at_least", 500, "easy"]
    assert " " not in text  # no padding bytes


def test_a_real_days_goals_encode_small_and_its_id_is_derived() -> None:
    """A real template's id is the one its goals imply, so the row stores NULL for it."""
    day = date(2026, 11, 21)
    template = pick_template(day, "free", 0)
    assert derived_template_id(template.goals) == template.id
    assert len(encode_goals(template.goals).encode()) <= 160
    values = assignments._row_values(uuid.uuid4(), day, Assignment(template))
    assert values["template_id"] is None and values["slate"] is None and values["bonus"] is None


def test_the_retention_default_follows_the_streak_lookback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(assignments, "_settings", None)
    assert assignments.retention_days() == 61  # STREAK_LOOKBACK_DAYS + 1
    monkeypatch.setenv("STREAK_LOOKBACK_DAYS", "30")
    monkeypatch.setattr(assignments, "_settings", None)
    assert assignments.retention_days() == 31
    monkeypatch.setenv("DAILY_CHALLENGE_ASSIGNMENT_RETENTION_DAYS", "45")
    monkeypatch.setattr(assignments, "_settings", None)
    assert assignments.retention_days() == 45


def test_personalization_is_on_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DAILY_CHALLENGE_PERSONALIZED", raising=False)
    monkeypatch.setattr(assignments, "_settings", None)
    assert assignments.personalized_on() is True
    _kill_switch_off(monkeypatch)
    assert assignments.personalized_on() is False


# ---------------------------------------------------------------------------
# Pin on serve
# ---------------------------------------------------------------------------


@needs_db
async def test_status_pins_today_once_and_returns_the_same_row(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[date] = []
    real = service.pick_for_install

    async def counting(db, sid, day, **kw) -> Assignment:
        calls.append(day)
        return await real(db, sid, day, **kw)

    monkeypatch.setattr(service, "pick_for_install", counting)
    sid = await _played()
    first = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    rows = await _rows(sid)
    assert [r.local_date for r in rows] == [local_day(0).date]
    created = rows[0].created_at

    second = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    assert second == first
    assert calls == [local_day(0).date]  # picked once
    rows = await _rows(sid)
    assert len(rows) == 1 and rows[0].created_at == created  # no second insert
    # This story's pick is today's behaviour: the shared template, unchanged.
    assert first["template_id"] == _SHARED.id
    assert _ids(first["goals"]) == [g.id for g in _SHARED.goals]


@needs_db
async def test_a_pinned_row_is_served_not_the_shared_template(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    today = local_day(0).date
    await _pin(sid, today)
    body = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    assert _ids(body["goals"]) == [g.id for g in _PERSONAL]
    assert body["template_id"] == derived_template_id(_PERSONAL)
    up = client.get("/daily-challenge/upcoming", headers=_headers(sid)).json()
    assert _ids(up["days"][0]["goals"]) == [g.id for g in _PERSONAL]
    # The public routes still show the shared template.
    assert client.get("/daily-challenge/today").json()["template_id"] == _SHARED.id


@needs_db
async def test_a_stored_template_id_and_slate_are_read_back(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    await _pin(sid, local_day(0).date, template_id="custom", slate="premium")
    async with get_session_factory()() as db:
        status = await service.get_status_for_session(db, session_id=sid, tz_offset_minutes=0)
    assert status.template.id == "custom" and status.slate == "premium"


@needs_db
async def test_status_pins_the_slate_resolve_slate_chooses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    premium = Template("premium_for_tests", (_SCORE, _LEVEL, _TILE))

    async def premium_slate(*_a, **_k) -> str:
        return "premium"

    monkeypatch.setattr(
        "daily_challenge.service.template_for",
        lambda _day, slate="free": premium if slate == "premium" else _SHARED,
    )
    monkeypatch.setattr(service, "resolve_slate", premium_slate)
    sid = await _played()
    async with get_session_factory()() as db:
        status = await service.get_status_for_session(db, session_id=sid, tz_offset_minutes=0)
    assert (status.slate, status.template) == ("premium", premium)
    row = (await _rows(sid))[0]
    assert row.slate == "premium" and row.template_id == "premium_for_tests"


@needs_db
async def test_upcoming_with_a_session_pins_three_days_for_that_install(
    client: TestClient,
) -> None:
    sid = await _played()
    first = client.get("/daily-challenge/upcoming", headers=_headers(sid)).json()
    today = local_day(0).date
    assert [d["challenge_id"] for d in first["days"]] == [
        (today + timedelta(days=i)).isoformat() for i in range(3)
    ]
    assert [r.local_date for r in await _rows(sid)] == [today + timedelta(days=i) for i in range(3)]
    # Same response shape as the public route.
    public = client.get("/daily-challenge/upcoming").json()
    assert first == public  # this story's pick is the shared template
    # Read again (and /status for today): the same pinned rows, no new ones.
    assert client.get("/daily-challenge/upcoming", headers=_headers(sid)).json() == first
    status = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    assert _ids(status["goals"]) == _ids(first["days"][0]["goals"])
    assert len(await _rows(sid)) == 3


@needs_db
async def test_upcoming_without_a_session_pins_nothing(client: TestClient) -> None:
    body = client.get("/daily-challenge/upcoming").json()
    bad = client.get("/daily-challenge/upcoming", headers={"X-Session-ID": "not-a-uuid"}).json()
    assert body == bad
    assert [d["template_id"] for d in body["days"]] == [_SHARED.id] * 3
    assert await _rows() == []


@needs_db
async def test_a_session_that_has_not_played_is_served_the_pick_and_pins_nothing(
    client: TestClient,
) -> None:
    sid = str(uuid.uuid4())
    status = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    up = client.get("/daily-challenge/upcoming", headers=_headers(sid)).json()
    assert status["template_id"] == _SHARED.id
    assert up == client.get("/daily-challenge/upcoming").json()
    assert await _rows() == []
    # Its first game syncs: the next request pins.
    await _play_twenty48(sid, date(2026, 10, 1))
    client.get("/daily-challenge/status", headers=_headers(sid))
    assert [r.local_date for r in await _rows(sid)] == [local_day(0).date]


def _record_statements(db):
    statements: list[str] = []
    engine = db.sync_session.get_bind()

    def record(_conn, _cursor, statement, *_rest) -> None:
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    return statements, lambda: event.remove(engine, "before_cursor_execute", record)


@needs_db
async def test_a_pinned_day_is_one_select_and_never_checks_games() -> None:
    sid = await _played()
    today = local_day(0).date

    async def pick(day: date) -> Assignment:
        return Assignment(_SHARED)

    async with get_session_factory()() as db:
        statements, stop = _record_statements(db)
        try:
            await assignments.get_or_pin(db, sid, [today], today=today, pick=pick)
            first = len(statements)
            await assignments.get_or_pin(db, sid, [today], today=today, pick=pick)
        finally:
            stop()
    later = statements[first:]
    assert len(later) == 1 and "daily_challenge_assignments" in later[0], later
    # The first (pinning) call: select, EXISTS on games, insert.
    assert first == 3 and "games" in statements[1], statements[:first]


@needs_db
async def test_the_streak_of_an_install_with_no_pins_is_the_shared_replay() -> None:
    sid = str(uuid.uuid4())
    for n in (1, 2):
        day = _YESTERDAY - timedelta(days=n - 1)
        await _play_twenty48(sid, day)
        async with get_session_factory()() as db:
            gt_id = (
                await db.execute(select(GameType.id).where(GameType.name == "sort"))
            ).scalar_one()
            when = datetime(day.year, day.month, day.day, 13, tzinfo=UTC)
            db.add(
                Game(
                    session_id=sid,
                    game_type_id=gt_id,
                    started_at=when - timedelta(minutes=5),
                    completed_at=when,
                    outcome="completed",
                    final_score=5,
                    game_metadata={},
                )
            )
            await db.commit()
    assert await _rows(sid) == []
    assert await _streak(sid) == 2  # twenty48 + sort meet 2 of the shared goals each day


# ---------------------------------------------------------------------------
# Concurrent first requests
# ---------------------------------------------------------------------------


@needs_db
async def test_a_rival_pin_between_read_and_insert_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    """Simulates two first requests: the rival commits its row after our SELECT found
    none and before our INSERT. Ours is skipped and the rival's row is served."""
    sid = await _played()
    today = local_day(0).date

    async def pick_while_a_rival_pins(day: date) -> Assignment:
        await _pin(sid, day, goals=_PERSONAL)  # the rival's (different) goals
        return Assignment(_SHARED)

    async with get_session_factory()() as db:
        result = await assignments.get_or_pin(
            db, sid, [today], today=today, pick=pick_while_a_rival_pins
        )
    assert result[today].template.goals == _PERSONAL
    rows = await _rows(sid)
    assert len(rows) == 1 and decode_goals(rows[0].goals) == _PERSONAL


@needs_db
async def test_a_partial_rival_pin_keeps_both_sides(monkeypatch: pytest.MonkeyPatch) -> None:
    sid = await _played()
    today = local_day(0).date
    tomorrow = today + timedelta(days=1)

    async def pick(day: date) -> Assignment:
        if day == today:
            await _pin(sid, today)
        return Assignment(_SHARED)

    async with get_session_factory()() as db:
        result = await assignments.get_or_pin(db, sid, [today, tomorrow], today=today, pick=pick)
    assert result[today].template.goals == _PERSONAL
    assert result[tomorrow].template == _SHARED
    assert [r.local_date for r in await _rows(sid)] == [today, tomorrow]


@needs_db
async def test_a_skipped_pin_that_cannot_be_read_back_is_an_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The guard for a non-READ-COMMITTED isolation level: never serve an unstored pick."""
    sid = await _played()
    today = local_day(0).date

    async def pick_and_vanish(day: date) -> Assignment:
        await _pin(sid, day)
        return Assignment(_SHARED)

    async with get_session_factory()() as db:
        real_execute = db.execute
        calls = 0

        async def execute(stmt, *a, **k):
            nonlocal calls
            calls += 1
            if calls == 4:  # select, EXISTS, insert, then the re-read sees nothing
                stmt = stmt.where(DailyChallengeAssignment.local_date < date(2000, 1, 1))
            return await real_execute(stmt, *a, **k)

        monkeypatch.setattr(db, "execute", execute)
        with pytest.raises(RuntimeError, match="neither pinned nor found"):
            await assignments.get_or_pin(db, sid, [today], today=today, pick=pick_and_vanish)


# ---------------------------------------------------------------------------
# At most today..today+2
# ---------------------------------------------------------------------------


@needs_db
@pytest.mark.parametrize("offset", [-1, MAX_DAYS_AHEAD + 1, 30])
async def test_days_outside_today_to_today_plus_two_are_never_pinned(offset: int) -> None:
    sid = str(uuid.uuid4())
    today = local_day(0).date

    async def pick(_day: date) -> Assignment:
        raise AssertionError("never picked")

    async with get_session_factory()() as db:
        with pytest.raises(ValueError, match="outside today"):
            await assignments.get_or_pin(
                db, sid, [today, today + timedelta(days=offset)], today=today, pick=pick
            )
    assert await _rows(sid) == []


def test_only_three_days_are_pinnable() -> None:
    today = date(2026, 11, 21)
    window = [d for d in range(-5, 10) if assignments.pinnable(today + timedelta(days=d), today)]
    assert window == [0, 1, 2] and MAX_DAYS_AHEAD == 2


@needs_db
async def test_upcoming_from_every_timezone_stays_within_the_window(client: TestClient) -> None:
    sid = await _played()
    for tz in (-840, 0, 840):
        client.get(
            "/daily-challenge/upcoming", headers=_headers(sid), params={"tz_offset_minutes": tz}
        )
    utc_today = datetime.now(UTC).date()
    dates = [r.local_date for r in await _rows(sid)]
    # Never more than today+2 for the furthest-east local calendar.
    assert max(dates) <= local_day(840).date + timedelta(days=MAX_DAYS_AHEAD)
    assert min(dates) >= utc_today - timedelta(days=1)
    assert len(dates) == len(set(dates))


# ---------------------------------------------------------------------------
# Kill switch
# ---------------------------------------------------------------------------


@needs_db
async def test_kill_switch_off_serves_the_shared_template_and_writes_nothing(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _kill_switch_off(monkeypatch)
    sid = await _played()
    status = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    up = client.get("/daily-challenge/upcoming", headers=_headers(sid)).json()
    assert status["template_id"] == _SHARED.id
    assert up == client.get("/daily-challenge/upcoming").json()
    assert await _rows() == []
    # The shared frozen template is still frozen, as before this feature.
    async with get_session_factory()() as db:
        frozen = (await db.execute(select(func.count()).select_from(DailyChallengeDay))).scalar()
    assert frozen >= 3


@needs_db
async def test_kill_switch_off_ignores_rows_already_pinned(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    sid = str(uuid.uuid4())
    await _pin(sid, local_day(0).date)
    _kill_switch_off(monkeypatch)
    status = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    assert status["template_id"] == _SHARED.id
    up = client.get("/daily-challenge/upcoming", headers=_headers(sid)).json()
    assert up["days"][0]["template_id"] == _SHARED.id


# ---------------------------------------------------------------------------
# The reserved bonus field (#3995)
# ---------------------------------------------------------------------------


@needs_db
def test_bonus_is_null_on_every_day_payload(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    assert client.get("/daily-challenge/today").json()["bonus"] is None
    assert client.get("/daily-challenge/status", headers=_headers(sid)).json()["bonus"] is None
    for headers in ({}, _headers(sid)):
        days = client.get("/daily-challenge/upcoming", headers=headers).json()["days"]
        assert [d["bonus"] for d in days] == [None] * 3


@needs_db
async def test_a_stored_bonus_is_served_apart_from_the_core_goals(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    bonus = FREE_GOAL_POOL["yacht"][0]
    await _pin(sid, local_day(0).date, bonus=json.dumps(["yacht", bonus.kind, 100, "easy"]))
    body = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    assert body["bonus"] == {
        "id": bonus.id,
        "game_type": "yacht",
        "kind": bonus.kind,
        "target": 100,
    }
    assert body["total_goals"] == 3 and bonus.id not in _ids(body["goals"])
    up = client.get("/daily-challenge/upcoming", headers=_headers(sid)).json()
    assert up["days"][0]["bonus"]["id"] == bonus.id
    # Round trip through the writer too.
    values = assignments._row_values(
        uuid.uuid4(), local_day(0).date, Assignment(_SHARED, bonus=bonus)
    )
    assert values["bonus"] == '["yacht","final_score_at_least",100,"easy"]'


# ---------------------------------------------------------------------------
# Streak replay
# ---------------------------------------------------------------------------

_NOW = datetime(2026, 10, 9, 15, 0, tzinfo=UTC)
_YESTERDAY = _NOW.date() - timedelta(days=1)


async def _play_twenty48(sid: str, day: date) -> None:
    """One twenty48 game: meets _SCORE and _TILE, so 1 of the shared goals, 2 of _PERSONAL."""
    async with get_session_factory()() as db:
        gt_id = (
            await db.execute(select(GameType.id).where(GameType.name == "twenty48"))
        ).scalar_one()
        when = datetime(day.year, day.month, day.day, 12, tzinfo=UTC)
        db.add(
            Game(
                session_id=sid,
                game_type_id=gt_id,
                started_at=when - timedelta(minutes=5),
                completed_at=when,
                outcome="completed",
                final_score=600,
                game_metadata={"highest_tile": 128},
            )
        )
        await db.commit()


async def _streak(sid: str) -> int:
    async with get_session_factory()() as db:
        return await compute_streak(db, sid, 0, _NOW)


@needs_db
async def test_the_streak_scores_a_pinned_day_on_its_pinned_goals() -> None:
    sid = str(uuid.uuid4())
    await _play_twenty48(sid, _YESTERDAY)
    assert await _streak(sid) == 0  # shared template: 1 of 3
    await _pin(sid, _YESTERDAY)
    assert await _streak(sid) == 1  # pinned goals: 2 of 3


@needs_db
async def test_the_streak_falls_back_to_the_shared_template_for_unpinned_days() -> None:
    sid = str(uuid.uuid4())
    day_before = _YESTERDAY - timedelta(days=1)
    await _play_twenty48(sid, _YESTERDAY)
    await _play_twenty48(sid, day_before)
    await _pin(sid, _YESTERDAY)
    # Yesterday qualifies on its pin; the day before has no pin, so it is scored on
    # the shared template (1 of 3) and ends the run.
    assert await _streak(sid) == 1
    other = str(uuid.uuid4())
    await _play_twenty48(other, _YESTERDAY)
    assert await _streak(other) == 0  # another install's pin is not this one's


@needs_db
async def test_the_streak_ignores_pins_while_the_kill_switch_is_off(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sid = str(uuid.uuid4())
    await _play_twenty48(sid, _YESTERDAY)
    await _pin(sid, _YESTERDAY)
    _kill_switch_off(monkeypatch)
    assert await _streak(sid) == 0


@needs_db
async def test_the_bonus_never_counts_toward_the_streak() -> None:
    sid = str(uuid.uuid4())
    await _play_twenty48(sid, _YESTERDAY)
    tile_bonus = json.dumps(["twenty48", "highest_tile_at_least", 64, "easy"])
    await _pin(sid, _YESTERDAY, goals=_SHARED.goals, bonus=tile_bonus)
    assert await _streak(sid) == 0  # 1 core goal + the bonus is still 1 of 3


# ---------------------------------------------------------------------------
# Retention
# ---------------------------------------------------------------------------


@needs_db
async def test_prune_keeps_the_retention_window_and_removes_older_rows() -> None:
    now = datetime(2026, 11, 21, 12, tzinfo=UTC)
    sid = str(uuid.uuid4())
    retention_window = assignments.retention_days()
    assert retention_window == 61  # the streak's oldest day (60 back) plus a day of margin
    ages = [retention_window - 1, retention_window, retention_window + 1, retention_window + 30]
    for age in ages:
        await _pin(sid, now.date() - timedelta(days=age))
    await _pin(sid, now.date() + timedelta(days=2))  # a future pin is never pruned
    async with get_session_factory()() as db:
        pruned = await retention.prune_expired_assignments(db, now=now)
    assert pruned == 2
    kept = {(now.date() - r.local_date).days for r in await _rows(sid)}
    assert kept == {retention_window - 1, retention_window, -2}


@needs_db
async def test_prune_runs_in_batches_until_the_backlog_is_gone() -> None:
    now = datetime(2026, 11, 21, 12, tzinfo=UTC)
    for _ in range(5):
        sid = str(uuid.uuid4())
        await _pin(sid, now.date() - timedelta(days=100))
        await _pin(sid, now.date() - timedelta(days=101))
    async with get_session_factory()() as db:
        assert await retention.prune_expired_assignments(db, now=now, batch_size=3) == 10
    assert await _rows() == []


@needs_db
async def test_prune_follows_the_retention_setting(monkeypatch: pytest.MonkeyPatch) -> None:
    now = datetime(2026, 11, 21, 12, tzinfo=UTC)
    sid = str(uuid.uuid4())
    await _pin(sid, now.date() - timedelta(days=20))
    monkeypatch.setenv("STREAK_LOOKBACK_DAYS", "5")
    monkeypatch.setenv("DAILY_CHALLENGE_ASSIGNMENT_RETENTION_DAYS", "10")
    monkeypatch.setattr(assignments, "_settings", None)
    async with get_session_factory()() as db:
        assert await retention.prune_expired_assignments(db, now=now) == 1


@needs_db
async def test_the_scheduled_prune_logs_what_it_removed(caplog: pytest.LogCaptureFixture) -> None:
    await _pin(str(uuid.uuid4()), date(2000, 1, 1))
    with caplog.at_level("INFO", logger="daily_challenge.retention"):
        await retention._prune_once(get_session_factory)
    assert "pruned 1 assignment rows" in caplog.text
    assert await _rows() == []


def test_the_retention_job_is_registered_and_reraises_a_crash() -> None:
    names = [job.name for job in jobs_lifespan.configured_jobs()]
    assert "daily_challenge_retention" in names
    job = jobs_lifespan.daily_challenge_retention_job()
    assert job is not None
    assert job.interval_s == retention.PRUNE_INTERVAL_S
    assert job.reraise_on_crash is True


def test_the_retention_job_is_off_without_a_database(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(jobs_lifespan, "is_configured", lambda: False)
    assert jobs_lifespan.daily_challenge_retention_job() is None


# ---------------------------------------------------------------------------
# DELETE /me
# ---------------------------------------------------------------------------


@needs_db
async def test_delete_me_removes_the_installs_assignments(client: TestClient) -> None:
    sid, other = await _played(), await _played()
    client.get("/daily-challenge/upcoming", headers=_headers(sid))
    client.get("/daily-challenge/upcoming", headers=_headers(other))
    assert len(await _rows(sid)) == 3
    # Any spelling of the same UUID is the same install.
    assert client.delete("/me", headers=_headers(sid.upper())).status_code == 204
    assert await _rows(sid) == []
    assert len(await _rows(other)) == 3


# ---------------------------------------------------------------------------
# Write ceiling: recent play and the storage budget
# ---------------------------------------------------------------------------


def test_retention_below_the_streak_lookback_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    """A pinned day pruned inside the streak window would re-score a past streak day."""
    monkeypatch.setenv("STREAK_LOOKBACK_DAYS", "60")
    for too_short in ("59", "60"):  # 60: the UTC-date prune would cut a west-of-UTC day
        monkeypatch.setenv("DAILY_CHALLENGE_ASSIGNMENT_RETENTION_DAYS", too_short)
        with pytest.raises(ValueError, match=r"at least STREAK_LOOKBACK_DAYS \+ 1"):
            Settings()
    monkeypatch.setenv("DAILY_CHALLENGE_ASSIGNMENT_RETENTION_DAYS", "61")
    assert Settings().daily_challenge_assignment_retention_days == 61


def test_the_recent_play_window_defaults_to_48_hours(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(assignments, "_settings", None)
    assert assignments.recent_play_window() == timedelta(hours=48)
    monkeypatch.setenv("DAILY_CHALLENGE_PIN_RECENT_PLAY_HOURS", "6")
    monkeypatch.setattr(assignments, "_settings", None)
    assert assignments.recent_play_window() == timedelta(hours=6)


async def _game_created(sid: str, hours_ago: float) -> None:
    """A finished game whose server-side ``created_at`` is ``hours_ago`` in the past."""
    created = datetime.now(UTC) - timedelta(hours=hours_ago)
    async with get_session_factory()() as db:
        gt_id = (
            await db.execute(select(GameType.id).where(GameType.name == "twenty48"))
        ).scalar_one()
        db.add(
            Game(
                session_id=sid,
                game_type_id=gt_id,
                started_at=created - timedelta(minutes=5),
                completed_at=created,
                created_at=created,
                outcome="completed",
                final_score=600,
                game_metadata={},
            )
        )
        await db.commit()


@needs_db
async def test_only_stale_play_writes_nothing(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    await _game_created(sid, hours_ago=49)
    status = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    up = client.get("/daily-challenge/upcoming", headers=_headers(sid)).json()
    assert status["template_id"] == _SHARED.id
    assert [d["template_id"] for d in up["days"]] == [_SHARED.id] * 3
    assert await _rows() == []


@needs_db
async def test_recent_play_pins(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    await _game_created(sid, hours_ago=47)
    client.get("/daily-challenge/upcoming", headers=_headers(sid))
    assert len(await _rows(sid)) == 3


def _sized(events_bytes: int, database_bytes: int) -> None:
    """Seed the process's cached size reading, as the daily budget check does."""
    replay_storage._remember(
        replay_storage.StorageSize(events_bytes=events_bytes, database_bytes=database_bytes)
    )


@needs_db
async def test_over_the_storage_budget_writes_nothing(client: TestClient) -> None:
    sid = await _played()
    _sized(events_bytes=0, database_bytes=replay_storage.plan_bytes())  # database at 100 %
    status = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    up = client.get("/daily-challenge/upcoming", headers=_headers(sid)).json()
    assert status["template_id"] == _SHARED.id
    assert [d["template_id"] for d in up["days"]] == [_SHARED.id] * 3
    assert await _rows() == []


@needs_db
async def test_under_the_storage_budget_pins(client: TestClient) -> None:
    sid = await _played()
    # 89 % of the replay budget, 10 % of the plan: under the 90 % turn-down point.
    _sized(
        events_bytes=int(replay_storage.budget_bytes() * 0.89),
        database_bytes=replay_storage.plan_bytes() // 10,
    )
    client.get("/daily-challenge/status", headers=_headers(sid))
    assert len(await _rows(sid)) == 1


@needs_db
async def test_the_budget_guard_reuses_a_cached_reading_for_an_hour(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    measured: list[int] = []

    async def measure(_db) -> replay_storage.StorageSize:
        measured.append(1)
        return replay_storage.StorageSize(events_bytes=1, database_bytes=1)

    monkeypatch.setattr(replay_storage, "measure_storage", measure)
    now = datetime(2026, 11, 21, 12, tzinfo=UTC)
    async with get_session_factory()() as db:
        await replay_storage.cached_storage(db, now=now)
        await replay_storage.cached_storage(db, now=now + timedelta(minutes=59))
        assert len(measured) == 1
        await replay_storage.cached_storage(db, now=now + timedelta(minutes=61))
        assert len(measured) == 2
        assert await replay_storage.storage_over_budget(db) is False


@needs_db
async def test_the_budget_guard_is_off_where_size_cannot_be_measured() -> None:
    async with get_session_factory()() as db:  # SQLite: no pg_* size functions
        assert await replay_storage.cached_storage(db) is None
        assert await replay_storage.storage_over_budget(db) is False


@needs_db
async def test_the_daily_budget_check_refreshes_the_cached_reading() -> None:
    size = replay_storage.StorageSize(events_bytes=5, database_bytes=7)

    async def measure(_db) -> replay_storage.StorageSize:
        return size

    async with get_session_factory()() as db:
        await replay_storage.check_storage_budget(db, measure=measure)
    assert replay_storage._cached_size is not None
    assert replay_storage._cached_size[1] == size


# ---------------------------------------------------------------------------
# Query counts: an ineligible install is the shared path, a pinned one one SELECT
# ---------------------------------------------------------------------------


def _count_statements():
    engine = get_engine().sync_engine
    statements: list[str] = []

    def record(_conn, _cursor, statement, *_rest) -> None:
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    return statements, lambda: event.remove(engine, "before_cursor_execute", record)


@needs_db
async def test_an_ineligible_installs_status_never_picks(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    sid = str(uuid.uuid4())  # never played
    client.get("/daily-challenge/today")  # freeze today's shared template first

    async def no_pick(*_a, **_k):
        raise AssertionError("an install that may not pin is never picked for")

    monkeypatch.setattr(service, "pick_for_install", no_pick)
    statements, stop = _count_statements()
    try:
        async with get_session_factory()() as db:
            status = await service.get_status_for_session(db, session_id=sid, tz_offset_minutes=0)
    finally:
        stop()
    assert status.template == _SHARED
    # assignment SELECT, recent-play EXISTS, the frozen template SELECT, today's games.
    assert len(statements) == 4, statements
    assert await _rows() == []


@needs_db
async def test_a_pinned_installs_status_is_one_select_plus_its_games(client: TestClient) -> None:
    sid = await _played()
    client.get("/daily-challenge/status", headers=_headers(sid))  # pins today
    statements, stop = _count_statements()
    try:
        async with get_session_factory()() as db:
            await service.get_status_for_session(db, session_id=sid, tz_offset_minutes=0)
    finally:
        stop()
    assert len(statements) == 2, statements  # the pinned row, today's games
    assert "daily_challenge_assignments" in statements[0]


@needs_db
async def test_an_ineligible_installs_upcoming_is_one_batched_template_read(
    client: TestClient,
) -> None:
    sid = str(uuid.uuid4())  # never played
    client.get("/daily-challenge/upcoming")  # freeze the 3 shared days first
    statements, stop = _count_statements()
    try:
        body = client.get("/daily-challenge/upcoming", headers=_headers(sid)).json()
    finally:
        stop()
    assert body == client.get("/daily-challenge/upcoming").json()
    # assignment SELECT, recent-play EXISTS, one batched daily_challenge_days SELECT.
    assert len(statements) == 3, statements
    assert sum("daily_challenge_days" in s for s in statements) == 1


@needs_db
async def test_an_unreadable_storage_size_fails_safe(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """The size query raising never fails /status: shared template, no row, one warning,
    and no reading cached."""
    sid = await _played()

    async def broken(_db):
        raise TimeoutError("statement timeout")

    monkeypatch.setattr(replay_storage, "measure_storage", broken)
    with caplog.at_level("WARNING", logger="daily_challenge.assignments"):
        r = client.get("/daily-challenge/status", headers=_headers(sid))
    assert r.status_code == 200, r.text
    assert r.json()["template_id"] == _SHARED.id
    assert await _rows() == []
    warnings = [rec for rec in caplog.records if rec.name == "daily_challenge.assignments"]
    assert len(warnings) == 1 and warnings[0].levelname == "WARNING"
    assert replay_storage._cached_size is None


# ---------------------------------------------------------------------------
# A failing size reading: remembered for SIZE_FAILURE_TTL, and never fails /status
# ---------------------------------------------------------------------------


@needs_db
async def test_a_failed_size_reading_is_remembered_for_the_failure_window(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    measured: list[int] = []

    async def broken(_db):
        measured.append(1)
        raise TimeoutError("statement timeout")

    monkeypatch.setattr(replay_storage, "measure_storage", broken)
    sid = await _played()
    now = datetime.now(UTC)
    with caplog.at_level("WARNING", logger="daily_challenge.assignments"):
        async with get_session_factory()() as db:
            assert await assignments.may_pin(db, sid, now) is False
            later = now + assignments.SIZE_FAILURE_TTL - timedelta(seconds=1)
            assert await assignments.may_pin(db, sid, later) is False
            assert len(measured) == 1  # no second size query inside the window
            assert len(_warnings(caplog)) == 1  # one warning per failure window
            after = now + assignments.SIZE_FAILURE_TTL
            assert await assignments.may_pin(db, sid, after) is False
            assert len(measured) == 2  # measured again once the window ended
            assert len(_warnings(caplog)) == 2
    assert replay_storage._cached_size is None
    # Once the size reads again, pinning resumes.
    monkeypatch.setattr(replay_storage, "measure_storage", lambda _db: _none())
    async with get_session_factory()() as db:
        after_recovery = after + assignments.SIZE_FAILURE_TTL
        assert await assignments.may_pin(db, sid, after_recovery) is True


def _warnings(caplog: pytest.LogCaptureFixture) -> list:
    return [r for r in caplog.records if r.name == "daily_challenge.assignments"]


async def _none() -> None:
    return None


@needs_db
async def test_invalid_size_sql_rolls_back_to_its_savepoint(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A size query that fails *in the database* (not just in Python) leaves the
    request's transaction usable: /status answers, nothing is pinned, and a later
    statement in the same session runs."""

    async def invalid_sql(db):
        await db.execute(text("SELECT * FROM no_such_table"))

    monkeypatch.setattr(replay_storage, "measure_storage", invalid_sql)
    sid = await _played()
    r = client.get("/daily-challenge/status", headers=_headers(sid))
    assert r.status_code == 200, r.text
    assert r.json()["template_id"] == _SHARED.id
    assert await _rows() == []

    assignments._size_failed_until = None  # measure again, now in a session we hold
    async with get_session_factory()() as db:
        assert await assignments.may_pin(db, sid) is False
        assert (await db.execute(text("SELECT 42"))).scalar() == 42
        status = await service.get_status_for_session(db, session_id=sid, tz_offset_minutes=0)
    assert status.template == _SHARED
