"""The optional daily bonus goal (#3995): choice (pure), pinning and /status (DB).

The bonus is never one of the three core goals, never counts toward the streak or "day
complete", and is null on a shared-template day, with ``DAILY_CHALLENGE_BONUS_ENABLED``
off, or when no game qualifies. See ``personal.choose_bonus`` and docs/DAILY-CHALLENGE.md §3b.
"""

from __future__ import annotations

import os
import uuid
from collections import Counter
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from daily_challenge import personal, service
from daily_challenge.assignments import Assignment, derived_template_id
from daily_challenge.definitions import (
    ALWAYS_PRESENT,
    FREE_GOAL_POOL,
    Goal,
    Template,
    goal_from_spec,
    local_day,
)
from daily_challenge.history import InstallHistory
from daily_challenge.personal import (
    DISCOVERY_TIER,
    GAME_SPECS,
    bonus_kind,
    choose_bonus,
    choose_core,
    discovery_candidates,
)
from db.base import get_session_factory
from settings import Settings
from tests._helpers import session_headers as _headers
from tests._helpers import set_dev_override
from tests.test_daily_challenge_personal import _add, _history, _score, _seed_2048

needs_db = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping daily-challenge bonus tests",
)

_DAY = date(2026, 11, 21)
_FREE = sorted(
    g for g in GAME_SPECS if g in FREE_GOAL_POOL
)  # the free games with specs (#3996 added premium specs)
_DW = FREE_GOAL_POOL[ALWAYS_PRESENT][0]


@pytest.fixture(autouse=True)
def _fresh_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    set_dev_override(monkeypatch, "")
    monkeypatch.setattr(personal, "_settings", None)


def _plays(game: str, scores: list[int]) -> list:
    return [(game, _DAY - timedelta(days=1 + i), _score(s)) for i, s in enumerate(scores)]


def _core_of(*games: str) -> tuple[Goal, ...]:
    """Daily Word, then each game's first pool goal."""
    return (_DW, *(FREE_GOAL_POOL[g][0] for g in games))


def _bonus_assignment(game: str, tier: str) -> Assignment:
    core = _core_of("twenty48", "yacht")
    goal = goal_from_spec({"game_type": game, "kind": "solved", "target": None, "tier": tier})
    return Assignment(Template(derived_template_id(core), core), bonus=goal)


# ---------------------------------------------------------------------------
# Pure: which bonus
# ---------------------------------------------------------------------------


def _mixed_history() -> InstallHistory:
    # twenty48 and yacht are played (affinity); the other games with specs are not.
    plays = _plays("twenty48", [1000, 1200, 1400, 1600]) + _plays("yacht", [100, 120, 200])
    return _history(_DAY, plays)


def test_share_one_is_always_a_discovery_goal_of_an_unplayed_game() -> None:
    h = _mixed_history()
    for seed in range(60):
        goal = choose_bonus(h, _DAY, _FREE, _core_of("twenty48"), session_id=f"s{seed}", share=1.0)
        assert goal is not None and bonus_kind(goal) == "discovery"
        assert goal.tier == DISCOVERY_TIER
        # never played, not core (Sort is a spec game again, #4028)
        assert goal.game_type in {"sudoku", "solitaire", "freecell", "sort"}


def test_share_zero_is_always_a_stretch_in_an_affinity_game() -> None:
    h = _mixed_history()
    for seed in range(60):
        goal = choose_bonus(h, _DAY, _FREE, _core_of("sudoku"), session_id=f"s{seed}", share=0.0)
        assert goal is not None and bonus_kind(goal) == "stretch"
        assert goal.game_type in {"twenty48", "yacht"}


def test_a_stretch_bonus_doubles_the_stretch_and_stays_capped_at_the_best() -> None:
    # yacht scores 100, 120, 200: median 120, best 200. 12 %: 134.4 -> 135 (the core
    # step); doubled to 24 %: 148.8 -> 150, still under the best (200).
    h = _history(_DAY, _plays("yacht", [100, 120, 200]))
    goal = choose_bonus(h, _DAY, ["yacht"], _core_of("sudoku"), session_id="s", share=0.0)
    assert goal is not None and goal.target == 150
    # A 50 % stretch doubles to 100 %: 240, capped at the best (200).
    goal = choose_bonus(h, _DAY, ["yacht"], _core_of("sudoku"), session_id="s", share=0.0, pct=50)
    assert goal is not None and goal.target == 200


def test_the_bonus_is_never_a_core_game_and_never_luck_dependent() -> None:
    h = _mixed_history()
    for seed in range(200):
        sid = f"seed{seed}"
        core = choose_core(h, _DAY, _FREE, session_id=sid)
        goal = choose_bonus(h, _DAY, _FREE, core, session_id=sid)
        assert goal is not None
        assert goal.game_type not in {g.game_type for g in core}
        assert not goal.is_win


def test_the_draw_is_deterministic() -> None:
    h = _mixed_history()
    core = choose_core(h, _DAY, _FREE, session_id="same")
    assert core == choose_core(h, _DAY, _FREE, session_id="same")
    first = choose_bonus(h, _DAY, _FREE, core, session_id="same")
    assert first is not None
    assert first == choose_bonus(h, _DAY, _FREE, core, session_id="same")


def test_the_discovery_share_is_honoured_over_many_seeds() -> None:
    h = _mixed_history()
    kinds = Counter(
        bonus_kind(g)
        for seed in range(400)
        if (g := choose_bonus(h, _DAY, _FREE, _core_of("sudoku"), session_id=f"x{seed}", share=0.3))
    )
    assert 0.2 < kinds["discovery"] / 400 < 0.4


def test_a_kind_with_no_candidate_falls_back_to_the_other_then_to_none() -> None:
    # Everything played: no discovery candidate, so a wanted discovery becomes a stretch.
    plays = [p for g in _FREE for p in _plays(g, [150, 160, 170])]
    h = _history(_DAY, plays)
    goal = choose_bonus(h, _DAY, _FREE, _core_of("sudoku"), session_id="s", share=1.0)
    assert goal is not None and bonus_kind(goal) == "stretch"
    # Only the core game is eligible: nothing to offer.
    assert choose_bonus(h, _DAY, ["yacht"], _core_of("yacht"), session_id="s") is None
    assert choose_bonus(_history(_DAY, []), _DAY, [], _core_of("yacht"), session_id="s") is None


def test_the_discovery_goal_is_the_cold_start_goal_in_the_easy_tier() -> None:
    for game, spec in GAME_SPECS.items():
        goal = personal._discovery_goal(game)
        cold = spec.type(spec.cold_type)
        assert (goal.kind, goal.target, goal.tier) == (cold.kind, spec.cold_target, "easy")


def test_a_discovery_bonus_offered_three_times_and_ignored_rests_the_game() -> None:
    days = [_DAY - timedelta(days=d) for d in (3, 4, 5)]
    ignored = {d: _bonus_assignment("sudoku", "easy") for d in days}
    h = _history(_DAY, [], ignored)
    assert "sudoku" not in discovery_candidates(h, _FREE, _DAY)
    goal = choose_bonus(h, _DAY, ["sudoku"], _core_of("yacht"), session_id="s", share=1.0)
    assert goal is None
    # Two ignores: still a candidate.
    h = _history(_DAY, [], {d: ignored[d] for d in days[1:]})
    goal = choose_bonus(h, _DAY, ["sudoku"], _core_of("yacht"), session_id="s", share=1.0)
    assert goal is not None and goal.game_type == "sudoku"
    # Stretch bonuses (tier medium) never rest a game.
    stretch = {d: _bonus_assignment("sudoku", "medium") for d in days}
    assert "sudoku" in discovery_candidates(_history(_DAY, [], stretch), _FREE, _DAY)


def test_playing_the_offered_discovery_game_resets_the_rest_count() -> None:
    days = [_DAY - timedelta(days=d) for d in (3, 4, 5)]
    plays = [("sudoku", days[0], {"won": True})]
    h = _history(_DAY, plays, {d: _bonus_assignment("sudoku", "easy") for d in days})
    assert not personal.resting(h, "sudoku", _DAY)  # only two of the three were ignored


# ---------------------------------------------------------------------------
# Service: the bonus is pinned with the day
# ---------------------------------------------------------------------------


@needs_db
async def test_a_personal_pick_carries_a_bonus_and_the_dial_turns_it_off(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sid = str(uuid.uuid4())
    today = local_day(0).date
    await _seed_2048(sid, today)
    async with get_session_factory()() as db:
        picked = await service.pick_for_install(db, sid, today)
    assert picked.bonus is not None
    assert picked.bonus.game_type not in {g.game_type for g in picked.template.goals}

    monkeypatch.setenv("DAILY_CHALLENGE_BONUS_ENABLED", "false")
    monkeypatch.setattr(personal, "_settings", None)
    async with get_session_factory()() as db:
        off = await service.pick_for_install(db, sid, today)
    assert off.bonus is None and off.template == picked.template


@needs_db
async def test_a_shared_template_day_has_no_bonus(client: TestClient) -> None:
    sid = str(uuid.uuid4())  # a new install: no history, so the shared template
    status = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    assert status["bonus"] is None
    days = client.get("/daily-challenge/upcoming", headers=_headers(sid)).json()["days"]
    assert [d["bonus"] for d in days] == [None] * 3


@needs_db
async def test_status_reports_the_bonus_and_its_completion_apart_from_the_core_goals(
    client: TestClient,
) -> None:
    sid = str(uuid.uuid4())
    today = local_day(0).date
    await _seed_2048(sid, today)
    body = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    bonus = body["bonus"]
    assert bonus is not None and bonus["completed"] is False
    assert set(bonus) == {"id", "game_type", "kind", "target", "completed", "best_score"}
    # Older-build shape: exactly three core goals; the bonus is not among them.
    assert len(body["goals"]) == body["total_goals"] == 3
    assert bonus["id"] not in {g["id"] for g in body["goals"]}

    up = client.get("/daily-challenge/upcoming", headers=_headers(sid)).json()
    assert up["days"][0]["bonus"]["id"] == bonus["id"]

    # Finish a game of the bonus game that meets its goal (every discovery goal accepts
    # a won game with a large score): the bonus completes; the core count and the day's
    # completion do not move.
    await _add(
        sid,
        bonus["game_type"],
        datetime.now(UTC) - timedelta(minutes=1),
        final_score=100000,
        metadata={"won": True},
    )
    after = client.get("/daily-challenge/status", headers=_headers(sid)).json()
    assert after["bonus"]["id"] == bonus["id"] and after["bonus"]["completed"] is True
    assert after["completed_goals"] == body["completed_goals"]
    assert after["total_goals"] == 3 and after["completed"] is False


def test_the_bonus_is_ignored_by_completed_and_completed_goals() -> None:
    day = local_day(0)
    core = _core_of("twenty48", "yacht")
    template = Template("t", core)
    done = tuple(service.GoalStatus(g, True, None) for g in core)
    bonus = service.GoalStatus(personal._discovery_goal("sudoku"), False, None)
    status = service.ChallengeStatus(day, "free", template, done, bonus)
    assert status.completed and status.completed_goals == 3
    # A done bonus does not complete a day with unmet core goals.
    partial = (done[0], done[1], service.GoalStatus(core[2], False, None))
    done_bonus = service.GoalStatus(personal._discovery_goal("sudoku"), True, None)
    status = service.ChallengeStatus(day, "free", template, partial, done_bonus)
    assert not status.completed and status.completed_goals == 2


def test_the_two_dials_have_their_documented_defaults_and_ranges(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert personal.bonus_enabled() is True and personal.discovery_share() == 0.5
    monkeypatch.setenv("DAILY_CHALLENGE_DISCOVERY_SHARE", "1.5")
    with pytest.raises(ValidationError):
        Settings()
    monkeypatch.setenv("DAILY_CHALLENGE_DISCOVERY_SHARE", "0")
    monkeypatch.setattr(personal, "_settings", None)
    assert personal.discovery_share() == 0.0


def test_a_stretch_bonus_is_never_a_cold_start_goal() -> None:
    # yacht has 4 plays (a real target); twenty48 has 1 (only its cold-start goal).
    plays = _plays("yacht", [100, 120, 140, 160]) + _plays("twenty48", [900])
    h = _history(_DAY, plays)
    cold = personal._discovery_goal("twenty48")
    for seed in range(100):
        goal = choose_bonus(h, _DAY, _FREE, _core_of("sudoku"), session_id=f"c{seed}", share=0.0)
        assert goal is not None and goal.game_type == "yacht"
        assert goal.id != cold.id


def test_core_picks_are_identical_with_the_bonus_on_and_off(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    h = _mixed_history()
    for seed in range(100):
        sid = f"core{seed}"
        on = choose_core(h, _DAY, _FREE, session_id=sid)
        monkeypatch.setenv("DAILY_CHALLENGE_BONUS_ENABLED", "false")
        monkeypatch.setattr(personal, "_settings", None)
        off = choose_core(h, _DAY, _FREE, session_id=sid)
        monkeypatch.delenv("DAILY_CHALLENGE_BONUS_ENABLED")
        monkeypatch.setattr(personal, "_settings", None)
        assert on == off
