"""``YachtResult`` and the final scorecard (#2839).

No database: these run in every environment. The round trip through
``PATCH /games/{id}/complete`` and ``GET /games/{id}`` is in
``test_yacht_api.py``.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest

from games.registry import get_module
from vocab import GameType
from yacht.models import CATEGORY_MAX, YachtResult
from yacht.module import module

_ENGINE = Path(__file__).resolve().parents[2] / "frontend" / "src" / "game" / "yacht" / "engine.ts"

# A finished card: upper 3+6+9+12+15+18 = 63 (bonus 35); lower 97.
_FULL = {
    "ones": 3,
    "twos": 6,
    "threes": 9,
    "fours": 12,
    "fives": 15,
    "sixes": 18,
    "three_of_a_kind": 20,
    "four_of_a_kind": 0,
    "full_house": 25,
    "small_straight": 30,
    "large_straight": 0,
    "yacht": 0,
    "chance": 22,
}
_FULL_TOTAL = sum(_FULL.values()) + 35  # 195


def _card(categories: dict[str, int], **bonus: int) -> dict[str, Any]:
    return {"categories": categories, **bonus}


def _result(**kw: Any) -> dict[str, Any]:
    return {"outcome": "completed", "upper_bonus": 0, "yacht_bonus_total": 0, **kw}


def _dump(raw: dict[str, Any]) -> dict[str, Any]:
    return YachtResult.model_validate(raw).model_dump(exclude_unset=True)


def test_module_registers_the_result_model() -> None:
    assert module.result_model is YachtResult
    assert get_module(GameType.YACHT.value) is not None


def test_category_keys_match_the_engine() -> None:
    src = _ENGINE.read_text()
    block = re.search(r"export const CATEGORIES = \[(.*?)\] as const", src, re.DOTALL)
    assert block is not None
    assert re.findall(r'"(\w+)"', block.group(1)) == list(CATEGORY_MAX)


def test_max_scores_reach_the_board_ceiling() -> None:
    # 13 categories at their maximum, the upper bonus and 12 extra Yachts.
    assert sum(CATEGORY_MAX.values()) + 35 + 12 * 100 >= 1575


def test_regular_game_reconciles() -> None:
    out = _dump(
        _result(final_score=_FULL_TOTAL, upper_bonus=35, scorecard=_card(_FULL, upper_bonus=35))
    )
    assert out["scorecard_reconciled"] is True
    assert out["scorecard"]["categories"] == _FULL
    assert out["scorecard"]["upper_bonus"] == 35


def test_joker_game_counts_the_bonus_once() -> None:
    # Yacht 50, then two Jokers: sixes 30 and full house 25 (flat), 200 bonus.
    cats = {"yacht": 50, "sixes": 30, "full_house": 25}
    total = 50 + 30 + 25 + 200
    card = _card(cats, yacht_bonus_count=2, yacht_bonus_total=200)
    ok = _dump(_result(final_score=total, yacht_bonus_total=200, scorecard=card))
    assert ok["scorecard_reconciled"] is True
    # Counting the Joker's points twice, or leaving the bonus out, is flagged.
    for wrong in (total + 100, total - 200):
        assert _dump(_result(final_score=wrong, scorecard=card))["scorecard_reconciled"] is False


@pytest.mark.parametrize(
    "card",
    [
        # bonus without a Yacht scored at 50
        _card({"yacht": 0}, yacht_bonus_count=1, yacht_bonus_total=100),
        # total does not match the count
        _card({"yacht": 50}, yacht_bonus_count=1, yacht_bonus_total=200),
        # an upper bonus the upper section did not earn
        _card({"ones": 1}, upper_bonus=35),
    ],
)
def test_inconsistent_card_is_stored_and_flagged_not_rejected(card: dict[str, Any]) -> None:
    total = sum(card["categories"].values()) + card.get("upper_bonus", 0)
    total += card.get("yacht_bonus_total", 0)
    out = _dump(_result(final_score=total, scorecard=card))
    assert out["scorecard_reconciled"] is False
    assert out["scorecard"]["categories"] == card["categories"]


def test_upper_bonus_needs_a_complete_upper_section() -> None:
    upper = {"ones": 5, "twos": 10, "threes": 15, "fours": 20, "fives": 25}  # sixes open
    early = _dump(_result(final_score=75 + 35, scorecard=_card(upper, upper_bonus=35)))
    assert early["scorecard_reconciled"] is False
    assert _dump(_result(final_score=75, scorecard=_card(upper)))["scorecard_reconciled"] is True


def test_abandoned_game_needs_no_full_card() -> None:
    out = _dump({"outcome": "abandoned", "final_score": 6, "scorecard": _card({"twos": 6})})
    assert out["scorecard_reconciled"] is True
    assert set(out["scorecard"]["categories"]) == {"twos"}
    empty = _dump({"outcome": "abandoned", "final_score": 0, "scorecard": _card({})})
    assert empty["scorecard_reconciled"] is True


def test_vs_result_keeps_each_side_apart() -> None:
    out = _dump(
        _result(
            outcome="win",
            vs_result="win",
            final_score=_FULL_TOTAL,
            upper_bonus=35,
            scorecard=_card(_FULL, upper_bonus=35),
            opponent_score=3,
            opponent_scorecard=_card({"ones": 3}),
        )
    )
    assert out["scorecard_reconciled"] is True
    assert out["scorecard"]["categories"]["twos"] == 6
    assert out["opponent_scorecard"]["categories"] == {"ones": 3}
    assert out["opponent_score"] == 3
    # The opponent's card reconciles to the opponent's total, not the player's.
    bad = _dump(
        _result(
            final_score=_FULL_TOTAL,
            scorecard=_card(_FULL, upper_bonus=35),
            opponent_score=99,
            opponent_scorecard=_card({"ones": 3}),
        )
    )
    assert bad["scorecard_reconciled"] is False


@pytest.mark.parametrize(
    "old",
    [
        {},
        {"final_score": 180, "upper_bonus": 0, "yacht_bonus_total": 0, "outcome": "completed"},
        {
            "final_score": 180,
            "upper_bonus": 35,
            "yacht_bonus_total": 100,
            "outcome": "win",
            "opponent_score": 150,
            "vs_result": "win",
        },
        {"final_score": 12, "outcome": "abandoned", "future_key": {"a": 1}},
    ],
)
def test_pre_2839_payloads_are_unchanged(old: dict[str, Any]) -> None:
    assert _dump(old) == old


@pytest.mark.parametrize(
    "scorecard",
    [
        {"categories": {"bogus": 1}},  # unknown category
        {"categories": {"ones": 6}},  # above the category's maximum
        {"categories": {"yacht": 51}},
        {"categories": {"chance": -1}},
        {"categories": {"chance": 12.5}},
        {"categories": {"chance": "12"}},
        {"categories": {"chance": True}},
        {"categories": {}, "upper_bonus": 36},
        {"categories": {}, "yacht_bonus_count": 13},
        {"categories": {}, "yacht_bonus_total": 1300},
        {"ones": 1},  # categories missing
        "not a card",
        [1, 2],
    ],
)
def test_out_of_shape_scorecard_is_dropped_flagged_and_reported(
    scorecard: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    reports: list[tuple[Any, ...]] = []
    monkeypatch.setattr("games.sessions._report_rejected_result", lambda *a: reports.append(a))
    out = _dump(_result(final_score=10, scorecard=scorecard))
    assert "scorecard" not in out
    assert out["scorecard_reconciled"] is False
    assert out["final_score"] == 10
    assert len(reports) == 1 and reports[0][0] == "yacht"


def test_a_bad_opponent_card_is_dropped_but_the_players_kept(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("games.sessions._report_rejected_result", lambda *a: None)
    out = _dump(
        _result(
            final_score=3,
            scorecard=_card({"ones": 3}),
            opponent_score=5,
            opponent_scorecard={"categories": {"bogus": 5}},
        )
    )
    assert out["scorecard"]["categories"] == {"ones": 3}
    assert "opponent_scorecard" not in out
    assert out["scorecard_reconciled"] is False


def test_unknown_key_inside_a_card_does_not_invalidate_it() -> None:
    card = {**_card({"ones": 3}), "future_field": 1}
    out = _dump(_result(final_score=3, scorecard=card))
    assert out["scorecard_reconciled"] is True
    assert out["scorecard"]["categories"] == {"ones": 3}


def test_player_card_reconciles_to_the_complete_body_score() -> None:
    raw = _result(final_score=_FULL_TOTAL, scorecard=_card(_FULL, upper_bonus=35))
    ok = YachtResult.model_validate(raw, context={"final_score": _FULL_TOTAL})
    assert ok.model_dump(exclude_unset=True)["scorecard_reconciled"] is True
    # The row's score differs from what the card (and the result's copy) says.
    bad = YachtResult.model_validate(raw, context={"final_score": 999})
    assert bad.model_dump(exclude_unset=True)["scorecard_reconciled"] is False
    # The card matches the body but the result's own copy disagrees.
    skew = _result(final_score=1, scorecard=_card(_FULL, upper_bonus=35))
    out = YachtResult.model_validate(skew, context={"final_score": _FULL_TOTAL})
    assert out.model_dump(exclude_unset=True)["scorecard_reconciled"] is False


@pytest.mark.parametrize("context", [None, {}, {"final_score": None}])
def test_without_a_body_score_the_result_copy_is_used(context: Any) -> None:
    raw = _result(final_score=_FULL_TOTAL, scorecard=_card(_FULL, upper_bonus=35))
    out = YachtResult.model_validate(raw, context=context)
    assert out.model_dump(exclude_unset=True)["scorecard_reconciled"] is True


def test_null_card_is_no_card() -> None:
    out = _dump(_result(scorecard=None))
    assert "scorecard" not in out
    assert "scorecard_reconciled" not in out


@pytest.mark.parametrize(
    "legacy",
    [
        {"final_score": 12.5, "outcome": "x" * 50},
        {"final_score": -3, "upper_bonus": "35", "yacht_bonus_total": None},
        {"final_score": "180", "opponent_score": 1.0, "vs_result": "y" * 99},
        {"outcome": None, "final_score": True},
    ],
)
def test_legacy_top_level_oddities_pass_through_unchanged(legacy: dict[str, Any]) -> None:
    out = _dump(legacy)
    assert out == legacy
    assert [type(v) for v in out.values()] == [type(v) for v in legacy.values()]


def test_client_cannot_set_the_reconciled_flag() -> None:
    out = _dump(_result(final_score=5, scorecard=_card({"ones": 1}), scorecard_reconciled=True))
    assert out["scorecard_reconciled"] is False
    assert "scorecard_reconciled" not in _dump(_result(scorecard_reconciled=True))


# The service path (`PATCH /games/{id}/complete` validates through it, and
# `games.metadata` stores what it returns), without a database.


async def test_service_validates_and_returns_the_stored_block() -> None:
    from games import sessions as service

    card = {"categories": {"yacht": 50}}
    result = _result(final_score=345, scorecard=card)
    stored = await service._validate_result(None, None, result, "yacht", module)  # type: ignore[arg-type]
    assert stored["scorecard"]["categories"] == {"yacht": 50}
    assert stored["scorecard_reconciled"] is False  # 50 is not 345


async def test_service_reconciles_the_card_against_the_body_final_score() -> None:
    from games import sessions as service

    result = _result(final_score=_FULL_TOTAL, scorecard=_card(_FULL, upper_bonus=35))
    ok = await service._validate_result(
        None, None, result, "yacht", module, _FULL_TOTAL  # type: ignore[arg-type]
    )
    assert ok["scorecard_reconciled"] is True
    # The row scores 999: the card explains the result's copy, not the row.
    bad = await service._validate_result(
        None, None, result, "yacht", module, 999  # type: ignore[arg-type]
    )
    assert bad["scorecard_reconciled"] is False
    assert bad["scorecard"]["categories"] == _FULL
    # An abandon has no body score: the result's own copy is used.
    none = await service._validate_result(
        None, None, result, "yacht", module, None  # type: ignore[arg-type]
    )
    assert none["scorecard_reconciled"] is True


async def test_service_completes_with_a_bad_card_dropped_and_rejects_only_oversize(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from games import sessions as service

    reports: list[Any] = []
    monkeypatch.setattr("games.sessions._report_rejected_result", lambda *a: reports.append(a))
    bad = _result(final_score=10, scorecard={"categories": {"bogus": 1}})
    stored = await service._validate_result(None, None, bad, "yacht", module)  # type: ignore[arg-type]
    assert "scorecard" not in stored
    assert stored["scorecard_reconciled"] is False
    assert stored["final_score"] == 10
    assert len(reports) == 1
    big = _result(pad="x" * 9000)
    with pytest.raises(service.GameServiceError):
        await service._validate_result(None, None, big, "yacht", module)  # type: ignore[arg-type]
