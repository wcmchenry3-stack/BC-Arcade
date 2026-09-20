"""Daily cross-game challenge (#2392): definitions, goal evaluation, API."""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from daily_challenge import service
from daily_challenge.definitions import (
    CHALLENGE_GAMES,
    SCORE_GOAL_GAMES,
    TEMPLATES,
    Goal,
    Template,
    local_day,
    pick_index,
    shuffled_templates,
    template_for,
)
from daily_challenge.service import evaluate_goal
from db.base import get_session_factory, is_configured
from db.models import Game, GameType
from entitlements.service import _ALL_PREMIUM_SLUGS

# ---------------------------------------------------------------------------
# definitions — no DB
# ---------------------------------------------------------------------------


def test_local_day_at_utc() -> None:
    now = datetime(2026, 10, 9, 15, 30, tzinfo=timezone.utc)
    day = local_day(0, now)
    assert day.date == date(2026, 10, 9)
    assert day.start_utc == datetime(2026, 10, 9, tzinfo=timezone.utc)
    assert day.end_utc == datetime(2026, 10, 10, tzinfo=timezone.utc)


def test_local_day_west_of_utc_is_still_yesterday() -> None:
    # 03:00 UTC is 20:00 the previous evening in UTC-7.
    now = datetime(2026, 10, 9, 3, 0, tzinfo=timezone.utc)
    day = local_day(-420, now)
    assert day.date == date(2026, 10, 8)
    assert day.start_utc == datetime(2026, 10, 8, 7, 0, tzinfo=timezone.utc)
    assert day.end_utc == datetime(2026, 10, 9, 7, 0, tzinfo=timezone.utc)
    assert day.start_utc <= now < day.end_utc


def test_local_day_east_of_utc_is_already_tomorrow() -> None:
    # 20:00 UTC is 01:30 the next morning in UTC+5:30.
    now = datetime(2026, 10, 9, 20, 0, tzinfo=timezone.utc)
    day = local_day(330, now)
    assert day.date == date(2026, 10, 10)
    assert day.start_utc == datetime(2026, 10, 9, 18, 30, tzinfo=timezone.utc)
    assert day.start_utc <= now < day.end_utc


@pytest.mark.parametrize("offset", [-840, -1, 0, 1, 840])
def test_local_day_window_always_contains_now(offset: int) -> None:
    now = datetime(2026, 12, 31, 23, 59, 59, tzinfo=timezone.utc)
    day = local_day(offset, now)
    assert day.start_utc <= now < day.end_utc
    assert day.end_utc - day.start_utc == timedelta(days=1)


def test_template_pick_is_deterministic() -> None:
    assert template_for(date(2026, 10, 9)) is template_for(date(2026, 10, 9))


def test_every_template_comes_up_within_a_run_of_days() -> None:
    picked = {template_for(date(2026, 10, 1) + timedelta(days=i)).id for i in range(len(TEMPLATES))}
    assert picked == {t.id for t in TEMPLATES}


def test_salt_shifts_the_schedule() -> None:
    day = date(2026, 10, 9)
    count = len(TEMPLATES)
    assert pick_index(day, 0, count) != pick_index(day, 3, count)
    assert pick_index(day, 0, count) == pick_index(day, count, count)
    # The order is salt-seeded too: reproducible, and always the full set.
    assert shuffled_templates(12345) == shuffled_templates(12345)
    assert sorted(t.id for t in shuffled_templates(12345)) == sorted(t.id for t in TEMPLATES)
    assert any(shuffled_templates(s) != shuffled_templates(0) for s in range(1, 6))


def test_template_ids_are_unique() -> None:
    ids = [t.id for t in TEMPLATES]
    assert len(ids) == len(set(ids))


def test_challenge_games_are_never_premium() -> None:
    # A store build hides the premium games — a goal there could never be met.
    assert CHALLENGE_GAMES.isdisjoint(_ALL_PREMIUM_SLUGS)


@pytest.mark.parametrize("template", TEMPLATES, ids=lambda t: t.id)
def test_template_invariants(template: Template) -> None:
    games = [g.game_type for g in template.goals]
    assert len(template.goals) >= 2
    assert len(set(games)) == len(games), "one goal per game — the point is variety"
    assert len({g.id for g in template.goals}) == len(template.goals)
    for goal in template.goals:
        assert goal.game_type in CHALLENGE_GAMES
        if goal.kind == "score_at_least":
            assert goal.game_type in SCORE_GOAL_GAMES
            assert goal.target is not None and goal.target > 0
        else:
            assert goal.kind == "complete"
            assert goal.target is None


# ---------------------------------------------------------------------------
# goal evaluation — no DB
# ---------------------------------------------------------------------------

_COMPLETE_MAHJONG = Goal(game_type="mahjong", kind="complete")
_SCORE_2000 = Goal(game_type="twenty48", kind="score_at_least", target=2000)


def test_complete_goal_needs_a_finished_game_of_that_type() -> None:
    assert not evaluate_goal(_COMPLETE_MAHJONG, []).completed
    assert not evaluate_goal(_COMPLETE_MAHJONG, [("twenty48", 5000)]).completed
    status = evaluate_goal(_COMPLETE_MAHJONG, [("mahjong", None)])
    assert status.completed
    assert status.best_score is None


def test_score_goal_reports_best_score_and_completes_at_the_target() -> None:
    assert evaluate_goal(_SCORE_2000, []).best_score is None
    below = evaluate_goal(_SCORE_2000, [("twenty48", 800), ("twenty48", 1999)])
    assert not below.completed
    assert below.best_score == 1999
    exact = evaluate_goal(_SCORE_2000, [("twenty48", 2000)])
    assert exact.completed
    assert exact.best_score == 2000


def test_score_goal_ignores_missing_scores_and_other_games() -> None:
    status = evaluate_goal(_SCORE_2000, [("twenty48", None), ("mahjong", 9999)])
    assert not status.completed
    assert status.best_score is None


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

needs_db = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping live API tests",
)

_FIXED = Template("fixed_for_tests", (_SCORE_2000, _COMPLETE_MAHJONG))


@pytest.fixture()
def client() -> Iterator[TestClient]:
    assert is_configured()
    from main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def fixed_template(monkeypatch: pytest.MonkeyPatch) -> Template:
    """Pin today's template so the tests do not depend on the calendar."""
    monkeypatch.setattr("daily_challenge.service.template_for", lambda _day: _FIXED)
    monkeypatch.setattr("daily_challenge.router.template_for", lambda _day: _FIXED)
    return _FIXED


def _headers(sid: str) -> dict[str, str]:
    return {"X-Session-ID": sid, "Content-Type": "application/json"}


def _play(
    client: TestClient,
    sid: str,
    *,
    game_type: str,
    final_score: int | None,
    outcome: str = "completed",
) -> None:
    r = client.post("/games", headers=_headers(sid), json={"game_type": game_type})
    assert r.status_code == 200, r.text
    r = client.patch(
        f"/games/{r.json()['id']}/complete",
        headers=_headers(sid),
        json={"final_score": final_score, "outcome": outcome, "duration_ms": 1000},
    )
    assert r.status_code == 200, r.text


async def _insert_finished_game(sid: str, *, game_type: str, completed_at: datetime) -> None:
    """Write a finished game with an exact ``completed_at`` (the API validates client clocks)."""
    factory = get_session_factory()
    async with factory() as db:
        gt_id = (
            await db.execute(select(GameType.id).where(GameType.name == game_type))
        ).scalar_one()
        db.add(
            Game(
                session_id=sid,
                game_type_id=gt_id,
                started_at=completed_at - timedelta(minutes=5),
                completed_at=completed_at,
                final_score=100,
                outcome="completed",
            )
        )
        await db.commit()


def _goals_by_id(body: dict) -> dict[str, dict]:
    return {g["id"]: g for g in body["goals"]}


@needs_db
def test_today_is_public_and_describes_the_goals(client: TestClient) -> None:
    r = client.get("/daily-challenge/today")
    assert r.status_code == 200, r.text
    body = r.json()
    today = local_day(0)
    assert body["challenge_id"] == today.date.isoformat()
    assert body["template_id"] == template_for(today.date).id
    assert datetime.fromisoformat(body["resets_at"].replace("Z", "+00:00")) == today.end_utc
    assert len(body["goals"]) >= 2
    for goal in body["goals"]:
        assert set(goal) == {"id", "game_type", "kind", "target"}
        assert goal["game_type"] in CHALLENGE_GAMES


@needs_db
def test_today_follows_the_client_timezone(client: TestClient) -> None:
    east = client.get("/daily-challenge/today", params={"tz_offset_minutes": 840}).json()
    west = client.get("/daily-challenge/today", params={"tz_offset_minutes": -840}).json()
    # 28 hours apart — never the same calendar day.
    assert east["challenge_id"] != west["challenge_id"]
    assert east["challenge_id"] == local_day(840).date.isoformat()


@needs_db
@pytest.mark.parametrize("path", ["/daily-challenge/today", "/daily-challenge/status"])
def test_rejects_out_of_range_timezone(client: TestClient, path: str) -> None:
    r = client.get(path, headers=_headers(str(uuid.uuid4())), params={"tz_offset_minutes": 900})
    assert r.status_code == 422


@needs_db
def test_status_requires_a_session(client: TestClient) -> None:
    assert client.get("/daily-challenge/status").status_code == 400
    r = client.get("/daily-challenge/status", headers={"X-Session-ID": "not-a-uuid"})
    assert r.status_code == 400


@needs_db
def test_status_for_a_fresh_session(client: TestClient, fixed_template: Template) -> None:
    body = client.get("/daily-challenge/status", headers=_headers(str(uuid.uuid4()))).json()
    today = client.get("/daily-challenge/today").json()
    assert body["challenge_id"] == today["challenge_id"]
    assert body["template_id"] == today["template_id"] == fixed_template.id
    assert [g["id"] for g in body["goals"]] == [g["id"] for g in today["goals"]]
    assert body["completed_goals"] == 0
    assert body["total_goals"] == 2
    assert body["completed"] is False
    assert all(g["completed"] is False and g["best_score"] is None for g in body["goals"])


@needs_db
def test_finishing_the_games_completes_the_challenge(
    client: TestClient, fixed_template: Template
) -> None:
    sid = str(uuid.uuid4())

    _play(client, sid, game_type="twenty48", final_score=1200)
    body = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    goals = _goals_by_id(body)
    assert goals[_SCORE_2000.id]["completed"] is False
    assert goals[_SCORE_2000.id]["best_score"] == 1200
    assert body["completed_goals"] == 0

    _play(client, sid, game_type="twenty48", final_score=2400)
    body = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    assert _goals_by_id(body)[_SCORE_2000.id] == {
        "id": _SCORE_2000.id,
        "game_type": "twenty48",
        "kind": "score_at_least",
        "target": 2000,
        "completed": True,
        "best_score": 2400,
    }
    assert body["completed_goals"] == 1
    assert body["completed"] is False

    _play(client, sid, game_type="mahjong", final_score=350)
    body = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    assert body["completed_goals"] == 2
    assert body["completed"] is True


@needs_db
def test_abandoned_and_unfinished_games_do_not_count(
    client: TestClient, fixed_template: Template
) -> None:
    sid = str(uuid.uuid4())
    _play(client, sid, game_type="mahjong", final_score=0, outcome="abandoned")
    _play(client, sid, game_type="twenty48", final_score=9000, outcome="abandoned")
    r = client.post("/games", headers=_headers(sid), json={"game_type": "mahjong"})
    assert r.status_code == 200  # started, never finished

    body = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    assert body["completed_goals"] == 0
    assert _goals_by_id(body)[_SCORE_2000.id]["best_score"] is None


@needs_db
def test_kept_playing_twenty48_counts(client: TestClient, fixed_template: Template) -> None:
    sid = str(uuid.uuid4())
    _play(client, sid, game_type="twenty48", final_score=20000, outcome="kept_playing")
    body = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    assert _goals_by_id(body)[_SCORE_2000.id]["completed"] is True


@needs_db
def test_other_sessions_and_other_games_do_not_count(
    client: TestClient, fixed_template: Template
) -> None:
    sid, other = str(uuid.uuid4()), str(uuid.uuid4())
    _play(client, other, game_type="mahjong", final_score=300)
    _play(client, sid, game_type="solitaire", final_score=500)
    body = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    assert body["completed_goals"] == 0


@needs_db
async def test_only_games_inside_the_local_day_count(fixed_template: Template) -> None:
    now = datetime(2026, 10, 9, 12, 0, tzinfo=timezone.utc)
    day = local_day(-420, now)  # 07:00 UTC Oct 9 → 07:00 UTC Oct 10
    factory = get_session_factory()

    async def completed_goals(sid: str) -> int:
        async with factory() as db:
            status = await service.get_status_for_session(
                db, session_id=sid, tz_offset_minutes=-420, utc_now=now
            )
        return status.completed_goals

    before, first, last, after = (str(uuid.uuid4()) for _ in range(4))
    await _insert_finished_game(
        before, game_type="mahjong", completed_at=day.start_utc - timedelta(seconds=1)
    )
    await _insert_finished_game(first, game_type="mahjong", completed_at=day.start_utc)
    await _insert_finished_game(
        last, game_type="mahjong", completed_at=day.end_utc - timedelta(seconds=1)
    )
    await _insert_finished_game(after, game_type="mahjong", completed_at=day.end_utc)

    assert await completed_goals(before) == 0
    assert await completed_goals(first) == 1
    assert await completed_goals(last) == 1
    assert await completed_goals(after) == 0
