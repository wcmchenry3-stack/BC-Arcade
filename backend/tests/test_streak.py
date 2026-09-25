"""App-wide streak (#2456): consecutive days with >= 2 of 3 daily goals met.

The template is pinned so the tests do not depend on the calendar. A "qualifying"
day is two goals met (twenty48 score + sort level); a "partial" day is one.
"""

from __future__ import annotations

import os
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select

from daily_challenge.definitions import FREE_GOAL_POOL, Template, _at_least
from daily_challenge.service import slate_for_games
from daily_challenge.streak import GOALS_TO_QUALIFY, LOOKBACK_DAYS, compute_streak
from db.base import get_session_factory, is_configured
from db.models import Game, GameEntitlement, GameType

needs_db = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping streak tests",
)

_NOW = datetime(2026, 10, 9, 15, 0, tzinfo=timezone.utc)
_TODAY = _NOW.date()

_SCORE = FREE_GOAL_POOL["twenty48"][0]  # final_score >= 500
_LEVEL = FREE_GOAL_POOL["sort"][0]  # final_score >= 3
_MOVES = FREE_GOAL_POOL["solitaire"][0]  # moves >= 10
_TEMPLATE = Template("streak_for_tests", (_SCORE, _LEVEL, _MOVES))


@pytest.fixture(autouse=True)
def pinned_template(monkeypatch: pytest.MonkeyPatch) -> None:
    # A shell that exports the dev override must not change what these assert.
    monkeypatch.delenv("ENTITLEMENT_DEV_OVERRIDE", raising=False)
    monkeypatch.setattr(
        "daily_challenge.streak.template_for", lambda _day, _slate="free": _TEMPLATE
    )


def _at(day: date, hour: int = 12) -> datetime:
    return datetime(day.year, day.month, day.day, hour, tzinfo=timezone.utc)


async def _add(sid: str, game_type: str, when: datetime, **fields) -> None:
    factory = get_session_factory()
    async with factory() as db:
        gt_id = (
            await db.execute(select(GameType.id).where(GameType.name == game_type))
        ).scalar_one()
        db.add(
            Game(
                session_id=sid,
                game_type_id=gt_id,
                started_at=when - timedelta(minutes=5),
                completed_at=when,
                outcome=fields.get("outcome", "completed"),
                final_score=fields.get("final_score"),
                game_metadata=fields.get("metadata", {}),
            )
        )
        await db.commit()


async def _qualifying_day(sid: str, day: date, hour: int = 12) -> None:
    """Two goals met: a twenty48 score and a sort level."""
    await _add(sid, "twenty48", _at(day, hour), final_score=600)
    await _add(sid, "sort", _at(day, hour), final_score=12)


async def _partial_day(sid: str, day: date) -> None:
    """One goal met only."""
    await _add(sid, "twenty48", _at(day), final_score=600)


async def _streak(sid: str, tz: int = 0, now: datetime = _NOW) -> int:
    factory = get_session_factory()
    async with factory() as db:
        return await compute_streak(db, sid, tz, now)


def _ago(days: int) -> date:
    return _TODAY - timedelta(days=days)


# ---------------------------------------------------------------------------
# the rule
# ---------------------------------------------------------------------------


def test_the_threshold_is_two_of_three() -> None:
    assert GOALS_TO_QUALIFY == 2 and len(_TEMPLATE.goals) == 3
    assert LOOKBACK_DAYS == 60


@needs_db
async def test_no_history_is_a_zero_streak() -> None:
    assert await _streak(str(uuid.uuid4())) == 0


@needs_db
async def test_today_not_yet_finished_does_not_break_the_streak() -> None:
    sid = str(uuid.uuid4())
    for n in (1, 2, 3):
        await _qualifying_day(sid, _ago(n))
    # Nothing today yet: the streak ends yesterday, it is not failed.
    assert await _streak(sid) == 3


@needs_db
async def test_today_counts_once_it_has_two_goals() -> None:
    sid = str(uuid.uuid4())
    for n in (1, 2):
        await _qualifying_day(sid, _ago(n))
    await _qualifying_day(sid, _ago(0))
    assert await _streak(sid) == 3


@needs_db
async def test_a_partial_today_neither_counts_nor_breaks_it() -> None:
    sid = str(uuid.uuid4())
    await _qualifying_day(sid, _ago(1))
    await _partial_day(sid, _ago(0))  # 1 of 3 — not yet a day that counts
    assert await _streak(sid) == 1


@needs_db
async def test_only_today_qualifying_is_a_streak_of_one() -> None:
    sid = str(uuid.uuid4())
    await _qualifying_day(sid, _ago(0))
    assert await _streak(sid) == 1


@needs_db
async def test_a_day_with_one_goal_breaks_the_streak() -> None:
    sid = str(uuid.uuid4())
    await _qualifying_day(sid, _ago(1))
    await _qualifying_day(sid, _ago(2))
    await _partial_day(sid, _ago(3))  # breaks it
    await _qualifying_day(sid, _ago(4))  # before the break — must not count
    assert await _streak(sid) == 2


@needs_db
async def test_a_missed_yesterday_ends_the_streak_at_zero() -> None:
    sid = str(uuid.uuid4())
    await _qualifying_day(sid, _ago(2))
    await _qualifying_day(sid, _ago(3))
    # Nothing yesterday and today has not qualified: the run is over.
    assert await _streak(sid) == 0


@needs_db
async def test_progress_goals_do_not_credit_an_abandoned_game() -> None:
    """A streak day has to be earned by games the player finished (#2468/#2472).

    These abandons do report real progress — level 10, moves >= 10 — and
    used to earn the day. They no longer do: the streak is an accomplishment,
    so quitting must not advance it.
    """
    sid = str(uuid.uuid4())
    await _add(sid, "sort", _at(_ago(1)), outcome="abandoned", final_score=10)
    await _add(
        sid, "solitaire", _at(_ago(1)), outcome="abandoned", metadata={"won": False, "moves": 10}
    )
    assert await _streak(sid) == 0


@needs_db
async def test_the_same_progress_credits_the_day_when_the_games_are_finished() -> None:
    """The mirror of the test above — proves the filter keys on outcome alone."""
    sid = str(uuid.uuid4())
    await _add(sid, "sort", _at(_ago(1)), outcome="completed", final_score=10)
    await _add(
        sid, "solitaire", _at(_ago(1)), outcome="completed", metadata={"won": False, "moves": 10}
    )
    assert await _streak(sid) == 1


@needs_db
async def test_other_sessions_do_not_count() -> None:
    mine, other = str(uuid.uuid4()), str(uuid.uuid4())
    await _qualifying_day(other, _ago(1))
    assert await _streak(mine) == 0


@needs_db
async def test_the_streak_is_capped_at_the_lookback() -> None:
    sid = str(uuid.uuid4())
    for n in range(LOOKBACK_DAYS + 10):
        await _qualifying_day(sid, _ago(n))
    assert await _streak(sid) == LOOKBACK_DAYS


# ---------------------------------------------------------------------------
# local days — the same window the live challenge uses
# ---------------------------------------------------------------------------


@needs_db
async def test_days_are_the_players_local_days() -> None:
    sid = str(uuid.uuid4())
    # 03:00 UTC on Oct 9 is Oct 8 20:00 in UTC-7 but Oct 9 in UTC.
    late = datetime(2026, 10, 9, 3, 0, tzinfo=timezone.utc)
    for when in (late, _at(_ago(1))):  # _ago(1) is Oct 8 12:00 UTC: Oct 8 in both zones
        await _add(sid, "twenty48", when, final_score=600)
        await _add(sid, "sort", when, final_score=12)
    # UTC: the late games are today, the others yesterday — two qualifying days.
    assert await _streak(sid, tz=0) == 2
    # UTC-7: all four games fall on Oct 8 — one qualifying day, and today (08:00) is empty.
    assert await _streak(sid, tz=-420) == 1


@needs_db
async def test_a_game_at_local_midnight_belongs_to_the_new_day() -> None:
    sid = str(uuid.uuid4())
    midnight = datetime(2026, 10, 8, 7, 0, tzinfo=timezone.utc)  # 00:00 Oct 8 in UTC-7
    await _add(sid, "twenty48", midnight, final_score=600)
    await _add(sid, "sort", midnight, final_score=12)
    # Oct 8 local is yesterday for a player at UTC-7 whose now is Oct 9 08:00.
    assert await _streak(sid, tz=-420) == 1
    just_before = midnight - timedelta(seconds=1)  # 23:59:59 Oct 7 local
    other = str(uuid.uuid4())
    await _add(other, "twenty48", just_before, final_score=600)
    await _add(other, "sort", just_before, final_score=12)
    assert await _streak(other, tz=-420) == 0  # Oct 7 local, and Oct 8 has nothing


# ---------------------------------------------------------------------------
# slates — the rule is shared with resolve_slate, entitlements read once
# ---------------------------------------------------------------------------


def test_slate_rule_needs_every_named_premium_game() -> None:
    assert slate_for_games(set(), {"yacht"}, override=False) == "free"  # nothing to unlock
    assert slate_for_games({"yacht", "sudoku"}, {"yacht"}, override=False) == "free"
    assert slate_for_games({"yacht", "sudoku"}, {"yacht", "sudoku", "hearts"}, False) == "premium"
    assert slate_for_games({"yacht", "sudoku"}, set(), override=True) == "premium"
    assert slate_for_games(set(), set(), override=True) == "free"  # override follows the rule


_PREMIUM_TEMPLATE = Template(
    "premium_streak_for_tests",
    (_at_least("yacht", "score", 1, "easy"), _at_least("sudoku", "errors", 0, "easy"), _MOVES),
)


@pytest.fixture()
def two_slates(monkeypatch: pytest.MonkeyPatch) -> None:
    def pick(_day: date, slate: str = "free") -> Template:
        return _PREMIUM_TEMPLATE if slate == "premium" else _TEMPLATE

    monkeypatch.setattr("daily_challenge.streak.template_for", pick)


@needs_db
async def test_each_past_day_uses_the_slate_the_session_is_entitled_to(two_slates: None) -> None:
    free, entitled = str(uuid.uuid4()), str(uuid.uuid4())
    factory = get_session_factory()
    async with factory() as db:
        db.add_all([GameEntitlement(session_id=entitled, game_slug=s) for s in ("yacht", "sudoku")])
        await db.commit()
    # Both sessions met the FREE template's goals yesterday.
    for sid in (free, entitled):
        await _qualifying_day(sid, _ago(1))
    assert await _streak(free) == 1  # free slate: yesterday counts
    assert await _streak(entitled) == 0  # premium slate replaces it: those goals were not met


@needs_db
async def test_dev_override_replays_with_the_premium_slate(
    two_slates: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ENTITLEMENT_DEV_OVERRIDE", "true")
    sid = str(uuid.uuid4())
    await _qualifying_day(sid, _ago(1))
    assert await _streak(sid) == 0


# ---------------------------------------------------------------------------
# cost — two statements however long the history
# ---------------------------------------------------------------------------


async def _statements_for_a_30_day_streak() -> list[str]:
    sid = str(uuid.uuid4())
    for n in range(1, 31):
        await _qualifying_day(sid, _ago(n))
    statements: list[str] = []
    factory = get_session_factory()
    async with factory() as db:
        engine = db.sync_session.get_bind()

        def record(_conn, _cursor, statement, *_rest) -> None:
            statements.append(statement)

        event.listen(engine, "before_cursor_execute", record)
        try:
            assert await compute_streak(db, sid, 0, _NOW) == 30
        finally:
            event.remove(engine, "before_cursor_execute", record)
    return statements


@needs_db
async def test_the_lookback_is_one_query_not_one_per_day_while_the_slates_match() -> None:
    # Free and premium templates are identical (as until #2458), so only one slate's
    # frozen templates are ever fetched: the window of games, one SELECT for the
    # window's daily_challenge_days rows, and one INSERT freezing the ones that were
    # missing (every day, on this fresh DB) — fixed regardless of LOOKBACK_DAYS.
    assert len(await _statements_for_a_30_day_streak()) == 3


@needs_db
async def test_entitlements_are_one_more_query_and_only_when_the_slates_differ(
    two_slates: None,
) -> None:
    # Differing slates fetch both slates' frozen templates (SELECT + INSERT each, on
    # this fresh DB) and add the entitlements query: games(1) + free(2) + premium(2)
    # + entitlements(1) = 6 — still fixed regardless of LOOKBACK_DAYS, just a higher
    # constant than the matching-slates case above.
    statements = await _statements_for_a_30_day_streak()
    assert len(statements) == 6, statements


# ---------------------------------------------------------------------------
# API — /stats/me carries it
# ---------------------------------------------------------------------------


@pytest.fixture()
def client() -> TestClient:
    assert is_configured()
    from main import app

    return TestClient(app)


def _headers(sid: str) -> dict[str, str]:
    return {"X-Session-ID": sid, "Content-Type": "application/json"}


@needs_db
def test_stats_me_reports_a_streak_and_keeps_the_xp_fields(client: TestClient) -> None:
    body = client.get("/stats/me", headers=_headers(str(uuid.uuid4()))).json()
    assert body["streak_days"] == 0
    for key in ("arcade_xp", "arcade_level", "xp_into_level", "xp_for_next_level"):
        assert key in body


@needs_db
def test_stats_me_accepts_a_timezone_and_rejects_an_out_of_range_one(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    ok = client.get("/stats/me", headers=_headers(sid), params={"tz_offset_minutes": -420})
    assert ok.status_code == 200 and ok.json()["streak_days"] == 0
    bad = client.get("/stats/me", headers=_headers(sid), params={"tz_offset_minutes": 900})
    assert bad.status_code == 422


@needs_db
def test_a_streak_failure_does_not_take_down_stats_me(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # /stats/me also carries XP and level, which Home and Profile read.
    async def boom(*_a, **_k) -> int:
        raise RuntimeError("streak exploded")

    monkeypatch.setattr("stats.router.compute_streak", boom)
    r = client.get("/stats/me", headers=_headers(str(uuid.uuid4())))
    assert r.status_code == 200
    body = r.json()
    assert body["streak_days"] == 0
    assert "arcade_xp" in body and "arcade_level" in body
