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
    sort_new_levels,
    sort_target,
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
_FREE = sorted(GAME_SPECS)
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
    return choose_core(h, day, eligible, session_id=sid, catalog_on=True, **kw)


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


@pytest.mark.parametrize(
    "per_day,stepped,expected",
    [([], False, 1), ([2, 2, 3], False, 2), ([3, 3, 3], False, 3), ([5, 9], False, 3)]
    + [([0, 0, 1], False, 1), ([2, 2, 2], True, 1), ([1], True, 1)],
)
def test_sort_new_levels(per_day: list[int], stepped: bool, expected: int) -> None:
    assert sort_new_levels(per_day, pct=12, stepped_down=stepped) == expected


@pytest.mark.parametrize(
    "highest,n,catalog_on,expected",
    [
        (21, 2, True, 23),
        (0, 1, True, 1),
        (119, 3, True, 120),  # capped at the catalog's last level
        (120, 1, True, None),  # catalog finished: no Sort goal
        (22, 3, False, 23),  # switch off: never past 23 (older builds stop there)
        (23, 1, False, None),
        (40, 1, False, None),
    ],
)
def test_sort_target(highest: int, n: int, catalog_on: bool, expected: int | None) -> None:
    assert sort_target(highest, n, catalog_on=catalog_on) == expected


def _sort_history(levels_by_day: dict[date, list[int]], day: date = _DAY) -> InstallHistory:
    plays = [
        ("sort", d, {"won": True, "final_score": lvl})
        for d, lvls in levels_by_day.items()
        for lvl in lvls
    ]
    return _history(day, plays)


def test_bottle_sort_asks_for_new_levels_from_its_recent_pace() -> None:
    days = _days_before(_DAY, 4)[::-1]
    # Two new levels a day: 10 -> 12 -> 14 -> 16.
    h = _sort_history({days[0]: [10], days[1]: [11, 12], days[2]: [13, 14], days[3]: [15, 16]})
    [option] = options_for("sort", h, _DAY, pct=12, catalog_on=True)
    assert option.goal == _at_least("sort", "final_score", 18, "medium")  # 16 + 2


def test_bottle_sort_cold_start_is_one_new_level() -> None:
    h = _sort_history({_DAY - timedelta(days=1): [7, 7]})
    [option] = options_for("sort", h, _DAY, pct=12, catalog_on=True)
    assert option.goal.target == 8


def test_bottle_sort_stops_at_120_and_at_23_while_the_catalog_switch_is_off() -> None:
    days = _days_before(_DAY, 4)[::-1]
    near_end = _sort_history({days[0]: [114], days[1]: [116], days[2]: [118], days[3]: [119]})
    [option] = options_for("sort", near_end, _DAY, pct=12, catalog_on=True)
    assert option.goal.target == 120
    done = _sort_history({days[0]: [118], days[1]: [119], days[2]: [120], days[3]: [120]})
    assert options_for("sort", done, _DAY, pct=12, catalog_on=True) == []
    legacy = _sort_history({days[0]: [16], days[1]: [18], days[2]: [20], days[3]: [22]})
    [option] = options_for("sort", legacy, _DAY, pct=12, catalog_on=False)
    assert option.goal.target == 23
    assert options_for("sort", legacy, _DAY, pct=12, catalog_on=True)[0].goal.target == 24


def test_a_sort_player_who_finished_the_catalog_gets_another_game() -> None:
    days = _days_before(_DAY, 5)
    plays = [("sort", d, {"won": True, "final_score": 120}) for d in days]
    core = _core(_history(_DAY, plays))
    assert all(g.game_type != "sort" for g in core)


def test_cold_start_goals_per_game() -> None:
    h = _history(_DAY, [(g, _DAY - timedelta(days=1), _score(10)) for g in _FREE])
    got = {g: [o.goal.id for o in options_for(g, h, _DAY, pct=12, catalog_on=True)] for g in _FREE}
    assert got == {
        "freecell": ["freecell:won"],
        "solitaire": ["solitaire:won"],
        "sort": ["sort:final_score_at_least:11"],
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
    got = {g: [o.goal.id for o in options_for(g, h, _DAY, pct=12, catalog_on=True)] for g in _FREE}
    assert got == {
        "freecell": ["freecell:won", "freecell:won_moves_at_most:80"],
        "solitaire": ["solitaire:won", "solitaire:won_moves_at_most:95"],
        "sort": ["sort:final_score_at_least:1"],
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
    [option] = options_for("yacht", _history(_DAY, plays), _DAY, pct=0, catalog_on=True)
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
    [option] = options_for("yacht", h, _DAY, pct=12, catalog_on=True)
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
    "sort": st.builds(lambda s: {"won": True, "final_score": s}, st.integers(0, 120)),
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
    best_level = max((f["final_score"] for g, _d, f in plays if g == "sort"), default=0)
    for game in _FREE:
        for option in options_for(game, h, _DAY, pct=pct, catalog_on=True):
            goal = option.goal
            pre_day = [f for g, _d, f in plays if g == game]
            if game == "sort":
                # A level goal is above every level solved before the day, so no game
                # from before the day (nor a replay today reporting the same standing)
                # meets it.
                assert goal.target is not None and goal.target > best_level
                assert goal.target <= best_level + 3
                assert not any(goal.evaluate(f) for f in pre_day)
                continue
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
    assert other.id in {
        o.goal.id for o in options_for(other.game_type, h, _DAY, pct=12, catalog_on=True)
    }


def test_at_most_one_win_dependent_goal_a_day(monkeypatch: pytest.MonkeyPatch) -> None:
    # Mahjong's win goals are luck-dependent (not a solvable-deal game); give it and a
    # second such game specs, played the most, to force the rule.
    win = personal.GoalType("mahjong", "win", "skill", "won")
    within = personal.GoalType(
        "mahjong", "win_time", "stretch", "won_duration_ms_at_most", "duration_ms", True, 1, 1000
    )
    monkeypatch.setitem(GAME_SPECS, "mahjong", personal.GameSpec("mahjong", (win, within), "win"))
    assert _won("mahjong", "easy").is_win and _won_within("mahjong", "x", 1, "easy").is_win
    plays = [
        ("mahjong", d, {"won": True, "duration_ms": 300_000})
        for d in _days_before(_DAY, 5)
        for _ in range(5)
    ]
    plays += _profile_plays({"yacht": 1}, _DAY)
    h = _history(_DAY, plays)
    for i in range(60):
        core = _core(h, sid=f"s{i}", eligible=[*_FREE, "mahjong"])
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
        assert spec.game_type in FREE_GOAL_POOL  # premium specs arrive with #3996
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
    assert discovery_candidates(h, _FREE, _DAY) == ["freecell", "solitaire", "sort", "sudoku"]
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
) -> None:
    async with get_session_factory()() as db:
        gt_id = (await db.execute(select(GameType.id).where(GameType.name == game))).scalar_one()
        db.add(
            Game(
                session_id=sid,
                game_type_id=gt_id,
                started_at=when - timedelta(minutes=5),
                completed_at=when,
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
        {o.goal.id for o in options_for("twenty48", h, today, pct=12, catalog_on=True)}
        == {o.goal.id for o in options_for("twenty48", expected, today, pct=12, catalog_on=True)}
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
        await _add(
            sid,
            "sort",
            _noon(today - timedelta(days=back)),
            final_score=10 - back,
            metadata={"won": True},
        )
    await _add(sid, "sort", _noon(today), final_score=12, metadata={"won": True})
    async with get_session_factory()() as db:
        h = await load_install_history(db, sid, today, through=today + timedelta(days=2))
    assert h.best_final_score("sort", today) == 9
    assert h.best_final_score("sort", today + timedelta(days=1)) == 12
    # Today's levels count for tomorrow's target: never already met before it starts.
    tomorrow = options_for("sort", h, today + timedelta(days=1), pct=12, catalog_on=True)
    assert tomorrow[0].goal.target > 12


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
    assert len([g for g in h.games["yacht"] if g.recent]) == 20  # 2 x HISTORY_GAMES
    assert all(h.played_on("yacht", d) for d in old)
    assert personal.stepped_down(h, "yacht", "score")
    # The step-down: 200 x 0.88 = 176 -> 175.
    assert options_for("yacht", h, today, pct=12, catalog_on=True)[0].goal.target == 175


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
async def test_one_personal_pick_is_three_queries() -> None:
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
    # pinned assignments, recent games (+ probe days), per-day counts and bests.
    assert len(statements) == 3, statements
    assert "daily_challenge_assignments" in statements[0]


@needs_db
async def test_upcoming_reads_the_history_once_for_three_days(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    today = local_day(0).date
    await _seed_2048(sid, today)
    await _add(sid, "yacht", datetime.now(UTC) - timedelta(minutes=1), final_score=150)
    statements, stop = _count_statements()
    try:
        body = client.get("/daily-challenge/upcoming", headers=_headers(sid)).json()
    finally:
        stop()
    # assignment SELECT, recent-play EXISTS, 3 history queries, the INSERT.
    assert len(statements) == 6, statements
    days = [d["goals"] for d in body["days"]]
    # Today, +1 and +2 see each other: no game in two consecutive days' core slots
    # needs 3+ games; with two, a (game, goal type) still never repeats within 3 days.
    pairs = [{(g["game_type"], g["kind"]) for g in goals[1:]} for goals in days]
    assert all(len(p) == 2 for p in pairs)


@needs_db
async def test_status_pins_personal_goals_and_the_streak_scores_them(
    client: TestClient,
) -> None:
    sid = str(uuid.uuid4())
    today = local_day(0).date
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
        g: [o.type_name for o in options_for(g, h, _DAY, pct=12, catalog_on=True)]
        for g in ("twenty48", "solitaire")
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
    assert goal_type_name(_won("mahjong", "easy")) == "won"
