"""Daily-challenge persistence (#2493): a day is frozen on first request and
never recomputed after, however the pool or DAILY_CHALLENGE_SALT changes."""

from __future__ import annotations

import os
from datetime import date

import pytest
from sqlalchemy import select

from daily_challenge import schedule
from daily_challenge.definitions import Template, _at_least, _won, goal_from_spec, goal_to_spec
from db.base import get_session_factory
from db.models import DailyChallengeDay

needs_db = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping daily-challenge schedule tests",
)

_DAY = date(2026, 11, 1)
_OTHER_DAY = date(2026, 11, 2)
_V1 = Template("v1", (_won("mahjong", "medium"),))
_V2 = Template("v2", (_won("solitaire", "medium"),))


@needs_db
async def test_first_request_freezes_the_day() -> None:
    factory = get_session_factory()
    async with factory() as db:
        result = await schedule.get_or_create_template(db, _DAY, "free", lambda: _V1)
    assert result == _V1

    async with factory() as db:
        row = (
            await db.execute(
                select(DailyChallengeDay).where(
                    DailyChallengeDay.date == _DAY, DailyChallengeDay.slate == "free"
                )
            )
        ).scalar_one()
    assert row.template_id == "v1"


@needs_db
async def test_a_later_policy_change_does_not_affect_a_frozen_day() -> None:
    """The whole point of #2493: once a day is shown, changing what the
    scheduler would now pick (a stand-in for retuning the pool or the salt)
    must not change what that day already was."""
    factory = get_session_factory()
    async with factory() as db:
        first = await schedule.get_or_create_template(db, _DAY, "free", lambda: _V1)
    async with factory() as db:
        second = await schedule.get_or_create_template(db, _DAY, "free", lambda: _V2)
    assert first == _V1
    assert second == _V1  # not _V2 — the "policy change" never took effect


@needs_db
async def test_an_unfrozen_day_does_pick_up_a_policy_change() -> None:
    """Only days nobody has requested yet are free to move."""
    factory = get_session_factory()
    async with factory() as db:
        await schedule.get_or_create_template(db, _DAY, "free", lambda: _V1)
        never_requested = await schedule.get_or_create_template(db, _OTHER_DAY, "free", lambda: _V2)
    assert never_requested == _V2


@needs_db
async def test_slates_freeze_independently() -> None:
    factory = get_session_factory()
    async with factory() as db:
        free = await schedule.get_or_create_template(db, _DAY, "free", lambda: _V1)
        premium = await schedule.get_or_create_template(db, _DAY, "premium", lambda: _V2)
    assert free == _V1
    assert premium == _V2


@needs_db
async def test_batch_freezes_only_the_missing_days() -> None:
    factory = get_session_factory()
    third_day = date(2026, 11, 3)
    async with factory() as db:
        await schedule.get_or_create_template(db, _DAY, "free", lambda: _V1)

        calls: list[date] = []

        def compute(d: date) -> Template:
            calls.append(d)
            return _V2

        result = await schedule.get_or_create_templates(
            db, [_DAY, _OTHER_DAY, third_day], "free", compute
        )
    assert result[_DAY] == _V1  # already frozen — compute() never ran for it
    assert result[_OTHER_DAY] == _V2
    assert result[third_day] == _V2
    assert calls == [_OTHER_DAY, third_day]


@needs_db
async def test_reconstructed_goal_equals_the_original_even_outside_any_pool() -> None:
    """Goals round-trip through spec/from_spec by rebuilding via the same
    builder, not a pool lookup — so a day survives its goal leaving the pool,
    and a synthetic goal that was never in a pool (as some tests use) works too."""
    synthetic = _at_least("yacht", "score", 1, "easy")
    rebuilt = goal_from_spec(goal_to_spec(synthetic))
    assert rebuilt == synthetic

    factory = get_session_factory()
    template = Template("synthetic", (synthetic,))
    async with factory() as db:
        frozen_first = await schedule.get_or_create_template(db, _DAY, "premium", lambda: template)
    async with factory() as db:
        frozen_again = await schedule.get_or_create_template(db, _DAY, "premium", lambda: template)
    assert frozen_first == template
    assert frozen_again == template  # cache-hit path reconstructs correctly too
