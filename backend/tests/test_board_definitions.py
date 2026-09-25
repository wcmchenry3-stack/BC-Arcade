"""Board definitions declared on each GameModule (#2617, epic #2519 §4.2).

Covers the ``BoardDefinition`` model, the per-game values the owner decided,
and the ``max_value`` caps that are recomputed from the frontend engines'
scoring constants so a constant change fails here until the cap is updated.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path

import pytest
from pydantic import ValidationError

from db.models import Game
from games.board import FINAL_TIEBREAK, SCORE_METRIC, BoardDefinition
from games.leaderboard import _unrankable_reason
from games.registry import get_module

_FRONTEND_SRC = Path(__file__).parents[2] / "frontend" / "src"
_FRONTEND_GAME = _FRONTEND_SRC / "game"


_GAMES = [
    "yacht",
    "solitaire",
    "freecell",
    "mahjong",
    "hearts",
    "sudoku",
    "cascade",
    "sort",
    "blackjack",
    "daily_word",
    "twenty48",
    "starswarm",
]


def _board(game: str) -> BoardDefinition:
    mod = get_module(game)
    assert mod is not None, f"{game} has no module"
    return mod.board


# ---------------------------------------------------------------------------
# BoardDefinition model
# ---------------------------------------------------------------------------


def test_defaults() -> None:
    board = BoardDefinition(metric=SCORE_METRIC, direction="desc", label_key="score")
    assert board.tiebreak is None
    assert board.partitions == ()
    assert board.partition_defaults == ()
    assert board.partition_values == ()
    assert board.max_value is None
    assert board.partition_max_values == ()
    assert board.qualifying_outcomes is None
    assert board.enabled is True


def test_final_tiebreak_is_earliest_completion() -> None:
    assert FINAL_TIEBREAK == ("completed_at", "asc")


_PARTITIONED = {"partitions": ("difficulty", "variant"), "max_value": 300}


@pytest.mark.parametrize(
    "overrides",
    [
        {"direction": "up"},
        {"tiebreak": ("total_moves", "sideways")},
        {"metric": ""},
        {"label_key": ""},
        {"max_value": -1},
        {"unknown": 1},
        {"partitions": ("variant", "variant")},
        {"partition_defaults": (("variant", "classic"),)},
        {**_PARTITIONED, "partition_defaults": (("mode", "classic"),)},
        {**_PARTITIONED, "partition_defaults": (("variant", "classic"), ("variant", "mini"))},
        {**_PARTITIONED, "partition_max_values": (("mode", "easy", 100),)},
        {**_PARTITIONED, "partition_max_values": (("difficulty", "easy", 301),)},
        {**_PARTITIONED, "partition_max_values": (("difficulty", "easy", -1),)},
        {
            **_PARTITIONED,
            "partition_max_values": (("difficulty", "easy", 100), ("difficulty", "easy", 90)),
        },
        {**_PARTITIONED, "max_value": None, "partition_max_values": (("difficulty", "easy", 1),)},
        {"partition_values": (("variant", ("classic",)),)},
        {**_PARTITIONED, "partition_values": (("mode", ("classic",)),)},
        {
            **_PARTITIONED,
            "partition_values": (("variant", ("classic",)), ("variant", ("mini",))),
        },
        {**_PARTITIONED, "partition_values": (("variant", ()),)},
        {**_PARTITIONED, "partition_values": (("variant", ("mini", "mini")),)},
        {
            **_PARTITIONED,
            "partition_defaults": (("variant", "classic"),),
            "partition_values": (("variant", ("mini",)),),
        },
        {
            **_PARTITIONED,
            "partition_max_values": (("difficulty", "extreme", 300),),
            "partition_values": (("difficulty", ("easy", "hard")),),
        },
        {"qualifying_outcomes": ()},
        {"qualifying_outcomes": ("abandoned",)},
        {"qualifying_outcomes": ("victory",)},
        {"qualifying_outcomes": ("win", "win")},
    ],
    ids=[
        "direction",
        "tiebreak-direction",
        "empty-metric",
        "empty-label",
        "negative-max",
        "extra",
        "duplicate-partition",
        "default-without-partition",
        "default-key-not-a-partition",
        "duplicate-default-key",
        "cap-key-not-a-partition",
        "cap-above-max-value",
        "negative-cap",
        "duplicate-cap",
        "cap-without-max-value",
        "values-without-partition",
        "values-key-not-a-partition",
        "duplicate-values-key",
        "empty-values",
        "duplicate-value",
        "default-not-allowed",
        "cap-value-not-allowed",
        "empty-qualifying-outcomes",
        "abandoned-qualifies",
        "unknown-outcome",
        "duplicate-outcome",
    ],
)
def test_rejects_invalid_values(overrides: dict) -> None:
    fields = {"metric": SCORE_METRIC, "direction": "desc", "label_key": "score", **overrides}
    with pytest.raises(ValidationError):
        BoardDefinition(**fields)


def test_is_immutable() -> None:
    board = _board("yacht")
    with pytest.raises(ValidationError):
        board.max_value = 999  # type: ignore[misc]


def test_list_input_is_stored_as_tuple() -> None:
    board = BoardDefinition(
        metric=SCORE_METRIC, direction="desc", label_key="score", partitions=["difficulty"]
    )
    assert board.partitions == ("difficulty",)


@pytest.mark.parametrize("game", _GAMES)
def test_every_container_is_immutable(game: str) -> None:
    """Boards are shared class-level singletons: no field may be a mutable container."""
    board = _board(game)
    for name in BoardDefinition.model_fields:
        value = getattr(board, name)
        assert not isinstance(value, (list, dict, set)), f"{game}.board.{name} is mutable"
    hash(board)  # every field is hashable, so the frozen model is too


# ---------------------------------------------------------------------------
# Helpers: partition_default and max_value_for
# ---------------------------------------------------------------------------


def test_partition_default() -> None:
    board = _board("sudoku")
    assert board.partition_default("variant") == "classic"
    assert board.partition_default("difficulty") is None


def test_max_value_for_applies_defaults_and_takes_the_tightest_cap() -> None:
    board = BoardDefinition(
        metric=SCORE_METRIC,
        direction="desc",
        label_key="score",
        partitions=("variant",),
        partition_defaults=(("variant", "classic"),),
        max_value=50,
        partition_max_values=(("variant", "classic", 10),),
    )
    assert board.max_value_for({"variant": "classic"}) == 10
    assert board.max_value_for({}) == 10  # legacy row: no variant -> classic
    assert board.max_value_for({"variant": None}) == 10
    assert board.max_value_for({"variant": "mini"}) == 50  # no per-partition cap


def test_allowed_values() -> None:
    board = BoardDefinition(
        metric=SCORE_METRIC,
        direction="desc",
        label_key="score",
        partitions=("difficulty", "variant"),
        partition_values=(("variant", ("classic", "mini")),),
    )
    assert board.allowed_values("variant") == ("classic", "mini")
    assert board.allowed_values("difficulty") is None
    assert board.is_allowed("variant", "mini")
    assert not board.is_allowed("variant", "Mini")
    assert board.is_allowed("difficulty", "anything")  # no allow-list for this key


def test_max_value_for_uncapped_board_is_none() -> None:
    assert _board("cascade").max_value_for({}) is None


@pytest.mark.parametrize(
    "partition,cap",
    [
        ({"difficulty": "easy"}, 100),
        ({"difficulty": "medium", "variant": "mini"}, 200),
        ({"difficulty": "hard", "variant": "classic"}, 300),
        ({}, 300),
        ({"difficulty": "extreme"}, 300),
    ],
)
def test_sudoku_max_value_for(partition: dict, cap: int) -> None:
    assert _board("sudoku").max_value_for(partition) == cap


# ---------------------------------------------------------------------------
# Declared values (plan §4.2 table and owner decisions §8)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "game,metric,direction,tiebreak,partitions,max_value,qualifying,enabled",
    [
        ("yacht", SCORE_METRIC, "desc", None, (), 1575, None, True),
        ("solitaire", SCORE_METRIC, "desc", None, (), 1245, None, True),
        ("freecell", SCORE_METRIC, "asc", None, (), None, None, True),
        ("mahjong", SCORE_METRIC, "desc", None, (), 1220, None, True),
        ("hearts", SCORE_METRIC, "desc", None, (), 100, None, True),
        ("sudoku", SCORE_METRIC, "desc", None, ("difficulty", "variant"), 300, None, True),
        ("cascade", SCORE_METRIC, "desc", None, (), None, None, True),
        ("sort", "level_reached", "desc", ("total_moves", "asc"), (), 23, None, True),
        ("blackjack", SCORE_METRIC, "desc", None, (), None, None, False),
        ("daily_word", "guesses_used", "asc", None, (), None, ("win",), False),
        ("twenty48", SCORE_METRIC, "desc", None, (), None, None, True),
        ("starswarm", SCORE_METRIC, "desc", None, ("difficulty_tier",), None, None, True),
    ],
)
def test_declared_board(
    game, metric, direction, tiebreak, partitions, max_value, qualifying, enabled
) -> None:
    board = _board(game)
    assert board.metric == metric
    assert board.direction == direction
    assert board.tiebreak == tiebreak
    assert board.partitions == partitions
    assert board.max_value == max_value
    assert board.qualifying_outcomes == qualifying
    assert board.enabled is enabled


@pytest.mark.parametrize("game", sorted(set(_GAMES) - {"sudoku", "starswarm"}))
def test_only_sudoku_and_starswarm_have_partition_rules(game: str) -> None:
    board = _board(game)
    assert board.partition_defaults == ()
    assert board.partition_values == ()
    assert board.partition_max_values == ()


@pytest.mark.parametrize("game", _GAMES)
def test_partition_values_fill_every_board_and_nothing_else_ranks(game: str) -> None:
    """Every board can fill, and a row outside ``partition_values`` never ranks.

    For each ``partition_values`` key, the metadata model (and the result
    model, when it declares the key) accepts every allowed value. It also
    accepts other values: rejecting one would dead-letter the game in the app.
    Such a row is stored but can't be named (``_unrankable_reason``), so it
    never lands on a board nobody can request.
    """
    mod = get_module(game)
    assert mod is not None
    for key, values in mod.board.partition_values:
        models = [mod.metadata_model]
        if mod.result_model is not None and key in mod.result_model.model_fields:
            models.append(mod.result_model)
        for model in models:
            assert key in model.model_fields, f"{game}: {model.__name__} lacks {key}"
            for value in values:
                model.model_validate({key: value})

        def reason(value: str, key: str = key) -> str | None:
            row = Game(
                final_score=1,
                outcome="completed",
                completed_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
                game_metadata={mod.board.metric: 1, key: value},
            )
            return _unrankable_reason(mod.board, row)

        for value in values:
            assert reason(value) is None, f"{game}: {key}={value} should rank"
        for bad in (values[0].lower(), values[0] + "x", "forged"):
            if bad not in values:
                assert reason(bad) == "This game's board does not exist."


def test_sudoku_variant_defaults_to_classic_like_the_legacy_route() -> None:
    """Rows from before #748 have no ``variant``; ``_top_scores`` counts them as classic."""
    from sudoku.models import SudokuMetadata

    board = _board("sudoku")
    assert board.partition_defaults == (("variant", "classic"),)
    assert SudokuMetadata.model_fields["variant"].default == "classic"


def test_existing_request_bounds_match_max_value() -> None:
    """The per-game submit bounds that exist today agree with the boards.

    Yacht has no submit route: its legacy ``POST /yacht/score`` was removed
    (#2630), and its 1575 cap is recomputed from the engine below.
    """
    from sort.models import ScoreSubmitRequest as SortSubmit

    def le(model, field: str) -> int:
        return next(m.le for m in model.model_fields[field].metadata if hasattr(m, "le"))

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


def test_yacht_max_value_recomputed_from_engine() -> None:
    """1575: the classic theoretical maximum, derived from engine.ts.

    Every roll is a Yacht of the right face. The Yacht box scores its fixed 50,
    the other 12 categories take their best joker values (five of a face in the
    upper section, five sixes for the kinds and chance, the fixed full house and
    straights), the upper bonus is earned, and each of the 12 extra Yachts adds
    the Yacht bonus. A cap below this rejects real games with bonus Yachts.
    """
    path = _FRONTEND_GAME / "yacht" / "engine.ts"
    c = _ts_constants(path)
    text = path.read_text(encoding="utf-8")
    # The joker scorer prices every lower category at its best (fixed) value.
    joker = text[text.index("export function calculateJokerScore") :]

    def fixed(category: str) -> int:
        # A case may carry comment lines before its return (the "yacht" case does).
        found = re.findall(rf'case "{category}":(?:\s*//[^\n]*)*\s*return (\d+);', joker)
        assert found, f"no fixed score for {category} in the Yacht joker scorer"
        return int(found[0])

    dice, faces = 5, 6
    upper = sum(face * dice for face in range(1, faces + 1))  # 105
    kinds_and_chance = 3 * faces * dice  # three/four of a kind and chance: 30 each
    lower = (
        kinds_and_chance
        + fixed("full_house")
        + fixed("small_straight")
        + fixed("large_straight")
        + fixed("yacht")
    )
    extra_yachts = 12  # 13 rounds, the first Yacht fills the Yacht box
    expected = upper + c["UPPER_BONUS_VALUE"] + lower + extra_yachts * c["YACHT_BONUS_VALUE"]
    assert _board("yacht").max_value == expected == 1575


def test_sudoku_partition_max_values_recomputed_from_screen() -> None:
    """Per-difficulty caps are ``DIFFICULTY_BASE`` in SudokuScreen.tsx.

    A game scores ``max(0, DIFFICULTY_BASE[difficulty] - errors * N)``, so the
    error-free base is each difficulty's ceiling and the hardest base is the
    overall ``max_value``.
    """
    from typing import get_args

    from sudoku.models import Difficulty

    text = (_FRONTEND_SRC / "screens" / "SudokuScreen.tsx").read_text(encoding="utf-8")
    block = re.search(r"const DIFFICULTY_BASE\b[^=]*=\s*\{(.*?)\};", text, re.DOTALL)
    assert block, "DIFFICULTY_BASE not found in SudokuScreen.tsx"
    base = {k: int(v) for k, v in re.findall(r"(\w+):\s*(\d+)", block.group(1))}
    assert set(base) == set(get_args(Difficulty))
    # The base is the ceiling only while errors can only subtract.
    penalty = re.search(r"DIFFICULTY_BASE\[difficulty\]\s*-\s*errors\s*\*\s*(\d+)", text)
    assert penalty and int(penalty.group(1)) > 0, "Sudoku score formula changed"

    board = _board("sudoku")
    caps = {value: cap for key, value, cap in board.partition_max_values if key == "difficulty"}
    assert caps == base == {"easy": 100, "medium": 200, "hard": 300}
    assert board.max_value == max(base.values())
    assert all(key == "difficulty" for key, _, _ in board.partition_max_values)
