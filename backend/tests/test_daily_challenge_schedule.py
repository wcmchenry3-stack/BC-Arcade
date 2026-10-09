"""Daily-challenge persistence (#2493): a day is frozen on first request and
never recomputed after, however the pool or DAILY_CHALLENGE_SALT changes."""

from __future__ import annotations

import os
from datetime import date
from typing import Any

import pytest
from sqlalchemy import false, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.sql.dml import Insert

from daily_challenge import schedule
from daily_challenge.definitions import (
    Slate,
    Template,
    _at_least,
    _won,
    goal_from_spec,
    goal_to_spec,
)
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

    assert await _frozen("free") == {_DAY: "v1"}


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


def _insert_after_rival_freezes(
    monkeypatch: pytest.MonkeyPatch,
    db: AsyncSession,
    factory: async_sessionmaker[AsyncSession],
    rival_days: dict[date, Template],
    slate: Slate,
) -> None:
    """Make ``db``'s next INSERT land after a concurrent request froze ``rival_days``.

    That is the race window: ``db`` has already read the table and found the days
    missing, and the rival commits through its own session before ``db`` writes, so
    ``db``'s INSERT then meets the real committed rows, exactly as when two requests
    race.
    """
    real_execute = db.execute
    rival_landed = False

    async def execute(statement: Any, *args: Any, **kwargs: Any) -> Any:
        nonlocal rival_landed
        if isinstance(statement, Insert) and not rival_landed:
            rival_landed = True
            async with factory() as rival:
                await schedule.get_or_create_templates(
                    rival, list(rival_days), slate, rival_days.__getitem__
                )
        return await real_execute(statement, *args, **kwargs)

    monkeypatch.setattr(db, "execute", execute)


async def _frozen(slate: Slate) -> dict[date, str]:
    async with get_session_factory()() as db:
        rows = (
            await db.execute(select(DailyChallengeDay).where(DailyChallengeDay.slate == slate))
        ).scalars()
        return {r.date: r.template_id for r in rows}


@needs_db
async def test_losing_the_freeze_race_trusts_the_committed_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A concurrent request froze the day between our SELECT and our INSERT: its
    answer wins and ours is dropped, so every caller sees one template per day."""
    factory = get_session_factory()
    async with factory() as db:
        _insert_after_rival_freezes(monkeypatch, db, factory, {_DAY: _V1}, "free")
        result = await schedule.get_or_create_template(db, _DAY, "free", lambda: _V2)

    assert result == _V1
    assert await _frozen("free") == {_DAY: "v1"}


async def _two_day_batch_after_rival_froze_one_day(
    monkeypatch: pytest.MonkeyPatch,
) -> dict[date, Template]:
    factory = get_session_factory()
    async with factory() as db:
        _insert_after_rival_freezes(monkeypatch, db, factory, {_DAY: _V1}, "free")
        return await schedule.get_or_create_templates(
            db, [_DAY, _OTHER_DAY], "free", lambda _d: _V2
        )


@needs_db
async def test_losing_the_race_on_one_day_still_answers_every_day(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The rival froze one day of a two-day batch: that day answers with the rival's
    template, the other with our own computation."""
    result = await _two_day_batch_after_rival_froze_one_day(monkeypatch)
    assert result == {_DAY: _V1, _OTHER_DAY: _V2}


@needs_db
async def test_losing_the_race_on_one_day_still_freezes_the_other_days(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A day is frozen the first time it is shown (#3013). The day the rival did not
    freeze is written by the loser too, so it is never recomputed later."""
    result = await _two_day_batch_after_rival_froze_one_day(monkeypatch)
    frozen = await _frozen("free")
    assert frozen == {_DAY: "v1", _OTHER_DAY: "v2"}
    assert {d: t.id for d, t in result.items()} == frozen  # the answer is what is stored


@needs_db
async def test_losing_the_race_on_every_day_returns_only_the_rivals_templates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The rival froze the whole batch first: every day answers with its row, and
    nothing of our own computation is written or returned."""
    factory = get_session_factory()
    async with factory() as db:
        _insert_after_rival_freezes(monkeypatch, db, factory, {_DAY: _V1, _OTHER_DAY: _V1}, "free")
        result = await schedule.get_or_create_templates(
            db, [_DAY, _OTHER_DAY], "free", lambda _d: _V2
        )

    assert result == {_DAY: _V1, _OTHER_DAY: _V1}
    assert await _frozen("free") == {_DAY: "v1", _OTHER_DAY: "v1"}


@needs_db
async def test_losing_the_race_keeps_the_callers_pending_work(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Losing the race no longer rolls the session back (#3013), so a write the caller
    still has pending in the same session survives and is committed with the freeze."""
    factory = get_session_factory()
    async with factory() as db:
        # no_autoflush keeps the pending row out of the database until commit, so it
        # does not hold SQLite's write lock while the rival freezes its day.
        with db.no_autoflush:
            db.add(
                DailyChallengeDay(
                    date=_OTHER_DAY,
                    slate="premium",
                    template_id=_V2.id,
                    goals=[goal_to_spec(g) for g in _V2.goals],
                )
            )
            _insert_after_rival_freezes(monkeypatch, db, factory, {_DAY: _V1}, "free")
            result = await schedule.get_or_create_template(db, _DAY, "free", lambda: _V2)

    assert result == _V1
    assert await _frozen("free") == {_DAY: "v1"}
    assert await _frozen("premium") == {_OTHER_DAY: "v2"}


@needs_db
async def test_a_day_neither_frozen_nor_found_raises_instead_of_answering(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Defensive: if a day the INSERT skipped is not in the table either, the call fails
    rather than returning a template nobody stored (the next request would recompute it)."""
    factory = get_session_factory()
    async with factory() as db:
        real_execute = db.execute

        async def execute(statement: Any, *args: Any, **kwargs: Any) -> Any:
            if isinstance(statement, Insert):  # an INSERT that froze nothing
                statement = select(DailyChallengeDay.date).where(false())
            return await real_execute(statement, *args, **kwargs)

        monkeypatch.setattr(db, "execute", execute)
        with pytest.raises(RuntimeError, match="neither frozen nor found"):
            await schedule.get_or_create_template(db, _DAY, "free", lambda: _V2)

    assert await _frozen("free") == {}
