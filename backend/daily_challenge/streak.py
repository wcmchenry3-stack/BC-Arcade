"""App-wide streak — consecutive days with at least 2 of 3 daily goals met (#2456).

No table. The challenge for any past day is reproducible from its date
(``template_for``), so the streak is *replayed*: for each day walked back, recompute
that day's template and evaluate it against the session's own ``games`` rows in that
day's local window — the same ``local_day_of`` / ``evaluate_goal`` the live challenge
uses, so there is no second definition of a day or of a goal.

Rule (owner decision, 2026-09-20): count consecutive qualifying days ending **today**
if today already has 2 of 3 goals met; otherwise ending **yesterday** — today is not
failed, just not finished yet. It stops at the first day with fewer than 2.

Cost: the lookback is capped at ``LOOKBACK_DAYS`` and read with ONE windowed query
(plus one for the session's entitlements), grouped by local day in Python, rather than
a query per day. The streak therefore never exceeds ``LOOKBACK_DAYS``; a client showing
it should render that value as "60+".

Accepted approximations (documented, not silent):
- **Current entitlements are used for every past day**, not the ones the session had
  then. Premium status does not change during the launch window.
- **Replay means retroactive re-scoring.** History is not stored, so anything that
  changes what a past day's challenge *was* changes the streak: tuning a goal target,
  adding premium goal specs (#2458), or changing ``DAILY_CHALLENGE_SALT`` (which
  reshuffles every day). Treat the salt as permanent once players have streaks, and
  expect a target change to shift streaks — it is not a bug in the replay.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from daily_challenge.definitions import (
    GOAL_POOLS,
    game_facts,
    local_day,
    local_day_of,
    template_for,
)
from daily_challenge.service import EndedGame, evaluate_goal, slate_for_games
from db.models import Game, GameEntitlement, GameType
from entitlements.service import is_dev_override_active

# A day counts if at least this many of its goals are met.
GOALS_TO_QUALIFY = 2
# How far back to look, and so the largest streak reported. One windowed query
# bounds the cost; longer streaks are shown as this value ("60+").
LOOKBACK_DAYS = 60


def _local_date(completed_at: datetime, tz_offset_minutes: int) -> date:
    """The local calendar day a completion falls on. Naive timestamps (SQLite) are UTC."""
    if completed_at.tzinfo is None:
        completed_at = completed_at.replace(tzinfo=timezone.utc)
    return (completed_at + timedelta(minutes=tz_offset_minutes)).date()


async def compute_streak(
    session: AsyncSession,
    session_id: str,
    tz_offset_minutes: int,
    utc_now: datetime | None = None,
) -> int:
    """Consecutive qualifying days for ``session_id``, at most ``LOOKBACK_DAYS``."""
    today = local_day(tz_offset_minutes, utc_now)
    oldest = local_day_of(today.date - timedelta(days=LOOKBACK_DAYS), tz_offset_minutes)
    spec_games = {game for pool in GOAL_POOLS.values() for game in pool}

    # One query for the whole window …
    rows = (
        await session.execute(
            select(
                GameType.name,
                Game.game_metadata,
                Game.final_score,
                Game.duration_ms,
                Game.completed_at,
            )
            .select_from(Game)
            .join(GameType, Game.game_type_id == GameType.id)
            .where(
                Game.session_id == session_id,
                GameType.name.in_(spec_games),
                Game.completed_at >= oldest.start_utc,
                Game.completed_at < today.end_utc,
            )
        )
    ).all()
    by_day: dict[date, list[EndedGame]] = defaultdict(list)
    for name, metadata, final_score, duration_ms, completed_at in rows:
        by_day[_local_date(completed_at, tz_offset_minutes)].append(
            (name, game_facts(metadata, final_score, duration_ms))
        )

    # … and one for the session's entitlements, so the slate rule is pure per day.
    premium_all, owned = await _premium_and_owned(session, session_id)
    override = is_dev_override_active()

    def qualifies(day: date) -> bool:
        free = template_for(day, "free")
        premium = template_for(day, "premium")
        if premium == free:
            template = free  # the slate is moot
        else:
            named = {goal.game_type for goal in premium.goals} & premium_all
            slate = slate_for_games(named, named & owned, override)
            template = premium if slate == "premium" else free
        ended = by_day.get(day, [])
        met = sum(1 for goal in template.goals if evaluate_goal(goal, ended).completed)
        return met >= GOALS_TO_QUALIFY

    streak = 0
    day = today.date
    if qualifies(day):
        streak = 1
    day -= timedelta(days=1)
    for _ in range(LOOKBACK_DAYS):
        if not qualifies(day):
            break
        streak += 1
        day -= timedelta(days=1)
    return min(streak, LOOKBACK_DAYS)


async def _premium_and_owned(session: AsyncSession, session_id: str) -> tuple[set[str], set[str]]:
    """Every premium game, and which of them the session owns — one statement."""
    rows = (
        await session.execute(
            select(GameType.name, GameEntitlement.game_slug)
            .select_from(GameType)
            .outerjoin(
                GameEntitlement,
                (GameEntitlement.game_slug == GameType.name)
                & (GameEntitlement.session_id == session_id),
            )
            .where(GameType.is_premium.is_(True))
        )
    ).all()
    return {name for name, _ in rows}, {name for name, slug in rows if slug is not None}
