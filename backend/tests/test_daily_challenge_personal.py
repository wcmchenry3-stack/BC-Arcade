"""Per-install daily-challenge picks: personal targets (#3993) and game selection (#3994).

Pure tests build an ``InstallHistory`` by hand (``_history``, which mirrors what
``history.load_install_history`` reads, and ``test_the_loader_reads_what_the_pure_tests_build``
checks that it does). DB tests cover the loader, the new-install rule, the discovery
rest rule, /status integration, the streak and the query count.
"""

from __future__ import annotations

import json
import os
import random
import uuid
from collections import Counter
from collections.abc import Iterable, Sequence
from datetime import UTC, date, datetime, timedelta
from itertools import pairwise
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st
from sqlalchemy import event, select

from daily_challenge import history as history_mod
from daily_challenge import personal, service
from daily_challenge.assignments import Assignment, derived_template_id, encode_goals
from daily_challenge.definitions import (
    ALWAYS_PRESENT,
    FREE_GOAL_POOL,
    SALT,
    Goal,
    Template,
    _at_least,
    _won,
    _won_within,
    goal_from_spec,
    local_day,
    local_day_of,
)
from daily_challenge.history import InstallHistory, PastGame, load_install_history
from daily_challenge.personal import (
    GAME_SPECS,
    choose_core,
    discovery_candidates,
    goal_type_name,
    is_new_install,
    options_for,
    personal_target,
)
from daily_challenge.streak import compute_streak
from db.base import get_engine, get_session_factory
from db.models import DailyChallengeAssignment, Game, GameEntitlement, GameType
from settings import Settings
from tests._helpers import session_headers as _headers
from tests._helpers import set_dev_override

needs_db = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping daily-challenge personal-pick tests",
)

_EN_COPY = Path(__file__).resolve().parents[2] / "frontend/src/i18n/locales/en/daily_challenge.json"
_FREE = sorted(g for g in GAME_SPECS if g in FREE_GOAL_POOL)  # the free games with specs
_DAY = date(2026, 11, 21)
_DW = FREE_GOAL_POOL[ALWAYS_PRESENT][0]


@pytest.fixture(autouse=True)
def _fresh_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    set_dev_override(monkeypatch, "")
    monkeypatch.setattr(personal, "_settings", None)


def _type(game: str, name: str) -> personal.GoalType:
    return GAME_SPECS[game].type(name)


# ---------------------------------------------------------------------------
# A hand-built history (mirrors history.load_install_history)
# ---------------------------------------------------------------------------

Play = tuple[str, date, dict]  # (game, local date, facts)


def _history(
    day: date,
    plays: Iterable[Play],
    pinned: dict[date, Assignment] | None = None,
    *,
    window: int = 14,
) -> InstallHistory:
    h = InstallHistory(tz_offset_minutes=0, first_day=day, last_day=day, affinity_window=window)
    ordered = sorted(enumerate(plays), key=lambda p: (p[1][1], p[0]), reverse=True)
    for i, (game, d, facts) in ordered:
        at = datetime(d.year, d.month, d.day, 6, tzinfo=UTC) + timedelta(seconds=i)
        h.games.setdefault(game, []).append(PastGame(game, dict(facts), at, d, True))
        if day - timedelta(days=window) <= d < day:
            counts = h.daily_counts.setdefault(game, {})
            counts[d] = counts.get(d, 0) + 1
        score = facts.get("final_score")
        if d < day and isinstance(score, int):
            best = h.best_scores.setdefault(day, {})
            best[game] = max(best.get(game, 0), score)
    h.pinned = dict(pinned or {})
    return h


def _days_before(day: date, n: int) -> list[date]:
    return [day - timedelta(days=i) for i in range(1, n + 1)]


def _pin(*goals: Goal) -> Assignment:
    core = (_DW, *goals)
    return Assignment(Template(derived_template_id(core), core))


def _plays(game: str, facts: Sequence[dict], days: Sequence[date]) -> list[Play]:
    return [(game, days[i % len(days)], f) for i, f in enumerate(facts)]


def _score(n: int) -> dict:
    return {"final_score": n}


def _2048(score: int, tile: int) -> dict:
    return {"final_score": score, "highest_tile": tile}


def _win(moves: int) -> dict:
    return {"won": True, "moves": moves, "final_score": moves}


def _core(h: InstallHistory, day: date = _DAY, sid: str = "s", eligible=_FREE, **kw):
    return choose_core(h, day, eligible, session_id=sid, **kw)


# ---------------------------------------------------------------------------
# #3993: the target function
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "game,name,values,best,pct,stepped,expected",
    [
        # 2048 score (at least, unit 50, floor 500): median 1200 x 1.12 = 1344 -> 1350.
        ("twenty48", "score", [1000, 1200, 1400], 1400, 12, False, 1350),
        # Capped at the best (1000): never require beating it.
        ("twenty48", "score", [1000, 1000, 1000], 1000, 12, False, 1000),
        # Floored at the easy tier (500).
        ("twenty48", "score", [100, 200, 300], 300, 12, False, 500),
        # Two misses: the stretch goes the other way, 1200 x 0.88 = 1056 -> 1050.
        ("twenty48", "score", [1000, 1200, 1400], 1400, 12, True, 1050),
        # pct 0: the median itself.
        ("twenty48", "score", [1000, 1200, 1400], 1400, 0, False, 1200),
        # Yacht (unit 5): 160 x 1.12 = 179.2 -> 180.
        ("yacht", "score", [150, 160, 170], 200, 12, False, 180),
        ("yacht", "score", [150, 160, 170], 170, 12, False, 170),
        ("yacht", "score", [40, 50, 60], 60, 12, False, 100),
        # Sudoku (unit 10, floor 100): 190 x 1.12 = 212.8 -> 210.
        ("sudoku", "score", [180, 190, 200], 280, 12, False, 210),
        ("sudoku", "score", [180, 190, 200], 200, 12, False, 200),
        # Solitaire moves on wins (at most, unit 5, floor 60): 110 x 0.88 = 96.8 -> 95.
        ("solitaire", "win_moves", [90, 110, 130], 90, 12, False, 95),
        # ... never below the fewest moves (best 100).
        ("solitaire", "win_moves", [100, 110, 120], 100, 12, False, 100),
        # ... and stepped down after two misses: 110 x 1.12 = 123.2 -> 125.
        ("solitaire", "win_moves", [90, 110, 130], 90, 12, True, 125),
        # ... floored at 60 moves.
        ("freecell", "win_moves", [55, 58, 60], 55, 12, False, 60),
        # 2048 tile (power of two, floor 128): 512 x 1.12 -> 512.
        ("twenty48", "tile", [256, 512, 512], 1024, 12, False, 512),
        ("twenty48", "tile", [256, 512, 512], 1024, 50, False, 1024),
        ("twenty48", "tile", [512, 512, 512], 512, 50, False, 512),  # capped at the best
        ("twenty48", "tile", [256, 512, 512], 1024, 12, True, 256),  # halves on a step-down
        ("twenty48", "tile", [16, 32, 64], 64, 12, False, 128),  # floor
    ],
)
def test_personal_target(
    game: str, name: str, values: list[int], best: int, pct: int, stepped: bool, expected: int
) -> None:
    assert (
        personal_target(_type(game, name), values, best=best, pct=pct, stepped_down=stepped)
        == expected
    )


def test_personal_target_needs_values() -> None:
    with pytest.raises(ValueError):
        personal_target(_type("yacht", "score"), [], best=1, pct=12)


def test_cold_start_goals_per_game() -> None:
    h = _history(_DAY, [(g, _DAY - timedelta(days=1), _score(10)) for g in _FREE])
    got = {g: [o.goal.id for o in options_for(g, h, _DAY, pct=12)] for g in _FREE}
    assert got == {
        "freecell": ["freecell:won"],
        "solitaire": ["solitaire:won"],
        "sudoku": ["sudoku:solved"],
        "twenty48": ["twenty48:final_score_at_least:500"],
        "yacht": ["yacht:final_score_at_least:100"],
    }


def test_an_experienced_players_goals_per_game() -> None:
    days = _days_before(_DAY, 5)
    plays = (
        _plays("twenty48", [_2048(s, t) for s, t in [(1000, 256), (1200, 512), (1400, 512)]], days)
        + _plays("solitaire", [_win(m) for m in (90, 110, 130)], days)
        + _plays("freecell", [_win(m) for m in (80, 90, 100)], days)
        + _plays("sudoku", [{"won": True, "final_score": s} for s in (180, 190, 200)], days)
        + _plays("yacht", [_score(s) for s in (150, 160, 170)], days)
    )
    h = _history(_DAY, plays)
    got = {g: [o.goal.id for o in options_for(g, h, _DAY, pct=12)] for g in _FREE}
    assert got == {
        "freecell": ["freecell:won", "freecell:won_moves_at_most:80"],
        "solitaire": ["solitaire:won", "solitaire:won_moves_at_most:95"],
        "sudoku": ["sudoku:solved", "sudoku:final_score_at_least:200"],
        "twenty48": ["twenty48:final_score_at_least:1350", "twenty48:highest_tile_at_least:512"],
        "yacht": ["yacht:final_score_at_least:170"],
    }


def test_only_the_latest_history_games_are_read(monkeypatch: pytest.MonkeyPatch) -> None:
    days = _days_before(_DAY, 12)
    # Oldest 10 games score 5000; the latest 3 score 1000.
    plays = [("yacht", days[-1 - i % 3], _score(200)) for i in range(10)]
    plays += [("yacht", days[0], _score(150)) for _ in range(3)]
    monkeypatch.setenv("DAILY_CHALLENGE_HISTORY_GAMES", "3")
    monkeypatch.setattr(personal, "_settings", None)
    [option] = options_for("yacht", _history(_DAY, plays), _DAY, pct=0)
    assert option.goal.target == 150  # the median of the latest 3 only


def test_the_stretch_dial_moves_the_target(monkeypatch: pytest.MonkeyPatch) -> None:
    days = _days_before(_DAY, 3)
    h = _history(_DAY, _plays("yacht", [_score(s) for s in (200, 200, 200, 300)], days))
    monkeypatch.setenv("DAILY_CHALLENGE_STRETCH_PCT", "0")
    monkeypatch.setattr(personal, "_settings", None)
    zero = _core(h, eligible=["yacht"] + ["twenty48"])
    monkeypatch.setenv("DAILY_CHALLENGE_STRETCH_PCT", "50")
    monkeypatch.setattr(personal, "_settings", None)
    fifty = _core(h, eligible=["yacht"] + ["twenty48"])
    yacht = {g.game_type: g.target for g in zero}["yacht"], {g.game_type: g.target for g in fifty}[
        "yacht"
    ]
    assert yacht == (200, 300)  # 200 -> 200 x 1.5 = 300 (the best)


def _miss_history(met: Sequence[bool]) -> InstallHistory:
    """Yacht played 5 days running; its score goal (target 300) pinned on the days in
    ``met`` (oldest first), met or missed."""
    days = _days_before(_DAY, 5)[::-1]
    plays = [("yacht", d, _score(200)) for d in days]
    goal = _at_least("yacht", "final_score", 300, "medium")
    pinned = {}
    for d, hit in zip(days[-len(met) :], met, strict=True):
        pinned[d] = _pin(goal, FREE_GOAL_POOL["twenty48"][0])
        if hit:
            plays.append(("yacht", d, _score(320)))
    return _history(_DAY, plays + [("yacht", days[0], _score(400))], pinned)


@pytest.mark.parametrize(
    "met,stepped",
    [([False, False], True), ([True, False], False), ([False, True], False), ([False], False)]
    + [([False, False, True], False), ([True, False, False], True)],
)
def test_step_down_after_two_consecutive_misses(met: list[bool], stepped: bool) -> None:
    h = _miss_history(met)
    assert personal.stepped_down(h, "yacht", "score") is stepped
    [option] = options_for("yacht", h, _DAY, pct=12)
    # median 200: 224 -> 225 normally, 176 -> 175 stepped down.
    assert option.goal.target == (175 if stepped else 225)


def test_a_day_still_being_played_is_never_a_miss() -> None:
    h = _miss_history([False, False])
    h.first_day = _DAY - timedelta(days=1)  # yesterday is now "today", unfinished
    assert personal.stepped_down(h, "yacht", "score") is False


# ---------------------------------------------------------------------------
# Property: a pinned target is never already met by play before the day
# ---------------------------------------------------------------------------

_GAME_FACTS = {
    "twenty48": st.builds(
        _2048, st.integers(0, 20_000), st.sampled_from([32, 64, 128, 256, 512, 1024, 2048])
    ),
    "solitaire": st.builds(_win, st.integers(52, 400)),
    "freecell": st.builds(_win, st.integers(52, 300)),
    "sudoku": st.builds(lambda s: {"won": True, "final_score": s}, st.integers(0, 300)),
    "yacht": st.builds(_score, st.integers(0, 375)),
}


@st.composite
def _random_history(draw):
    plays: list[Play] = []
    for game in _FREE:
        for _ in range(draw(st.integers(0, 12))):
            back = draw(st.integers(1, 20))
            plays.append((game, _DAY - timedelta(days=back), draw(_GAME_FACTS[game])))
    return plays


@settings(max_examples=150, deadline=None)
@given(plays=_random_history(), pct=st.integers(0, 50), sid=st.uuids())
def test_property_targets_are_bounded_and_progress_is_never_already_done(
    plays: list[Play], pct: int, sid: uuid.UUID
) -> None:
    h = _history(_DAY, plays)
    for game in _FREE:
        for option in options_for(game, h, _DAY, pct=pct):
            goal = option.goal
            pre_day = [f for g, _d, f in plays if g == game]
            gtype = GAME_SPECS[game].type(goal_type_name(goal))
            if not gtype.personal or len(pre_day) < 3:
                continue
            assert goal.target is not None
            floor = gtype.floor or 0
            values = [f[gtype.measure] for f in pre_day]
            if gtype.at_most:
                assert goal.target >= max(min(values), floor)
            else:
                # Never above the best (unless the floor is): beating it is never required.
                assert floor <= goal.target <= max(max(values), floor)
    if not is_new_install(h, _DAY):
        core = _core(h, sid=str(sid), pct=pct)
        assert core[0] == _DW and len(core) == 3
        assert sum(g.is_win for g in core) <= 1
        assert all(g.game_type != "sort" for g in core)


# ---------------------------------------------------------------------------
# #3994: selection
# ---------------------------------------------------------------------------


def test_affinity_weights_recent_days_more() -> None:
    plays = [("yacht", _DAY - timedelta(days=1), _score(1))]
    plays += [("sudoku", _DAY - timedelta(days=14), _score(1))] * 2
    plays += [("twenty48", _DAY - timedelta(days=15), _score(1))]  # outside the window
    plays += [("sort", _DAY, _score(1))]  # the day itself: not yet
    assert _history(_DAY, plays).affinity(_DAY) == {"yacht": 14, "sudoku": 2}


def _profile_plays(weights: dict[str, int], day: date, days: int = 10) -> list[Play]:
    facts = {
        "twenty48": _2048(1500, 512),
        "solitaire": _win(110),
        "freecell": _win(90),
        "sudoku": {"won": True, "final_score": 190},
        "yacht": _score(180),
        "sort": {"won": True, "final_score": 30},
    }
    return [
        (game, day - timedelta(days=back), facts[game])
        for back in range(1, days + 1)
        for game, n in weights.items()
        for _ in range(n)
    ]


def test_core_slots_are_drawn_in_proportion_to_affinity() -> None:
    h = _history(_DAY, _profile_plays({"twenty48": 8, "yacht": 1, "sudoku": 1}, _DAY))
    seen = Counter(g.game_type for i in range(300) for g in _core(h, sid=f"s{i}")[1:])
    assert set(seen) == {"twenty48", "yacht", "sudoku"}
    # The two slots hold two different games, so the favourite is in almost every
    # day's core (8x the affinity of each other game) and the others share the rest
    # (sudoku more often: its solve goal is a different archetype from 2048's score).
    assert seen["twenty48"] >= 0.9 * 300
    assert seen["twenty48"] > max(seen["yacht"], seen["sudoku"])


def test_games_without_affinity_are_not_drawn_while_two_have_it() -> None:
    h = _history(_DAY, _profile_plays({"twenty48": 1, "yacht": 1}, _DAY))
    for i in range(50):
        assert {g.game_type for g in _core(h, sid=f"s{i}")[1:]} == {"twenty48", "yacht"}


def test_no_back_to_back_game_with_three_or_more_games() -> None:
    plays = _profile_plays({"twenty48": 3, "yacht": 1, "sudoku": 1, "solitaire": 1}, _DAY)
    yesterday = _pin(FREE_GOAL_POOL["twenty48"][0], FREE_GOAL_POOL["yacht"][0])
    h = _history(_DAY, plays, {_DAY - timedelta(days=1): yesterday})
    for i in range(50):
        assert not {g.game_type for g in _core(h, sid=f"s{i}")[1:]} & {"twenty48", "yacht"}


def test_back_to_back_is_allowed_with_fewer_than_three_games() -> None:
    plays = _profile_plays({"twenty48": 1, "yacht": 1}, _DAY)
    yesterday = _pin(FREE_GOAL_POOL["twenty48"][0], FREE_GOAL_POOL["yacht"][0])
    h = _history(_DAY, plays, {_DAY - timedelta(days=1): yesterday})
    assert {g.game_type for g in _core(h)[1:]} == {"twenty48", "yacht"}


def test_three_games_with_yesterdays_two_out_take_the_third_twice() -> None:
    plays = _profile_plays({"twenty48": 1, "yacht": 1, "sudoku": 1}, _DAY)
    yesterday = _pin(FREE_GOAL_POOL["twenty48"][0], FREE_GOAL_POOL["yacht"][0])
    h = _history(_DAY, plays, {_DAY - timedelta(days=1): yesterday})
    core = _core(h)
    assert [g.game_type for g in core[1:]] == ["sudoku", "sudoku"]
    assert {goal_type_name(g) for g in core[1:]} == {"solve", "score"}


def test_a_game_and_goal_type_does_not_repeat_within_three_days() -> None:
    plays = _profile_plays({"twenty48": 1, "sudoku": 1}, _DAY)
    score_2048 = _at_least("twenty48", "final_score", 1500, "medium")
    solve = goal_from_spec(
        {"game_type": "sudoku", "kind": "solved", "target": None, "tier": "easy"}
    )
    pinned = {_DAY - timedelta(days=2): _pin(score_2048, solve)}
    for i in range(40):
        core = _core(_history(_DAY, plays, pinned), sid=f"s{i}")
        pairs = {(g.game_type, goal_type_name(g)) for g in core[1:]}
        assert pairs == {("twenty48", "tile"), ("sudoku", "score")}
    # Three days back is fine again.
    pinned = {_DAY - timedelta(days=3): _pin(score_2048, solve)}
    pairs_seen = {
        (g.game_type, goal_type_name(g))
        for i in range(40)
        for g in _core(_history(_DAY, plays, pinned), sid=f"s{i}")[1:]
    }
    assert ("twenty48", "score") in pairs_seen and ("sudoku", "solve") in pairs_seen


def test_the_two_core_goals_are_different_archetypes_where_possible() -> None:
    # yacht (score: stretch only) and sudoku (solve: finish, score: stretch). After a
    # yacht score goal, sudoku's goal is the solve, never a second stretch.
    h = _history(_DAY, _profile_plays({"yacht": 1, "sudoku": 1}, _DAY))
    yacht_first = 0
    for i in range(60):
        core = _core(h, sid=f"s{i}")
        assert {g.game_type for g in core[1:]} == {"yacht", "sudoku"}  # two games first
        if core[1].game_type == "yacht":
            yacht_first += 1
            assert core[2].id == "sudoku:solved"
    assert yacht_first > 0


def test_a_one_game_player_gets_two_goal_types_of_that_game() -> None:
    h = _history(_DAY, _profile_plays({"twenty48": 2}, _DAY))
    for i in range(20):
        core = _core(h, sid=f"s{i}")
        assert [g.game_type for g in core[1:]] == ["twenty48", "twenty48"]
        assert {goal_type_name(g) for g in core[1:]} == {"score", "tile"}


def test_a_one_game_player_with_one_goal_type_gets_a_cold_start_second_game() -> None:
    h = _history(_DAY, _profile_plays({"yacht": 2}, _DAY))
    core = _core(h)
    assert core[1].game_type == "yacht" or core[2].game_type == "yacht"
    other = next(g for g in core[1:] if g.game_type != "yacht")
    assert other.id in {o.goal.id for o in options_for(other.game_type, h, _DAY, pct=12)}


def test_at_most_one_win_dependent_goal_a_day() -> None:
    # Hearts' and Blackjack's wins are luck-dependent (#3996; Mahjong's no longer is):
    # played the most, they would both be drawn without the rule.
    assert _won("hearts", "easy").is_win and _won("blackjack", "easy").is_win
    plays = [
        (game, d, {"won": True, "is_complete": True, "starting_chips": 100})
        for game in ("hearts", "blackjack")
        for d in _days_before(_DAY, 5)
        for _ in range(5)
    ]
    plays += _profile_plays({"yacht": 1}, _DAY)
    h = _history(_DAY, plays)
    for i in range(60):
        core = _core(h, sid=f"s{i}", eligible=[*_FREE, "hearts", "blackjack"])
        assert sum(g.is_win for g in core) <= 1


def test_solitaire_and_freecell_wins_are_skill_not_luck() -> None:
    for game in ("solitaire", "freecell"):
        assert not _won(game, "easy").is_win
        assert not _won_within(game, "moves", 100, "hard").is_win
    assert all(not g.is_win for goals in FREE_GOAL_POOL.values() for g in goals)


def test_the_pick_is_deterministic_and_seeded_per_install_and_day() -> None:
    h = _history(_DAY, _profile_plays({g: 1 for g in _FREE}, _DAY))
    assert _core(h, sid="a") == _core(h, sid="a")
    by_sid = {_core(h, sid=f"s{i}") for i in range(30)}
    assert len(by_sid) > 1
    assert _core(h, sid="a", salt=1) == _core(h, sid="a", salt=1)


def test_the_rng_never_reads_the_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    h = _history(_DAY, _profile_plays({g: 1 for g in _FREE}, _DAY))
    first = _core(h, sid="x")
    monkeypatch.setattr(random, "random", lambda: 0.0)  # the global RNG is never used
    random.seed(12345)
    assert _core(h, sid="x") == first


def test_ineligible_games_are_never_picked() -> None:
    h = _history(_DAY, _profile_plays({"twenty48": 5, "yacht": 1, "sudoku": 1}, _DAY))
    for i in range(30):
        core = _core(h, sid=f"s{i}", eligible=["yacht", "sudoku"])
        assert "twenty48" not in {g.game_type for g in core}


def test_every_spec_goal_kind_is_an_existing_kind_with_frontend_wording() -> None:
    copy = json.loads(_EN_COPY.read_text(encoding="utf-8"))
    existing = {"completed", "won", "solved", "chips_gained"}
    for spec in GAME_SPECS.values():
        for t in spec.types:
            assert (
                t.kind in existing
                or t.kind.endswith("_at_least")
                or (t.kind.startswith("won_") and t.kind.endswith("_at_most"))
            )
            key = f"goal.{t.game_type}.{t.kind}"
            assert key in copy or f"{key}_other" in copy, key


# ---------------------------------------------------------------------------
# Discovery candidates (for #3995) — pure
# ---------------------------------------------------------------------------


def _bonus(game: str) -> Goal:
    return goal_from_spec({"game_type": game, "kind": "solved", "target": None, "tier": "easy"})


def _with_bonus(game: str) -> Assignment:
    return Assignment(
        _pin(FREE_GOAL_POOL["twenty48"][0], FREE_GOAL_POOL["yacht"][0]).template, bonus=_bonus(game)
    )


def test_discovery_candidates_are_eligible_games_not_played_in_the_window() -> None:
    h = _history(_DAY, _profile_plays({"twenty48": 1, "yacht": 1}, _DAY))
    assert discovery_candidates(h, _FREE, _DAY) == ["freecell", "solitaire", "sudoku"]
    assert discovery_candidates(h, ["yacht", "sudoku"], _DAY) == ["sudoku"]


def test_a_bonus_ignored_three_times_rests_for_30_days() -> None:
    days = [_DAY - timedelta(days=n) for n in (20, 10, 5)]
    h = _history(_DAY, [], {d: _with_bonus("sudoku") for d in days})
    assert "sudoku" not in discovery_candidates(h, _FREE, _DAY)
    assert personal.resting(h, "sudoku", _DAY - timedelta(days=5) + timedelta(days=30))
    assert not personal.resting(h, "sudoku", _DAY - timedelta(days=5) + timedelta(days=31))
    # Two ignores only: not resting.
    h = _history(_DAY, [], {d: _with_bonus("sudoku") for d in days[1:]})
    assert "sudoku" in discovery_candidates(h, _FREE, _DAY)
    # Three ignores spread over more than 30 days: not resting.
    spread = [_DAY - timedelta(days=n) for n in (45, 20, 5)]
    h = _history(_DAY, [], {d: _with_bonus("sudoku") for d in spread})
    assert "sudoku" in discovery_candidates(h, _FREE, _DAY)


# ---------------------------------------------------------------------------
# Sim: 60 days for a few player profiles
# ---------------------------------------------------------------------------


def _simulate(weights: dict[str, int], days: int = 60, seed: int = 7):
    """Each day: pick, pin, then play the profile's games (seeded), as the app would."""
    rng = random.Random(seed)
    start = date(2026, 9, 1)
    plays: list[Play] = []
    pinned: dict[date, Assignment] = {}
    picks: list[tuple[date, tuple[Goal, ...] | None]] = []
    for i in range(days):
        day = start + timedelta(days=i)
        h = _history(day, plays, pinned)
        if is_new_install(h, day):
            picks.append((day, None))  # the shared template (tested over the DB)
        else:
            core = _core(h, day=day, sid="sim")
            pinned[day] = _pin(*core[1:])
            picks.append((day, core))
        for game, n in weights.items():
            for _ in range(n if rng.random() < 0.9 else 0):
                plays.append((game, day, _sim_facts(game, rng)))
    return picks


def _sim_facts(game: str, rng: random.Random) -> dict:
    return {
        "twenty48": lambda: _2048(rng.randint(500, 4000), rng.choice([256, 512, 1024])),
        "solitaire": lambda: _win(rng.randint(90, 160)),
        "freecell": lambda: _win(rng.randint(80, 130)),
        "sudoku": lambda: {"won": True, "final_score": rng.choice([100, 190, 200, 280])},
        "yacht": lambda: _score(rng.randint(120, 260)),
        "sort": lambda: {"won": True, "final_score": 0},
    }[game]()


def _no_back_to_back(picks) -> None:
    for (_, a), (_, b) in pairwise(picks):
        assert not {g.game_type for g in a[1:]} & {g.game_type for g in b[1:]}


def test_sim_three_games_never_back_to_back() -> None:
    """With exactly 3 games the guard, not affinity, sets the rhythm: two games one
    day, the third (two goal types) the next. Every game they play comes up."""
    weights = {"twenty48": 4, "sudoku": 2, "solitaire": 1}
    picks = [(d, core) for d, core in _simulate(weights) if core is not None]
    assert len(picks) >= 58
    _no_back_to_back(picks)
    seen = Counter(g.game_type for _, core in picks[5:] for g in core[1:])
    assert set(seen) == set(weights), seen  # past the first days' cold starts


def test_sim_everything_favourites_most_and_never_back_to_back() -> None:
    weights = {"twenty48": 1, "solitaire": 4, "freecell": 1, "sudoku": 1, "yacht": 1, "sort": 1}
    picks = [(d, core) for d, core in _simulate(weights) if core is not None]
    assert len(picks) >= 58
    _no_back_to_back(picks)
    seen = Counter(g.game_type for _, core in picks for g in core[1:])
    assert seen.most_common(1)[0][0] == "solitaire", seen
    assert set(seen) <= set(weights)  # only games they play


def test_sim_one_favourite_game() -> None:
    picks = [core for _, core in _simulate({"twenty48": 3}) if core is not None]
    assert all([g.game_type for g in core[1:]] == ["twenty48"] * 2 for core in picks)
    # Two goal types every day, and they alternate order, never the same goal twice.
    assert all(core[1].id != core[2].id for core in picks)


def test_sim_new_player_starts_on_the_shared_template() -> None:
    picks = _simulate({"yacht": 1}, days=10, seed=1)
    # One game a day (90 %): the first days have fewer than 3 games, so shared.
    assert picks[0][1] is None and picks[1][1] is None
    assert any(core is not None for _, core in picks[3:])


# ---------------------------------------------------------------------------
# DB: the loader, the new-install rule, rest rule, /status, streak, query count
# ---------------------------------------------------------------------------


async def _add(
    sid: str,
    game: str,
    when: datetime,
    *,
    final_score: int | None = None,
    metadata: dict | None = None,
    outcome: str = "completed",
    created_at: datetime | None = None,
) -> None:
    """A finished game; its server-side ``created_at`` is ``when`` unless given, so a
    seeded history reads as continuous play (``InstallHistory.always_pinnable``)."""
    async with get_session_factory()() as db:
        gt_id = (await db.execute(select(GameType.id).where(GameType.name == game))).scalar_one()
        db.add(
            Game(
                session_id=sid,
                game_type_id=gt_id,
                started_at=when - timedelta(minutes=5),
                completed_at=when,
                created_at=created_at or when,
                outcome=outcome,
                final_score=final_score,
                game_metadata=metadata or {},
            )
        )
        await db.commit()


def _noon(day: date) -> datetime:
    return datetime(day.year, day.month, day.day, 12, tzinfo=UTC)


async def _seed_2048(sid: str, today: date) -> None:
    """Five 2048 games over the last five days: score median 1400, best 1800; tile
    median 512, best 1024. Personal goals: score 1550 (1400 x 1.12), tile 512."""
    for back, (score, tile) in enumerate(
        [(1000, 256), (1200, 512), (1400, 512), (1600, 1024), (1800, 512)], start=1
    ):
        await _add(
            sid,
            "twenty48",
            _noon(today - timedelta(days=back)),
            final_score=score,
            metadata={"highest_tile": tile},
        )


_EXPECTED_2048 = {"twenty48:final_score_at_least:1550", "twenty48:highest_tile_at_least:512"}


@needs_db
async def test_the_loader_reads_what_the_pure_tests_build() -> None:
    sid = str(uuid.uuid4())
    today = _DAY
    await _seed_2048(sid, today)
    await _add(
        sid, "twenty48", _noon(today - timedelta(days=1)), final_score=9000, outcome="abandoned"
    )
    await _add(
        sid,
        "twenty48",
        _noon(today - timedelta(days=1)),
        final_score=9000,
        metadata={"dev_affected": True},
    )
    await _add(sid, "yacht", _noon(today), final_score=200)  # the day itself: not before it
    await _add(sid, "yacht", _noon(today - timedelta(days=30)), final_score=250)
    async with get_session_factory()() as db:
        h = await load_install_history(db, sid, today)
    assert h.affinity(today) == {"twenty48": 14 + 13 + 12 + 11 + 10}
    assert [f["final_score"] for f in h.recent_facts("twenty48", today, 10)] == [
        1000,
        1200,
        1400,
        1600,
        1800,
    ]
    assert h.best_final_score("twenty48", today) == 1800
    assert h.best_final_score("yacht", today) == 250
    assert h.finished_before(today) == 6
    assert h.pinned == {}
    expected = _history(
        today,
        [
            ("twenty48", today - timedelta(days=b), _2048(s, t))
            for b, (s, t) in enumerate(
                [(1000, 256), (1200, 512), (1400, 512), (1600, 1024), (1800, 512)], start=1
            )
        ],
    )
    assert (
        {o.goal.id for o in options_for("twenty48", h, today, pct=12)}
        == {o.goal.id for o in options_for("twenty48", expected, today, pct=12)}
        == _EXPECTED_2048
    )


@needs_db
async def test_the_loader_follows_the_client_timezone() -> None:
    sid = str(uuid.uuid4())
    # 23:30 UTC on Nov 19 is Nov 20 at +60 min.
    await _add(sid, "yacht", datetime(2026, 11, 19, 23, 30, tzinfo=UTC), final_score=1)
    async with get_session_factory()() as db:
        east = await load_install_history(db, sid, _DAY, 60)
        utc = await load_install_history(db, sid, _DAY, 0)
    assert east.daily_counts == {"yacht": {date(2026, 11, 20): 1}}
    assert utc.daily_counts == {"yacht": {date(2026, 11, 19): 1}}


@needs_db
async def test_a_batch_history_serves_each_day_with_its_own_cutoff() -> None:
    sid = str(uuid.uuid4())
    today = _DAY
    for back in (1, 2, 3):
        await _add(sid, "yacht", _noon(today - timedelta(days=back)), final_score=100 + back)
    await _add(sid, "yacht", _noon(today), final_score=300)
    async with get_session_factory()() as db:
        h = await load_install_history(db, sid, today, through=today + timedelta(days=2))
    assert h.best_final_score("yacht", today) == 103
    assert h.best_final_score("yacht", today + timedelta(days=1)) == 300
    assert len(h.recent_facts("yacht", today, 10)) == 3
    assert len(h.recent_facts("yacht", today + timedelta(days=1), 10)) == 4


async def _pin_row(sid: str, day: date, goals: Sequence[Goal], bonus: Goal | None = None):
    async with get_session_factory()() as db:
        db.add(
            DailyChallengeAssignment(
                session_id=uuid.UUID(sid),
                local_date=day,
                goals=encode_goals(goals),
                bonus=(
                    None
                    if bonus is None
                    else json.dumps([bonus.game_type, bonus.kind, bonus.target, bonus.tier])
                ),
            )
        )
        await db.commit()


@needs_db
async def test_discovery_rest_rule_from_pinned_rows_with_a_bonus() -> None:
    sid = str(uuid.uuid4())
    today = local_day(0).date
    await _seed_2048(sid, today)
    core = (_DW, *FREE_GOAL_POOL["twenty48"][:2])
    offers = [today - timedelta(days=n) for n in (12, 8, 3)]
    for d in offers:
        await _pin_row(sid, d, core, bonus=_bonus("sudoku"))
    async with get_session_factory()() as db:
        h = await load_install_history(db, sid, today)
    assert set(h.pinned) == set(offers)
    assert h.pinned[offers[0]].bonus == _bonus("sudoku")
    assert "sudoku" not in discovery_candidates(h, _FREE, today)
    assert "yacht" in discovery_candidates(h, _FREE, today)

    # Played on one of the offered days (and 14+ days ago otherwise): only 2 ignores.
    sid2 = str(uuid.uuid4())
    await _seed_2048(sid2, today)
    for d in offers:
        await _pin_row(sid2, d, core, bonus=_bonus("sudoku"))
    await _add(sid2, "sudoku", _noon(offers[0]), final_score=100, metadata={"won": True})
    async with get_session_factory()() as db:
        h = await load_install_history(db, sid2, today)
    assert h.played_on("sudoku", offers[0])
    assert not personal.resting(h, "sudoku", today)


@needs_db
async def test_the_loader_probes_the_last_two_days_of_each_stretch_goal() -> None:
    """A yacht goal missed on two pinned days 30+ days back is judged on those days'
    full play, even with 25 later games pushing them out of the recent window."""
    sid = str(uuid.uuid4())
    today = _DAY
    goal = _at_least("yacht", "final_score", 300, "medium")
    old = [today - timedelta(days=n) for n in (40, 35)]
    for d in old:
        await _pin_row(sid, d, (_DW, goal, FREE_GOAL_POOL["twenty48"][0]))
        await _add(sid, "yacht", _noon(d), final_score=150)
    for i in range(25):
        await _add(
            sid, "yacht", _noon(today - timedelta(days=1)) - timedelta(minutes=i), final_score=200
        )
    async with get_session_factory()() as db:
        h = await load_install_history(db, sid, today)
    assert len([g for g in h.games["yacht"] if g.recent]) == 10  # HISTORY_GAMES
    assert all(h.played_on("yacht", d) for d in old)
    assert personal.stepped_down(h, "yacht", "score")
    # The step-down: 200 x 0.88 = 176 -> 175.
    assert options_for("yacht", h, today, pct=12)[0].goal.target == 175


@needs_db
@pytest.mark.parametrize("games", [0, 1, 2])
async def test_a_new_install_gets_exactly_the_shared_template(games: int) -> None:
    sid = str(uuid.uuid4())
    today = local_day(0).date
    for back in range(1, games + 1):
        await _add(sid, "twenty48", _noon(today - timedelta(days=back)), final_score=900)
    async with get_session_factory()() as db:
        picked = await service.pick_for_install(db, sid, today)
        shared = await service.shared_for_install(db, sid, today)
    assert picked == shared


@needs_db
async def test_an_install_with_no_game_in_the_window_gets_the_shared_template() -> None:
    sid = str(uuid.uuid4())
    today = local_day(0).date
    for back in (20, 21, 22, 23):
        await _add(sid, "twenty48", _noon(today - timedelta(days=back)), final_score=900)
    async with get_session_factory()() as db:
        picked = await service.pick_for_install(db, sid, today)
        shared = await service.shared_for_install(db, sid, today)
    assert picked == shared


@needs_db
async def test_a_personal_pick_keeps_the_resolved_slate(monkeypatch: pytest.MonkeyPatch) -> None:
    sid = str(uuid.uuid4())
    today = local_day(0).date
    await _seed_2048(sid, today)

    async def premium(*_a, **_k) -> str:
        return "premium"

    monkeypatch.setattr(service, "resolve_slate", premium)
    # The bonus (#3995) is on by default; this test is about the slate and core goals.
    monkeypatch.setenv("DAILY_CHALLENGE_BONUS_ENABLED", "false")
    monkeypatch.setattr(personal, "_settings", None)
    async with get_session_factory()() as db:
        picked = await service.pick_for_install(db, sid, today)
    assert picked.slate == "premium" and picked.bonus is None
    assert {g.id for g in picked.template.goals[1:]} == _EXPECTED_2048


def _count_statements():
    engine = get_engine().sync_engine
    statements: list[str] = []

    def record(_conn, _cursor, statement, *_rest) -> None:
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    return statements, lambda: event.remove(engine, "before_cursor_execute", record)


@needs_db
async def test_one_personal_pick_is_five_queries() -> None:
    sid = str(uuid.uuid4())
    today = local_day(0).date
    await _seed_2048(sid, today)
    for game in ("yacht", "sudoku", "solitaire", "freecell", "sort"):
        await _add(
            sid,
            game,
            _noon(today - timedelta(days=1)),
            final_score=100,
            metadata={"won": True, "moves": 100},
        )
    statements, stop = _count_statements()
    try:
        async with get_session_factory()() as db:
            picked = await service.pick_for_install(db, sid, today)
    finally:
        stop()
    assert picked.template.goals[0] == _DW
    # pinned assignments, recent games (+ probe days), per-day counts and bests,
    # game creation times (always_pinnable), then which premium games with specs the
    # install owns (#3996: eligible_games).
    assert len(statements) == 5, statements
    assert "daily_challenge_assignments" in statements[0]
    assert "game_entitlements" in statements[-1]


@needs_db
async def test_upcoming_reads_the_history_once_for_three_days(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    sid = str(uuid.uuid4())
    today = local_day(0).date
    await _seed_2048(sid, today)
    await _add(sid, "yacht", datetime.now(UTC) - timedelta(minutes=1), final_score=150)
    loads: list[tuple[date, date | None]] = []
    real_load = history_mod.load_install_history

    async def counting_load(db, sid_, day, tz=0, **kw):
        loads.append((day, kw.get("through")))
        return await real_load(db, sid_, day, tz, **kw)

    monkeypatch.setattr(history_mod, "load_install_history", counting_load)
    statements, stop = _count_statements()
    try:
        body = client.get("/daily-challenge/upcoming", headers=_headers(sid)).json()
    finally:
        stop()
    # One history read for all three days. Counted by what each statement is, not
    # by total, so a dialect's extra statements (Postgres' storage-guard SAVEPOINT
    # and size query) do not matter.
    assert loads == [(today, today + timedelta(days=2))]
    lowered = [s.lower() for s in statements]
    assert sum("row_number" in s for s in lowered) == 1  # query 2
    assert sum("lag(" in s for s in lowered) == 1  # query 4
    assert sum("insert into daily_challenge_assignments" in s for s in lowered) == 1
    reads = [
        s for s in lowered if s.lstrip().startswith("select") and "daily_challenge_assignments" in s
    ]
    assert len(reads) == 2, reads  # get_or_pin's lookup + the history's pinned rows
    days = [d["goals"] for d in body["days"]]
    # Today, +1 and +2 see each other: no game in two consecutive days' core slots
    # needs 3+ games; with two, a (game, goal type) still never repeats within 3 days.
    pairs = [{(g["game_type"], g["kind"]) for g in goals[1:]} for goals in days]
    assert all(len(p) == 2 for p in pairs)


@needs_db
async def test_status_pins_personal_goals_and_the_streak_scores_them(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    sid = str(uuid.uuid4())
    today = local_day(0).date
    # The bonus (#3995) is on by default; this test is about the core goals and streak.
    monkeypatch.setenv("DAILY_CHALLENGE_BONUS_ENABLED", "false")
    monkeypatch.setattr(personal, "_settings", None)
    await _seed_2048(sid, today)
    body = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    # Older-build shape: 3 goals, existing kinds only, the usual fields.
    assert body["total_goals"] == len(body["goals"]) == 3
    assert body["goals"][0]["id"] == "daily_word:completed"
    assert {g["id"] for g in body["goals"][1:]} == _EXPECTED_2048
    assert body["bonus"] is None
    for g in body["goals"]:
        assert set(g) == {"id", "game_type", "kind", "target", "completed", "best_score"}
    assert body["completed_goals"] == 0  # nothing before the day counts

    # A 2048 game today meeting both personal goals: 2 of 3, the streak counts today.
    r = client.post("/games", headers=_headers(sid), json={"game_type": "twenty48"})
    gid = r.json()["id"]
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(sid),
        json={
            "final_score": 1600,
            "outcome": "completed",
            "duration_ms": 1000,
            "result": {"final_score": 1600, "highest_tile": 512, "move_count": 300},
        },
    )
    assert r.status_code == 200, r.text
    body = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    assert {g["id"] for g in body["goals"][1:]} == _EXPECTED_2048  # pinned: unchanged
    assert body["completed_goals"] == 2
    async with get_session_factory()() as db:
        assert await compute_streak(db, sid, 0) >= 1


@needs_db
async def test_the_kill_switch_still_serves_the_shared_template(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from daily_challenge import assignments

    monkeypatch.setenv("DAILY_CHALLENGE_PERSONALIZED", "false")
    monkeypatch.setattr(assignments, "_settings", None)
    sid = str(uuid.uuid4())
    await _seed_2048(sid, local_day(0).date)
    status = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    assert status["template_id"] == client.get("/daily-challenge/today").json()["template_id"]


@needs_db
async def test_eligible_games_are_the_free_spec_games() -> None:
    async with get_session_factory()() as db:
        assert await service.eligible_games(db, str(uuid.uuid4())) == _FREE


@needs_db
async def test_disabled_games_are_never_eligible(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service, "DISABLED_GAMES", frozenset({"yacht"}))
    async with get_session_factory()() as db:
        assert "yacht" not in await service.eligible_games(db, str(uuid.uuid4()))


@needs_db
async def test_a_premium_game_with_specs_is_eligible_only_when_entitled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    spec = personal.GameSpec(
        "mahjong", (personal.GoalType("mahjong", "win", "skill", "won"),), "win"
    )
    monkeypatch.setitem(GAME_SPECS, "mahjong", spec)
    owner, other = str(uuid.uuid4()), str(uuid.uuid4())
    async with get_session_factory()() as db:
        db.add(GameEntitlement(session_id=owner, game_slug="mahjong"))
        await db.commit()
    async with get_session_factory()() as db:
        assert "mahjong" in await service.eligible_games(db, owner)
        assert "mahjong" not in await service.eligible_games(db, other)
    set_dev_override(monkeypatch, "true")
    async with get_session_factory()() as db:
        assert "mahjong" in await service.eligible_games(db, other)


def test_a_personal_day_encodes_small() -> None:
    goals = (
        _DW,
        _at_least("twenty48", "final_score", 12_350, "medium"),
        _won_within("solitaire", "moves", 115, "medium"),
    )
    size = len(encode_goals(goals).encode())
    # The shared template's goals are ~100-130 B (test_a_real_days_goals_encode_small).
    assert size <= 160, size


# ---------------------------------------------------------------------------
# Dials
# ---------------------------------------------------------------------------


def test_dial_defaults_and_bounds(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (
        "DAILY_CHALLENGE_STRETCH_PCT",
        "DAILY_CHALLENGE_AFFINITY_DAYS",
        "DAILY_CHALLENGE_HISTORY_GAMES",
    ):
        monkeypatch.delenv(name, raising=False)
    assert (personal.stretch_pct(), personal.affinity_days(), personal.history_games()) == (
        12,
        14,
        10,
    )
    for name, bad in (
        ("DAILY_CHALLENGE_STRETCH_PCT", "51"),
        ("DAILY_CHALLENGE_STRETCH_PCT", "-1"),
        ("DAILY_CHALLENGE_AFFINITY_DAYS", "0"),
        ("DAILY_CHALLENGE_HISTORY_GAMES", "2"),
    ):
        monkeypatch.setenv(name, bad)
        with pytest.raises(ValueError):
            Settings()
        monkeypatch.delenv(name)


def test_the_affinity_window_dial(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DAILY_CHALLENGE_AFFINITY_DAYS", "3")
    monkeypatch.setattr(personal, "_settings", None)
    assert personal.affinity_days() == 3
    plays = [("yacht", _DAY - timedelta(days=4), _score(1))] * 3
    h = _history(_DAY, plays, window=personal.affinity_days())
    assert h.affinity(_DAY) == {}
    assert is_new_install(h, _DAY)


def test_the_pick_uses_salt_from_definitions() -> None:
    h = _history(_DAY, _profile_plays({g: 1 for g in _FREE}, _DAY))
    assert _core(h, sid="z") == _core(h, sid="z", salt=SALT)


def test_local_windows_match_definitions() -> None:
    assert local_day_of(_DAY, 0).start_utc == datetime(2026, 11, 21, tzinfo=UTC)
    assert history_mod.PINNED_LOOKBACK_DAYS == 2 * personal.REST_DAYS


def test_choose_core_refuses_when_fewer_than_two_goals_exist() -> None:
    h = _history(_DAY, _profile_plays({"yacht": 2}, _DAY))
    with pytest.raises(ValueError):
        _core(h, eligible=["yacht"])


@needs_db
async def test_a_pick_with_no_personal_goals_falls_back_to_the_shared_template(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sid = str(uuid.uuid4())
    today = local_day(0).date
    await _seed_2048(sid, today)

    async def nothing_eligible(*_a) -> list[str]:
        return []

    monkeypatch.setattr(service, "eligible_games", nothing_eligible)
    async with get_session_factory()() as db:
        picked = await service.pick_for_install(db, sid, today)
        shared = await service.shared_for_install(db, sid, today)
    assert picked == shared


def test_a_goal_type_without_three_values_is_not_offered() -> None:
    days = _days_before(_DAY, 4)
    # Older 2048 builds sent no highest_tile; a lost or unscored solitaire row has no
    # win moves. Those types drop out, the rest stay.
    plays = _plays("twenty48", [_score(1000), _score(1100), _2048(1200, True)], days)
    plays += _plays("solitaire", [_win(100), _win(110), {"won": False, "moves": 50}], days)
    h = _history(_DAY, plays)
    got = {
        g: [o.type_name for o in options_for(g, h, _DAY, pct=12)] for g in ("twenty48", "solitaire")
    }
    assert got == {"twenty48": ["score"], "solitaire": ["win"]}


@needs_db
async def test_a_context_asked_for_a_day_it_did_not_load_reloads() -> None:
    sid = str(uuid.uuid4())
    today = local_day(0).date
    await _seed_2048(sid, today)
    ctx = service.PickContext([today])
    async with get_session_factory()() as db:
        await service.pick_for_install(db, sid, today, context=ctx)
        assert ctx.history is not None and today in ctx.history.pinned
        tomorrow = today + timedelta(days=1)
        await service.pick_for_install(db, sid, tomorrow, context=ctx)
    assert ctx.days == [today, tomorrow] and ctx.history.last_day == tomorrow


def test_a_kind_no_spec_names_is_its_own_goal_type() -> None:
    assert goal_type_name(_at_least("solitaire", "moves", 10, "easy")) == "moves_at_least"
    assert goal_type_name(_won("mahjong", "easy")) == "win"  # a spec names it (#3996)
    assert goal_type_name(_won("yacht", "easy")) == "won"


# ---------------------------------------------------------------------------
# Review round 1: goals already shown never change when the day is pinned later
# ---------------------------------------------------------------------------

_H = timedelta(hours=1)


def test_request_opens_covers_every_timezone_two_days_ahead() -> None:
    # Local Nov 19 begins at 10:00 UTC Nov 18 at +14:00, the earliest anywhere.
    assert history_mod.request_opens(_DAY) == datetime(2026, 11, 18, 10, tzinfo=UTC)


def test_serves_shared_for_a_day_that_could_have_been_served_unpinned() -> None:
    h = _history(_DAY, _profile_plays({"twenty48": 2}, _DAY))
    assert not personal.serves_shared(h, _DAY)
    first = datetime(2026, 11, 21, 1, tzinfo=UTC)  # after the day could be asked for
    h.creations = {_DAY: history_mod.Creations(first=first, gaps=0, latest=first)}
    h.now = first + _H
    assert personal.serves_shared(h, _DAY)


async def _pinnable(created: list[datetime], now: datetime, day: date = _DAY) -> bool:
    """Query 4 over games created at ``created``, then ``always_pinnable(day)``."""
    sid = str(uuid.uuid4())
    for c in created:
        await _add(sid, "twenty48", c, final_score=1, created_at=c)
    async with get_session_factory()() as db:
        h = await load_install_history(db, sid, day, now=now)
    # Query 4 only runs for a day that is not a new-install day; force it.
    async with get_session_factory()() as db:
        h.creations = await history_mod._creations(db, sid, [day], h.pin_window, now)
    return h.always_pinnable(day)


@needs_db
async def test_always_pinnable_needs_play_in_every_window_since_the_day_could_be_asked_for() -> (
    None
):
    opens = history_mod.request_opens(_DAY)
    now = datetime(2026, 11, 21, 12, tzinfo=UTC)
    daily = [opens - 40 * _H + i * 24 * _H for i in range(5)]  # every 24 h from before
    assert await _pinnable(daily, now)
    # The first game only after the day opened: a device may hold shared goals.
    assert not await _pinnable(daily[2:], now)
    # A gap longer than the 48 h window since then: served unpinned in between.
    assert not await _pinnable([daily[0], daily[0] + 49 * _H, now - _H], now)
    # Exactly 48 h apart is still covered.
    assert await _pinnable([opens - _H, opens + 47 * _H, now - _H], now)
    # A gap long before the day could be asked for does not matter.
    assert await _pinnable([opens - 30 * 24 * _H, *daily], now)
    # No game in the last 48 h (may_pin would refuse anyway).
    assert not await _pinnable(daily[:2], now)
    # No game at all.
    assert not await _pinnable([], now)
    # Not read (hand-built histories): treated as pinnable.
    assert _history(_DAY, []).always_pinnable(_DAY)


@needs_db
async def test_query_4_is_one_row_however_many_games(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    now = datetime.now(UTC)
    for i in range(300):
        c = now - timedelta(minutes=i + 1)
        await _add(sid, "yacht", c, final_score=1, created_at=c)
    statements: list[str] = []
    engine = get_engine().sync_engine

    def after(_conn, cursor, statement, *_rest) -> None:
        statements.append(statement)

    event.listen(engine, "after_cursor_execute", after)
    try:
        async with get_session_factory()() as db:
            result = await history_mod._creations(db, sid, [local_day(0).date], 2 * 24 * _H, now)
    finally:
        event.remove(engine, "after_cursor_execute", after)
    assert len(statements) == 1 and "lag" in statements[0].lower()
    summary = next(iter(result.values()))
    assert summary.gaps == 0 and summary.latest is not None


async def _status_ids(client: TestClient, sid: str) -> list[str]:
    return [
        g["id"]
        for g in client.get("/daily-challenge/status", headers=_headers(sid)).json()["goals"]
    ]


async def _rows_for(sid: str) -> list[DailyChallengeAssignment]:
    async with get_session_factory()() as db:
        return list(
            (
                await db.execute(
                    select(DailyChallengeAssignment)
                    .where(DailyChallengeAssignment.session_id == uuid.UUID(sid))
                    .order_by(DailyChallengeAssignment.local_date)
                )
            ).scalars()
        )


@needs_db
async def test_a_lapsed_installs_shared_goals_stay_after_its_next_game_syncs(
    client: TestClient,
) -> None:
    """The reviewer's probe: an install with plenty of history but no game created in
    the last 48 h is served the shared template unpinned. Its next game syncs mid-day:
    the day is pinned, with the same shared goals it already showed."""
    sid = str(uuid.uuid4())
    today = local_day(0).date
    for back in range(3, 9):
        await _add(
            sid,
            "twenty48",
            _noon(today - timedelta(days=back)),
            final_score=1500,
            metadata={"highest_tile": 512},
        )
    before = await _status_ids(client, sid)
    upcoming_before = client.get("/daily-challenge/upcoming", headers=_headers(sid)).json()
    assert await _rows_for(sid) == []  # unpinned
    await _add(sid, "twenty48", datetime.now(UTC) - timedelta(minutes=1), final_score=100)
    assert await _status_ids(client, sid) == before
    upcoming_after = client.get("/daily-challenge/upcoming", headers=_headers(sid)).json()
    assert upcoming_after == upcoming_before
    assert len(await _rows_for(sid)) == 3  # now pinned, as shown


@needs_db
async def test_a_new_installs_offline_cached_days_stay_after_three_games_sync(
    client: TestClient,
) -> None:
    """A new install caches /upcoming (shared, unpinned) before its first game. It then
    plays 3 games today: tomorrow and the day after are pinned with the cached goals."""
    sid = str(uuid.uuid4())
    cached = client.get("/daily-challenge/upcoming", headers=_headers(sid)).json()
    for minutes in (30, 20, 10):
        await _add(
            sid,
            "twenty48",
            datetime.now(UTC) - timedelta(minutes=minutes),
            final_score=1500,
            metadata={"highest_tile": 512},
        )
    later = client.get("/daily-challenge/upcoming", headers=_headers(sid)).json()
    assert later == cached
    assert len(await _rows_for(sid)) == 3


@needs_db
async def test_continuous_play_still_gets_personal_goals_for_all_three_days(
    client: TestClient,
) -> None:
    sid = str(uuid.uuid4())
    today = local_day(0).date
    await _seed_2048(sid, today)
    await _add(
        sid,
        "twenty48",
        datetime.now(UTC) - timedelta(minutes=1),
        final_score=1500,
        metadata={"highest_tile": 512},
    )
    shared = client.get("/daily-challenge/upcoming").json()
    mine = client.get("/daily-challenge/upcoming", headers=_headers(sid)).json()
    assert all(m["goals"] != s["goals"] for m, s in zip(mine["days"], shared["days"], strict=True))


# ---------------------------------------------------------------------------
# Review round 1: Sort pace from per-day standings; pre-day history per served day
# ---------------------------------------------------------------------------


@needs_db
async def test_a_days_own_games_never_push_out_the_history_before_it() -> None:
    """Codex P2: /upcoming loads today..today+2. 25 games of one type today must not
    wipe out the games before today, so today keeps its personal goals."""
    sid = str(uuid.uuid4())
    today = local_day(0).date
    await _seed_2048(sid, today)
    start = local_day_of(today, 0).start_utc
    for i in range(25):
        await _add(
            sid,
            "twenty48",
            start + timedelta(minutes=i + 1),
            final_score=10,
            metadata={"highest_tile": 16},
            created_at=datetime.now(UTC) - timedelta(minutes=30),
        )
    ctx = service.PickContext([today, today + timedelta(days=1), today + timedelta(days=2)])
    async with get_session_factory()() as db:
        picked = await service.pick_for_install(db, sid, today, context=ctx)
    assert {g.id for g in picked.template.goals[1:]} == _EXPECTED_2048
    assert ctx.history is not None
    assert len(ctx.history.recent_facts("twenty48", today, 10)) == 5
    # Tomorrow reads today's latest 10 (all low): its score target is at the floor.
    assert len(ctx.history.recent_facts("twenty48", today + timedelta(days=1), 10)) == 10


# ---------------------------------------------------------------------------
# Review round 1: step-down ignores shared-template days and days not played
# ---------------------------------------------------------------------------


def test_a_shared_template_goal_missed_twice_is_no_step_down() -> None:
    days = _days_before(_DAY, 5)[::-1]
    plays = [("yacht", d, _score(150)) for d in days] * 2
    shared_goal = FREE_GOAL_POOL["yacht"][1]  # final_score >= 175, a pool goal
    pinned = {d: _pin(shared_goal, FREE_GOAL_POOL["twenty48"][0]) for d in days[-2:]}
    h = _history(_DAY, plays, pinned)
    assert not personal.stepped_down(h, "yacht", "score")


def test_a_day_the_game_was_not_played_is_no_miss() -> None:
    days = _days_before(_DAY, 5)[::-1]
    goal = _at_least("yacht", "final_score", 300, "medium")
    plays = [("yacht", d, _score(200)) for d in days[:3]] + [("yacht", days[4], _score(200))]
    pinned = {d: _pin(goal, FREE_GOAL_POOL["twenty48"][0]) for d in days[-2:]}  # days[3] unplayed
    h = _history(_DAY, plays, pinned)
    assert not personal.stepped_down(h, "yacht", "score")
    plays.append(("yacht", days[3], _score(200)))
    assert personal.stepped_down(_history(_DAY, plays, pinned), "yacht", "score")


# ---------------------------------------------------------------------------
# Review round 2: Bottle Sort personal goals are deferred to an owner decision
# ---------------------------------------------------------------------------


def test_no_personal_pick_ever_contains_a_sort_goal() -> None:
    assert "sort" not in GAME_SPECS
    h = _history(_DAY, _profile_plays({"sort": 10, "yacht": 1}, _DAY))
    for i in range(100):
        core = _core(h, sid=f"s{i}", eligible=[*_FREE, "sort"])
        assert all(g.game_type != "sort" for g in core)


@needs_db
async def test_a_sort_heavy_install_never_gets_a_personal_sort_goal(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    today = local_day(0).date
    await _seed_2048(sid, today)
    for back in range(1, 6):
        for lvl in range(10):
            await _add(
                sid,
                "sort",
                _noon(today - timedelta(days=back)) + timedelta(minutes=lvl),
                final_score=10 * (6 - back) + lvl,
                metadata={"won": True},
            )
    body = client.get("/daily-challenge/upcoming", headers=_headers(sid)).json()
    assert len(await _rows_for(sid)) == 3
    assert all(g["game_type"] != "sort" for day in body["days"] for g in day["goals"])
    async with get_session_factory()() as db:
        assert "sort" not in await service.eligible_games(db, sid)


@needs_db
async def test_a_gap_one_microsecond_over_the_window_counts() -> None:
    """Round 3: SQLite rounded a .999999 s fraction up inside plus_hours, so this 48 h
    + 1 us gap went uncounted. The day (opens 11-18 10:00) was servable unpinned."""
    sid = str(uuid.uuid4())
    created = [
        datetime(2026, 11, 16, 10, tzinfo=UTC),
        datetime(2026, 11, 17, 12, 59, 59, 999999, tzinfo=UTC),
        datetime(2026, 11, 19, 13, tzinfo=UTC),
    ]
    for c in created:
        await _add(sid, "twenty48", c, final_score=1, created_at=c)
    now = datetime(2026, 11, 20, 12, tzinfo=UTC)
    async with get_session_factory()() as db:
        result = await history_mod._creations(db, sid, [_DAY], 48 * _H, now)
    assert result[_DAY].gaps == 1
    assert result[_DAY].first == created[0] and result[_DAY].latest == created[-1]
    assert not await _pinnable(created, now)
