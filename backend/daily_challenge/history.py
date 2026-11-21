"""One install's play history for the daily-challenge pick (#3993/#3994).

``load_install_history`` reads everything ``personal.choose_core`` needs in **three
queries, whatever the number of games**, once per request (``/upcoming`` loads once
for its three days):

1. **Pinned assignments** (``daily_challenge_assignments``) from ``PINNED_LOOKBACK_DAYS``
   (60) before the first day through the last: the variety guard (yesterday's games,
   no (game, type) repeat in 3 days), the step-down rule (the last two days that held
   each personal goal) and the discovery rest rule (bonus offers, 30 days back plus
   their 30-day rest). Read first, because the days it names are probed in query 2.
2. **Recent games**: per game type, the install's latest
   ``2 × DAILY_CHALLENGE_HISTORY_GAMES`` finished games before the start of the last
   day (a ``ROW_NUMBER`` window), plus every finished game on the *probe days* query 1
   names (the step-down days and bonus days), so a miss or an ignored bonus is judged
   on that day's full play. Twice the history size, so a day's own games never push
   the 10 before it out (each day's targets read only games before its start).
3. **Per-day counts and bests**: one grouped row per game type, with the finished
   games of each local day of the affinity window (``CASE`` sums, any dialect) and the
   best ``final_score`` ever before each served day (Sort's highest level solved, and
   the cap for score goals).

Every query filters ``not_abandoned()`` and ``not_dev_affected()`` (a run a dev-panel
action touched never counts, #3510), and only reads the games with goal specs.
Nothing is written. Local days use the client's UTC offset, as the streak does.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from daily_challenge import assignments, personal
from daily_challenge.assignments import Assignment
from daily_challenge.definitions import Facts, Goal, game_facts, local_day_of
from db.models import Game, GameType
from games.filters import not_abandoned, not_dev_affected

# Pinned rows read back: the rest rule's 30 days of offers plus their 30-day rest.
PINNED_LOOKBACK_DAYS = personal.REST_DAYS * 2


@dataclass(frozen=True)
class PastGame:
    game_type: str
    facts: Facts
    completed_at: datetime
    local_date: date
    # Among the latest games of its type (query 2's window); probe rows are not.
    recent: bool


@dataclass
class InstallHistory:
    """What ``personal`` reads. Valid for the days ``first_day``..``last_day``."""

    tz_offset_minutes: int
    first_day: date
    last_day: date
    affinity_window: int
    # Newest first, per game type: the recent rows plus the probe-day rows.
    games: dict[str, list[PastGame]] = field(default_factory=dict)
    # Finished games per (game type, local day), over the affinity window.
    daily_counts: dict[str, dict[date, int]] = field(default_factory=dict)
    # Best final_score ever before each served day, per game type.
    best_scores: dict[date, dict[str, int]] = field(default_factory=dict)
    # Pinned assignments by local date; the pick adds the days it picks.
    pinned: dict[date, Assignment] = field(default_factory=dict)

    def _start(self, day: date) -> datetime:
        return local_day_of(day, self.tz_offset_minutes).start_utc

    def recent_facts(self, game: str, day: date, limit: int) -> list[Facts]:
        """The latest ``limit`` finished games of ``game`` before ``day`` starts."""
        start = self._start(day)
        rows = [g for g in self.games.get(game, []) if g.recent and g.completed_at < start]
        return [g.facts for g in rows[:limit]]

    def finished_before(self, day: date) -> int:
        """Finished games of any spec game before ``day`` (exact up to the window)."""
        start = self._start(day)
        return sum(
            1 for rows in self.games.values() for g in rows if g.recent and g.completed_at < start
        )

    def affinity(self, day: date) -> dict[str, int]:
        """Per game: finished games on each of the ``affinity_window`` days before
        ``day``, weighted ``window`` for yesterday down to 1 for the oldest day."""
        out: dict[str, int] = {}
        for game, counts in self.daily_counts.items():
            score = 0
            for back in range(1, self.affinity_window + 1):
                score += counts.get(day - timedelta(days=back), 0) * (
                    self.affinity_window + 1 - back
                )
            if score:
                out[game] = score
        return out

    def played_on(self, game: str, day: date) -> bool:
        if self.daily_counts.get(game, {}).get(day):
            return True
        return any(g.local_date == day for g in self.games.get(game, []))

    def met_on(self, goal: Goal, day: date) -> bool:
        """Whether a finished game of ``day`` met ``goal`` (exact on probe days)."""
        return any(
            g.local_date == day and goal.evaluate(g.facts)
            for g in self.games.get(goal.game_type, [])
        )

    def best_final_score(self, game: str, day: date) -> int:
        return self.best_scores.get(day, {}).get(game, 0)

    def sort_new_levels_per_day(self, day: date) -> list[int]:
        """New Sort levels solved per local day of play, over the recent games
        before ``day`` (the first day seen has no baseline and is skipped)."""
        start = self._start(day)
        rows = [g for g in self.games.get("sort", []) if g.recent and g.completed_at < start]
        rows = rows[: personal.history_games()]
        per_day: dict[date, int] = {}
        for g in rows:
            score = g.facts.get("final_score")
            if isinstance(score, int) and not isinstance(score, bool):
                per_day[g.local_date] = max(per_day.get(g.local_date, 0), score)
        out: list[int] = []
        running: int | None = None
        for d in sorted(per_day):
            if running is not None:
                out.append(max(0, per_day[d] - running))
            running = per_day[d] if running is None else max(running, per_day[d])
        return out


def _aware(value: datetime) -> datetime:
    """SQLite returns naive timestamps; they are UTC."""
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _local_date(completed_at: datetime, tz_offset_minutes: int) -> date:
    return (completed_at + timedelta(minutes=tz_offset_minutes)).date()


def _probe_days(pinned: Mapping[date, Assignment], first_day: date) -> dict[str, set[date]]:
    """The finished days query 2 must read in full: the last two days each personal
    goal type was pinned (step-down), and every bonus offer (rest rule)."""
    probes: dict[str, set[date]] = defaultdict(set)
    history = InstallHistory(0, first_day, first_day, 1, pinned=dict(pinned))
    for game, type_name in personal.personal_type_keys():
        for d in personal.last_occurrences(history, game, type_name, first_day):
            probes[game].add(d)
    for d, a in pinned.items():
        if d < first_day and a.bonus is not None and a.bonus.game_type in personal.GAME_SPECS:
            probes[a.bonus.game_type].add(d)
    return probes


async def load_install_history(
    session: AsyncSession,
    session_id: str,
    day: date,
    tz_offset_minutes: int = 0,
    *,
    through: date | None = None,
) -> InstallHistory:
    """The install's history for picking ``day`` .. ``through`` (default ``day``)."""
    through = through or day
    window = personal.affinity_days()
    history = InstallHistory(
        tz_offset_minutes=tz_offset_minutes,
        first_day=day,
        last_day=through,
        affinity_window=window,
    )
    games = sorted(personal.GAME_SPECS)

    # 1. Pinned assignments.
    history.pinned = await assignments.read_assignments(
        session, session_id, day - timedelta(days=PINNED_LOOKBACK_DAYS), through
    )

    # 2. Recent games per type, plus the probe days in full.
    end = local_day_of(through, tz_offset_minutes).start_utc
    cap = 2 * personal.history_games()
    rn = (
        func.row_number()
        .over(
            partition_by=Game.game_type_id,
            order_by=(Game.completed_at.desc(), Game.id.desc()),
        )
        .label("rn")
    )
    inner = (
        select(
            GameType.name.label("name"),
            Game.game_metadata.label("metadata"),
            Game.final_score.label("final_score"),
            Game.duration_ms.label("duration_ms"),
            Game.completed_at.label("completed_at"),
            rn,
        )
        .select_from(Game)
        .join(GameType, Game.game_type_id == GameType.id)
        .where(
            Game.session_id == session_id,
            GameType.name.in_(games),
            Game.completed_at.is_not(None),
            Game.completed_at < end,
            not_abandoned(),
            not_dev_affected(),
        )
        .subquery()
    )
    probe_terms = []
    for game, days in sorted(_probe_days(history.pinned, day).items()):
        windows = [local_day_of(d, tz_offset_minutes) for d in sorted(days)]
        probe_terms.append(
            and_(
                inner.c.name == game,
                or_(
                    *(
                        and_(inner.c.completed_at >= w.start_utc, inner.c.completed_at < w.end_utc)
                        for w in windows
                    )
                ),
            )
        )
    rows = (
        await session.execute(
            select(inner)
            .where(or_(inner.c.rn <= cap, *probe_terms))
            .order_by(inner.c.name, inner.c.completed_at.desc())
        )
    ).all()
    by_game: dict[str, list[PastGame]] = defaultdict(list)
    for name, metadata, final_score, duration_ms, completed_at, row_number in rows:
        completed = _aware(completed_at)
        by_game[name].append(
            PastGame(
                game_type=name,
                facts=game_facts(metadata, final_score, duration_ms),
                completed_at=completed,
                local_date=_local_date(completed, tz_offset_minutes),
                recent=row_number <= cap,
            )
        )
    history.games = dict(by_game)

    # 3. Finished games per local day (affinity) and best final_score before each day.
    count_days = [
        through - timedelta(days=back) for back in range(1, window + (through - day).days + 1)
    ]
    count_windows = [local_day_of(d, tz_offset_minutes) for d in count_days]
    served = [day + timedelta(days=i) for i in range((through - day).days + 1)]
    columns = [
        func.sum(
            case(
                (and_(Game.completed_at >= w.start_utc, Game.completed_at < w.end_utc), 1),
                else_=0,
            )
        )
        for w in count_windows
    ] + [
        func.max(
            case(
                (
                    Game.completed_at < local_day_of(d, tz_offset_minutes).start_utc,
                    Game.final_score,
                ),
                else_=None,
            )
        )
        for d in served
    ]
    agg = (
        await session.execute(
            select(GameType.name, *columns)
            .select_from(Game)
            .join(GameType, Game.game_type_id == GameType.id)
            .where(
                Game.session_id == session_id,
                GameType.name.in_(games),
                Game.completed_at.is_not(None),
                not_abandoned(),
                not_dev_affected(),
            )
            .group_by(GameType.name)
        )
    ).all()
    for name, *values in agg:
        counts = values[: len(count_days)]
        bests = values[len(count_days) :]
        history.daily_counts[name] = {
            d: int(c) for d, c in zip(count_days, counts, strict=True) if c
        }
        for d, best in zip(served, bests, strict=True):
            if best is not None:
                history.best_scores.setdefault(d, {})[name] = int(best)
    return history
