"""One install's play history for the daily-challenge pick (#3993/#3994).

``load_install_history`` reads everything ``personal.choose_core`` needs in **at most
four queries, whatever the number of games**, once per request (``/upcoming`` loads
once for its three days):

1. **Pinned assignments** (``daily_challenge_assignments``) from ``PINNED_LOOKBACK_DAYS``
   (60) before the first day through the last: the variety guard (yesterday's games,
   no (game, type) repeat in 3 days), the step-down rule (the last two days that held
   each personal goal) and the discovery rest rule (bonus offers, 30 days back plus
   their 30-day rest). Read first, because the days it names are probed in query 2.
2. **Recent games**: per game type, the install's latest
   ``DAILY_CHALLENGE_HISTORY_GAMES`` finished games before the start of the first
   served day, and the latest as many again within each later served day's own
   window (a ``ROW_NUMBER`` partitioned by game type and served-day bucket), so the
   last N games before *each* served day's start are exact: a day's own games never
   push the history before it out. Plus every finished game on the *probe days* query
   1 names (the step-down days and bonus days), so a miss or an ignored bonus is
   judged on that day's full play.
3. **Per-day counts and bests**: one grouped row per game type, with the finished
   games and the best ``final_score`` of each local day of the affinity window (``CASE``
   aggregates, any dialect), the best before that window (Sort's per-day pace, #4028),
   and the best ``final_score`` ever before each served day and each probe day (the cap
   for score goals, and the day-start best a Sort "new levels" goal is scored against).
4. **Game creation summary**: one aggregate row over the install's ``games`` rows (any
   row, as ``assignments.may_pin`` reads them) created since the earliest instant a
   served day could have been requested, minus ``DAILY_CHALLENGE_PIN_RECENT_PLAY_HOURS``.
   ``LAG()`` over ``created_at`` gives, per served day, the first creation in that
   day's window and the number of gaps longer than the pin window, plus the latest
   creation: whether the install could have been served that day unpinned before
   (``InstallHistory.always_pinnable``). One row however many games, so an install
   creating many games cannot make it read more. Skipped when every served day is a
   new-install day anyway.

Queries 2 and 3 filter ``not_abandoned()`` and ``not_dev_affected()`` (a run a
dev-panel action touched never counts, #3510), and only read the games with goal
specs. Nothing is written. Local days use the client's UTC offset, as the streak does.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from daily_challenge import assignments, personal
from daily_challenge.assignments import MAX_DAYS_AHEAD, Assignment
from daily_challenge.definitions import (
    CATALOG_EDITION,
    DAY_START_MEASURES,
    LEGACY_EDITION,
    Facts,
    Goal,
    counted_editions,
    edition_of,
    facts_for,
    game_facts,
    is_relative,
    local_day_of,
)
from daily_challenge.editions import edition_column, edition_group
from db.jsonx import plus_hours
from db.models import Game, GameType
from games.filters import not_abandoned, not_dev_affected

# Pinned rows read back: the rest rule's 30 days of offers plus their 30-day rest.
PINNED_LOOKBACK_DAYS = personal.REST_DAYS * 2
# The earliest UTC offset a client may send (-840..840 minutes): a local date starts
# at most this long before UTC midnight.
_MAX_EAST = timedelta(minutes=840)


def request_opens(day: date) -> datetime:
    """The earliest instant any client could have asked for ``day``: ``/upcoming``
    serves today..today+``MAX_DAYS_AHEAD``, so from the start of local ``day`` - 2 in
    the easternmost time zone. Independent of the offset this request sent, so a
    client that changed time zone is covered too."""
    opening = day - timedelta(days=MAX_DAYS_AHEAD)
    return datetime(opening.year, opening.month, opening.day, tzinfo=UTC) - _MAX_EAST


@dataclass(frozen=True)
class Creations:
    """Query 4 for one served day: the install's first game created at or after
    ``request_opens(day)`` - the pin window, how many gaps longer than the window lie
    between consecutive creations since, and the latest creation."""

    first: datetime | None
    gaps: int
    latest: datetime | None


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
    # Best final_score ever before each served day (and each probe day), per game type.
    # For Sort, of the install's edition only (``sort_edition``).
    best_scores: dict[date, dict[str, int]] = field(default_factory=dict)
    # Best final_score per (game type, local day) over the affinity window, and the best
    # before that window: Sort's per-day standings (``sort_new_levels_per_day``, #4028),
    # of the install's edition only.
    daily_best: dict[str, dict[date, int]] = field(default_factory=dict)
    best_before_window: dict[str, int] = field(default_factory=dict)
    # The day-start bests per (game type, Sort edition) of each served and probe day,
    # every edition: what a relative goal is scored against (``met_on``).
    edition_bests: dict[date, dict[tuple[str, int], int]] = field(default_factory=dict)
    # The Sort edition the install's targets read, as the loader fixed it for query 3
    # (``_standing_edition``); None in a hand-built history (``sort_edition`` works it out).
    read_sort_edition: int | None = None
    # Pinned assignments by local date; the pick adds the days it picks.
    pinned: dict[date, Assignment] = field(default_factory=dict)
    # Query 4 per served day, and the write ceiling's window. None: not read
    # (hand-built histories in pure tests), treated as always pinnable.
    creations: dict[date, Creations] | None = None
    pin_window: timedelta = timedelta(hours=48)
    now: datetime | None = None

    def always_pinnable(self, day: date) -> bool:
        """True when the install could **not** have been served ``day`` unpinned
        before this request, so a personal pick shows nothing new for that day.

        A day is served unpinned (the shared template, nothing stored) whenever the
        install asks for it while ``assignments.may_pin`` refuses: no ``games`` row
        created in the last ``DAILY_CHALLENGE_PIN_RECENT_PLAY_HOURS``. The day can be
        asked for from ``request_opens(day)``. So it is always pinnable only if, at
        every instant from then until now, the install had a game created in the
        window before it: a game before ``request_opens(day)`` within the window, no
        gap longer than the window between consecutive games since, and one within
        the window before now. Otherwise the device may hold shared goals for the day
        (a cached ``/upcoming``, a ``/status`` read before its first game synced), and
        the pick must be that same shared template.

        Not covered: a day served unpinned only because ``may_pin``'s storage guard
        paused pinning. That pause is automatic, not only an operator's: storage
        crossing the replay recorder's 90 % turn-down point, or a failed size reading
        (remembered for ``assignments.SIZE_FAILURE_TTL``, 10 minutes). Once the guard
        lets pinning resume, a day served unpinned during the pause can be pinned with
        personal goals. Also not covered: days served while the kill switch was off.
        No state records either pause (by design)."""
        if self.creations is None:
            return True
        summary = self.creations.get(day)
        if summary is None or summary.first is None or summary.latest is None:
            return False
        if summary.first >= request_opens(day) or summary.gaps:
            return False
        now = self.now or datetime.now(UTC)
        return now - summary.latest <= self.pin_window

    @property
    def sort_edition(self) -> int:
        """The Sort edition the pace, best and catalog cap read (``_standing_edition``)."""
        if self.read_sort_edition is not None:
            return self.read_sort_edition
        return _standing_edition(self)

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
        """Whether a finished game of ``day`` met ``goal`` (exact on probe days). A
        relative goal (Sort "new levels") is scored against the best before ``day`` of
        each row's edition (query 3 reads them for every probe day). A hand-built history
        without them uses ``best_scores`` for both editions."""
        day_start: dict[tuple[str, int], int] | None = None
        if is_relative(goal):
            day_start = self.edition_bests.get(day) or {
                (goal.game_type, e): self.best_final_score(goal.game_type, day)
                for e in (LEGACY_EDITION, CATALOG_EDITION)
            }
        for g in self.games.get(goal.game_type, []):
            if g.local_date != day:
                continue
            facts = facts_for(goal, g.facts, day_start)
            if facts is not None and goal.evaluate(facts):
                return True
        return False

    def best_final_score(self, game: str, day: date) -> int:
        return self.best_scores.get(day, {}).get(game, 0)

    def sort_new_levels_per_day(self, day: date) -> list[int]:
        """New Sort levels solved on each local day of play in the affinity window before
        ``day``: that day's best ``final_score`` (the standing after its last solve) minus
        the best before it. From per-day maxima (query 3), not from single rows, so a
        player solving 10 levels a day reads as 10 a day (#4028). A day not over yet (today,
        when the pick runs for today+1 or today+2) is left out: its standing so far is not a
        day's pace."""
        today = self.first_day
        if self.now is not None:
            today = _local_date(self.now, self.tz_offset_minutes)
        dates = [
            d
            for back in range(self.affinity_window, 0, -1)
            if (d := day - timedelta(days=back)) < today
        ]
        if not dates:
            return []
        maxima = self.daily_best.get("sort", {})
        running = max(
            [self.best_before_window.get("sort", 0)]
            + [v for d, v in maxima.items() if d < dates[0]]
        )
        out: list[int] = []
        for d in dates:
            best = maxima.get(d)
            if best is None:
                continue
            out.append(max(0, best - running))
            running = max(running, best)
        return out


def _aware(value: datetime) -> datetime:
    """SQLite returns naive timestamps; they are UTC."""
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _local_date(completed_at: datetime, tz_offset_minutes: int) -> date:
    return (completed_at + timedelta(minutes=tz_offset_minutes)).date()


def _probe_days(pinned: Mapping[date, Assignment], first_day: date) -> dict[str, set[date]]:
    """The finished days query 2 must read in full: the last two days each personal
    goal type was pinned (step-down), and every discovery bonus offer (rest rule)."""
    probes: dict[str, set[date]] = defaultdict(set)
    history = InstallHistory(0, first_day, first_day, 1, pinned=dict(pinned))
    for game, type_name in personal.personal_type_keys():
        for d in personal.last_personal_occurrences(history, game, type_name, first_day):
            probes[game].add(d)
    for d, a in pinned.items():
        if (
            d < first_day
            and a.bonus is not None
            and a.bonus.game_type in personal.GAME_SPECS
            and personal.bonus_kind(a.bonus) == "discovery"
        ):
            probes[a.bonus.game_type].add(d)
    return probes


async def load_install_history(
    session: AsyncSession,
    session_id: str,
    day: date,
    tz_offset_minutes: int = 0,
    *,
    through: date | None = None,
    now: datetime | None = None,
) -> InstallHistory:
    """The install's history for picking ``day`` .. ``through`` (default ``day``)."""
    through = through or day
    now = now or datetime.now(UTC)
    window = personal.affinity_days()
    history = InstallHistory(
        tz_offset_minutes=tz_offset_minutes,
        first_day=day,
        last_day=through,
        affinity_window=window,
        pin_window=assignments.recent_play_window(),
        now=now,
    )
    served = [day + timedelta(days=i) for i in range((through - day).days + 1)]
    games = sorted(personal.GAME_SPECS)

    # 1. Pinned assignments.
    history.pinned = await assignments.read_assignments(
        session, session_id, day - timedelta(days=PINNED_LOOKBACK_DAYS), through
    )

    # 2. Recent games per type and served-day bucket, plus the probe days in full.
    starts = [local_day_of(d, tz_offset_minutes).start_utc for d in served]
    end = starts[-1]
    cap = personal.history_games()
    # Bucket 0: before the first served day; bucket i: inside served day i - 1.
    partition = [Game.game_type_id]
    if len(starts) > 1:
        partition.append(
            case(
                *((Game.completed_at < s, i) for i, s in enumerate(starts[:-1])),
                else_=len(starts) - 1,
            )
        )
    rn = (
        func.row_number()
        .over(
            partition_by=partition,
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
    probes = _probe_days(history.pinned, day)
    for game, days in sorted(probes.items()):
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

    # 3. Finished games and best final_score per local day of the affinity window; the
    # best before that window; the best final_score before each served day and each
    # probe day (a relative Sort goal's baseline, #4028).
    count_days = [
        through - timedelta(days=back) for back in range(1, window + (through - day).days + 1)
    ]
    count_windows = [local_day_of(d, tz_offset_minutes) for d in count_days]
    best_days = sorted(set(served).union(*probes.values()))

    def in_window(w):
        return and_(Game.completed_at >= w.start_utc, Game.completed_at < w.end_utc)

    def best_before(start: datetime):
        return func.max(case((Game.completed_at < start, Game.final_score), else_=None))

    columns = (
        [func.sum(case((in_window(w), 1), else_=0)) for w in count_windows]
        + [func.max(case((in_window(w), Game.final_score), else_=None)) for w in count_windows]
        + [best_before(count_windows[-1].start_utc)]
        + [best_before(local_day_of(d, tz_offset_minutes).start_utc) for d in best_days]
    )
    # Grouped by Sort edition too (one more GROUP BY key, same statement): Sort's catalog
    # and pre-catalog levels are numbered apart, so its standings are per edition.
    edition = edition_column()
    agg = (
        await session.execute(
            select(GameType.name, edition, *columns)
            .select_from(Game)
            .join(GameType, Game.game_type_id == GameType.id)
            .where(
                Game.session_id == session_id,
                GameType.name.in_(games),
                Game.completed_at.is_not(None),
                not_abandoned(),
                not_dev_affected(),
            )
            .group_by(GameType.name, edition_group())
        )
    ).all()
    _fold_counts_and_bests(history, agg, count_days, best_days)

    # 4. One aggregate row over game creations (skipped if every day is new anyway).
    history.creations = {}
    if not all(personal.is_new_install(history, d) for d in served):
        history.creations = await _creations(session, session_id, served, history.pin_window, now)
    return history


def _fold_counts_and_bests(
    history: InstallHistory, agg: Sequence, count_days: list[date], best_days: list[date]
) -> None:
    """Query 3's rows (one per game type and Sort edition) into ``history``: counts summed
    over editions, every edition's day-start bests in ``edition_bests``, and Sort's
    per-day standings and bests from the install's edition only (``sort_edition``)."""
    history.read_sort_edition = _standing_edition(history)
    n = len(count_days)
    for name, ed, *values in agg:
        counts, day_bests = values[:n], values[n : 2 * n]
        before_window, bests = values[2 * n], values[2 * n + 1 :]
        day_counts = history.daily_counts.setdefault(name, {})
        for d, c in zip(count_days, counts, strict=True):
            if c:
                day_counts[d] = day_counts.get(d, 0) + int(c)
        for d, best in zip(best_days, bests, strict=True):
            if best is not None:
                history.edition_bests.setdefault(d, {})[(name, int(ed))] = int(best)
        if name in DAY_START_MEASURES and int(ed) != history.sort_edition:
            continue  # the targets read the install's own edition only
        _merge_max(
            history.daily_best.setdefault(name, {}),
            {d: b for d, b in zip(count_days, day_bests, strict=True) if b is not None},
        )
        if before_window is not None:
            history.best_before_window[name] = max(
                history.best_before_window.get(name, 0), int(before_window)
            )
        for d, best in zip(best_days, bests, strict=True):
            if best is not None:
                _merge_max(history.best_scores.setdefault(d, {}), {name: best})


def _merge_max(into: dict, values: Mapping) -> None:
    for key, value in values.items():
        into[key] = max(into.get(key, 0), int(value))


def _standing_edition(history: InstallHistory) -> int:
    """The Sort edition the install's pace and levels left read: the catalog while
    ``SORT_CATALOG_EDITION_ENFORCED`` is on (only it counts), else the edition of the
    install's latest Sort row (the build it plays now; the catalog when it has none)."""
    editions = counted_editions()
    if len(editions) == 1:
        return editions[0]
    rows = history.games.get("sort", [])
    return edition_of(rows[0].facts) if rows else CATALOG_EDITION


def _as_datetime(value: datetime | None) -> datetime | None:
    """An aggregate over a ``DateTime`` column, UTC-aware (SQLite returns it naive)."""
    return None if value is None else _aware(value)


async def _creations(
    session: AsyncSession,
    session_id: str,
    served: list[date],
    window: timedelta,
    now: datetime,
) -> dict[date, Creations]:
    """Query 4: one row, whatever the number of games (see the module docstring)."""
    hours = int(window.total_seconds() // 3600)
    sinces = [request_opens(d) - window for d in served]
    inner = (
        select(
            Game.created_at.label("created"),
            func.lag(Game.created_at).over(order_by=Game.created_at).label("prev"),
        )
        .where(
            Game.session_id == session_id,
            Game.created_at >= sinces[0],
            Game.created_at < now,
        )
        .subquery()
    )
    columns = []
    for since in sinces:
        columns.append(func.min(case((inner.c.created >= since, inner.c.created), else_=None)))
        columns.append(
            func.sum(
                case(
                    (
                        and_(
                            inner.c.prev >= since,
                            inner.c.created > plus_hours(inner.c.prev, hours),
                        ),
                        1,
                    ),
                    else_=0,
                )
            )
        )
    columns.append(func.max(inner.c.created))
    row = (await session.execute(select(*columns))).one()
    latest = _as_datetime(row[-1])
    return {
        d: Creations(first=_as_datetime(row[2 * i]), gaps=int(row[2 * i + 1] or 0), latest=latest)
        for i, d in enumerate(served)
    }
