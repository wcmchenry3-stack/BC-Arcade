"""Bottle Sort "solve N new levels" (#4028): the relative goal kind, its scoring against
the best level solved before the day started (``/status``, the streak, the metrics
script, the step-down), and the personal pick that offers it.

The evaluation cases come from ``fixtures/sort_new_levels_parity.json``, which the
app's offline check reads too (``frontend/src/game/daily_challenge/__tests__/
sortNewLevels.test.ts``), so the server and the device agree on every case.
"""

from __future__ import annotations

import importlib.util
import json
import pathlib
import sys
import uuid
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import delete, event

from daily_challenge import personal, service
from daily_challenge.assignments import Assignment, derived_template_id, encode_goals
from daily_challenge.definitions import (
    FREE_GOAL_POOL,
    NEW_LEVELS_KIND,
    Goal,
    Template,
    facts_for,
    goal_from_spec,
    goal_to_spec,
    is_relative,
    relative_games,
)
from daily_challenge.history import InstallHistory, load_install_history
from daily_challenge.personal import (
    GAME_SPECS,
    build_goal,
    choose_bonus,
    options_for,
    sort_new_levels,
    sort_target,
)
from daily_challenge.streak import compute_streak
from db.base import get_engine, get_session_factory
from db.models import DailyChallengeAssignment, Game
from tests._helpers import set_dev_override
from tests.test_daily_challenge_personal import _add, _history

BACKEND = pathlib.Path(__file__).parent.parent
_FIXTURE = json.loads(
    (BACKEND / "tests" / "fixtures" / "sort_new_levels_parity.json").read_text(encoding="utf-8")
)
_DAY = date(2026, 11, 21)
_DW = FREE_GOAL_POOL["daily_word"][0]
_2048 = FREE_GOAL_POOL["twenty48"][0]  # final_score >= 500
_LEVELS = GAME_SPECS["sort"].type("levels")


def _goal(n: int) -> Goal:
    return build_goal(_LEVELS, n)


def _ended(solves: Sequence[int]) -> list[tuple[str, dict]]:
    return [("sort", {"won": True, "final_score": s}) for s in solves]


@pytest.fixture(autouse=True)
def _fresh_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    set_dev_override(monkeypatch, "")
    monkeypatch.setattr(personal, "_settings", None)


def _catalog(monkeypatch: pytest.MonkeyPatch, on: bool) -> None:
    monkeypatch.setattr(personal, "sort_catalog_goals_on", lambda: on)


# ---------------------------------------------------------------------------
# The kind (pure)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("case", _FIXTURE["cases"], ids=lambda c: c["name"])
def test_new_levels_against_the_day_start_best(case: dict) -> None:
    goal = _goal(case["target"])
    status = service.evaluate_goal(goal, _ended(case["solves"]), {"sort": case["day_start_best"]})
    assert status.completed is case["met"]


def test_the_goal_is_relative_and_rebuilds_equal() -> None:
    goal = _goal(2)
    assert (goal.game_type, goal.kind, goal.target, goal.id) == (
        "sort",
        NEW_LEVELS_KIND,
        2,
        "sort:new_levels_at_least:2",
    )
    assert is_relative(goal) and not goal.is_win
    # A pinned goal rebuilds equal: through goal_to_spec / goal_from_spec and the row codec.
    assert goal_from_spec(goal_to_spec(goal)) == goal
    assert not is_relative(FREE_GOAL_POOL["sort"][0])  # the shared template's absolute goal
    assert relative_games([_DW, FREE_GOAL_POOL["sort"][0], None]) == set()
    assert relative_games([_DW, goal]) == {"sort"}


def test_without_the_day_start_best_it_is_never_met() -> None:
    goal = _goal(1)
    assert not service.evaluate_goal(goal, _ended([50])).completed
    assert not service.evaluate_goal(goal, _ended([50]), {}).completed
    assert service.evaluate_goal(goal, _ended([50]), {"sort": 0}).completed


def test_a_client_sent_new_levels_value_is_ignored() -> None:
    goal = _goal(1)
    forged = [("sort", {"won": True, "final_score": 10, "new_levels": 99})]
    assert not service.evaluate_goal(goal, forged, {"sort": 10}).completed
    assert facts_for(goal, forged[0][1], {"sort": 10})["new_levels"] == 0
    # A row with no score reads as nothing.
    assert facts_for(goal, {"won": True}, {"sort": 10}) is None
    # Every other goal reads its facts unchanged.
    assert facts_for(_2048, {"final_score": 600}, None) == {"final_score": 600}


# ---------------------------------------------------------------------------
# The personal pick (pure): N rule and caps
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "per_day,stepped,expected",
    [
        ([], False, 1),  # no day of play yet
        ([0, 0], False, 1),  # floor 1
        ([1], False, 1),
        ([2, 2, 1], False, 2),  # median 2 x 1.12 = 2.24 -> 2
        ([3], False, 3),
        ([10, 12], False, 3),  # capped at 3
        ([2], True, 1),  # one fewer after two misses
        ([1], True, 1),  # never under 1
        ([10], True, 2),
    ],
)
def test_n_is_the_per_day_pace_from_1_to_3(per_day: list[int], stepped: bool, expected: int):
    assert sort_new_levels(per_day, pct=12, stepped_down=stepped) == expected


@pytest.mark.parametrize(
    "n,best,catalog_on,expected",
    [
        (3, 0, True, 3),
        (3, 117, True, 3),
        (3, 118, True, 2),
        (3, 119, True, 1),
        (3, 120, True, None),  # the 120-level catalog is done: no Sort goal
        (3, 20, False, 3),
        (3, 21, False, 2),
        (3, 22, False, 1),
        (3, 23, False, None),  # the 23 legacy levels are done
        (1, 40, False, None),  # past 23 on an old build's edition
    ],
)
def test_the_catalog_caps_n(n: int, best: int, catalog_on: bool, expected: int | None) -> None:
    assert sort_target(n, best, catalog_on=catalog_on) == expected


def _sort_history(per_day: dict[int, int], *, before: int = 0, day: date = _DAY) -> InstallHistory:
    """Sort played on the given days back (days back -> highest level solved that day),
    three rows a day, with ``before`` solved before the affinity window."""
    plays = []
    for back, best in per_day.items():
        d = day - timedelta(days=back)
        plays += [("sort", d, {"won": True, "final_score": best}) for _ in range(3)]
    h = _history(day, plays)
    h.daily_best = {"sort": {day - timedelta(days=b): v for b, v in per_day.items()}}
    h.best_before_window = {"sort": before} if before else {}
    if before:
        best = h.best_scores.setdefault(day, {})
        best["sort"] = max(best.get("sort", 0), before)
    return h


def test_the_pace_reads_per_day_standings(monkeypatch: pytest.MonkeyPatch) -> None:
    _catalog(monkeypatch, True)
    # 30 solved before the window, then 32, 34, 36: two new levels a day.
    h = _sort_history({3: 32, 2: 34, 1: 36}, before=30)
    assert h.sort_new_levels_per_day(_DAY) == [2, 2, 2]
    [option] = options_for("sort", h, _DAY, pct=12)
    assert option.goal == _goal(2)  # 2 x 1.12 -> 2
    # A day of replays only (the standing does not move) is a day of 0 new levels.
    h = _sort_history({3: 32, 2: 32, 1: 32}, before=30)
    assert h.sort_new_levels_per_day(_DAY) == [2, 0, 0]
    assert options_for("sort", h, _DAY, pct=12)[0].goal == _goal(1)


def test_cold_start_is_one_new_level_and_still_capped(monkeypatch: pytest.MonkeyPatch) -> None:
    _catalog(monkeypatch, False)
    h = _history(_DAY, [("sort", _DAY - timedelta(days=1), {"final_score": 5})])
    assert [o.goal for o in options_for("sort", h, _DAY, pct=12)] == [_goal(1)]
    h = _history(_DAY, [("sort", _DAY - timedelta(days=1), {"final_score": 23})])
    assert options_for("sort", h, _DAY, pct=12) == []


@pytest.mark.parametrize("catalog_on,cap", [(True, 120), (False, 23)])
def test_the_pick_never_asks_past_the_catalog(
    monkeypatch: pytest.MonkeyPatch, catalog_on: bool, cap: int
) -> None:
    _catalog(monkeypatch, catalog_on)
    fast = {3: cap - 21, 2: cap - 11, 1: cap - 1}  # ten new levels a day
    [option] = options_for("sort", _sort_history(fast, before=max(0, cap - 31)), _DAY, pct=12)
    assert option.goal == _goal(1)  # N would be 3; one level is left
    done = {3: cap - 20, 2: cap - 10, 1: cap}
    assert options_for("sort", _sort_history(done, before=max(0, cap - 30)), _DAY, pct=12) == []


def test_an_exhausted_catalog_is_never_offered_as_a_bonus(monkeypatch: pytest.MonkeyPatch) -> None:
    _catalog(monkeypatch, False)
    core = (_DW, _2048, FREE_GOAL_POOL["yacht"][0])
    # Sort last played 20 days ago (outside the affinity window): a discovery candidate.
    played = [("sort", _DAY - timedelta(days=20), {"final_score": 23})]
    for seed in range(30):
        bonus = choose_bonus(
            _history(_DAY, played), _DAY, ["sort"], core, session_id=f"s{seed}", share=1.0
        )
        assert bonus is None
    fresh = [("sort", _DAY - timedelta(days=20), {"final_score": 5})]
    bonus = choose_bonus(_history(_DAY, fresh), _DAY, ["sort"], core, session_id="s", share=1.0)
    assert bonus is not None and bonus.kind == NEW_LEVELS_KIND and bonus.target == 1


def test_two_missed_sort_days_step_n_down(monkeypatch: pytest.MonkeyPatch) -> None:
    _catalog(monkeypatch, True)
    h = _sort_history({5: 32, 4: 34, 3: 36, 2: 36, 1: 37}, before=30)
    # Days -2 and -1 held "3 new levels": day -2 replayed only, day -1 solved one. Both are
    # scored from their own day-start best (36 before day -1, 36 before day -2).
    for back in (2, 1):
        d = _DAY - timedelta(days=back)
        h.pinned[d] = Assignment(
            Template(derived_template_id((_DW, _goal(3), _2048)), (_DW, _goal(3), _2048))
        )
        h.best_scores[d] = {"sort": 36}
    assert personal.stepped_down(h, "sort", "levels")
    # Pace: 2, 2, 2, 0, 1 -> median 2 -> 2; stepped down -> 1.
    assert options_for("sort", h, _DAY, pct=12)[0].goal == _goal(1)
    # Had day -1 started from 33 (so its 37 was 4 new levels), it would have been met.
    h.best_scores[_DAY - timedelta(days=1)] = {"sort": 33}
    assert not personal.stepped_down(h, "sort", "levels")


# ---------------------------------------------------------------------------
# Server evaluation against the database
# ---------------------------------------------------------------------------

_sids: list[str] = []


@pytest.fixture
async def _cleanup():
    yield
    async with get_session_factory()() as db:
        await db.execute(delete(Game).where(Game.session_id.in_(_sids)))
        await db.execute(
            delete(DailyChallengeAssignment).where(
                DailyChallengeAssignment.session_id.in_([uuid.UUID(s) for s in _sids])
            )
        )
        await db.commit()
    _sids.clear()


def _sid() -> str:
    sid = str(uuid.uuid4())
    _sids.append(sid)
    return sid


async def _pin(sid: str, day: date, goals: Sequence[Goal]) -> None:
    async with get_session_factory()() as db:
        db.add(
            DailyChallengeAssignment(
                session_id=uuid.UUID(sid), local_date=day, goals=encode_goals(goals)
            )
        )
        await db.commit()


def _statements():
    engine = get_engine().sync_engine
    seen: list[str] = []

    def record(_conn, _cursor, statement, *_rest) -> None:
        seen.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    return seen, lambda: event.remove(engine, "before_cursor_execute", record)


# UTC-5: the local day 2025-01-15 starts at 05:00 UTC.
_TZ = -300
_LOCAL = date(2025, 1, 15)
_START = datetime(2025, 1, 15, 5, tzinfo=UTC)
_NOW = datetime(2025, 1, 15, 20, tzinfo=UTC)


async def _status(sid: str):
    async with get_session_factory()() as db:
        return await service.get_status_for_session(
            db, session_id=sid, tz_offset_minutes=_TZ, utc_now=_NOW
        )


@pytest.mark.usefixtures("_cleanup")
async def test_status_scores_new_levels_across_the_local_day_boundary() -> None:
    sid = _sid()
    await _pin(sid, _LOCAL, (_DW, _goal(2), _2048))
    # 23:59:59 local the day before: level 10. It is the day-start best, not today's.
    await _add(sid, "sort", _START - timedelta(seconds=1), final_score=10)
    # Never baselines: an abandoned run and a dev-affected one, both before the day.
    await _add(sid, "sort", _START - timedelta(hours=2), final_score=60, outcome="abandoned")
    await _add(
        sid, "sort", _START - timedelta(hours=3), final_score=70, metadata={"dev_affected": True}
    )
    # 00:00 local: level 11 (the day's first second counts as the day).
    await _add(sid, "sort", _START, final_score=11)
    status = await _status(sid)
    assert [g.completed for g in status.goals] == [False, False, False]
    # A replay of an old level reports the same standing: still one new level.
    await _add(sid, "sort", _START + timedelta(hours=1), final_score=11)
    assert not (await _status(sid)).goals[1].completed
    await _add(sid, "sort", _START + timedelta(hours=2), final_score=12)
    assert (await _status(sid)).goals[1].completed


@pytest.mark.usefixtures("_cleanup")
async def test_status_reads_the_day_start_best_with_one_more_query_only_when_needed() -> None:
    relative, absolute = _sid(), _sid()
    await _pin(relative, _LOCAL, (_DW, _goal(1), _2048))
    await _pin(absolute, _LOCAL, (_DW, FREE_GOAL_POOL["sort"][0], _2048))
    counts = []
    for sid in (relative, absolute):
        seen, stop = _statements()
        try:
            await _status(sid)
        finally:
            stop()
        counts.append(seen)
    assert len(counts[0]) == len(counts[1]) + 1
    extra = [s for s in counts[0] if s not in counts[1]]
    assert len(extra) == 1 and "max(" in extra[0].lower()


@pytest.mark.usefixtures("_cleanup")
async def test_the_streak_replays_days_with_a_running_day_start_best() -> None:
    sid = _sid()
    now = datetime(2025, 3, 1, 12, tzinfo=UTC)
    today = date(2025, 3, 1)

    def day(back: int) -> date:
        return today - timedelta(days=back)

    def noon(back: int, minute: int = 0) -> datetime:
        d = day(back)
        return datetime(d.year, d.month, d.day, 12, minute, tzinfo=UTC)

    # Level 10 solved 70 days ago, before the 60-day window: read by one aggregate.
    await _add(sid, "sort", noon(70), final_score=10)
    targets = {3: 1, 2: 2, 1: 1}
    solved = {3: 11, 2: 12, 1: 13}
    for back, n in targets.items():
        await _pin(sid, day(back), (_DW, _goal(n), _2048))
        await _add(sid, "twenty48", noon(back), final_score=600)
        await _add(sid, "sort", noon(back, 1), final_score=solved[back])
    # Day -1: 13 - 12 = 1 >= 1, met. Day -2: 12 - 11 = 1 < 2 (its baseline is day -3's 11,
    # not the 10 before the window), missed: the streak stops there.
    seen, stop = _statements()
    try:
        async with get_session_factory()() as db:
            assert await compute_streak(db, sid, 0, now) == 1
    finally:
        stop()
    sort_reads = [s for s in seen if "max(" in s.lower() and "games" in s.lower()]
    assert len(sort_reads) == 1  # one aggregate, not one per day


@pytest.mark.usefixtures("_cleanup")
async def test_the_streak_baseline_includes_play_before_the_window() -> None:
    sid = _sid()
    now = datetime(2025, 3, 1, 12, tzinfo=UTC)
    yesterday = date(2025, 2, 28)
    await _add(sid, "sort", datetime(2024, 12, 1, 12, tzinfo=UTC), final_score=50)
    await _pin(sid, yesterday, (_DW, _goal(1), _2048))
    await _add(sid, "twenty48", datetime(2025, 2, 28, 12, tzinfo=UTC), final_score=600)
    await _add(sid, "sort", datetime(2025, 2, 28, 12, 1, tzinfo=UTC), final_score=50)  # replay
    async with get_session_factory()() as db:
        assert await compute_streak(db, sid, 0, now) == 0
    await _add(sid, "sort", datetime(2025, 2, 28, 12, 2, tzinfo=UTC), final_score=51)
    async with get_session_factory()() as db:
        assert await compute_streak(db, sid, 0, now) == 1


@pytest.mark.usefixtures("_cleanup")
async def test_the_loader_reads_day_start_bests_for_the_step_down_days(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _catalog(monkeypatch, True)
    sid = _sid()
    for back, level in ((4, 30), (3, 32), (2, 33), (1, 33)):
        d = _DAY - timedelta(days=back)
        await _add(sid, "sort", datetime(d.year, d.month, d.day, 12, tzinfo=UTC), final_score=level)
    for back in (2, 1):
        await _pin(sid, _DAY - timedelta(days=back), (_DW, _goal(2), _2048))
    async with get_session_factory()() as db:
        h = await load_install_history(db, sid, _DAY, now=datetime(2026, 11, 21, 6, tzinfo=UTC))
    assert h.best_scores[_DAY - timedelta(days=2)]["sort"] == 32
    assert h.best_scores[_DAY - timedelta(days=1)]["sort"] == 33
    assert h.daily_best["sort"][_DAY - timedelta(days=3)] == 32
    # Day -2: 33 - 32 = 1 < 2; day -1: 33 - 33 = 0 < 2. Both played and missed.
    assert personal.stepped_down(h, "sort", "levels")


# ---------------------------------------------------------------------------
# The metrics script
# ---------------------------------------------------------------------------

_SCRIPT = BACKEND / "scripts" / "daily_challenge_metrics.py"
_spec = importlib.util.spec_from_file_location("daily_challenge_metrics_sort", _SCRIPT)
metrics = importlib.util.module_from_spec(_spec)
sys.modules["daily_challenge_metrics_sort"] = metrics
_spec.loader.exec_module(metrics)


@pytest.mark.usefixtures("_cleanup")
async def test_the_metrics_score_new_levels_with_a_running_baseline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(metrics, "CHUNK_INSTALLS", 1)
    d1, d2, d3 = date(2024, 4, 2), date(2024, 4, 3), date(2024, 4, 4)
    now = datetime(2024, 4, 20, tzinfo=UTC)

    def at(d: date, minute: int = 0) -> datetime:
        return datetime(d.year, d.month, d.day, 12, minute, tzinfo=UTC)

    sid = _sid()
    await _add(sid, "sort", at(date(2024, 3, 1)), final_score=10)  # before the window
    await _pin(sid, d1, (_DW, _goal(1), _2048))  # 11 - 10: met
    await _add(sid, "sort", at(d1), final_score=11)
    await _pin(sid, d2, (_DW, _goal(1), _2048))  # a replay: 11 - 11, missed
    await _add(sid, "sort", at(d2), final_score=11)
    await _pin(sid, d3, (_DW, _goal(2), _2048))  # 13 - 11: met
    await _add(sid, "sort", at(d3), final_score=13)
    other = _sid()  # no relative goal: no extra query for its chunk
    await _pin(other, d1, (_DW, FREE_GOAL_POOL["sort"][0], _2048))
    seen, stop = _statements()
    try:
        async with get_session_factory()() as db:
            report = await metrics.collect(db, d1, d3, 0, now)
    finally:
        stop()
    rows = {(g["game_type"], g["kind"]): g for g in report["core_goals"]}
    levels = rows[("sort", NEW_LEVELS_KIND)]
    assert (levels["assigned"], levels["offered"], levels["met"]) == (3, 3, 2)
    # Two chunks of one install: 3 SELECTs each, a 4th only for the one with a relative
    # goal, then the empty id page.
    assert report["install_days"] == 4
    assert len(seen) == 3 + 4 + 1
