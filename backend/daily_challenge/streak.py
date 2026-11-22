"""App-wide streak — consecutive days with at least 2 of 3 daily goals met (#2456).

The challenge for any past day is *replayed*: for each day walked back, take the
install's pinned assignment for that day (``daily_challenge_assignments``, #3992) when
it has one, else that day's shared frozen template
(``schedule.get_or_create_templates``, #2493: days before pinning existed, days pruned
by retention, or every day while ``DAILY_CHALLENGE_PERSONALIZED`` is off), and evaluate
its core goals (never the bonus)
against the session's own ``games`` rows in that day's local window — the same
``local_day_of`` / ``evaluate_goal`` the live challenge uses, so there is no second
definition of a day or of a goal. A day nobody has ever requested before (rare — only
possible for a day with no games at all, since scoring it is the only way to reach it)
is frozen on this same call, from the current pool/salt; once frozen, it never changes.

Rule (owner decision, 2026-09-20): count consecutive qualifying days ending **today**
if today already has 2 of 3 goals met; otherwise ending **yesterday** — today is not
failed, just not finished yet. It stops at the first day with fewer than 2.

Cost: the lookback is capped at ``STREAK_LOOKBACK_DAYS`` and the player's games are read with
ONE windowed query, grouped by local day in Python, rather than a query per day. Each
install's pinned assignments for the window come from one more (none while the kill
switch is off), and each slate's frozen templates from one more each (schedule.py's
batch form) — a second only when some day's free and premium templates differ, which
until #2458 they never do — plus the session's entitlements (one more) in that same
case. A pinned day with a relative goal (Bottle Sort "solve N new levels", #4028) is
scored against the install's best Sort level before that day started: one aggregate for
the best before the window (only when some pinned day holds such a goal), then a running
max over the window's own rows (``_day_starts``). The query count is fixed regardless of
``STREAK_LOOKBACK_DAYS``, not one per day. The
streak never exceeds ``STREAK_LOOKBACK_DAYS``: a value equal to it means "at least that many",
so a client renders it as "60+" (a true 60 and a true 200 look the same — that is the
cap, not a bug).

Accepted approximations (documented, not silent):
- **Current entitlements are used for every unpinned past day**, not the ones the
  session had then. A pinned day (#3992) keeps the slate it was served with. Invisible
  while the two pools are identical; once #2458 gives the premium pool games of its own,
  buying (or losing) a premium game re-scores the unpinned days of the window under the
  other slate (days before #3992, pruned days, days an install could not pin).
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
from collections.abc import Mapping
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from daily_challenge import assignments, personal, schedule
from daily_challenge.definitions import (
    DAY_START_MEASURES,
    GOAL_POOLS,
    DayStart,
    Template,
    game_facts,
    local_day,
    local_day_of,
    relative_games,
    template_for,
)
from daily_challenge.service import (
    EndedGame,
    day_start_bests,
    evaluate_template,
    slate_for_games,
)
from db.models import Game, GameEntitlement, GameType
from entitlements.service import is_dev_override_active
from games.filters import not_abandoned, not_dev_affected
from settings import Settings

# A day counts if at least this many of its goals are met.
GOALS_TO_QUALIFY = 2
# How far back to look, and so the largest streak reported. One windowed query
# bounds the cost; longer streaks are shown as this value ("60+").
# (``STREAK_LOOKBACK_DAYS`` in settings.py, default 60, read lazily.)
_settings: Settings | None = None


def lookback_days() -> int:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings.streak_lookback_days


def _local_date(completed_at: datetime, tz_offset_minutes: int) -> date:
    """The local calendar day a completion falls on. Naive timestamps (SQLite) are UTC."""
    if completed_at.tzinfo is None:
        completed_at = completed_at.replace(tzinfo=UTC)
    return (completed_at + timedelta(minutes=tz_offset_minutes)).date()


async def compute_streak(
    session: AsyncSession,
    session_id: str,
    tz_offset_minutes: int,
    utc_now: datetime | None = None,
) -> int:
    """Consecutive qualifying days for ``session_id``, at most ``STREAK_LOOKBACK_DAYS``."""
    lookback = lookback_days()
    today = local_day(tz_offset_minutes, utc_now)
    oldest = local_day_of(today.date - timedelta(days=lookback), tz_offset_minutes)
    # Every game a pinned day may name: the pools' games, and the premium games'
    # personal goals (#3996) that no pool lists.
    spec_games = {game for pool in GOAL_POOLS.values() for game in pool} | set(personal.GAME_SPECS)

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
                # Same rule as service.py — an abandoned game never earns a
                # streak day (#2468 / #2472).
                not_abandoned(),
                # A run a dev-panel action touched never counts (#3510, #3996).
                not_dev_affected(),
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
    days = [today.date - timedelta(days=n) for n in range(lookback + 1)]  # today first
    slates_differ = any(template_for(d, "premium") != template_for(d, "free") for d in days)

    # Frozen templates (#2493) for the whole window — one SELECT (+ an INSERT only for
    # days nobody has ever requested before) per slate actually needed, however long
    # the lookback is.
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
    # The install's pinned days (#3992) in the window — one query, whatever the
    # lookback. A pinned day is scored on exactly the goals that install was served.
    pinned = await assignments.read_assignments(session, session_id, days[-1], days[0])
    day_starts = await _day_starts(session, session_id, pinned, by_day, days, oldest.start_utc)

    def qualifies(day: date) -> bool:
        free = free_templates[day]
        premium = premium_templates[day]
        if day in pinned:
            # Core goals only: the bonus (#3995) never counts toward the streak.
            template: Template = pinned[day].template
        elif premium == free:
            template = free  # the slate is moot
        else:
            named = {goal.game_type for goal in premium.goals} & premium_all
            slate = slate_for_games(named, named & owned, override)
            template = premium if slate == "premium" else free
        statuses = evaluate_template(template, by_day.get(day, []), day_starts.get(day))
        return sum(1 for status in statuses if status.completed) >= GOALS_TO_QUALIFY

    # Newest first. Today is optional: if it has not qualified yet it is not a break —
    # the run simply ends yesterday — but any earlier day that fails ends it.
    streak = 0
    for i, day in enumerate(days):
        if qualifies(day):
            streak += 1
        elif i > 0:
            break
    return min(streak, lookback)


async def _day_starts(
    session: AsyncSession,
    session_id: str,
    pinned: Mapping[date, assignments.Assignment],
    by_day: Mapping[date, list[EndedGame]],
    days: list[date],
    window_start: datetime,
) -> dict[date, DayStart]:
    """The day-start best for each pinned day that holds a relative goal (Sort "new
    levels", #4028). The best before the window is one aggregate (none when no pinned day
    holds such a goal; shared templates never do); each later day's is a running max over
    the window's own rows, already read. No query per day."""
    games = relative_games(g for a in pinned.values() for g in a.template.goals)
    if not games:
        return {}
    running = dict(await day_start_bests(session, session_id, games, window_start))
    out: dict[date, DayStart] = {}
    for day in reversed(days):  # oldest first
        out[day] = dict(running)
        for name, facts in by_day.get(day, []):
            value = facts.get(DAY_START_MEASURES.get(name, ""))
            if name in running and isinstance(value, int) and not isinstance(value, bool):
                running[name] = max(running[name], value)
    return out


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
