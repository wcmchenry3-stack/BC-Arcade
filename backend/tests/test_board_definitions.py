"""Board definitions declared on each GameModule (#2617, epic #2519 §4.2).

Covers the ``BoardDefinition`` model, the per-game values the owner decided,
and the ``max_value`` caps that are recomputed from the frontend engines'
scoring constants so a constant change fails here until the cap is updated.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from pydantic import ValidationError

from games.board import FINAL_TIEBREAK, SCORE_METRIC, BoardDefinition
from games.registry import get_module

_FRONTEND_GAME = Path(__file__).parents[2] / "frontend" / "src" / "game"


def _board(game: str) -> BoardDefinition:
    mod = get_module(game)
    assert mod is not None and mod.board is not None, f"{game} has no board"
    return mod.board


# ---------------------------------------------------------------------------
# BoardDefinition model
# ---------------------------------------------------------------------------


def test_defaults() -> None:
    board = BoardDefinition(metric=SCORE_METRIC, direction="desc", label_key="score")
    assert board.tiebreak is None
    assert board.partitions == []
    assert board.max_value is None
    assert board.enabled is True


def test_final_tiebreak_is_earliest_completion() -> None:
    assert FINAL_TIEBREAK == ("completed_at", "asc")


@pytest.mark.parametrize(
    "overrides",
    [
        {"direction": "up"},
        {"tiebreak": ("total_moves", "sideways")},
        {"metric": ""},
        {"label_key": ""},
        {"max_value": -1},
        {"unknown": 1},
    ],
    ids=["direction", "tiebreak-direction", "empty-metric", "empty-label", "negative-max", "extra"],
)
def test_rejects_invalid_values(overrides: dict) -> None:
    fields = {"metric": SCORE_METRIC, "direction": "desc", "label_key": "score", **overrides}
    with pytest.raises(ValidationError):
        BoardDefinition(**fields)


def test_is_immutable() -> None:
    board = _board("yacht")
    with pytest.raises(ValidationError):
        board.max_value = 999  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Declared values (plan §4.2 table and owner decisions §8)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "game,metric,direction,tiebreak,partitions,max_value,enabled",
    [
        ("yacht", SCORE_METRIC, "desc", None, [], 400, True),
        ("solitaire", SCORE_METRIC, "desc", None, [], 1245, True),
        ("freecell", SCORE_METRIC, "asc", None, [], None, True),
        ("mahjong", SCORE_METRIC, "desc", None, [], 1220, True),
        ("hearts", SCORE_METRIC, "desc", None, [], 100, True),
        ("sudoku", SCORE_METRIC, "desc", None, ["difficulty", "variant"], 300, True),
        ("cascade", SCORE_METRIC, "desc", None, [], None, True),
        ("sort", "level_reached", "desc", ("total_moves", "asc"), [], 23, True),
        ("blackjack", SCORE_METRIC, "desc", None, [], None, False),
        ("daily_word", "guesses_used", "asc", None, [], None, False),
    ],
)
def test_declared_board(game, metric, direction, tiebreak, partitions, max_value, enabled) -> None:
    board = _board(game)
    assert board.metric == metric
    assert board.direction == direction
    assert board.tiebreak == tiebreak
    assert board.partitions == partitions
    assert board.max_value == max_value
    assert board.enabled is enabled


def test_existing_request_bounds_match_max_value() -> None:
    """The per-game submit bounds that exist today agree with the boards."""
    from sort.models import ScoreSubmitRequest as SortSubmit
    from yacht.models import YachtScoreSubmitRequest

    def le(model, field: str) -> int:
        return next(m.le for m in model.model_fields[field].metadata if hasattr(m, "le"))

    assert le(YachtScoreSubmitRequest, "score") == _board("yacht").max_value
    assert le(SortSubmit, "level_reached") == _board("sort").max_value


# ---------------------------------------------------------------------------
# Caps recomputed from the engines' scoring constants
# ---------------------------------------------------------------------------


def _ts_constants(path: Path) -> dict[str, int]:
    """Top-level ``const NAME = <int>;`` declarations in a TypeScript file."""
    text = path.read_text(encoding="utf-8")
    pattern = r"^(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=\s*(-?\d+)\s*;"
    return {name: int(value) for name, value in re.findall(pattern, text, re.MULTILINE)}


def test_solitaire_max_value_recomputed_from_engine() -> None:
    """1245 (#2519 decision 13).

    Stock cards: waste -> tableau, then tableau -> foundation. Dealt cards go
    tableau -> foundation. Every face-down dealt card is revealed once. Plus the
    win bonus. Moving a card off a foundation costs more than returning it
    earns, so replays can't farm points.
    """
    c = _ts_constants(_FRONTEND_GAME / "solitaire" / "engine.ts")
    columns, deck = c["TABLEAU_COLUMNS"], c["DECK_SIZE"]
    dealt = columns * (columns + 1) // 2  # 28
    stock = deck - dealt  # 24
    reveals = dealt - columns  # 21

    best_stock_card = max(
        c["SCORE_WASTE_TO_TABLEAU"] + c["SCORE_TABLEAU_TO_FOUNDATION"],
        c["SCORE_WASTE_TO_FOUNDATION"],
    )
    expected = (
        stock * best_stock_card
        + dealt * c["SCORE_TABLEAU_TO_FOUNDATION"]
        + reveals * c["SCORE_REVEAL"]
        + c["SCORE_WIN_BONUS"]
    )

    # Assumptions the formula relies on: no farming loop, penalties are penalties.
    assert c["SCORE_FOUNDATION_TO_TABLEAU"] + c["SCORE_TABLEAU_TO_FOUNDATION"] < 0
    assert c["SCORE_RECYCLE_PENALTY"] <= 0
    assert _board("solitaire").max_value == expected == 1245


def test_mahjong_max_value_recomputed_from_engine() -> None:
    """1220: every pair on the largest layout plus the completion bonus."""
    c = _ts_constants(_FRONTEND_GAME / "mahjong" / "engine.ts")
    registry = (_FRONTEND_GAME / "mahjong" / "layouts" / "registry.ts").read_text(encoding="utf-8")
    tile_counts = [int(n) for n in re.findall(r"tileCount:\s*(\d+)", registry)]
    assert tile_counts, "no tileCount found in the Mahjong layout registry"

    expected = max(tile_counts) // 2 * c["SCORE_PER_PAIR"] + c["SCORE_COMPLETE_BONUS"]
    assert _board("mahjong").max_value == expected == 1220
