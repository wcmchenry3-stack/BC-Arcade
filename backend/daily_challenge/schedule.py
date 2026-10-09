"""Freezes each day's daily-challenge assignment the first time it's requested (#2493).

``definitions.py`` is the *scheduling policy*: a pure function of (day, slate, salt,
pool) proposing what a day's challenge would be — correct only for a day nobody has
been shown yet. The first time a (date, slate) pair is requested here, the result is
written to ``daily_challenge_days`` and returned as-is; every later request for that
same pair reads the row back instead of recomputing. So retuning the goal pool, a
goal's target, or ``DAILY_CHALLENGE_SALT`` afterward can only ever affect days not yet
frozen — never a day a player has already seen or a streak has already been scored
against.

Each goal is stored as a self-contained spec (``goal_to_spec``/``goal_from_spec`` in
``definitions.py``), not a lookup key into a pool dict, so a day's history survives a
goal being retuned or removed from the live pool later.

This module does not import ``template_for`` itself — callers (``service.py``,
``router.py``, ``streak.py``) each pass their own (patchable) reference in as
``compute``. The freeze is generic over *how* a template is produced.

Known limitation: reconstructing a goal calls the same builder the live pools use
(``goal_from_spec``), which only knows the five ``kind`` shapes those builders
produce. A goal frozen from a shape outside that set cannot be read back — none of
the real pools nor this project's tests produce one.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from daily_challenge.definitions import Slate, Template, goal_from_spec, goal_to_spec
from db.dialect import dialect_insert
from db.models import DailyChallengeDay


def _row_to_template(row: DailyChallengeDay) -> Template:
    return Template(id=row.template_id, goals=tuple(goal_from_spec(g) for g in row.goals))


async def get_or_create_template(
    session: AsyncSession, day: date, slate: Slate, compute: Callable[[], Template]
) -> Template:
    """The frozen template for one (day, slate), computing it via ``compute`` on the
    first request only. A thin wrapper over the batch form below."""
    templates = await get_or_create_templates(session, [day], slate, lambda _d: compute())
    return templates[day]


async def get_or_create_templates(
    session: AsyncSession,
    days: Iterable[date],
    slate: Slate,
    compute: Callable[[date], Template],
) -> dict[date, Template]:
    """The frozen templates for every day in ``days`` under ``slate`` — one SELECT,
    plus one INSERT only for the days nobody has ever requested before (usually none,
    or just today), and one more SELECT only when a concurrent request froze some of
    those days first. Used directly by the streak, which needs up to 60 days at once —
    the query count stays fixed however long the lookback."""
    days = list(dict.fromkeys(days))
    rows = (
        await session.execute(
            select(DailyChallengeDay).where(
                DailyChallengeDay.date.in_(days), DailyChallengeDay.slate == slate
            )
        )
    ).scalars()
    result = {row.date: _row_to_template(row) for row in rows}
    missing = [d for d in days if d not in result]
    if not missing:
        return result

    fresh = {d: compute(d) for d in missing}
    # INSERT ... ON CONFLICT DO NOTHING (#3013): a day a concurrent request froze
    # first is skipped rather than failing the statement, so there is no
    # IntegrityError, no rollback (which would also discard any pending work the
    # caller has in this session) and no retry. RETURNING names the days this
    # statement froze; every other missing day was frozen by the rival and is read
    # back from the table, whose row wins over our own computation. Rows go in date
    # order so two overlapping batches take their row locks in the same order and
    # cannot deadlock each other on Postgres.
    stmt = (
        dialect_insert(session, DailyChallengeDay)
        .values(
            [
                {
                    "date": d,
                    "slate": slate,
                    "template_id": fresh[d].id,
                    "goals": [goal_to_spec(g) for g in fresh[d].goals],
                }
                for d in sorted(fresh)
            ]
        )
        .on_conflict_do_nothing(index_elements=[DailyChallengeDay.date, DailyChallengeDay.slate])
        .returning(DailyChallengeDay.date)
    )
    inserted = set((await session.execute(stmt)).scalars())
    lost = [d for d in missing if d not in inserted]
    if lost:
        # Postgres' ON CONFLICT waits for the conflicting transaction to end, and
        # under READ COMMITTED this next statement then sees the row it committed.
        rows = (
            await session.execute(
                select(DailyChallengeDay).where(
                    DailyChallengeDay.date.in_(lost), DailyChallengeDay.slate == slate
                )
            )
        ).scalars()
        result.update((row.date, _row_to_template(row)) for row in rows)
        unpersisted = [d for d in lost if d not in result]
        if unpersisted:
            # Never answer with a template that is not in the table: the next request
            # would recompute it, and could show a different challenge for that day.
            # Unreachable under READ COMMITTED (the default here): ON CONFLICT skips a
            # day only once the conflicting rival has committed its row, and the
            # re-read above takes a fresh snapshot that sees it. Kept as a guard in
            # case the isolation level ever changes.
            raise RuntimeError(
                f"daily challenge days {unpersisted} ({slate}) were neither frozen nor found"
            )
    await session.commit()
    result.update((d, fresh[d]) for d in inserted)
    return result
