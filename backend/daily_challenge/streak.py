"""App-wide streak — consecutive days with at least 2 of 3 daily goals met (#2456).

The challenge for any past day is *replayed*: for each day walked back, look up that
day's frozen template (``schedule.get_or_create_templates``, #2493) and evaluate it
against the session's own ``games`` rows in that day's local window — the same
``local_day_of`` / ``evaluate_goal`` the live challenge uses, so there is no second
definition of a day or of a goal. A day nobody has ever requested before (rare — only
possible for a day with no games at all, since scoring it is the only way to reach it)
is frozen on this same call, from the current pool/salt; once frozen, it never changes.

Rule (owner decision, 2026-09-20): count consecutive qualifying days ending **today**
if today already has 2 of 3 goals met; otherwise ending **yesterday** — today is not
failed, just not finished yet. It stops at the first day with fewer than 2.

Cost: the lookback is capped at ``LOOKBACK_DAYS`` and the player's games are read with
ONE windowed query, grouped by local day in Python, rather than a query per day. Each
slate's frozen templates for the window come from one more query each (schedule.py's
batch form) — a second only when some day's free and premium templates differ, which
until #2458 they never do — plus the session's entitlements (one more) in that same
case. The query count is fixed regardless of ``LOOKBACK_DAYS``, not one per day. The
streak never exceeds ``LOOKBACK_DAYS``: a value equal to it means "at least that many",
so a client renders it as "60+" (a true 60 and a true 200 look the same — that is the
cap, not a bug).

Accepted approximations (documented, not silent):
- **Current entitlements are used for every past day**, not the ones the session had
  then. Invisible while the two pools are identical; once #2458 gives the premium pool
  games of its own, buying (or losing) a premium game re-scores the whole window under
  the other slate, and can break or extend a streak with goals the player never saw.
- **One UTC offset for the whole window.** The client sends its offset *today*
  (``tz_offset_minutes``, as for every other route here); a daylight-saving change
  inside the 60 days moves a game finished within an hour of local midnight onto the
  neighbouring day. There is no IANA zone on the wire to do better.
- **History is client-reported.** ``completed_at`` is accepted up to a year back and the
  result block is unvalidated for some games, so a session can fabricate a streak. The
  same trust model as ``final_score``; harmless while the streak is a count with no
  reward — revisit before it earns anything (#2469).
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from daily_challenge import schedule
from daily_challenge.definitions import (
    GOAL_POOLS,
    Template,
    game_facts,
    local_day,
    local_day_of,
    template_for,
)
from daily_challenge.service import EndedGame, evaluate_template, slate_for_games
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

    # Which slate each day uses needs the session's entitlements — but only if some day's
    # premium template differs from its free one. Until #2458 none do, so skip the query.
    # This is a structural check on the current *policy*, not on history, so it uses the
    # pure template_for rather than a frozen day — nothing here is being scored yet.
    days = [today.date - timedelta(days=n) for n in range(LOOKBACK_DAYS + 1)]  # today first
    slates_differ = any(template_for(d, "premium") != template_for(d, "free") for d in days)

    # Frozen templates (#2493) for the whole window — one SELECT (+ an INSERT only for
    # days nobody has ever requested before) per slate actually needed, however long
    # LOOKBACK_DAYS is.
    free_templates = await schedule.get_or_create_templates(
        session, days, "free", lambda d: template_for(d, "free")
    )
    if slates_differ:
        premium_templates = await schedule.get_or_create_templates(
            session, days, "premium", lambda d: template_for(d, "premium")
        )
        premium_all, owned = await _premium_and_owned(session, session_id)
    else:
        premium_templates = free_templates
        premium_all, owned = set(), set()
    override = is_dev_override_active()

    def qualifies(day: date) -> bool:
        free = free_templates[day]
        premium = premium_templates[day]
        if premium == free:
            template: Template = free  # the slate is moot
        else:
            named = {goal.game_type for goal in premium.goals} & premium_all
            slate = slate_for_games(named, named & owned, override)
            template = premium if slate == "premium" else free
        met = sum(
            1 for status in evaluate_template(template, by_day.get(day, [])) if status.completed
        )
        return met >= GOALS_TO_QUALIFY

    # Newest first. Today is optional: if it has not qualified yet it is not a break —
    # the run simply ends yesterday — but any earlier day that fails ends it.
    streak = 0
    for i, day in enumerate(days):
        if qualifies(day):
            streak += 1
        elif i > 0:
            break
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
