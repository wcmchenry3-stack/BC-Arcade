"""Daily cross-game challenge (#2392): definitions, goal evaluation, API."""

from __future__ import annotations

import json
import os
import uuid
from collections.abc import Iterator
from datetime import date, datetime, timedelta, timezone
from itertools import pairwise
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select

from daily_challenge import service
from daily_challenge.definitions import (
    ALWAYS_PRESENT,
    FREE_GOAL_POOL,
    GOAL_POOLS,
    GOALS_PER_DAY,
    PENDING_PREMIUM_GOALS,
    PREMIUM_GOAL_POOL,
    TIERS,
    Template,
    _at_least,
    game_facts,
    local_day,
    parse_salt,
    pick_games,
    pick_template,
    rotation,
    template_for,
)
from daily_challenge.service import evaluate_goal
from db.base import get_session_factory, is_configured
from db.models import Game, GameEntitlement, GameType
from entitlements.service import _ALL_PREMIUM_SLUGS

# ---------------------------------------------------------------------------
# definitions — no DB
# ---------------------------------------------------------------------------


def test_local_day_at_utc() -> None:
    now = datetime(2026, 10, 9, 15, 30, tzinfo=timezone.utc)
    day = local_day(0, now)
    assert day.date == date(2026, 10, 9)
    assert day.start_utc == datetime(2026, 10, 9, tzinfo=timezone.utc)
    assert day.end_utc == datetime(2026, 10, 10, tzinfo=timezone.utc)


def test_local_day_west_of_utc_is_still_yesterday() -> None:
    # 03:00 UTC is 20:00 the previous evening in UTC-7.
    now = datetime(2026, 10, 9, 3, 0, tzinfo=timezone.utc)
    day = local_day(-420, now)
    assert day.date == date(2026, 10, 8)
    assert day.start_utc == datetime(2026, 10, 8, 7, 0, tzinfo=timezone.utc)
    assert day.end_utc == datetime(2026, 10, 9, 7, 0, tzinfo=timezone.utc)
    assert day.start_utc <= now < day.end_utc


def test_local_day_east_of_utc_is_already_tomorrow() -> None:
    # 20:00 UTC is 01:30 the next morning in UTC+5:30.
    now = datetime(2026, 10, 9, 20, 0, tzinfo=timezone.utc)
    day = local_day(330, now)
    assert day.date == date(2026, 10, 10)
    assert day.start_utc == datetime(2026, 10, 9, 18, 30, tzinfo=timezone.utc)
    assert day.start_utc <= now < day.end_utc


@pytest.mark.parametrize("offset", [-840, -1, 0, 1, 840])
def test_local_day_window_always_contains_now(offset: int) -> None:
    now = datetime(2026, 12, 31, 23, 59, 59, tzinfo=timezone.utc)
    day = local_day(offset, now)
    assert day.start_utc <= now < day.end_utc
    assert day.end_utc - day.start_utc == timedelta(days=1)


_SALTS = [0, 1, 7, 12345, -3]
_SLATES = ["free", "premium"]
_START = date(2026, 10, 1)


def _days(n: int, start: date = _START):
    return [start + timedelta(days=i) for i in range(n)]


def test_template_pick_is_deterministic() -> None:
    assert template_for(date(2026, 10, 9)) == template_for(date(2026, 10, 9))
    assert template_for(date(2026, 10, 9), "premium") == template_for(date(2026, 10, 9), "premium")


@pytest.mark.parametrize("slate", _SLATES)
@pytest.mark.parametrize("salt", _SALTS)
def test_every_day_has_daily_word_plus_two_other_games(slate: str, salt: int) -> None:
    for day in _days(400):
        template = pick_template(day, slate, salt)
        games = [g.game_type for g in template.goals]
        assert len(template.goals) == GOALS_PER_DAY
        assert games[0] == ALWAYS_PRESENT
        assert len(set(games)) == GOALS_PER_DAY, "one goal per game — the point is variety"
        assert len({g.id for g in template.goals}) == GOALS_PER_DAY
        assert all(game in GOAL_POOLS[slate] for game in games)


@pytest.mark.parametrize("slate", _SLATES)
@pytest.mark.parametrize("salt", _SALTS)
def test_at_most_one_win_goal_per_day(slate: str, salt: int) -> None:
    # Covers both slates independently, and a full year of every alignment.
    for day in _days(400):
        wins = [g for g in pick_template(day, slate, salt).goals if g.is_win]
        assert len(wins) <= 1, f"{day}: {[g.id for g in wins]}"


@pytest.mark.parametrize("slate", _SLATES)
@pytest.mark.parametrize("salt", _SALTS)
def test_no_game_repeats_on_consecutive_days_even_across_month_ends(slate: str, salt: int) -> None:
    # Includes 2028-02-29 -> 03-01, where YYYYMMDD arithmetic repeated a pick.
    days = _days(60, date(2028, 2, 10)) + _days(400)
    days = sorted(set(days))
    for a, b in pairwise(days):
        if (b - a).days != 1:
            continue
        assert set(pick_games(a, slate, salt)).isdisjoint(pick_games(b, slate, salt))


@pytest.mark.parametrize("slate", _SLATES)
def test_every_rotating_game_comes_up(slate: str) -> None:
    seen = {g for day in _days(len(rotation(slate, 0)) * 2) for g in pick_games(day, slate, 0)}
    assert seen == set(GOAL_POOLS[slate]) - {ALWAYS_PRESENT}


def test_every_tier_of_every_free_game_can_be_picked() -> None:
    picked = {g.id for day in _days(600) for g in template_for(day).goals}
    every = {g.id for goals in FREE_GOAL_POOL.values() for g in goals}
    # Win goals lose out to the one-win rule some days, but each must still appear.
    assert picked == every


def test_salt_parsing_never_raises() -> None:
    assert parse_salt(None) == 0
    assert parse_salt("  ") == 0
    assert parse_salt(" 42 ") == 42
    assert parse_salt("-7") == -7
    hashed = parse_salt("not-a-number")
    assert hashed == parse_salt("not-a-number")
    assert hashed != parse_salt("another-secret")
    assert hashed > 0


def test_salt_shifts_and_reshuffles_the_schedule() -> None:
    day = date(2026, 10, 9)
    assert any(pick_template(day, "free", s) != pick_template(day, "free", 0) for s in range(1, 8))
    # The game order is salt-seeded: reproducible, always the same members.
    assert rotation("free", 12345) == rotation("free", 12345)
    assert sorted(rotation("free", 12345)) == sorted(rotation("free", 0))
    assert any(rotation("free", s) != rotation("free", 0) for s in range(1, 8))


# ---- the pools ----------------------------------------------------------


def test_free_pool_has_the_six_free_games_and_never_a_premium_one() -> None:
    # A store build hides the premium games — a goal there could never be met.
    assert set(FREE_GOAL_POOL) == {
        "daily_word",
        "twenty48",
        "solitaire",
        "sort",
        "freecell",
        "yacht",
    }
    assert set(FREE_GOAL_POOL).isdisjoint(_ALL_PREMIUM_SLUGS)


def test_pending_premium_goals_stay_out_of_every_live_pool() -> None:
    # Blackjack went premium on 2026-09-23; its goals wait for #2458. In a live
    # pool it would be picked for store builds, where the game does not exist.
    for pool in GOAL_POOLS.values():
        assert set(pool).isdisjoint(PENDING_PREMIUM_GOALS)
    assert set(PENDING_PREMIUM_GOALS) <= set(_ALL_PREMIUM_SLUGS)
    # The one-win rule's easy-goal fallback must hold for them too.
    assert all(goals[0].is_win is False for goals in PENDING_PREMIUM_GOALS.values())
    assert PENDING_PREMIUM_GOALS["blackjack"][1].is_win  # chips_gained is luck


_EN_COPY = (
    Path(__file__).parents[2]
    / "frontend"
    / "src"
    / "i18n"
    / "locales"
    / "en"
    / "daily_challenge.json"
)


def test_every_free_goal_kind_has_frontend_wording() -> None:
    """The card words a goal from ``goal.<game_type>.<kind>`` (plural kinds carry a
    ``_one`` / ``_other`` suffix). A kind with no copy ships as the generic
    "Play <game>" chip, so adding one here must add its wording there (#2455).
    Premium-only goals are out of scope until #2458."""
    copy = json.loads(_EN_COPY.read_text(encoding="utf-8"))
    missing = sorted(
        {
            f"goal.{g.game_type}.{g.kind}"
            for goals in FREE_GOAL_POOL.values()
            for g in goals
            if f"goal.{g.game_type}.{g.kind}" not in copy
            and f"goal.{g.game_type}.{g.kind}_other" not in copy
        }
    )
    assert not missing, f"No wording in {_EN_COPY.name} for: {missing}"


def test_premium_pool_is_a_superset_of_the_free_pool() -> None:
    assert set(PREMIUM_GOAL_POOL) >= set(FREE_GOAL_POOL)
    assert PREMIUM_GOAL_POOL is not FREE_GOAL_POOL


@pytest.mark.parametrize("game", sorted(PREMIUM_GOAL_POOL))
def test_each_game_has_easy_medium_hard_goals(game: str) -> None:
    goals = PREMIUM_GOAL_POOL[game]
    assert [g.tier for g in goals] == list(TIERS)
    assert all(g.game_type == game for g in goals)
    assert len({g.id for g in goals}) == 3
    for g in goals:
        assert g.kind and not g.kind.startswith("_")
        assert g.target is None or g.target > 0


@pytest.mark.parametrize("game", sorted(PREMIUM_GOAL_POOL))
def test_every_games_easy_goal_needs_no_win(game: str) -> None:
    # The one-win rule falls back to the easy goal, so it must be winnable by anyone.
    assert PREMIUM_GOAL_POOL[game][0].is_win is False


# The luck-dependent goals, spelled out so a new one is a deliberate edit here.
_LUCK_DEPENDENT = {
    "daily_word:won",
    "daily_word:won_guesses_used_at_most:4",
    "solitaire:won",
    "solitaire:won_moves_at_most:120",
    "freecell:won",
    "freecell:won_moves_at_most:100",
}


def test_luck_dependent_flag_is_exactly_the_listed_goals() -> None:
    flagged = {g.id for goals in PREMIUM_GOAL_POOL.values() for g in goals if g.is_win}
    assert flagged == _LUCK_DEPENDENT


def test_win_required_goals_need_a_win_and_progress_goals_do_not() -> None:
    for goals in PREMIUM_GOAL_POOL.values():
        for g in goals:
            if g.kind.startswith("won"):
                assert not g.evaluate({"won": False, "moves": 1, "pairs": 99, "duration_ms": 1})
            if g.kind.endswith("_at_least"):
                assert g.measure is not None and g.kind == f"{g.measure}_at_least"


@pytest.mark.parametrize("slate", _SLATES)
def test_every_neighbouring_pair_occurs_so_the_rotation_length_stays_odd(slate: str) -> None:
    # Step-of-two pairs only reach every position when the rotation length is odd.
    order = rotation(slate, 0)
    assert len(order) % 2 == 1, "even rotation halves the pairs — revisit pick_games"
    pairs = {frozenset(pick_games(d, slate, 0)) for d in _days(len(order) * 2)}
    assert len(pairs) == len(order)


def test_win_limits_are_above_the_physical_minimum() -> None:
    # A win is impossible below these, so a goal under them could never be met.
    minimum = {
        ("solitaire", "won_moves_at_most"): 52,  # 52 cards to the foundations
        ("freecell", "won_moves_at_most"): 52,
        ("daily_word", "won_guesses_used_at_most"): 1,
    }
    for goals in PREMIUM_GOAL_POOL.values():
        for g in goals:
            floor = minimum.get((g.game_type, g.kind))
            if floor is not None:
                assert g.target is not None and g.target > floor, g.id


def test_highest_tile_target_is_a_reachable_power_of_two() -> None:
    goal = next(g for g in FREE_GOAL_POOL["twenty48"] if g.kind == "highest_tile_at_least")
    assert goal.target is not None
    assert 2 <= goal.target <= 2048 and goal.target & (goal.target - 1) == 0


# ---------------------------------------------------------------------------
# goal evaluation — no DB
# ---------------------------------------------------------------------------

_EASY, _MEDIUM, _HARD = 0, 1, 2

# (game, tier, facts, expected) — every free game's three tiers, both sides of
# the line. Abandoned games report `won: False` plus progress, so no outcome here.
_EVALUATION_CASES = [
    # daily_word
    ("daily_word", _EASY, {"is_complete": True, "won": False}, True),
    ("daily_word", _EASY, {"is_complete": False}, False),
    ("daily_word", _MEDIUM, {"is_complete": True, "won": True, "guesses_used": 6}, True),
    ("daily_word", _MEDIUM, {"is_complete": True, "won": False, "guesses_used": 6}, False),
    ("daily_word", _HARD, {"won": True, "guesses_used": 4}, True),
    ("daily_word", _HARD, {"won": True, "guesses_used": 5}, False),
    ("daily_word", _HARD, {"won": False, "guesses_used": 2}, False),
    ("daily_word", _HARD, {"won": True}, False),
    # twenty48 — final_score / highest_tile, abandoned or not
    ("twenty48", _EASY, {"final_score": 500}, True),
    ("twenty48", _EASY, {"final_score": 499}, False),
    ("twenty48", _MEDIUM, {"highest_tile": 512, "final_score": 100}, True),
    ("twenty48", _MEDIUM, {"highest_tile": 256, "final_score": 9000}, False),
    ("twenty48", _HARD, {"final_score": 2500}, True),
    ("twenty48", _HARD, {"final_score": 2499}, False),
    # solitaire
    ("solitaire", _EASY, {"won": False, "moves": 10}, True),
    ("solitaire", _EASY, {"won": False, "moves": 9}, False),
    ("solitaire", _MEDIUM, {"won": True, "moves": 300}, True),
    ("solitaire", _MEDIUM, {"won": False, "moves": 300}, False),
    ("solitaire", _HARD, {"won": True, "moves": 120}, True),
    ("solitaire", _HARD, {"won": True, "moves": 121}, False),
    ("solitaire", _HARD, {"won": False, "moves": 20}, False),
    # sort — final_score = level reached (pour puzzle, 20 levels)
    ("sort", _EASY, {"final_score": 3}, True),
    ("sort", _EASY, {"final_score": 2}, False),
    ("sort", _MEDIUM, {"final_score": 8}, True),
    ("sort", _MEDIUM, {"final_score": 7}, False),
    ("sort", _HARD, {"final_score": 15}, True),
    ("sort", _HARD, {"final_score": 14}, False),
    # freecell
    ("freecell", _EASY, {"won": False, "moves": 5}, True),
    ("freecell", _EASY, {"won": False, "moves": 4}, False),
    ("freecell", _MEDIUM, {"won": True, "moves": 200}, True),
    ("freecell", _MEDIUM, {"won": False, "moves": 200}, False),
    ("freecell", _HARD, {"won": True, "moves": 100}, True),
    ("freecell", _HARD, {"won": True, "moves": 101}, False),
    # yacht — final_score only, abandoned or not
    ("yacht", _EASY, {"final_score": 100}, True),
    ("yacht", _EASY, {"final_score": 99}, False),
    ("yacht", _MEDIUM, {"final_score": 175}, True),
    ("yacht", _MEDIUM, {"final_score": 174}, False),
    ("yacht", _HARD, {"final_score": 250}, True),
    ("yacht", _HARD, {"final_score": 249, "won": True}, False),
    # blackjack — premium, pending #2458 (PENDING_PREMIUM_GOALS)
    ("blackjack", _EASY, {"hands_played": 3, "hands_won": 0}, True),
    ("blackjack", _EASY, {"hands_played": 2}, False),
    ("blackjack", _MEDIUM, {"starting_chips": 1000, "final_chips": 1001}, True),
    ("blackjack", _MEDIUM, {"starting_chips": 1000, "final_chips": 1000}, False),
    ("blackjack", _MEDIUM, {"final_chips": 1500}, False),
    ("blackjack", _HARD, {"hands_won": 3}, True),
    ("blackjack", _HARD, {"hands_won": 2}, False),
    # mahjong — premium, pending #2458 (PENDING_PREMIUM_GOALS); duration_ms comes from the column
    ("mahjong", _EASY, {"won": False, "pairs": 10}, True),
    ("mahjong", _EASY, {"won": False, "pairs": 9}, False),
    ("mahjong", _MEDIUM, {"won": True, "pairs": 72}, True),
    ("mahjong", _MEDIUM, {"won": False, "pairs": 60}, False),
    ("mahjong", _HARD, {"won": True, "pairs": 72, "duration_ms": 480_000}, True),
    ("mahjong", _HARD, {"won": True, "pairs": 72, "duration_ms": 480_001}, False),
    ("mahjong", _HARD, {"won": False, "pairs": 40, "duration_ms": 1_000}, False),
]


@pytest.mark.parametrize(
    "game,tier,facts,expected",
    _EVALUATION_CASES,
    ids=lambda v: v if isinstance(v, str) else None,
)
def test_goal_evaluation_per_game_and_tier(
    game: str, tier: int, facts: dict, expected: bool
) -> None:
    goals = {**FREE_GOAL_POOL, **PENDING_PREMIUM_GOALS}
    assert goals[game][tier].evaluate(facts) is expected


def test_every_free_game_tier_is_covered_both_ways() -> None:
    covered = {(g, t, e) for g, t, _, e in _EVALUATION_CASES}
    for game in FREE_GOAL_POOL:
        for tier in (_EASY, _MEDIUM, _HARD):
            assert (game, tier, True) in covered and (game, tier, False) in covered


def test_a_bool_is_not_a_number() -> None:
    # `won: true` / a stray flag must not satisfy a numeric threshold as the number 1.
    goal = _at_least("solitaire", "moves", 1, "easy")
    assert not goal.evaluate({"moves": True})
    assert goal.evaluate({"moves": 1})
    assert not goal.evaluate({"moves": "12"})


def test_evaluation_never_reads_outcome() -> None:
    goal = FREE_GOAL_POOL["solitaire"][_MEDIUM]
    assert not goal.evaluate({"outcome": "completed", "won": False})
    assert goal.evaluate({"outcome": "abandoned", "won": True})


def test_game_facts_columns_win_and_missing_columns_do_not_erase() -> None:
    meta = {"won": True, "final_score": 1, "duration_ms": 2, "difficulty": "hard"}
    assert game_facts(meta, 900, 3000) == {
        "won": True,
        "final_score": 900,
        "duration_ms": 3000,
        "difficulty": "hard",
    }
    assert game_facts(meta, None, None)["final_score"] == 1
    assert game_facts(None, None, None) == {}
    assert meta["final_score"] == 1, "input is not mutated"


def test_a_goal_is_met_by_any_one_game_not_a_sum() -> None:
    goal = FREE_GOAL_POOL["twenty48"][_HARD]  # final_score >= 2500
    ended = [("twenty48", {"final_score": 1500}), ("twenty48", {"final_score": 1500})]
    assert not evaluate_goal(goal, ended).completed
    ended.append(("twenty48", {"final_score": 2600}))
    status = evaluate_goal(goal, ended)
    assert status.completed and status.best_score == 2600


def test_service_ignores_other_games_and_reports_best_score_only_for_score_goals() -> None:
    score = FREE_GOAL_POOL["twenty48"][_EASY]
    win = PENDING_PREMIUM_GOALS["mahjong"][_MEDIUM]
    ended = [("mahjong", {"won": True, "final_score": 9999}), ("twenty48", {"final_score": 200})]
    assert not evaluate_goal(score, ended).completed
    assert evaluate_goal(score, ended).best_score == 200
    won = evaluate_goal(win, ended)
    assert won.completed and won.best_score is None
    assert evaluate_goal(score, []).best_score is None


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

needs_db = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping live API tests",
)

_SCORE_2500 = FREE_GOAL_POOL["twenty48"][_HARD]  # final_score >= 2500
_SORT_MEDIUM = FREE_GOAL_POOL["sort"][_MEDIUM]  # final_score >= 8
_FIXED = Template("fixed_for_tests", (_SCORE_2500, _SORT_MEDIUM))


@pytest.fixture()
def client() -> Iterator[TestClient]:
    assert is_configured()
    from main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def fixed_template(monkeypatch: pytest.MonkeyPatch) -> Template:
    """Pin today's template so the tests do not depend on the calendar."""
    monkeypatch.setattr("daily_challenge.service.template_for", lambda _day, _slate="free": _FIXED)
    monkeypatch.setattr("daily_challenge.router.template_for", lambda _day, _slate="free": _FIXED)
    return _FIXED


def _headers(sid: str) -> dict[str, str]:
    return {"X-Session-ID": sid, "Content-Type": "application/json"}


def _play(
    client: TestClient,
    sid: str,
    *,
    game_type: str,
    final_score: int | None,
    outcome: str = "completed",
    result: dict | None = None,
) -> None:
    r = client.post("/games", headers=_headers(sid), json={"game_type": game_type})
    assert r.status_code == 200, r.text
    r = client.patch(
        f"/games/{r.json()['id']}/complete",
        headers=_headers(sid),
        json={
            "final_score": final_score,
            "outcome": outcome,
            "duration_ms": 1000,
            "result": result or {},
        },
    )
    assert r.status_code == 200, r.text


async def _insert_finished_game(sid: str, *, game_type: str, completed_at: datetime) -> None:
    """Write a finished game with an exact ``completed_at`` (the API validates client clocks)."""
    factory = get_session_factory()
    async with factory() as db:
        gt_id = (
            await db.execute(select(GameType.id).where(GameType.name == game_type))
        ).scalar_one()
        db.add(
            Game(
                session_id=sid,
                game_type_id=gt_id,
                started_at=completed_at - timedelta(minutes=5),
                completed_at=completed_at,
                final_score=100,
                outcome="completed",
                game_metadata={"won": True, "pairs": 72},
            )
        )
        await db.commit()


def _goals_by_id(body: dict) -> dict[str, dict]:
    return {g["id"]: g for g in body["goals"]}


@needs_db
def test_today_is_public_and_describes_the_goals(client: TestClient) -> None:
    r = client.get("/daily-challenge/today")
    assert r.status_code == 200, r.text
    body = r.json()
    today = local_day(0)
    assert body["challenge_id"] == today.date.isoformat()
    assert body["template_id"] == template_for(today.date).id
    assert datetime.fromisoformat(body["resets_at"].replace("Z", "+00:00")) == today.end_utc
    assert len(body["goals"]) == GOALS_PER_DAY
    assert body["goals"][0]["game_type"] == ALWAYS_PRESENT
    for goal in body["goals"]:
        assert set(goal) == {"id", "game_type", "kind", "target"}
        assert goal["game_type"] in FREE_GOAL_POOL


@needs_db
def test_today_follows_the_client_timezone(client: TestClient) -> None:
    east = client.get("/daily-challenge/today", params={"tz_offset_minutes": 840}).json()
    west = client.get("/daily-challenge/today", params={"tz_offset_minutes": -840}).json()
    # 28 hours apart — never the same calendar day.
    assert east["challenge_id"] != west["challenge_id"]
    assert east["challenge_id"] == local_day(840).date.isoformat()


@needs_db
@pytest.mark.parametrize("path", ["/daily-challenge/today", "/daily-challenge/status"])
def test_rejects_out_of_range_timezone(client: TestClient, path: str) -> None:
    r = client.get(path, headers=_headers(str(uuid.uuid4())), params={"tz_offset_minutes": 900})
    assert r.status_code == 422


@needs_db
def test_status_requires_a_session(client: TestClient) -> None:
    assert client.get("/daily-challenge/status").status_code == 400
    r = client.get("/daily-challenge/status", headers={"X-Session-ID": "not-a-uuid"})
    assert r.status_code == 400


@needs_db
def test_status_for_a_fresh_session(client: TestClient, fixed_template: Template) -> None:
    body = client.get("/daily-challenge/status", headers=_headers(str(uuid.uuid4()))).json()
    today = client.get("/daily-challenge/today").json()
    assert body["challenge_id"] == today["challenge_id"]
    assert body["template_id"] == today["template_id"] == fixed_template.id
    assert [g["id"] for g in body["goals"]] == [g["id"] for g in today["goals"]]
    assert body["completed_goals"] == 0
    assert body["total_goals"] == 2
    assert body["completed"] is False
    assert all(g["completed"] is False and g["best_score"] is None for g in body["goals"])


@needs_db
def test_finishing_the_games_completes_the_challenge(
    client: TestClient, fixed_template: Template
) -> None:
    sid = str(uuid.uuid4())

    _play(client, sid, game_type="twenty48", final_score=1200)
    body = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    goals = _goals_by_id(body)
    assert goals[_SCORE_2500.id]["completed"] is False
    assert goals[_SCORE_2500.id]["best_score"] == 1200
    assert body["completed_goals"] == 0

    _play(client, sid, game_type="twenty48", final_score=2600)
    body = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    assert _goals_by_id(body)[_SCORE_2500.id] == {
        "id": _SCORE_2500.id,
        "game_type": "twenty48",
        "kind": "final_score_at_least",
        "target": 2500,
        "completed": True,
        "best_score": 2600,
    }
    assert body["completed_goals"] == 1
    assert body["completed"] is False

    _play(client, sid, game_type="sort", final_score=10)
    body = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    assert body["completed_goals"] == 2
    assert body["completed"] is True


@needs_db
def test_abandoned_and_unfinished_games_do_not_count(
    client: TestClient, fixed_template: Template
) -> None:
    sid = str(uuid.uuid4())
    _play(
        client,
        sid,
        game_type="sort",
        final_score=0,
        outcome="abandoned",
    )
    _play(client, sid, game_type="twenty48", final_score=None, outcome="abandoned")
    for game_type in ("sort", "twenty48"):
        r = client.post("/games", headers=_headers(sid), json={"game_type": game_type})
        assert r.status_code == 200  # started, never finished

    body = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    assert body["completed_goals"] == 0
    assert _goals_by_id(body)[_SCORE_2500.id]["best_score"] is None


@needs_db
def test_an_abandoned_game_satisfies_no_goal(client: TestClient, fixed_template: Template) -> None:
    """The challenge is an accomplishment, so quitting earns nothing (#2468/#2472).

    Both rows carry genuine progress — a 9,000-point Twenty48 run and a
    level-10 Sort run — well past either goal's threshold if it counted.
    """
    sid = str(uuid.uuid4())
    _play(client, sid, game_type="twenty48", final_score=9000, outcome="abandoned")
    _play(
        client,
        sid,
        game_type="sort",
        final_score=10,
        outcome="abandoned",
    )
    goals = _goals_by_id(client.get("/daily-challenge/status", headers=_headers(sid)).json())
    assert goals[_SCORE_2500.id]["completed"] is False
    assert goals[_SCORE_2500.id]["best_score"] is None
    assert goals[_SORT_MEDIUM.id]["completed"] is False


@needs_db
def test_the_same_score_counts_when_the_game_is_finished(
    client: TestClient, fixed_template: Template
) -> None:
    """Mirror of the test above — the filter keys on outcome, not on the score."""
    sid = str(uuid.uuid4())
    _play(client, sid, game_type="twenty48", final_score=9000, outcome="completed")
    goals = _goals_by_id(client.get("/daily-challenge/status", headers=_headers(sid)).json())
    assert goals[_SCORE_2500.id]["completed"] is True
    assert goals[_SCORE_2500.id]["best_score"] == 9000


@needs_db
def test_kept_playing_twenty48_counts(client: TestClient, fixed_template: Template) -> None:
    sid = str(uuid.uuid4())
    _play(client, sid, game_type="twenty48", final_score=20000, outcome="kept_playing")
    body = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    assert _goals_by_id(body)[_SCORE_2500.id]["completed"] is True


_TILE_512 = FREE_GOAL_POOL["twenty48"][_MEDIUM]  # highest_tile >= 512


@needs_db
@pytest.mark.parametrize("outcome", ["completed", "kept_playing"])
def test_twenty48_tile_goal_reads_the_validated_result(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, outcome: str
) -> None:
    """Twenty48's result block is validated since #2623; the goals still read it.

    The body is ``endedPayload`` from ``Twenty48Screen.tsx``: ``highest_tile``
    reaches the goal only through ``games.metadata``, so a result model that
    dropped it would silently break the medium goal.
    """
    template = Template("twenty48_tile_for_tests", (_TILE_512, _SCORE_2500))
    monkeypatch.setattr("daily_challenge.service.template_for", lambda _d, _s="free": template)
    monkeypatch.setattr("daily_challenge.router.template_for", lambda _d, _s="free": template)
    sid = str(uuid.uuid4())

    ended = {"final_score": 1800, "highest_tile": 256, "move_count": 150, "duration_ms": 1000}
    _play(
        client,
        sid,
        game_type="twenty48",
        final_score=1800,
        outcome=outcome,
        result={**ended, "outcome": outcome},
    )
    goals = _goals_by_id(client.get("/daily-challenge/status", headers=_headers(sid)).json())
    assert goals[_TILE_512.id]["completed"] is False
    assert goals[_SCORE_2500.id]["best_score"] == 1800

    ended = {**ended, "final_score": 3000, "highest_tile": 512}
    _play(
        client,
        sid,
        game_type="twenty48",
        final_score=3000,
        outcome=outcome,
        result={**ended, "outcome": outcome},
    )
    goals = _goals_by_id(client.get("/daily-challenge/status", headers=_headers(sid)).json())
    assert goals[_TILE_512.id]["completed"] is True
    assert goals[_SCORE_2500.id]["completed"] is True
    assert goals[_SCORE_2500.id]["best_score"] == 3000


@needs_db
def test_other_sessions_and_other_games_do_not_count(
    client: TestClient, fixed_template: Template
) -> None:
    sid, other = str(uuid.uuid4()), str(uuid.uuid4())
    _play(client, other, game_type="sort", final_score=10)
    _play(client, sid, game_type="solitaire", final_score=500, result={"won": True, "moves": 90})
    body = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    assert body["completed_goals"] == 0


@needs_db
async def test_only_games_inside_the_local_day_count(fixed_template: Template) -> None:
    now = datetime(2026, 10, 9, 12, 0, tzinfo=timezone.utc)
    day = local_day(-420, now)  # 07:00 UTC Oct 9 → 07:00 UTC Oct 10
    factory = get_session_factory()

    async def completed_goals(sid: str) -> int:
        async with factory() as db:
            status = await service.get_status_for_session(
                db, session_id=sid, tz_offset_minutes=-420, utc_now=now
            )
        return status.completed_goals

    before, first, last, after = (str(uuid.uuid4()) for _ in range(4))
    await _insert_finished_game(
        before, game_type="sort", completed_at=day.start_utc - timedelta(seconds=1)
    )
    await _insert_finished_game(first, game_type="sort", completed_at=day.start_utc)
    await _insert_finished_game(
        last, game_type="sort", completed_at=day.end_utc - timedelta(seconds=1)
    )
    await _insert_finished_game(after, game_type="sort", completed_at=day.end_utc)

    assert await completed_goals(before) == 0
    assert await completed_goals(first) == 1
    assert await completed_goals(last) == 1
    assert await completed_goals(after) == 0


# ---------------------------------------------------------------------------
# slate resolution (#2454)
# ---------------------------------------------------------------------------

# A premium-slate day that names one free game (yacht) and one real premium game
# (starswarm) — patched in, because until #2458 the real premium pool holds only
# free games. Only the premium one actually counts (resolve_slate filters named
# games to is_premium=True), so yacht is a harmless decoy.
_PREMIUM_DAY = Template(
    "premium_for_tests",
    (
        FREE_GOAL_POOL["daily_word"][_EASY],
        _at_least("yacht", "score", 1, "easy"),
        _at_least("starswarm", "errors", 0, "easy"),
    ),
)
_DAY = date(2026, 10, 9)


@pytest.fixture()
def two_slates(monkeypatch: pytest.MonkeyPatch) -> Template:
    # A shell that exports the dev override must not change what these assert.
    monkeypatch.delenv("ENTITLEMENT_DEV_OVERRIDE", raising=False)

    def pick(_day: date, slate: str = "free") -> Template:
        return _PREMIUM_DAY if slate == "premium" else _FIXED

    monkeypatch.setattr("daily_challenge.service.template_for", pick)
    monkeypatch.setattr("daily_challenge.router.template_for", pick)
    return _PREMIUM_DAY


async def _grant(sid: str, *slugs: str) -> None:
    factory = get_session_factory()
    async with factory() as db:
        db.add_all([GameEntitlement(session_id=sid, game_slug=slug) for slug in slugs])
        await db.commit()


async def _slate(sid: str, day: date = _DAY) -> str:
    factory = get_session_factory()
    async with factory() as db:
        return await service.resolve_slate(db, sid, day)


@needs_db
async def test_free_session_gets_the_free_slate(two_slates: Template) -> None:
    assert await _slate(str(uuid.uuid4())) == "free"


@needs_db
async def test_partly_entitled_session_gets_the_free_slate(two_slates: Template) -> None:
    # Owns yacht but not starswarm: the premium day names both, so it would hand
    # this session a goal in a game it cannot open.
    sid = str(uuid.uuid4())
    await _grant(sid, "yacht")
    assert await _slate(sid) == "free"


@needs_db
async def test_fully_entitled_session_gets_the_premium_slate(two_slates: Template) -> None:
    sid = str(uuid.uuid4())
    await _grant(sid, "yacht", "starswarm")
    assert await _slate(sid) == "premium"


@needs_db
async def test_entitlement_to_other_premium_games_does_not_unlock_it(two_slates: Template) -> None:
    sid = str(uuid.uuid4())
    await _grant(sid, "cascade", "hearts")  # premium, but not the ones named
    assert await _slate(sid) == "free"


@needs_db
async def test_dev_override_session_is_always_premium_eligible(
    two_slates: Template, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ENTITLEMENT_DEV_OVERRIDE", "true")
    assert await _slate(str(uuid.uuid4())) == "premium"  # no entitlement rows at all


@needs_db
async def test_a_premium_day_naming_no_premium_game_is_the_free_slate() -> None:
    # Real pools: until #2458 the premium pool holds only free games, so even a
    # session that owns every premium game has nothing to unlock.
    sid = str(uuid.uuid4())
    await _grant(sid, *_ALL_PREMIUM_SLUGS)
    assert await _slate(sid) == "free"
    assert template_for(_DAY, "premium") == template_for(_DAY, "free")


@needs_db
async def test_slate_tests_run_against_the_expected_premium_seed() -> None:
    # The slate tests read real game_types rows — fail loudly, and here, if the
    # seed the migrations produce ever stops matching what they assume.
    factory = get_session_factory()
    async with factory() as db:
        premium = set(
            (await db.execute(select(GameType.name).where(GameType.is_premium.is_(True)))).scalars()
        )
    assert {"blackjack", "cascade", "hearts", "starswarm", "mahjong"} <= premium
    assert "yacht" not in premium
    assert "sudoku" not in premium


@needs_db
async def test_override_follows_the_same_rule_as_production(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Real pools: nothing premium is named, so the override changes nothing — dev
    # must not report "premium" while production would say "free".
    monkeypatch.setenv("ENTITLEMENT_DEV_OVERRIDE", "true")
    assert await _slate(str(uuid.uuid4())) == "free"


@needs_db
async def test_a_differing_premium_template_naming_only_free_games_is_free(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    only_free = Template("premium_free_games_only", (*_FIXED.goals, _FIXED.goals[0]))

    def pick(_day: date, slate: str = "free") -> Template:
        return only_free if slate == "premium" else _FIXED

    monkeypatch.setattr("daily_challenge.service.template_for", pick)
    monkeypatch.delenv("ENTITLEMENT_DEV_OVERRIDE", raising=False)
    assert await _slate(str(uuid.uuid4())) == "free"
    monkeypatch.setenv("ENTITLEMENT_DEV_OVERRIDE", "true")
    assert await _slate(str(uuid.uuid4())) == "free"  # the override does not skip the rule


@needs_db
async def test_identical_templates_skip_the_query() -> None:
    statements: list[str] = []
    factory = get_session_factory()
    async with factory() as db:
        engine = db.sync_session.get_bind()

        def record(_conn, _cursor, statement, *_rest) -> None:
            statements.append(statement)

        event.listen(engine, "before_cursor_execute", record)
        try:
            assert await service.resolve_slate(db, str(uuid.uuid4()), _DAY) == "free"
        finally:
            event.remove(engine, "before_cursor_execute", record)
    assert statements == [], "the slate is moot when the templates match — no round trip"


@needs_db
async def test_a_mid_day_entitlement_change_swaps_the_challenge(two_slates: Template) -> None:
    # Slate is resolved live and nothing pins it, so buying the last premium game a
    # premium day names switches the next /status to the premium template. Pinned
    # here so the behaviour is deliberate, not an accident.
    sid = str(uuid.uuid4())
    await _grant(sid, "yacht")
    assert await _slate(sid) == "free"
    await _grant(sid, "starswarm")
    assert await _slate(sid) == "premium"


@needs_db
async def test_slate_resolution_is_one_statement(two_slates: Template) -> None:
    sid = str(uuid.uuid4())
    await _grant(sid, "yacht")
    statements: list[str] = []
    factory = get_session_factory()
    async with factory() as db:
        engine = db.sync_session.get_bind()

        def record(_conn, _cursor, statement, *_rest) -> None:
            statements.append(statement)

        event.listen(engine, "before_cursor_execute", record)
        try:
            await service.resolve_slate(db, sid, _DAY)
        finally:
            event.remove(engine, "before_cursor_execute", record)
    assert len(statements) == 1, statements


@needs_db
async def test_status_reports_and_uses_the_resolved_slate(two_slates: Template) -> None:
    now = datetime(2026, 10, 9, 12, 0, tzinfo=timezone.utc)
    free, entitled = str(uuid.uuid4()), str(uuid.uuid4())
    await _grant(entitled, "yacht", "starswarm")
    factory = get_session_factory()
    async with factory() as db:
        free_status = await service.get_status_for_session(
            db, session_id=free, tz_offset_minutes=0, utc_now=now
        )
        premium_status = await service.get_status_for_session(
            db, session_id=entitled, tz_offset_minutes=0, utc_now=now
        )
    assert (free_status.slate, free_status.template) == ("free", _FIXED)
    assert (premium_status.slate, premium_status.template) == ("premium", _PREMIUM_DAY)


@needs_db
def test_today_is_always_free_and_never_resolves_a_slate(
    client: TestClient, two_slates: Template, monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(*_a, **_k):
        raise AssertionError("/today must not resolve a slate")

    monkeypatch.setattr("daily_challenge.service.resolve_slate", boom)
    body = client.get("/daily-challenge/today").json()
    assert body["template_id"] == _FIXED.id  # the free template, never the premium one


@needs_db
def test_status_for_a_premium_session_differs_from_today(
    client: TestClient, two_slates: Template, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Router wiring only — the DB-level slate rules are covered by the async tests
    # above (mixing their event loop with TestClient's would not be portable).
    async def premium(*_a, **_k) -> str:
        return "premium"

    monkeypatch.setattr("daily_challenge.service.resolve_slate", premium)
    today = client.get("/daily-challenge/today").json()
    status = client.get("/daily-challenge/status", headers=_headers(str(uuid.uuid4()))).json()
    assert today["template_id"] == _FIXED.id
    assert status["template_id"] == _PREMIUM_DAY.id
    assert [g["id"] for g in status["goals"]] != [g["id"] for g in today["goals"]]
    assert {g["game_type"] for g in status["goals"]} >= {"yacht", "starswarm"}


@needs_db
def test_status_for_a_free_session_matches_today(client: TestClient, two_slates: Template) -> None:
    status = client.get("/daily-challenge/status", headers=_headers(str(uuid.uuid4()))).json()
    today = client.get("/daily-challenge/today").json()
    assert status["template_id"] == today["template_id"]
    assert [g["id"] for g in status["goals"]] == [g["id"] for g in today["goals"]]


@needs_db
async def test_goal_pools_agree_with_the_games_table() -> None:
    # The pools are static spec tables; which games are premium is a database fact
    # that can change. Fail here (in CI) if they drift, rather than hand a free
    # player a goal in a game they cannot open.
    factory = get_session_factory()
    async with factory() as db:
        premium = set(
            (await db.execute(select(GameType.name).where(GameType.is_premium.is_(True)))).scalars()
        )
    assert set(FREE_GOAL_POOL).isdisjoint(premium)
