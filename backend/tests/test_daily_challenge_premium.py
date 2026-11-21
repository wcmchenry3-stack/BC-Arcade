"""Daily Challenge goals for the premium games (#3996): Blackjack, Cascade, Hearts,
Mahjong and Star Swarm, through the personal-pick framework (``personal.GAME_SPECS``).

Pure tests first (specs, targets, evaluation against the facts each game's result model
writes), then DB tests: eligibility (a free install never gets one), the real
completion path (does a normal end record what its goal reads?), the status query and
the streak.
"""

from __future__ import annotations

import json
import os
import uuid
from collections.abc import Iterable
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from blackjack.models import BlackjackResult
from cascade.models import CascadeResult
from daily_challenge import personal, service
from daily_challenge.assignments import decode_goals, encode_goals
from daily_challenge.definitions import (
    FREE_GOAL_POOL,
    GOAL_POOLS,
    PREMIUM_GOAL_POOL,
    Goal,
    game_facts,
    goal_from_spec,
    goal_to_spec,
    local_day,
)
from daily_challenge.history import InstallHistory, PastGame
from daily_challenge.personal import GAME_SPECS, choose_core, options_for, personal_target
from daily_challenge.service import evaluate_goal
from daily_challenge.streak import compute_streak
from db.base import get_session_factory
from db.models import DailyChallengeAssignment, Game, GameEntitlement, GameType
from entitlements.service import ALL_PREMIUM_SLUGS
from hearts.models import HeartsResult
from mahjong.models import MahjongResult
from starswarm.models import StarSwarmResult
from tests._helpers import session_headers as _headers
from tests._helpers import set_dev_override

needs_db = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping premium daily-challenge tests",
)

_LOCALES = Path(__file__).resolve().parents[2] / "frontend/src/i18n/locales"
_DAY = date(2026, 11, 21)
_DW = FREE_GOAL_POOL["daily_word"][0]
_PREMIUM = sorted(ALL_PREMIUM_SLUGS)
_PCT = 12


@pytest.fixture(autouse=True)
def _fresh_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    set_dev_override(monkeypatch, "")
    monkeypatch.setattr(personal, "_settings", None)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _facts(
    model: type,
    block: dict,
    outcome: str | None,
    *,
    final_score: int | None = None,
    duration_ms: int | None = None,
) -> dict:
    """What the Daily Challenge evaluates for a completion: the result model's output as
    ``complete_game`` stores it, plus the ``final_score`` / ``duration_ms`` columns."""
    stored = model.model_validate(
        block,
        context={"final_score": final_score, "outcome": outcome, "duration_ms": duration_ms},
    ).model_dump(exclude_unset=True)
    return game_facts(stored, final_score, duration_ms)


def _bj(outcome: str | None, *, chips: int = 100, final: int = 250) -> dict:
    block = {"hands_won": 4, "hands_played": 9, "starting_chips": chips, "final_chips": final}
    return _facts(BlackjackResult, block, outcome, final_score=final)


def _hearts(outcome: str | None) -> dict:
    block = {"final_score": 60, "vs_result": outcome}
    return _facts(HeartsResult, block, outcome, final_score=60)


def _cascade(outcome: str | None, duration_ms: int = 270_000) -> dict:
    block = {"merge_score": 5000, "max_tier": 11 if outcome == "win" else 6}
    return _facts(CascadeResult, block, outcome, final_score=5000, duration_ms=duration_ms)


def _mahjong(won: bool, duration_ms: int = 600_000) -> dict:
    return _facts(
        MahjongResult, {"won": won, "pairs": 72 if won else 30}, None, duration_ms=duration_ms
    )


def _swarm(outcome: str | None, wave: int = 8, score: int = 5000, **extra) -> dict:
    block = {"outcome": outcome, "wave_reached": wave, "difficulty_tier": "Captain", **extra}
    return _facts(StarSwarmResult, block, outcome, final_score=score)


def _goal(game: str, type_name: str, target: int | None = None) -> Goal:
    return personal.build_goal(GAME_SPECS[game].type(type_name), target)


def _history(day: date, plays: Iterable[tuple[str, date, dict]], pinned=None) -> InstallHistory:
    h = InstallHistory(tz_offset_minutes=0, first_day=day, last_day=day, affinity_window=14)
    ordered = sorted(enumerate(plays), key=lambda p: (p[1][1], p[0]), reverse=True)
    for i, (game, d, facts) in ordered:
        at = datetime(d.year, d.month, d.day, 6, tzinfo=UTC) + timedelta(seconds=i)
        h.games.setdefault(game, []).append(PastGame(game, dict(facts), at, d, True))
        if day - timedelta(days=14) <= d < day:
            counts = h.daily_counts.setdefault(game, {})
            counts[d] = counts.get(d, 0) + 1
    h.pinned = dict(pinned or {})
    return h


def _runs(game: str, facts: list[dict]) -> list[tuple[str, date, dict]]:
    return [(game, _DAY - timedelta(days=1 + i % 5), f) for i, f in enumerate(facts)]


def _ids(game: str, plays: list[tuple[str, date, dict]]) -> list[str]:
    return [o.goal.id for o in options_for(game, _history(_DAY, plays), _DAY, pct=_PCT)]


# ---------------------------------------------------------------------------
# The specs
# ---------------------------------------------------------------------------


def test_every_premium_game_has_a_spec_and_nothing_else_does() -> None:
    assert set(GAME_SPECS) & set(ALL_PREMIUM_SLUGS) == set(ALL_PREMIUM_SLUGS)
    free = set(GAME_SPECS) - set(ALL_PREMIUM_SLUGS)
    assert free == {"twenty48", "solitaire", "freecell", "sudoku", "yacht"}


def test_the_goal_types_per_premium_game() -> None:
    shipped = {game: {t.name: t.kind for t in GAME_SPECS[game].types} for game in _PREMIUM}
    assert shipped == {
        "blackjack": {
            "finish": "completed",
            "win": "won",
            "table": "starting_chips_at_least",
        },
        "cascade": {"finish": "completed", "win": "won", "win_time": "won_duration_ms_at_most"},
        "hearts": {"finish": "completed", "win": "won"},
        "mahjong": {"win": "won", "win_time": "won_duration_ms_at_most"},
        "starswarm": {
            "finish": "completed",
            "wave": "wave_reached_at_least",
            "score": "final_score_at_least",
        },
    }


def test_the_cold_start_goal_per_premium_game() -> None:
    plays = [(g, _DAY - timedelta(days=1), {"won": True}) for g in _PREMIUM]
    got = {g: _ids(g, [p for p in plays if p[0] == g]) for g in _PREMIUM}
    assert got == {
        "blackjack": ["blackjack:completed"],
        "cascade": ["cascade:completed"],
        "hearts": ["hearts:completed"],
        "mahjong": ["mahjong:won"],
        "starswarm": ["starswarm:completed"],
    }
    # Two finished games are still fewer than the three a personal target needs.
    two = _runs("blackjack", [{"starting_chips": 250, "won": True}] * 2)
    assert _ids("blackjack", two) == ["blackjack:completed"]


def test_luck_dependence_blackjack_and_hearts_wins_only() -> None:
    luck = {
        game: {t.name: _goal(game, t.name, 1 if t.personal else None).is_win for t in spec.types}
        for game, spec in GAME_SPECS.items()
        if game in ALL_PREMIUM_SLUGS
    }
    assert luck["blackjack"] == {"finish": False, "win": True, "table": False}
    assert luck["hearts"] == {"finish": False, "win": True}
    assert luck["cascade"] == {"finish": False, "win": False, "win_time": False}
    assert luck["mahjong"] == {"win": False, "win_time": False}
    assert luck["starswarm"] == {"finish": False, "wave": False, "score": False}


def test_a_premium_install_gets_at_most_one_luck_goal_a_day() -> None:
    plays = [
        (game, d, {"won": True, "is_complete": True, "starting_chips": 100})
        for game in ("hearts", "blackjack")
        for d in (_DAY - timedelta(days=n) for n in range(1, 6))
        for _ in range(5)
    ]
    h = _history(_DAY, plays)
    seen_luck = 0
    for i in range(80):
        core = choose_core(h, _DAY, ["hearts", "blackjack"], session_id=f"s{i}")
        assert sum(g.is_win for g in core) <= 1
        seen_luck += sum(g.is_win for g in core)
    assert seen_luck > 0  # the rule was exercised, not dodged


def test_the_shared_template_stays_the_free_pool() -> None:
    # PREMIUM_GOAL_POOL is deliberately the free pool (definitions.py, Slates): a
    # premium game in it would change days resolve_slate already served (#2760).
    assert PREMIUM_GOAL_POOL == FREE_GOAL_POOL and PREMIUM_GOAL_POOL is not FREE_GOAL_POOL
    for pool in GOAL_POOLS.values():
        assert set(pool).isdisjoint(ALL_PREMIUM_SLUGS)


@pytest.mark.parametrize(
    "lang", sorted(p.name for p in _LOCALES.iterdir() if p.is_dir() and p.name != "_meta")
)
def test_every_premium_goal_has_wording_in_every_locale(lang: str) -> None:
    copy = json.loads((_LOCALES / lang / "daily_challenge.json").read_text(encoding="utf-8"))
    for game in _PREMIUM:
        for t in GAME_SPECS[game].types:
            key = f"goal.{game}.{t.kind}"
            assert any(k == key or k.startswith(f"{key}_") for k in copy), (lang, key)


# ---------------------------------------------------------------------------
# Evaluation, against the facts each result model writes
# ---------------------------------------------------------------------------


def test_blackjack_finish_and_win_read_the_outcome() -> None:
    finish, won = _goal("blackjack", "finish"), _goal("blackjack", "win")
    # A run that reached its goal records win, one that ran out of chips records loss.
    assert finish.evaluate(_bj("win")) and won.evaluate(_bj("win"))
    assert finish.evaluate(_bj("loss", final=0)) and not won.evaluate(_bj("loss", final=0))
    # An abandon is neither (the service also filters it); so is a completion with no outcome.
    assert not finish.evaluate(_bj("abandoned")) and not won.evaluate(_bj("abandoned"))
    assert not finish.evaluate(_bj(None)) and not won.evaluate(_bj(None))


def test_blackjack_won_is_never_taken_from_the_app() -> None:
    block = {"hands_won": 1, "starting_chips": 100, "final_chips": 0, "won": True}
    assert _facts(BlackjackResult, block, "loss", final_score=0)["won"] is False
    assert "won" not in _facts(BlackjackResult, block, None, final_score=0)


def test_blackjack_table_goal_reads_the_runs_starting_chips() -> None:
    goal = _goal("blackjack", "table", 250)
    assert goal.id == "blackjack:starting_chips_at_least:250"
    assert goal.evaluate(_bj("loss", chips=250, final=0))  # a loss at the table still finishes
    assert goal.evaluate(_bj("win", chips=500, final=1500))
    assert not goal.evaluate(_bj("win", chips=100))
    # A threshold goal reads no outcome: abandons are filtered by the service (tested below).


def test_cascade_goals() -> None:
    finish, won = _goal("cascade", "finish"), _goal("cascade", "win")
    within = _goal("cascade", "win_time", 300_000)
    assert finish.evaluate(_cascade("win")) and finish.evaluate(_cascade("loss"))
    assert not finish.evaluate(_cascade("abandoned")) and not finish.evaluate(_cascade(None))
    assert won.evaluate(_cascade("win")) and not won.evaluate(_cascade("loss"))
    assert within.evaluate(_cascade("win", 300_000))
    assert not within.evaluate(_cascade("win", 300_001))
    assert not within.evaluate(_cascade("loss", 100_000))  # only a win
    assert not within.evaluate(_cascade("win", 1_000))  # the 20 s win floor


def test_hearts_goals() -> None:
    finish, won = _goal("hearts", "finish"), _goal("hearts", "win")
    assert finish.evaluate(_hearts("win")) and won.evaluate(_hearts("win"))
    assert finish.evaluate(_hearts("loss")) and not won.evaluate(_hearts("loss"))
    # A tie for the lowest score is a finish, not a win.
    assert finish.evaluate(_hearts("push")) and not won.evaluate(_hearts("push"))
    assert not finish.evaluate(_hearts("abandoned")) and not won.evaluate(_hearts("abandoned"))


def test_mahjong_goals() -> None:
    won, within = _goal("mahjong", "win"), _goal("mahjong", "win_time", 480_000)
    assert won.evaluate(_mahjong(True)) and not won.evaluate(_mahjong(False))
    assert within.evaluate(_mahjong(True, 480_000))
    assert not within.evaluate(_mahjong(True, 480_001))
    assert not within.evaluate(_mahjong(False, 100_000))  # a deadlock is no clear


def test_star_swarm_goals() -> None:
    finish = _goal("starswarm", "finish")
    wave, score = _goal("starswarm", "wave", 8), _goal("starswarm", "score", 5000)
    assert finish.evaluate(_swarm("completed"))
    assert not finish.evaluate(_swarm("abandoned"))
    assert wave.evaluate(_swarm("completed", wave=8)) and not wave.evaluate(
        _swarm("completed", wave=7)
    )
    assert score.evaluate(_swarm("completed", score=5000))
    assert not score.evaluate(_swarm("completed", score=4999))
    assert (
        finish.measure is None and wave.measure == "wave_reached" and score.measure == "final_score"
    )


def test_a_star_swarm_run_never_gets_a_won_fact() -> None:
    assert "won" not in _swarm("completed")  # no win concept
    assert _swarm("completed", is_complete=False)["is_complete"] is True  # not the app's word


def test_a_completion_with_no_outcome_writes_no_flags() -> None:
    assert "is_complete" not in _bj(None) and "won" not in _bj(None)
    assert "is_complete" not in _hearts(None) and "won" not in _hearts(None)
    assert "is_complete" not in _cascade(None)
    assert "is_complete" not in _swarm(None)


def test_a_pinned_premium_goal_rebuilds_equal_from_its_spec() -> None:
    for game in _PREMIUM:
        for t in GAME_SPECS[game].types:
            goal = _goal(game, t.name, 2 if t.personal else None)
            assert goal_from_spec(goal_to_spec(goal)) == goal


def test_frozen_days_with_the_old_blackjack_hand_counts_still_rebuild() -> None:
    old = [
        ("blackjack", "hands_played_at_least", 3, "easy", {"hands_played": 3}, True),
        ("blackjack", "hands_played_at_least", 3, "easy", {"hands_played": 2}, False),
        (
            "blackjack",
            "chips_gained",
            None,
            "medium",
            {"starting_chips": 100, "final_chips": 101},
            True,
        ),
        (
            "blackjack",
            "chips_gained",
            None,
            "medium",
            {"starting_chips": 100, "final_chips": 100},
            False,
        ),
        ("blackjack", "hands_won_at_least", 3, "hard", {"hands_won": 3}, True),
        ("blackjack", "hands_won_at_least", 3, "hard", {"hands_won": 2}, False),
    ]
    for game, kind, target, tier, facts, expected in old:
        goal = goal_from_spec({"game_type": game, "kind": kind, "target": target, "tier": tier})
        assert goal.evaluate(facts) is expected
        assert goal_from_spec(goal_to_spec(goal)) == goal
    # …and through the pinned-assignment encoding too.
    goals = tuple(
        goal_from_spec({"game_type": g, "kind": k, "target": t, "tier": ti})
        for g, k, t, ti, *_ in old[::2]
    )
    assert decode_goals(encode_goals(goals)) == goals


# ---------------------------------------------------------------------------
# Targets per measure
# ---------------------------------------------------------------------------


def test_blackjack_table_target_steps_up_one_table_after_a_win() -> None:
    def ids(runs: list[dict]) -> list[str]:
        return _ids("blackjack", _runs("blackjack", runs))

    at100 = {"starting_chips": 100, "won": True, "is_complete": True}
    lost100 = {"starting_chips": 100, "won": False, "is_complete": True}
    at250 = {"starting_chips": 250, "won": True, "is_complete": True}
    at500 = {"starting_chips": 500, "won": True, "is_complete": True}
    tail = "blackjack:starting_chips_at_least:"
    # Usual table Beginner and a win there: one table up.
    assert ids([at100, lost100, lost100])[-1] == tail + "250"
    # No win yet, so the next table may still be locked: the usual table.
    assert ids([lost100, lost100, lost100])[-1] == tail + "100"
    assert ids([at250, at250, at250])[-1] == tail + "500"
    # Already at the top table: it stays.
    assert ids([at500, at500, at500])[-1] == tail + "500"
    # The usual table is the median, not the latest run.
    assert ids([at100, at100, at500])[-1] == tail + "250"
    # Every personal goal type of an experienced player.
    assert ids([at100, at100, at100])[:2] == ["blackjack:completed", "blackjack:won"]


def test_blackjack_table_target_steps_down_after_two_misses() -> None:
    gtype = GAME_SPECS["blackjack"].type("table")
    assert personal_target(gtype, [100, 100, 100], best=100, pct=_PCT) == 250
    assert personal_target(gtype, [100, 100, 100], best=100, pct=_PCT, stepped_down=True) == 100
    assert personal_target(gtype, [100, 100, 100], best=100, pct=_PCT, can_step_up=False) == 100
    assert personal_target(gtype, [250, 250, 100], best=250, pct=_PCT) == 500
    assert personal_target(gtype, [1000, 1000, 1000], best=1000, pct=_PCT) == 500  # no such table


def _wins(durations: list[int], extra: dict | None = None) -> list[dict]:
    return [{"won": True, "duration_ms": d, **(extra or {})} for d in durations]


def test_cascade_time_target_is_the_stretched_median_in_whole_minutes() -> None:
    wins = _wins([240_000, 270_000, 300_000, 330_000, 360_000])
    # median 300 s x 0.88 = 264 s -> 4 min; the best (240 s) is no cap on a limit.
    assert _ids("cascade", _runs("cascade", wins))[-1] == "cascade:won_duration_ms_at_most:240000"
    # Losses are not wins: they never set the time.
    losses = [{"won": False, "duration_ms": 30_000}] * 3
    assert _ids("cascade", _runs("cascade", wins + losses))[-1] == (
        "cascade:won_duration_ms_at_most:240000"
    )
    # Fast players are floored at 2 minutes, and a limit is never below their best.
    fast = _wins([40_000, 45_000, 50_000])
    assert _ids("cascade", _runs("cascade", fast))[-1] == "cascade:won_duration_ms_at_most:120000"
    slow = _wins([600_000, 600_000, 660_000])
    assert _ids("cascade", _runs("cascade", slow))[-1] == "cascade:won_duration_ms_at_most:600000"


def test_cascade_time_goal_needs_three_wins() -> None:
    runs = _wins([300_000, 300_000]) + [{"won": False, "duration_ms": 90_000}]
    assert _ids("cascade", _runs("cascade", runs)) == ["cascade:completed", "cascade:won"]


def test_mahjong_time_target() -> None:
    clears = _wins([600_000, 660_000, 720_000, 780_000, 840_000], {"pairs": 72})
    # median 720 s x 0.88 = 633.6 s -> 11 min, capped below by the fastest clear (10 min).
    assert _ids("mahjong", _runs("mahjong", clears)) == [
        "mahjong:won",
        "mahjong:won_duration_ms_at_most:660000",
    ]
    quick = _wins([100_000, 110_000, 120_000], {"pairs": 72})
    assert _ids("mahjong", _runs("mahjong", quick))[-1] == "mahjong:won_duration_ms_at_most:240000"


def _swarm_run(tier: str | None, wave: int, score: int) -> dict:
    facts = {"wave_reached": wave, "final_score": score, "is_complete": True}
    if tier is not None:
        facts["difficulty_tier"] = tier
    return facts


def test_star_swarm_targets_come_from_the_usual_difficulty_tier() -> None:
    captain = [
        _swarm_run("Captain", w, s)
        for w, s in [(8, 4000), (9, 4500), (10, 5000), (10, 5500), (12, 6000)]
    ]
    ensign = [_swarm_run("Ensign", 30, 90_000)] * 4
    got = _ids("starswarm", _runs("starswarm", captain + ensign))
    # Five Captain runs outnumber four Ensign ones: median wave 10 x 1.12 = 11, median
    # score 5000 x 1.12 = 5600 -> 5500. The Ensign runs set neither target nor cap.
    assert got == [
        "starswarm:completed",
        "starswarm:wave_reached_at_least:11",
        "starswarm:final_score_at_least:5500",
    ]


def test_star_swarm_usual_tier_ties_go_to_the_newest_run_and_a_missing_tier_is_the_default() -> (
    None
):
    captain = _swarm_run("Captain", 9, 4000)
    ensign = _swarm_run("Ensign", 20, 9000)
    tied = [("starswarm", _DAY - timedelta(days=n), captain) for n in (1, 2, 3)]
    tied += [("starswarm", _DAY - timedelta(days=n), ensign) for n in (4, 5, 6)]
    got = _ids("starswarm", tied)
    assert got[1] == "starswarm:wave_reached_at_least:9"  # Captain (the newest of the tie)
    untiered = [_swarm_run(None, 9, 4000)] * 3  # no tier: the default one, still 3 runs
    assert _ids("starswarm", _runs("starswarm", untiered))[1] == (
        "starswarm:wave_reached_at_least:9"
    )
    # Too few runs on the usual tier for a personal target: the finish goal only.
    spread = [_swarm_run(t, 9, 4000) for t in ("Ensign", "Captain", "Admiral", "Ensign")]
    assert _ids("starswarm", _runs("starswarm", spread)) == ["starswarm:completed"]


def test_star_swarm_wave_target_has_a_floor_and_the_best_of_the_tier_caps_it() -> None:
    low = [_swarm_run("Captain", 1, 200)] * 3
    got = _ids("starswarm", _runs("starswarm", low))
    assert got[1] == "starswarm:wave_reached_at_least:3"  # floor
    assert got[2] == "starswarm:final_score_at_least:1000"  # floor
    # The all-tier best score is not the cap for a tiered game.
    runs = [_swarm_run("Captain", 9, 4000)] * 3
    h = _history(_DAY, _runs("starswarm", runs))
    h.best_scores[_DAY] = {"starswarm": 999_999}
    ids = [o.goal.id for o in options_for("starswarm", h, _DAY, pct=_PCT)]
    assert ids[2] == "starswarm:final_score_at_least:4000"


# ---------------------------------------------------------------------------
# DB: eligibility, the real completion path, the status query, the streak
# ---------------------------------------------------------------------------


def _noon(day: date) -> datetime:
    return datetime(day.year, day.month, day.day, 12, tzinfo=UTC)


async def _add(
    sid: str,
    game: str,
    when: datetime,
    *,
    final_score: int | None = None,
    metadata: dict | None = None,
    outcome: str = "completed",
    duration_ms: int | None = None,
) -> None:
    async with get_session_factory()() as db:
        gt_id = (await db.execute(select(GameType.id).where(GameType.name == game))).scalar_one()
        db.add(
            Game(
                session_id=sid,
                game_type_id=gt_id,
                started_at=when - timedelta(minutes=5),
                completed_at=when,
                created_at=when,
                outcome=outcome,
                final_score=final_score,
                duration_ms=duration_ms,
                game_metadata=metadata or {},
            )
        )
        await db.commit()


async def _own(sid: str, *games: str) -> None:
    async with get_session_factory()() as db:
        for game in games:
            db.add(GameEntitlement(session_id=sid, game_slug=game))
        await db.commit()


async def _seed_premium_history(sid: str, today: date) -> None:
    """Two finished runs a day over five days in every premium game (five days of play, so
    the install is not on the shared template: ``InstallHistory.always_pinnable``)."""
    for back in (1, 2, 3, 4, 5):
        when = _noon(today - timedelta(days=back))
        for game in _PREMIUM:
            for _ in range(2):
                await _add(
                    sid,
                    game,
                    when,
                    final_score=5000,
                    duration_ms=300_000,
                    metadata={
                        "won": True,
                        "is_complete": True,
                        "starting_chips": 100,
                        "wave_reached": 9,
                        "difficulty_tier": "Captain",
                    },
                )


@needs_db
async def test_a_free_install_is_never_eligible_for_a_premium_game() -> None:
    async with get_session_factory()() as db:
        eligible = await service.eligible_games(db, str(uuid.uuid4()))
    assert eligible and set(eligible).isdisjoint(ALL_PREMIUM_SLUGS)


@needs_db
async def test_a_free_install_never_gets_a_premium_goal_whatever_its_history() -> None:
    today = local_day(0).date
    for _ in range(3):
        sid = str(uuid.uuid4())
        await _seed_premium_history(sid, today)
        for back in (1, 2, 3, 4, 5):  # free-game play too, so the pick is personal
            await _add(sid, "yacht", _noon(today - timedelta(days=back)), final_score=150)
            await _add(
                sid,
                "sudoku",
                _noon(today - timedelta(days=back)),
                final_score=190,
                metadata={"won": True},
            )
        async with get_session_factory()() as db:
            picked = await service.pick_for_install(db, sid, today)
        games = {g.game_type for g in picked.template.goals}
        assert games.isdisjoint(ALL_PREMIUM_SLUGS), games
        assert games & {"yacht", "sudoku"}


@needs_db
async def test_an_entitled_install_is_eligible_only_for_the_games_it_owns() -> None:
    sid = str(uuid.uuid4())
    await _own(sid, "hearts", "cascade")
    async with get_session_factory()() as db:
        eligible = await service.eligible_games(db, sid)
    assert {"hearts", "cascade"} <= set(eligible)
    assert set(eligible) & set(ALL_PREMIUM_SLUGS) == {"hearts", "cascade"}


@needs_db
async def test_the_dev_override_makes_every_premium_game_eligible(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    set_dev_override(monkeypatch, "true")
    async with get_session_factory()() as db:
        eligible = await service.eligible_games(db, str(uuid.uuid4()))
    assert set(ALL_PREMIUM_SLUGS) <= set(eligible)


@needs_db
async def test_an_entitled_install_with_premium_history_gets_premium_goals() -> None:
    sid = str(uuid.uuid4())
    today = local_day(0).date
    await _own(sid, *_PREMIUM)
    await _seed_premium_history(sid, today)
    async with get_session_factory()() as db:
        picked = await service.pick_for_install(db, sid, today)
    core = picked.template.goals
    assert core[0] == _DW
    assert {g.game_type for g in core[1:]} <= set(ALL_PREMIUM_SLUGS)
    assert len({g.id for g in core}) == 3
    # An install that owns only some games is offered only those.
    other = str(uuid.uuid4())
    await _own(other, "hearts")
    await _seed_premium_history(other, today)
    async with get_session_factory()() as db:
        picked = await service.pick_for_install(db, other, today)
    assert {g.game_type for g in picked.template.goals[1:]} <= {"hearts"}


def _pin(sid: str, day: date, *goals: Goal) -> DailyChallengeAssignment:
    core = (_DW, *goals)
    return DailyChallengeAssignment(
        session_id=uuid.UUID(sid), local_date=day, goals=encode_goals(core)
    )


async def _pin_goals(sid: str, day: date, *goals: Goal) -> None:
    async with get_session_factory()() as db:
        db.add(_pin(sid, day, *goals))
        await db.commit()


def _complete(
    client: TestClient,
    sid: str,
    game: str,
    *,
    outcome: str,
    final_score: int | None = None,
    duration_ms: int = 300_000,
    result: dict | None = None,
) -> None:
    r = client.post("/games", headers=_headers(sid), json={"game_type": game})
    assert r.status_code == 200, r.text
    body = {"outcome": outcome, "duration_ms": duration_ms, "result": result or {}}
    if final_score is not None:
        body["final_score"] = final_score
    r = client.patch(f"/games/{r.json()['id']}/complete", headers=_headers(sid), json=body)
    assert r.status_code == 200, r.text


def _status(client: TestClient, sid: str) -> dict[str, bool]:
    body = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    return {g["id"]: g["completed"] for g in body["goals"]}


@needs_db
async def test_a_blackjack_run_that_reaches_its_goal_records_win_and_meets_its_goals(
    client: TestClient,
) -> None:
    """The normal end the app sends (BlackjackGameContext.endSession): outcome ``win``,
    ``final_score`` = ``final_chips``, and a result with no ``won`` of its own."""
    sid = str(uuid.uuid4())
    today = local_day(0).date
    await _own(sid, "blackjack")
    goals = (
        _goal("blackjack", "finish"),
        _goal("blackjack", "win"),
        _goal("blackjack", "table", 100),
    )
    await _pin_goals(sid, today, *goals)
    assert _status(client, sid) == {g.id: False for g in (_DW, *goals)}

    block = {"hands_won": 11, "hands_played": 20, "starting_chips": 100, "final_chips": 260}
    _complete(client, sid, "blackjack", outcome="win", final_score=260, result=block)
    assert _status(client, sid) == {_DW.id: False, **{g.id: True for g in goals}}
    async with get_session_factory()() as db:
        row = (await db.execute(select(Game).where(Game.session_id == sid))).scalar_one()
    assert row.outcome == "win"
    assert row.game_metadata["won"] is True and row.game_metadata["is_complete"] is True


@needs_db
async def test_a_blackjack_loss_finishes_but_does_not_win_and_an_abandon_counts_for_nothing(
    client: TestClient,
) -> None:
    sid = str(uuid.uuid4())
    today = local_day(0).date
    await _own(sid, "blackjack")
    goals = (
        _goal("blackjack", "finish"),
        _goal("blackjack", "win"),
        _goal("blackjack", "table", 100),
    )
    await _pin_goals(sid, today, *goals)
    lost = {"hands_won": 3, "hands_played": 12, "starting_chips": 100, "final_chips": 0}
    _complete(client, sid, "blackjack", outcome="loss", final_score=0, result=lost)
    status = _status(client, sid)
    assert status[goals[0].id] is True and status[goals[2].id] is True
    assert status[goals[1].id] is False

    other = str(uuid.uuid4())
    await _own(other, "blackjack")
    await _pin_goals(other, today, *goals)
    quit_ = {"hands_won": 5, "hands_played": 8, "starting_chips": 100, "final_chips": 180}
    _complete(client, other, "blackjack", outcome="abandoned", result=quit_)
    assert not any(v for k, v in _status(client, other).items())


@needs_db
async def test_hearts_cascade_mahjong_and_star_swarm_record_what_their_goals_read(
    client: TestClient,
) -> None:
    sid = str(uuid.uuid4())
    today = local_day(0).date
    await _own(sid, *_PREMIUM)
    hearts = (_goal("hearts", "finish"), _goal("hearts", "win"))
    cascade = (
        _goal("cascade", "finish"),
        _goal("cascade", "win"),
        _goal("cascade", "win_time", 300_000),
    )
    mahjong = (_goal("mahjong", "win"), _goal("mahjong", "win_time", 480_000))
    swarm = (
        _goal("starswarm", "finish"),
        _goal("starswarm", "wave", 8),
        _goal("starswarm", "score", 5000),
    )
    # One pinned day holding every goal under test (a status reads whatever is pinned).
    await _pin_goals(sid, today, *hearts, *cascade, *mahjong, *swarm)
    everything = {g.id for g in (*hearts, *cascade, *mahjong, *swarm)}
    assert set(_status(client, sid)) == {_DW.id, *everything}
    assert not any(_status(client, sid).values())

    _complete(
        client,
        sid,
        "hearts",
        outcome="loss",
        final_score=40,
        result={"final_score": 40, "vs_result": "loss"},
    )
    done = {k for k, v in _status(client, sid).items() if v}
    assert done == {"hearts:completed"}

    _complete(
        client,
        sid,
        "cascade",
        outcome="win",
        final_score=5000,
        duration_ms=250_000,
        result={"merge_score": 5000, "max_tier": 11},
    )
    _complete(
        client,
        sid,
        "mahjong",
        outcome="win",
        final_score=None,
        duration_ms=400_000,
        result={"won": True, "pairs": 72},
    )
    _complete(
        client,
        sid,
        "starswarm",
        outcome="completed",
        final_score=6000,
        result={"outcome": "completed", "wave_reached": 9, "difficulty_tier": "Captain"},
    )
    done = {k for k, v in _status(client, sid).items() if v}
    assert done == {
        "hearts:completed",
        "cascade:completed",
        "cascade:won",
        "cascade:won_duration_ms_at_most:300000",
        "mahjong:won",
        "mahjong:won_duration_ms_at_most:480000",
        "starswarm:completed",
        "starswarm:wave_reached_at_least:8",
        "starswarm:final_score_at_least:5000",
    }


@needs_db
async def test_a_hearts_win_is_a_win(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    await _own(sid, "hearts")
    await _pin_goals(sid, local_day(0).date, _goal("hearts", "finish"), _goal("hearts", "win"))
    _complete(
        client,
        sid,
        "hearts",
        outcome="win",
        final_score=80,
        result={"final_score": 80, "vs_result": "win"},
    )
    assert _status(client, sid)["hearts:won"] is True


@needs_db
async def test_a_dev_affected_star_swarm_run_never_meets_a_goal_or_the_streak(
    client: TestClient,
) -> None:
    sid = str(uuid.uuid4())
    today = local_day(0).date
    await _own(sid, "starswarm")
    goals = (_goal("starswarm", "finish"), _goal("starswarm", "score", 1000))
    await _pin_goals(sid, today, *goals)
    flagged = {
        "outcome": "completed",
        "wave_reached": 20,
        "difficulty_tier": "Captain",
        "dev_affected": True,
    }
    _complete(client, sid, "starswarm", outcome="completed", final_score=90_000, result=flagged)
    assert not any(v for k, v in _status(client, sid).items() if k != _DW.id)
    # A clean run does.
    clean = {"outcome": "completed", "wave_reached": 4, "difficulty_tier": "Captain"}
    _complete(client, sid, "starswarm", outcome="completed", final_score=1200, result=clean)
    assert all(v for k, v in _status(client, sid).items() if k != _DW.id)


@needs_db
async def test_the_streak_scores_a_pinned_day_of_premium_goals() -> None:
    sid = str(uuid.uuid4())
    today = local_day(0).date
    goals = (_goal("hearts", "finish"), _goal("cascade", "win"))
    await _pin_goals(sid, today, *goals)
    async with get_session_factory()() as db:
        assert await compute_streak(db, sid, 0) == 0
    await _add(
        sid,
        "hearts",
        _noon(today),
        final_score=50,
        metadata={"won": False, "is_complete": True},
        outcome="loss",
    )
    await _add(
        sid,
        "cascade",
        _noon(today),
        final_score=4000,
        outcome="win",
        metadata={"won": True, "is_complete": True},
    )
    async with get_session_factory()() as db:
        assert await compute_streak(db, sid, 0) == 1
    # …but not on a run the dev panel touched.
    other = str(uuid.uuid4())
    await _pin_goals(other, today, *goals)
    for game, outcome in (("hearts", "loss"), ("cascade", "win")):
        await _add(
            other,
            game,
            _noon(today),
            final_score=50,
            outcome=outcome,
            metadata={"won": True, "is_complete": True, "dev_affected": True},
        )
    async with get_session_factory()() as db:
        assert await compute_streak(db, other, 0) == 0


def test_evaluate_goal_never_counts_an_abandoned_facts_block_for_a_finish() -> None:
    # The service drops abandoned rows before this; the facts also say so.
    finish = _goal("starswarm", "finish")
    assert not evaluate_goal(finish, [("starswarm", _swarm("abandoned"))]).completed
    assert evaluate_goal(finish, [("starswarm", _swarm("completed"))]).completed
