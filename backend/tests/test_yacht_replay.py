"""Rebuilding a Yacht game from its ``turn_completed`` events (#3282).

``fixtures/yacht_turn_events_v1.json`` is a scripted 13-round vs-computer game
as the app records it. Its totals come from the app's engine; the Python
scoring rules in ``yacht/replay.py`` must rebuild the same two scorecards from
the events alone, which is the golden check across the two languages.
"""

from __future__ import annotations

import copy
import importlib.util
import json
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import select

from db.base import get_session_factory
from db.models import EventType, Game, GameEvent, GameType
from yacht.replay import (
    Card,
    _alternatives,
    category_score,
    joker_score,
    rebuild,
    render_scorecards,
)
from yacht.turn_event import CATEGORY_ORDER, validate_turn

_FIXTURE = Path(__file__).parent / "fixtures" / "yacht_turn_events_v1.json"
_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "replay_game.py"
_spec = importlib.util.spec_from_file_location("replay_game_yacht", _SCRIPT)
assert _spec and _spec.loader
replay_game = importlib.util.module_from_spec(_spec)
sys.modules["replay_game_yacht"] = replay_game
_spec.loader.exec_module(replay_game)


_DIFF_FIXTURE = Path(__file__).parent / "fixtures" / "yacht_turn_events_diff_v1.json"


def _fixture() -> dict[str, Any]:
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))


def _pairs() -> list[tuple[str, dict[str, Any]]]:
    return [(e["type"], copy.deepcopy(e["data"])) for e in _fixture()["events"]]


# ---------------------------------------------------------------------------
# golden: both scorecards of the finished vs game
# ---------------------------------------------------------------------------


def test_rebuilds_both_scorecards_of_a_finished_vs_game() -> None:
    rebuilt = rebuild(_pairs())
    assert rebuilt.problems == []
    totals = _fixture()["totals"]
    assert set(rebuilt.cards) == {0, 1}
    assert rebuilt.cards[0].total == totals["0"] == 405
    assert rebuilt.cards[1].total == totals["1"]
    for card in rebuilt.cards.values():
        assert card.finished
        assert card.turns == 13
        assert card.round == 14


def test_the_human_card_has_the_yacht_the_joker_and_the_upper_bonus() -> None:
    card = rebuild(_pairs()).cards[0]
    assert card.categories["yacht"] == 50
    assert card.categories["sixes"] == 30  # the extra Yacht, forced into sixes
    assert card.yacht_bonus_count == 1
    assert card.upper_subtotal == 75
    assert card.upper_bonus == 35
    assert card.total == sum(v for v in card.categories.values() if v is not None) + 35 + 100


def test_the_computer_card_has_its_own_joker_and_no_upper_bonus() -> None:
    card = rebuild(_pairs()).cards[1]
    assert card.categories["fours"] == 20
    assert card.yacht_bonus_count == 1
    assert card.upper_bonus == 0


def test_a_solo_game_rebuilds_with_no_actor() -> None:
    solo = []
    for name, data in _pairs():
        if data["actor"]["seat"] == 0:
            data.pop("actor")
            solo.append((name, data))
    rebuilt = rebuild(solo)
    assert rebuilt.problems == []
    assert set(rebuilt.cards) == {0}
    assert rebuilt.cards[0].total == 405


def test_events_that_are_not_turns_are_ignored() -> None:
    mixed = [("game_started", {"v": 1}), ("roll", {"dice": [1]}), *_pairs(), ("game_ended", {})]
    assert rebuild(mixed).problems == []


# ---------------------------------------------------------------------------
# a recording that disagrees with the replay is reported, not hidden
# ---------------------------------------------------------------------------


def _mutated(index: int, **changes: Any) -> list[tuple[str, dict[str, Any]]]:
    pairs = _pairs()
    pairs[index][1].update(changes)
    return pairs


@pytest.mark.parametrize(
    ("change", "what"),
    [
        ({"s": [0, 4]}, "value"),
        ({"tot": 999}, "total"),
        ({"us": 1}, "upper subtotal"),
        ({"jk": 1}, "joker flag"),
        ({"yb": 1}, "yacht bonus flag"),
        ({"ub": 1}, "upper bonus flag"),
        ({"yc": 3}, "yacht bonus count"),
        ({"alt": [0, 0]}, "alternatives"),
        ({"r": 5}, "expected round 1"),
    ],
)
def test_reports_each_kind_of_disagreement(change: dict[str, Any], what: str) -> None:
    problems = rebuild(_mutated(0, **change)).problems
    assert problems, what
    assert any(what in p for p in problems)


def test_a_lost_roll_offset_is_reported() -> None:
    problems = rebuild(_mutated(0, ro=2)).problems
    assert problems == ["seat 0 round 1: 2 roll(s) lost to an app kill"]


def test_a_missing_turn_shows_as_a_round_mismatch() -> None:
    pairs = _pairs()
    del pairs[2]  # the human's round 2
    problems = rebuild(pairs).problems
    assert any("seat 0 round 3: expected round 2" in p for p in problems)


def test_a_filled_category_is_reported_and_skipped() -> None:
    pairs = _pairs()
    pairs.insert(2, copy.deepcopy(pairs[0]))  # the human's round-1 turn again
    problems = rebuild(pairs).problems
    assert "seat 0 round 1: yacht is already filled" in problems


def test_an_unfinished_card_is_reported() -> None:
    """A recording that stops early (the app went away during the last turns, a kill) says so."""
    human_first_six = [p for p in _pairs() if p[1]["actor"]["seat"] == 0][:6]
    rebuilt = rebuild(human_first_six)
    assert rebuilt.problems == ["seat 0: card unfinished (6 of 13 turns)"]
    # the computer's last turn missing (unit 26 refused after the session ended)
    pairs = _pairs()[:-1]
    assert rebuild(pairs).problems == ["seat 1: card unfinished (12 of 13 turns)"]
    assert "problems   1" in "\n".join(render_scorecards(rebuild(pairs)))
    # a finished card, and a recording with no turn at all, have no such line
    assert rebuild(_pairs()).problems == []
    assert rebuild([]).problems == []


def test_a_duplicated_turn_after_a_crash_is_reported_as_already_filled() -> None:
    """A crash between the save and the state save replays the turn: the second copy is a problem line."""
    pairs = _pairs()
    pairs.insert(1, copy.deepcopy(pairs[0]))
    assert "seat 0 round 1: yacht is already filled" in rebuild(pairs).problems


def test_seeded_random_games_rebuild_to_the_engines_totals() -> None:
    """The cross-language differential: 40 games from the app's engine (Jokers of every
    priority, several Yacht bonuses, a scratched Yacht then a Yacht roll), each event valid
    and each game rebuilt by the Python rules to the engine's totals."""
    diff = json.loads(_DIFF_FIXTURE.read_text(encoding="utf-8"))
    cov = diff["coverage"]
    assert all(cov[k] > 0 for k in cov), cov
    assert len(diff["games"]) == 40
    for n, game in enumerate(diff["games"]):
        for e in game["events"]:
            assert validate_turn(copy.deepcopy(e["data"])) == e["data"], (n, e["data"])
        rebuilt = rebuild((e["type"], e["data"]) for e in game["events"])
        assert rebuilt.problems == [], (n, rebuilt.problems[:3])
        assert [rebuilt.cards[s].total for s in sorted(rebuilt.cards)] == game["totals"], n


@pytest.mark.parametrize(
    "bad", [{}, {"rolls": [], "s": [0, 0]}, {"rolls": [[[1] * 5]], "s": [99, 0]}]
)
def test_a_malformed_turn_is_reported_not_raised(bad: dict[str, Any]) -> None:
    assert rebuild([("turn_completed", bad)]).problems == ["seat 0 round None: malformed turn"]


# ---------------------------------------------------------------------------
# the scoring rules (a port of engine.ts)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("category", "dice", "expected"),
    [
        ("ones", [1, 1, 3, 4, 1], 3),
        ("sixes", [6, 6, 1, 2, 3], 12),
        ("three_of_a_kind", [4, 4, 4, 1, 2], 15),
        ("three_of_a_kind", [4, 4, 5, 1, 2], 0),
        ("four_of_a_kind", [2, 2, 2, 2, 5], 13),
        ("four_of_a_kind", [2, 2, 2, 5, 5], 0),
        ("full_house", [3, 3, 5, 5, 5], 25),
        ("full_house", [3, 3, 3, 3, 3], 0),
        ("small_straight", [1, 2, 3, 4, 6], 30),
        ("small_straight", [3, 4, 5, 6, 6], 30),
        ("small_straight", [1, 2, 4, 5, 6], 0),
        ("large_straight", [2, 3, 4, 5, 6], 40),
        ("large_straight", [1, 2, 3, 4, 6], 0),
        ("yacht", [5, 5, 5, 5, 5], 50),
        ("yacht", [5, 5, 5, 5, 4], 0),
        ("chance", [1, 2, 3, 4, 6], 16),
    ],
)
def test_category_score(category: str, dice: list[int], expected: int) -> None:
    assert category_score(category, dice) == expected


@pytest.mark.parametrize(
    ("category", "expected"),
    [
        ("fours", 20),
        ("three_of_a_kind", 20),
        ("four_of_a_kind", 20),
        ("full_house", 25),
        ("small_straight", 30),
        ("large_straight", 40),
        ("yacht", 50),
        ("chance", 20),
    ],
)
def test_joker_score(category: str, expected: int) -> None:
    assert joker_score(category, [4, 4, 4, 4, 4]) == expected


def test_every_category_is_scored() -> None:
    for category in CATEGORY_ORDER:
        assert isinstance(category_score(category, [1, 2, 3, 4, 5]), int)


def test_joker_placement_priorities() -> None:
    """The alternatives follow the Joker rule: the matching upper box, else open lower boxes, else open upper."""
    dice = [3, 3, 3, 3, 3]
    card = Card()
    card.categories["yacht"] = 50
    # 1. the matching upper box is open: it is the only choice (the chosen one is not listed)
    assert _alternatives(card, dice, "threes") == []
    card.categories["threes"] = 9
    lower = _alternatives(card, dice, "chance")
    assert lower[0::2] == [
        CATEGORY_ORDER.index(c)
        for c in (
            "three_of_a_kind",
            "four_of_a_kind",
            "full_house",
            "small_straight",
            "large_straight",
        )
    ]
    assert lower[1::2] == [15, 15, 25, 30, 40]
    for c in (
        "three_of_a_kind",
        "four_of_a_kind",
        "full_house",
        "small_straight",
        "large_straight",
        "chance",
    ):
        card.categories[c] = 0
    upper = _alternatives(card, dice, "ones")
    assert upper[0::2] == [CATEGORY_ORDER.index(c) for c in ("twos", "fours", "fives", "sixes")]


# ---------------------------------------------------------------------------
# the report: scripts/replay_game.py
# ---------------------------------------------------------------------------


def _game_row(final_score: int | None = 405) -> Any:
    return replay_game.GameRow(
        id=uuid.uuid4(),
        game_type="yacht",
        started_at=datetime(2026, 10, 15, tzinfo=UTC),
        completed_at=None,
        outcome="win",
        final_score=final_score,
        duration_ms=1,
        metadata={"mode": "vs", "difficulty": "hard"},
    )


def _event_rows() -> list[Any]:
    return [
        replay_game.EventRow(i, name, datetime(2026, 10, 15, tzinfo=UTC), data)
        for i, (name, data) in enumerate(_pairs())
    ]


def test_the_replay_script_prints_both_scorecards_of_a_yacht_game() -> None:
    report = replay_game.render(_game_row(), _event_rows())
    assert "scorecards rebuilt from turn_completed events" in report
    assert "player" in report and "computer" in report
    rows = {ln[2:18].strip(): ln[18:].split() for ln in report.splitlines() if ln.startswith("  ")}
    assert rows["total"] == ["405", str(_fixture()["totals"]["1"])]
    assert rows["turns"] == ["13", "13"]
    assert rows["yacht"] == ["50", "50"]
    assert rows["yacht bonus"] == ["100", "100"]
    assert rows["upper bonus"] == ["35", "0"]
    assert "player total matches games.final_score (405)" in report
    assert "problems   none" in report


def test_the_replay_script_flags_a_total_that_differs_from_the_row() -> None:
    report = replay_game.render(_game_row(final_score=300), _event_rows())
    assert "player total DIFFERS from games.final_score (300)" in report


def test_the_replay_script_lists_the_problems_of_a_bad_recording() -> None:
    rows = _event_rows()
    rows[0].data["tot"] = 1  # type: ignore[index]
    report = replay_game.render(_game_row(), rows)
    assert "problems   1" in report
    assert "seat 0 round 1: total differs" in report


def test_the_replay_script_says_so_for_a_yacht_game_with_no_turns() -> None:
    old = [replay_game.EventRow(0, "roll", None, {"dice": [1, 2, 3, 4, 5]})]
    report = replay_game.render(_game_row(), old)
    assert "no turn_completed events" in report


def test_the_replay_script_adds_nothing_for_other_games() -> None:
    other = replay_game.GameRow(
        id=uuid.uuid4(),
        game_type="twenty48",
        started_at=None,
        completed_at=None,
        outcome=None,
        final_score=None,
        duration_ms=None,
        metadata={},
    )
    assert "scorecards rebuilt" not in replay_game.render(other, [])


def test_render_scorecards_without_a_final_score_or_a_player() -> None:
    rebuilt = rebuild([p for p in _pairs() if p[1]["actor"]["seat"] == 1])
    text = "\n".join(render_scorecards(rebuilt, 405))
    assert "games.final_score" not in text  # no seat 0 to compare
    assert "\n".join(render_scorecards(rebuilt)).count("computer") == 1


# ---------------------------------------------------------------------------
# end to end: a stored game, through the script's own query
# ---------------------------------------------------------------------------


async def test_the_script_rebuilds_a_stored_vs_game_from_the_database() -> None:
    async with get_session_factory()() as s:
        gt = (await s.execute(select(GameType).where(GameType.name == "yacht"))).scalar_one()
        type_ids: dict[str, int] = {}
        for name in ("game_started", "turn_completed", "game_ended"):
            found = (
                await s.execute(
                    select(EventType.id).where(
                        EventType.game_type_id == gt.id, EventType.name == name
                    )
                )
            ).scalar_one_or_none()
            if found is None:
                et = EventType(game_type_id=gt.id, name=name, display_name=name)
                s.add(et)
                await s.flush()
                found = et.id
            type_ids[name] = found
        game = Game(
            session_id="replay-yacht-session",
            game_type_id=gt.id,
            outcome="win",
            final_score=_fixture()["totals"]["0"],
            duration_ms=1,
            game_metadata={"mode": "vs", "difficulty": "hard"},
        )
        s.add(game)
        await s.flush()
        rows = [
            ("game_started", {"v": 1, "mode": "vs", "cpu_type": "oracle", "difficulty": "hard"})
        ]
        rows += _pairs()
        rows.append(("game_ended", {"outcome": "win"}))
        for index, (name, data) in enumerate(rows):
            s.add(
                GameEvent(
                    game_id=game.id,
                    event_index=index,
                    event_type_id=type_ids[name],
                    data=data,
                )
            )
        await s.commit()
        game_id = game.id

    async with get_session_factory()() as s:
        found = await replay_game.fetch(s, game_id)
    assert found is not None
    report = replay_game.render(*found)
    assert "gaps       none" in report
    assert "scorecards rebuilt from turn_completed events" in report
    assert "player total matches games.final_score (405)" in report
    assert "problems   none" in report
