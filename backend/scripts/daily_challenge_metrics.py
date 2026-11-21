"""Read-only tuning report for the Daily Challenge success metrics (#3998).

Answers "are the goals too easy or too hard?" from data already stored: the pinned
``daily_challenge_assignments`` rows (#3992) and the ``games`` rows. Collects and
writes nothing. See docs/DAILY-CHALLENGE.md ("Tuning metrics") and
docs/DAILY-CHALLENGE-STRATEGY.md section 8 for how to read it.

    cd backend
    python scripts/daily_challenge_metrics.py                       # last 14 complete days
    python scripts/daily_challenge_metrics.py --since 2026-11-01 --until 2026-11-14
    python scripts/daily_challenge_metrics.py --json

Reports, for the window:

a. core goal completion per game and goal kind: ``met / offered`` ("among those who
   played": an install-day is *offered* a game's goal only if that install finished
   at least one non-abandoned game of that type that day) and ``met / assigned``
   ("overall": every pinned goal, played or not);
b. the share of install-days with any finished game that met at least 2 of the 3
   core goals (the streak rule, ``streak.GOALS_TO_QUALIFY``);
c. bonus discovery: of pinned days with a bonus goal, the share where the bonus
   game was played that day ("no bonus data yet" while no row has one, #3995);
d. next-day return: of qualifying install-days, the share where the same install
   finished a game the next day.

Goals are rebuilt with ``goal_from_spec`` and scored with ``evaluate_goal`` against
the games the install finished that day, exactly as the live status and the streak
do (abandoned games never count: ``games.filters.not_abandoned``).

Approximation (documented, not silent): a pinned row stores only the install's local
*date*, not its UTC offset. Every install is bucketed with one offset
(``--tz-offset-minutes``, default 0 = UTC days), the same ``local_day_of`` window the
service uses. An install far from that offset can have a game near local midnight
land on the neighbouring day. Acceptable for an aggregate tuning read.

Read-only: only SELECTs are issued, and on PostgreSQL the transaction is also
``SET TRANSACTION READ ONLY`` (SQLite, used in tests, has no such mode). Aggregates
only: no install id is printed or returned. Reads ``DATABASE_URL`` the way the app
does (``settings.Settings``, ``backend/.env``, the environment).

Cost: per chunk of ``CHUNK_INSTALLS`` installs, three SELECTs (the next page of
install ids, their pinned rows, their games), so the query count is
``3 * ceil(installs / CHUNK_INSTALLS) + 1`` (the loop ends on an empty id page), never one per install or day, and only one
chunk is in memory at a time. Rough size at 10k DAU over 60 days: ~30k distinct
installs -> ~60 chunks, ~181 queries; ~600k pinned rows and a few million games
streamed through, tens of MB resident (one chunk), about a minute against a
replica. Run it off-peak, ideally on a read replica, and narrow ``--since``.

Exit codes: 0 printed, 2 bad argument or no database configured.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import uuid
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from daily_challenge.assignments import decode_goals
from daily_challenge.definitions import game_facts, local_day_of
from daily_challenge.service import EndedGame, evaluate_goal
from daily_challenge.streak import GOALS_TO_QUALIFY
from db.models import DailyChallengeAssignment, Game, GameType
from games.filters import not_abandoned

DEFAULT_DAYS = 14
CHUNK_INSTALLS = 500


@dataclass
class _GoalCount:
    assigned: int = 0
    offered: int = 0
    met: int = 0


@dataclass
class _Totals:
    goals: dict[tuple[str, str], _GoalCount] = field(
        default_factory=lambda: defaultdict(_GoalCount)
    )
    install_days: int = 0
    install_days_played: int = 0
    qualified: int = 0
    qualified_matured: int = 0
    returned: int = 0
    bonus_days: int = 0
    bonus_played: int = 0
    skipped_rows: int = 0
    skipped_bonus: int = 0


def _rate(num: int, den: int) -> float | None:
    return None if den == 0 else round(num / den, 4)


def _local_date(completed_at: datetime, tz_offset_minutes: int) -> date:
    """The local calendar day a completion falls on. Naive timestamps (SQLite) are UTC."""
    if completed_at.tzinfo is None:
        completed_at = completed_at.replace(tzinfo=UTC)
    return (completed_at + timedelta(minutes=tz_offset_minutes)).date()


def _score_install(
    totals: _Totals,
    pinned: dict[date, tuple[str, str | None]],
    games: dict[date, list[EndedGame]],
    last_matured_day: date,
) -> None:
    for day, (goals_text, bonus_text) in pinned.items():
        try:
            goals = decode_goals(goals_text)
        except (ValueError, KeyError, TypeError, IndexError):
            totals.skipped_rows += 1
            continue
        bonus_type = None
        if bonus_text is not None:
            try:
                bonus_type = json.loads(bonus_text)[0]
            except (ValueError, KeyError, TypeError, IndexError):
                totals.skipped_bonus += 1
        ended = games.get(day, [])
        played_types = {name for name, _ in ended}
        totals.install_days += 1
        met_count = 0
        for goal in goals:
            count = totals.goals[(goal.game_type, goal.kind)]
            count.assigned += 1
            if goal.game_type in played_types:
                count.offered += 1
            if evaluate_goal(goal, ended).completed:
                count.met += 1
                met_count += 1
        if bonus_type is not None:
            totals.bonus_days += 1
            totals.bonus_played += bonus_type in played_types
        if not ended:
            continue
        totals.install_days_played += 1
        if met_count >= GOALS_TO_QUALIFY:
            totals.qualified += 1
            # The next day must be over for a missing game to mean "did not return".
            if day <= last_matured_day:
                totals.qualified_matured += 1
                totals.returned += bool(games.get(day + timedelta(days=1)))


async def _collect(
    db: AsyncSession, since: date, until: date, tz_offset_minutes: int, today: date
) -> _Totals:
    totals = _Totals()
    first = local_day_of(since, tz_offset_minutes).start_utc
    # One extra day of games: the "next day" of the last day in the window.
    last = local_day_of(until + timedelta(days=1), tz_offset_minutes).end_utc
    in_window = (
        DailyChallengeAssignment.local_date >= since,
        DailyChallengeAssignment.local_date <= until,
    )
    last_matured_day = min(until, today - timedelta(days=2))
    after: uuid.UUID | None = None
    while True:
        page = select(DailyChallengeAssignment.session_id).where(*in_window).distinct()
        if after is not None:
            page = page.where(DailyChallengeAssignment.session_id > after)
        page = page.order_by(DailyChallengeAssignment.session_id).limit(CHUNK_INSTALLS)
        ids = (await db.execute(page)).scalars().all()
        if not ids:
            return totals
        after = ids[-1]
        rows = await db.execute(
            select(
                DailyChallengeAssignment.session_id,
                DailyChallengeAssignment.local_date,
                DailyChallengeAssignment.goals,
                DailyChallengeAssignment.bonus,
            ).where(*in_window, DailyChallengeAssignment.session_id.in_(ids))
        )
        pinned: dict[str, dict[date, tuple[str, str | None]]] = defaultdict(dict)
        for sid, local_date, goals_text, bonus_text in rows:
            pinned[str(sid)][local_date] = (goals_text, bonus_text)
        game_rows = await db.execute(
            select(
                Game.session_id,
                GameType.name,
                Game.game_metadata,
                Game.final_score,
                Game.duration_ms,
                Game.completed_at,
            )
            .select_from(Game)
            .join(GameType, Game.game_type_id == GameType.id)
            .where(
                Game.session_id.in_(list(pinned)),
                Game.completed_at >= first,
                Game.completed_at < last,
                not_abandoned(),
            )
        )
        games: dict[str, dict[date, list[EndedGame]]] = defaultdict(lambda: defaultdict(list))
        for sid, name, metadata, final_score, duration_ms, completed_at in game_rows:
            games[sid][_local_date(completed_at, tz_offset_minutes)].append(
                (name, game_facts(metadata, final_score, duration_ms))
            )
        for sid, days in pinned.items():
            _score_install(totals, days, games.get(sid, {}), last_matured_day)


def _report(totals: _Totals, since: date, until: date, tz_offset_minutes: int) -> dict[str, Any]:
    goals = [
        {
            "game_type": game_type,
            "kind": kind,
            "assigned": c.assigned,
            "offered": c.offered,
            "met": c.met,
            "rate_among_played": _rate(c.met, c.offered),
            "rate_overall": _rate(c.met, c.assigned),
        }
        for (game_type, kind), c in sorted(totals.goals.items())
    ]
    assigned = sum(c.assigned for c in totals.goals.values())
    offered = sum(c.offered for c in totals.goals.values())
    met = sum(c.met for c in totals.goals.values())
    bonus: dict[str, Any] = {"available": totals.bonus_days > 0}
    if totals.bonus_days:
        bonus |= {
            "days_with_bonus": totals.bonus_days,
            "played": totals.bonus_played,
            "share": _rate(totals.bonus_played, totals.bonus_days),
        }
    return {
        "window": {"since": since.isoformat(), "until": until.isoformat()},
        "tz_offset_minutes": tz_offset_minutes,
        "install_days": totals.install_days,
        "install_days_played": totals.install_days_played,
        "skipped_rows": totals.skipped_rows,
        "skipped_bonus": totals.skipped_bonus,
        "core_goals": goals,
        "core_total": {
            "assigned": assigned,
            "offered": offered,
            "met": met,
            "rate_among_played": _rate(met, offered),
            "rate_overall": _rate(met, assigned),
        },
        "qualifying_days": {
            "goals_to_qualify": GOALS_TO_QUALIFY,
            "install_days_played": totals.install_days_played,
            "qualified": totals.qualified,
            "share": _rate(totals.qualified, totals.install_days_played),
        },
        "bonus_discovery": bonus,
        "next_day_return": {
            "qualified_days": totals.qualified_matured,
            "returned": totals.returned,
            "share": _rate(totals.returned, totals.qualified_matured),
        },
    }


def _pct(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.1f}%"


def render(report: dict[str, Any]) -> str:
    w = report["window"]
    lines = [
        (
            f"Daily Challenge metrics {w['since']} .. {w['until']} "
            f"(UTC offset {report['tz_offset_minutes']} min)"
        ),
        (
            f"install-days pinned: {report['install_days']}, "
            f"with a finished game: {report['install_days_played']}"
        ),
    ]
    if report["skipped_bonus"]:
        lines.append(f"unreadable bonus (bonus metric skipped): {report['skipped_bonus']}")
    if report["skipped_rows"]:
        lines.append(f"skipped undecodable rows: {report['skipped_rows']}")
    lines += ["", "Core goal completion (target band 65-75% among those who played)"]
    header = (
        f"{'game':<14}{'kind':<26}{'assigned':>9}{'offered':>9}{'met':>7}"
        f"{'played':>9}{'overall':>9}"
    )
    lines += [header, "-" * len(header)]
    rows = [*report["core_goals"], {**report["core_total"], "game_type": "ALL", "kind": ""}]
    for g in rows:
        lines.append(
            f"{g['game_type']:<14}{g['kind']:<26}{g['assigned']:>9}{g['offered']:>9}{g['met']:>7}"
            f"{_pct(g['rate_among_played']):>9}{_pct(g['rate_overall']):>9}"
        )
    q = report["qualifying_days"]
    lines += [
        "",
        (
            f"Days with >= {q['goals_to_qualify']} of 3 core goals met: {q['qualified']} / "
            f"{q['install_days_played']} = {_pct(q['share'])}"
        ),
    ]
    b = report["bonus_discovery"]
    if b["available"]:
        lines.append(
            f"Bonus discovery: {b['played']} / {b['days_with_bonus']} bonus days played "
            f"= {_pct(b['share'])}"
        )
    else:
        lines.append("Bonus discovery: no bonus data yet")
    r = report["next_day_return"]
    lines.append(
        f"Next-day return after a qualifying day: {r['returned']} / {r['qualified_days']} "
        f"= {_pct(r['share'])}"
    )
    return "\n".join(lines) + "\n"


async def collect(
    db: AsyncSession,
    since: date,
    until: date,
    tz_offset_minutes: int = 0,
    utc_now: datetime | None = None,
) -> dict[str, Any]:
    """The report for ``since``..``until`` (inclusive local dates) on an open session."""
    now = utc_now or datetime.now(UTC)
    today = (now + timedelta(minutes=tz_offset_minutes)).date()
    until = min(until, today)
    totals = await _collect(db, since, until, tz_offset_minutes, today)
    return _report(totals, since, until, tz_offset_minutes)


async def run(
    since: date | None, until: date | None, tz_offset_minutes: int, as_json: bool
) -> tuple[int, str]:
    from db.base import get_engine, get_session_factory, is_configured

    if not is_configured():
        return 2, "DATABASE_URL is not set.\n"
    now = datetime.now(UTC)
    if until is None:
        until = (now + timedelta(minutes=tz_offset_minutes)).date() - timedelta(days=1)
    if since is None:
        since = until - timedelta(days=DEFAULT_DAYS - 1)
    if since > until:
        return 2, "--since must not be after --until.\n"
    try:
        async with get_session_factory()() as db:
            if db.get_bind().dialect.name == "postgresql":
                await db.execute(text("SET TRANSACTION READ ONLY"))
            report = await collect(db, since, until, tz_offset_minutes, now)
            await db.rollback()
    finally:
        await get_engine().dispose()
    return 0, (json.dumps(report, indent=2) + "\n") if as_json else render(report)


def _date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"not a YYYY-MM-DD date: {value!r}") from exc


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read-only Daily Challenge tuning metrics.")
    parser.add_argument(
        "--since", type=_date, help="first local date (default: 14 days ending --until)"
    )
    parser.add_argument("--until", type=_date, help="last local date (default: yesterday)")
    parser.add_argument(
        "--tz-offset-minutes",
        type=int,
        default=0,
        help="one UTC offset (minutes east) used to bucket every install's games (default 0)",
    )
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    args = parser.parse_args(argv)
    load_dotenv()
    code, out = asyncio.run(run(args.since, args.until, args.tz_offset_minutes, args.json))
    print(out, end="", file=sys.stderr if code else sys.stdout)
    return code


if __name__ == "__main__":
    sys.exit(main())
