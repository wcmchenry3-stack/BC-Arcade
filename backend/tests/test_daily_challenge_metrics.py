"""Daily Challenge tuning metrics script (#3998): ``scripts/daily_challenge_metrics.py``.

Fixtures are pinned assignment rows plus games whose aggregates are worked out by
hand in each test. Dates are in 2024 (the test DB is shared), and ``utc_now`` is
injected so every window is long past.
"""

from __future__ import annotations

import importlib.util
import json
import pathlib
import subprocess
import sys
import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import delete, event, func, select

from daily_challenge.assignments import encode_goals
from daily_challenge.definitions import FREE_GOAL_POOL, _at_least
from db.base import get_session_factory
from db.models import DailyChallengeAssignment, Game, GameType

BACKEND = pathlib.Path(__file__).parent.parent
SCRIPT = BACKEND / "scripts" / "daily_challenge_metrics.py"
_spec = importlib.util.spec_from_file_location("daily_challenge_metrics", SCRIPT)
metrics = importlib.util.module_from_spec(_spec)
sys.modules["daily_challenge_metrics"] = metrics
_spec.loader.exec_module(metrics)

_SCORE = FREE_GOAL_POOL["twenty48"][0]  # final_score >= 500
_LEVEL = FREE_GOAL_POOL["sort"][0]  # final_score >= 3
_MOVES = _at_least("solitaire", "moves", 10, "easy")  # the pre-#3993 easy goal
_CORE = (_SCORE, _LEVEL, _MOVES)
_BONUS = '["sort","final_score_at_least",8,"medium"]'

_NOW = datetime(2024, 3, 20, 12, 0, tzinfo=UTC)
D1, D2, D3 = date(2024, 3, 2), date(2024, 3, 3), date(2024, 3, 4)

_sids: list[str] = []


@pytest.fixture(autouse=True)
async def _clean():
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


def _new_install() -> str:
    sid = str(uuid.uuid4())
    _sids.append(sid)
    return sid


def _at(day: date, hour: int = 12, minute: int = 0, second: int = 0) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, second, tzinfo=UTC)


async def _pin(sid: str, day: date, *, bonus: str | None = None) -> None:
    async with get_session_factory()() as db:
        db.add(
            DailyChallengeAssignment(
                session_id=uuid.UUID(sid), local_date=day, goals=encode_goals(_CORE), bonus=bonus
            )
        )
        await db.commit()


async def _play(sid: str, game_type: str, when: datetime, **fields) -> None:
    async with get_session_factory()() as db:
        gt_id = (
            await db.execute(select(GameType.id).where(GameType.name == game_type))
        ).scalar_one()
        db.add(
            Game(
                session_id=sid,
                game_type_id=gt_id,
                started_at=when - timedelta(minutes=5),
                completed_at=when,
                outcome=fields.get("outcome", "completed"),
                final_score=fields.get("final_score"),
                game_metadata=fields.get("metadata", {}),
            )
        )
        await db.commit()


async def _collect(since: date, until: date, tz: int = 0) -> dict:
    async with get_session_factory()() as db:
        return await metrics.collect(db, since, until, tz, _NOW)


def _goal(report: dict, game_type: str) -> dict:
    return next(g for g in report["core_goals"] if g["game_type"] == game_type)


async def _seed_window_a() -> None:
    """Six install-days over D1..D3, hand-counted in ``test_every_metric``."""
    i1, i2, i3, i4, i5 = (_new_install() for _ in range(5))
    for sid, day in [(i1, D1), (i1, D2), (i2, D1), (i3, D1), (i4, D3), (i5, D3)]:
        await _pin(sid, day)
    # I1: D1 two goals met, D2 one game short of its goal; played both days.
    await _play(i1, "twenty48", _at(D1), final_score=600)
    await _play(i1, "sort", _at(D1), final_score=12)
    await _play(i1, "twenty48", _at(D2), final_score=100)
    # I2: an abandoned 9,000 never counts; one goal met by a finished sort game.
    await _play(i2, "twenty48", _at(D1), final_score=9000, outcome="abandoned")
    await _play(i2, "sort", _at(D1), final_score=12)
    # I3: pinned only, never played.
    # I4: qualifies on D3 at the last second; returns at exactly the next midnight.
    await _play(i4, "twenty48", _at(D3, 23, 59, 59), final_score=600)
    await _play(i4, "solitaire", _at(D3, 23, 59, 59), metadata={"moves": 12})
    await _play(i4, "sort", _at(D3 + timedelta(days=1), 0, 0, 0), final_score=1)
    # I5: qualifies on D3, but its only other game is the day *before*: no return.
    await _play(i5, "twenty48", _at(D3), final_score=600)
    await _play(i5, "sort", _at(D3), final_score=5)
    await _play(i5, "sort", _at(D2), final_score=5)


async def test_every_metric() -> None:
    await _seed_window_a()
    report = await _collect(D1, D3)

    assert report["install_days"] == 6
    assert report["install_days_played"] == 5  # I3 never played

    # a. per game and kind. assigned = 6 each (every day pins all three goals).
    t = _goal(report, "twenty48")
    assert (t["kind"], t["assigned"], t["offered"], t["met"]) == (
        "final_score_at_least",
        6,
        4,  # I1 D1, I1 D2, I4, I5; I2's only twenty48 game was abandoned
        3,  # I1 D1, I4, I5; I1 D2 scored 100
    )
    assert t["rate_among_played"] == 0.75 and t["rate_overall"] == 0.5
    s = _goal(report, "sort")
    assert (s["assigned"], s["offered"], s["met"]) == (6, 3, 3)  # I1 D1, I2, I5
    assert s["rate_among_played"] == 1.0
    m = _goal(report, "solitaire")
    assert (m["assigned"], m["offered"], m["met"]) == (6, 1, 1)  # I4 only
    assert report["core_total"] == {
        "assigned": 18,
        "offered": 8,
        "met": 7,
        "rate_among_played": 0.875,
        "rate_overall": 0.3889,
    }

    # b. 2 of 3 met: I1 D1, I4, I5 of the 5 played install-days.
    assert report["qualifying_days"]["qualified"] == 3
    assert report["qualifying_days"]["install_days_played"] == 5
    assert report["qualifying_days"]["share"] == 0.6

    # c. no pinned row has a bonus.
    assert report["bonus_discovery"] == {"available": False}

    # d. I1 returned on D2, I4 at 00:00:00 the next day, I5 did not.
    assert report["next_day_return"] == {"qualified_days": 3, "returned": 2, "share": 0.6667}


async def test_abandoned_games_are_not_counted_anywhere() -> None:
    sid = _new_install()
    await _pin(sid, D1)
    await _play(sid, "twenty48", _at(D1), final_score=9000, outcome="abandoned")
    report = await _collect(D1, D1)
    assert report["install_days"] == 1
    assert report["install_days_played"] == 0  # not a day with a finished game
    assert _goal(report, "twenty48")["offered"] == 0
    assert _goal(report, "twenty48")["met"] == 0
    assert report["qualifying_days"]["share"] is None


async def test_bonus_discovery_counts_days_where_the_bonus_game_was_played() -> None:
    j1, j2, j3 = (_new_install() for _ in range(3))
    await _pin(j1, D1, bonus=_BONUS)
    await _pin(j2, D1, bonus=_BONUS)
    await _pin(j3, D1)
    await _play(j1, "sort", _at(D1), final_score=4)  # bonus game played
    await _play(j2, "twenty48", _at(D1), final_score=10)  # other game only
    await _play(j2, "sort", _at(D1), final_score=9, outcome="abandoned")  # abandoned: no
    report = await _collect(D1, D1)
    assert report["bonus_discovery"] == {
        "available": True,
        "days_with_bonus": 2,
        "played": 1,
        "share": 0.5,
    }
    # The bonus never feeds the core goals: sort has 3 assigned core goals, not 5.
    assert _goal(report, "sort")["assigned"] == 3


async def test_next_day_return_follows_the_local_day_boundary() -> None:
    qualifies_and_returns, qualifies_late = _new_install(), _new_install()
    for sid in (qualifies_and_returns, qualifies_late):
        await _pin(sid, D3)
        await _play(sid, "twenty48", _at(D3, 10), final_score=600)
        await _play(sid, "sort", _at(D3, 10), final_score=12)
    # +120 min: local midnight is 22:00 UTC. 21:59 is still local D3, 22:00 is local D3+1.
    await _play(qualifies_late, "sort", _at(D3, 21, 59), final_score=1)
    await _play(qualifies_and_returns, "sort", _at(D3, 22, 0), final_score=1)
    east = await _collect(D3, D3, tz=120)
    assert east["next_day_return"] == {"qualified_days": 2, "returned": 1, "share": 0.5}
    # In UTC days both late games are still the same day: neither returned.
    utc = await _collect(D3, D3, tz=0)
    assert utc["next_day_return"] == {"qualified_days": 2, "returned": 0, "share": 0.0}


async def test_an_unfinished_next_day_is_not_a_missed_return() -> None:
    sid = _new_install()
    today = _NOW.date()
    await _pin(sid, today)
    await _play(sid, "twenty48", _at(today), final_score=600)
    await _play(sid, "sort", _at(today), final_score=12)
    report = await _collect(today, today)
    assert report["qualifying_days"]["qualified"] == 1
    assert report["next_day_return"] == {"qualified_days": 0, "returned": 0, "share": None}


async def test_the_result_is_the_same_whatever_the_chunk_size(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await _seed_window_a()
    whole = await _collect(D1, D3)
    monkeypatch.setattr(metrics, "CHUNK_INSTALLS", 2)
    assert await _collect(D1, D3) == whole


async def _counts() -> tuple[int, int]:
    async with get_session_factory()() as db:
        a = (await db.execute(select(func.count()).select_from(DailyChallengeAssignment))).scalar()
        g = (await db.execute(select(func.count()).select_from(Game))).scalar()
        return a, g


async def test_only_selects_are_issued_and_nothing_is_written() -> None:
    await _seed_window_a()
    before = await _counts()
    seen: list[str] = []

    def record(_conn, _cursor, statement, *_rest) -> None:
        seen.append(statement.lstrip().upper())

    async with get_session_factory()() as db:
        sync_engine = db.sync_session.get_bind()
        event.listen(sync_engine, "before_cursor_execute", record)
        try:
            await metrics.collect(db, D1, D3, 0, _NOW)
        finally:
            event.remove(sync_engine, "before_cursor_execute", record)
    assert seen and all(stmt.startswith("SELECT") for stmt in seen), seen
    assert await _counts() == before
    # Cost: one chunk is 3 SELECTs (ids, pinned rows, games) plus the final empty id
    # page, however many install-days there are.
    assert len(seen) == 4


async def test_output_carries_no_install_ids() -> None:
    await _seed_window_a()
    report = await _collect(D1, D3)
    out = metrics.render(report) + json.dumps(report)
    for sid in _sids:
        assert sid not in out and sid.replace("-", "") not in out
    assert "no bonus data yet" in metrics.render(report)
    assert "65-75%" in metrics.render(report)


async def test_an_empty_window_reports_zeros_and_no_rates() -> None:
    report = await _collect(date(2001, 1, 1), date(2001, 1, 2))
    assert report["install_days"] == 0 and report["core_goals"] == []
    assert report["core_total"]["rate_among_played"] is None
    assert "n/a" in metrics.render(report)


def _cli(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        cwd=BACKEND,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )


async def test_cli_json_and_text_and_default_window() -> None:
    sid = _new_install()
    await _pin(sid, D1)
    await _play(sid, "twenty48", _at(D1), final_score=600)
    result = _cli("--since", "2024-03-02", "--until", "2024-03-02", "--json")
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["window"] == {"since": "2024-03-02", "until": "2024-03-02"}
    assert payload["install_days"] == 1 and sid not in result.stdout
    text = _cli("--since", "2024-03-02", "--until", "2024-03-02")
    assert text.returncode == 0 and "Core goal completion" in text.stdout
    assert _cli().returncode == 0  # default: the last 14 complete days


def test_cli_rejects_a_bad_window() -> None:
    assert _cli("--since", "not-a-date").returncode == 2
    assert _cli("--since", "2024-03-05", "--until", "2024-03-01").returncode == 2


async def test_yesterday_is_not_matured_for_next_day_return() -> None:
    sid = _new_install()
    today = _NOW.date()
    for day in (today - timedelta(days=2), today - timedelta(days=1)):
        await _pin(sid, day)
        await _play(sid, "twenty48", _at(day), final_score=600)
        await _play(sid, "sort", _at(day), final_score=12)
    # No game today: yesterday's next day (today) has not ended, so it is not counted.
    yesterday = await _collect(today - timedelta(days=1), today - timedelta(days=1))
    assert yesterday["qualifying_days"]["qualified"] == 1
    assert yesterday["next_day_return"] == {"qualified_days": 0, "returned": 0, "share": None}
    # The day before it is matured, and the install did play yesterday.
    both = await _collect(today - timedelta(days=2), today - timedelta(days=1))
    assert both["next_day_return"] == {"qualified_days": 1, "returned": 1, "share": 1.0}


async def test_an_unreadable_bonus_skips_only_the_bonus_metric() -> None:
    sid = _new_install()
    await _pin(sid, D1, bonus="not json")
    await _play(sid, "twenty48", _at(D1), final_score=600)
    await _play(sid, "sort", _at(D1), final_score=12)
    report = await _collect(D1, D1)
    assert report["skipped_bonus"] == 1 and report["skipped_rows"] == 0
    assert report["bonus_discovery"] == {"available": False}
    assert report["install_days"] == 1
    assert report["core_total"]["met"] == 2  # core goals still scored
    assert report["qualifying_days"]["qualified"] == 1


async def test_several_chunks_cost_three_selects_each_plus_the_empty_page(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(metrics, "CHUNK_INSTALLS", 2)
    for _ in range(5):
        await _pin(_new_install(), D1)
    seen: list[str] = []

    def record(_conn, _cursor, statement, *_rest) -> None:
        seen.append(statement.lstrip().upper())

    async with get_session_factory()() as db:
        sync_engine = db.sync_session.get_bind()
        event.listen(sync_engine, "before_cursor_execute", record)
        try:
            report = await metrics.collect(db, D1, D1, 0, _NOW)
        finally:
            event.remove(sync_engine, "before_cursor_execute", record)
    assert report["install_days"] == 5
    assert len(seen) == 3 * 3 + 1  # 5 installs at chunk size 2 = 3 chunks
    assert all(stmt.startswith("SELECT") for stmt in seen)
