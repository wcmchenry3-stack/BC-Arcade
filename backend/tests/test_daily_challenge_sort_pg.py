"""Bottle Sort "new levels" baselines on real Postgres (#4028, review round 2 on #4038).

The three statements that group by Sort edition (``editions.edition_column``) run here
against Postgres: ``service.day_start_bests``, ``history.load_install_history`` (query 3,
which runs on every personal pick) and the metrics script's ``_before_window``. On SQLite
a grouped expression with bound parameters passes; on Postgres each copy of it binds its
own parameters, so ``GROUP BY`` on the expression raised ``GroupingError`` (the CASE in the
SELECT list was not the one grouped). CI's test-postgres job runs this file against a
migrated Postgres (``DATABASE_URL``); elsewhere it is skipped.
"""

from __future__ import annotations

import importlib.util
import os
import pathlib
import sys
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import delete, select

from daily_challenge import service
from daily_challenge.assignments import encode_goals
from daily_challenge.definitions import CATALOG_EDITION, FREE_GOAL_POOL, LEGACY_EDITION
from daily_challenge.game_specs import GAME_SPECS, build_goal
from daily_challenge.history import load_install_history
from db.base import get_session_factory
from db.models import DailyChallengeAssignment, Game, GameType

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL", "").startswith("postgres"),
    reason="DATABASE_URL is not Postgres — the Sort edition grouping is checked on Postgres only",
)

_SCRIPT = pathlib.Path(__file__).parent.parent / "scripts" / "daily_challenge_metrics.py"
_spec = importlib.util.spec_from_file_location("daily_challenge_metrics_pg", _SCRIPT)
metrics = importlib.util.module_from_spec(_spec)
sys.modules["daily_challenge_metrics_pg"] = metrics
_spec.loader.exec_module(metrics)

_DAY = date(2026, 11, 21)
_START = datetime(2026, 11, 21, tzinfo=UTC)
_CAT = {"catalog_version": 1}


@pytest.fixture
async def sid() -> AsyncIterator[str]:
    session_id = str(uuid.uuid4())
    yield session_id
    async with get_session_factory()() as db:
        await db.execute(delete(Game).where(Game.session_id == session_id))
        await db.execute(
            delete(DailyChallengeAssignment).where(
                DailyChallengeAssignment.session_id == uuid.UUID(session_id)
            )
        )
        await db.commit()


async def _add(sid: str, game: str, when: datetime, score: int, metadata: dict) -> None:
    async with get_session_factory()() as db:
        type_id = (await db.execute(select(GameType.id).where(GameType.name == game))).scalar_one()
        db.add(
            Game(
                session_id=sid,
                game_type_id=type_id,
                started_at=when - timedelta(minutes=5),
                completed_at=when,
                created_at=when,
                outcome="completed",
                final_score=score,
                game_metadata=metadata,
                players=[],
            )
        )
        await db.commit()


async def _seed(sid: str) -> None:
    """A migrated install: random levels up to 18, then catalog levels 3, 5, 7."""
    await _add(sid, "sort", _START - timedelta(days=20), 18, {"won": True})
    for back, level in ((3, 3), (2, 5), (1, 7)):
        await _add(sid, "sort", _START - timedelta(days=back), level, {"won": True, **_CAT})
    await _add(sid, "twenty48", _START - timedelta(days=1), 900, {"highest_tile": 128})


async def test_day_start_bests_groups_by_edition_on_postgres(sid: str) -> None:
    await _seed(sid)
    async with get_session_factory()() as db:
        bests = await service.day_start_bests(db, sid, {"sort"}, _START)
    assert bests == {("sort", LEGACY_EDITION): 18, ("sort", CATALOG_EDITION): 7}


async def test_the_history_query_groups_by_edition_on_postgres(sid: str) -> None:
    await _seed(sid)
    goal = build_goal(GAME_SPECS["sort"].type("levels"), 2)
    core = (FREE_GOAL_POOL["daily_word"][0], goal, FREE_GOAL_POOL["twenty48"][0])
    async with get_session_factory()() as db:
        # A pinned Sort goal two days back makes that day a probe day too.
        db.add(
            DailyChallengeAssignment(
                session_id=uuid.UUID(sid),
                local_date=_DAY - timedelta(days=2),
                goals=encode_goals(core),
            )
        )
        await db.commit()
    async with get_session_factory()() as db:
        h = await load_install_history(
            db, sid, _DAY, through=_DAY + timedelta(days=2), now=_START + timedelta(hours=6)
        )
    assert h.sort_edition == CATALOG_EDITION
    assert h.best_final_score("sort", _DAY) == 7
    assert h.edition_bests[_DAY][("sort", LEGACY_EDITION)] == 18
    assert h.daily_counts["sort"][_DAY - timedelta(days=1)] == 1
    assert h.best_final_score("twenty48", _DAY) == 900


async def test_the_metrics_baseline_groups_by_edition_on_postgres(sid: str) -> None:
    await _seed(sid)
    goal = build_goal(GAME_SPECS["sort"].type("levels"), 1)
    pinned = {sid: {_DAY: (encode_goals((goal,)), None)}}
    async with get_session_factory()() as db:
        before = await metrics._before_window(db, pinned, _START)
    assert before == {sid: {("sort", LEGACY_EDITION): 18, ("sort", CATALOG_EDITION): 7}}
