"""Tests for the GameModule Protocol and per-game stats_shape() (#540, #541)."""

from __future__ import annotations

import pytest

from blackjack.module import module as blackjack_module
from cascade.module import module as cascade_module
from daily_word.module import module as daily_word_module
from games.protocol import GameModule
from games.registry import get_module
from hearts.module import module as hearts_module
from mahjong.module import module as mahjong_module
from solitaire.module import module as solitaire_module
from sudoku.module import module as sudoku_module
from vocab import GameType

# ---------------------------------------------------------------------------
# Protocol conformance
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "mod",
    [
        blackjack_module,
        cascade_module,
        daily_word_module,
        hearts_module,
        mahjong_module,
        solitaire_module,
        sudoku_module,
    ],
    ids=["blackjack", "cascade", "daily_word", "hearts", "mahjong", "solitaire", "sudoku"],
)
def test_module_satisfies_protocol(mod) -> None:
    assert isinstance(mod, GameModule), f"{mod!r} does not satisfy the GameModule Protocol"


def test_daily_word_module_game_type() -> None:
    assert daily_word_module.game_type == GameType.DAILY_WORD


def test_blackjack_module_game_type() -> None:
    assert blackjack_module.game_type == GameType.BLACKJACK


def test_cascade_module_game_type() -> None:
    assert cascade_module.game_type == GameType.CASCADE


def test_solitaire_module_game_type() -> None:
    assert solitaire_module.game_type == GameType.SOLITAIRE


def test_hearts_module_game_type() -> None:
    assert hearts_module.game_type == GameType.HEARTS


def test_mahjong_module_game_type() -> None:
    assert mahjong_module.game_type == GameType.MAHJONG


def test_sudoku_module_game_type() -> None:
    assert sudoku_module.game_type == GameType.SUDOKU


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


def test_registry_returns_correct_modules() -> None:
    assert get_module("blackjack") is blackjack_module
    assert get_module("cascade") is cascade_module
    assert get_module("daily_word") is daily_word_module
    assert get_module("hearts") is hearts_module
    assert get_module("mahjong") is mahjong_module
    assert get_module("solitaire") is solitaire_module
    assert get_module("sudoku") is sudoku_module


def test_registry_returns_none_for_unknown() -> None:
    assert get_module("unknown_game") is None


# ---------------------------------------------------------------------------
# BlackjackModule.stats_shape — key renames and chip logic
# ---------------------------------------------------------------------------

_RAW_BJ = {
    "played": 5,
    "best": 2400,
    "avg": 1800.0,
    "last_played_at": None,
    "latest_score": 2100,
}


def test_blackjack_stats_shape_renames_best_to_best_chips() -> None:
    shaped = blackjack_module.stats_shape(_RAW_BJ)
    assert shaped["best_chips"] == 2400
    assert shaped.get("best") is None


def test_blackjack_stats_shape_drops_avg() -> None:
    shaped = blackjack_module.stats_shape(_RAW_BJ)
    assert shaped.get("avg") is None


def test_blackjack_stats_shape_maps_latest_score_to_current_chips() -> None:
    shaped = blackjack_module.stats_shape(_RAW_BJ)
    assert shaped["current_chips"] == 2100


def test_blackjack_stats_shape_preserves_played_and_last_played_at() -> None:
    shaped = blackjack_module.stats_shape(_RAW_BJ)
    assert shaped["played"] == 5
    assert shaped["last_played_at"] is None


def test_blackjack_stats_shape_none_latest_score() -> None:
    raw = {**_RAW_BJ, "latest_score": None}
    shaped = blackjack_module.stats_shape(raw)
    assert shaped["current_chips"] is None


def test_blackjack_stats_shape_no_metadata_key_returns_none_run_fields() -> None:
    shaped = blackjack_module.stats_shape(_RAW_BJ)
    assert shaped.get("best_run_chips") is None
    assert shaped.get("total_runs") is None
    assert shaped.get("runs_completed") is None
    assert shaped.get("current_table") is None


def test_blackjack_stats_shape_reads_run_fields_from_metadata() -> None:
    raw = {
        **_RAW_BJ,
        "metadata": {
            "best_run_chips": 3000,
            "total_runs": 12,
            "runs_completed": 4,
            "current_table": "intermediate",
        },
    }
    shaped = blackjack_module.stats_shape(raw)
    assert shaped["best_run_chips"] == 3000
    assert shaped["total_runs"] == 12
    assert shaped["runs_completed"] == 4
    assert shaped["current_table"] == "intermediate"


def test_blackjack_stats_shape_empty_metadata_returns_none_run_fields() -> None:
    shaped = blackjack_module.stats_shape({**_RAW_BJ, "metadata": {}})
    assert shaped.get("best_run_chips") is None
    assert shaped.get("current_table") is None


# ---------------------------------------------------------------------------
# CascadeModule.stats_shape — pass-through, strips latest_score
# ---------------------------------------------------------------------------

_RAW_CASCADE = {
    "played": 3,
    "best": 9500,
    "avg": 7000.0,
    "last_played_at": None,
    "latest_score": 8000,
}


def test_cascade_stats_shape_preserves_aggregate_fields() -> None:
    shaped = cascade_module.stats_shape(_RAW_CASCADE)
    assert shaped["played"] == 3
    assert shaped["best"] == 9500
    assert shaped["avg"] == 7000.0


def test_cascade_stats_shape_strips_latest_score() -> None:
    shaped = cascade_module.stats_shape(_RAW_CASCADE)
    assert "latest_score" not in shaped


# ---------------------------------------------------------------------------
# SolitaireModule.stats_shape — pass-through, strips latest_score
# ---------------------------------------------------------------------------

_RAW_SOLITAIRE = {
    "played": 4,
    "best": 1200,
    "avg": 650.0,
    "last_played_at": None,
    "latest_score": 780,
}


def test_solitaire_stats_shape_preserves_aggregate_fields() -> None:
    shaped = solitaire_module.stats_shape(_RAW_SOLITAIRE)
    assert shaped["played"] == 4
    assert shaped["best"] == 1200
    assert shaped["avg"] == 650.0


def test_solitaire_stats_shape_strips_latest_score() -> None:
    shaped = solitaire_module.stats_shape(_RAW_SOLITAIRE)
    assert "latest_score" not in shaped


# ---------------------------------------------------------------------------
# HeartsModule.stats_shape — pass-through, strips latest_score
# ---------------------------------------------------------------------------

_RAW_HEARTS = {
    "played": 7,
    "best": 95,
    "avg": 72.0,
    "last_played_at": None,
    "latest_score": 80,
}


def test_hearts_stats_shape_preserves_aggregate_fields() -> None:
    shaped = hearts_module.stats_shape(_RAW_HEARTS)
    assert shaped["played"] == 7
    assert shaped["best"] == 95
    assert shaped["avg"] == 72.0


def test_hearts_stats_shape_strips_latest_score() -> None:
    shaped = hearts_module.stats_shape(_RAW_HEARTS)
    assert "latest_score" not in shaped


# ---------------------------------------------------------------------------
# SudokuModule.stats_shape — pass-through, strips latest_score
# ---------------------------------------------------------------------------

_RAW_SUDOKU = {
    "played": 6,
    "best": 290,
    "avg": 180.0,
    "last_played_at": None,
    "latest_score": 200,
}


def test_sudoku_stats_shape_preserves_aggregate_fields() -> None:
    shaped = sudoku_module.stats_shape(_RAW_SUDOKU)
    assert shaped["played"] == 6
    assert shaped["best"] == 290
    assert shaped["avg"] == 180.0


def test_sudoku_stats_shape_strips_latest_score() -> None:
    shaped = sudoku_module.stats_shape(_RAW_SUDOKU)
    assert "latest_score" not in shaped


# ---------------------------------------------------------------------------
# MahjongModule.stats_shape — pass-through, strips latest_score
# ---------------------------------------------------------------------------

_RAW_MAHJONG = {
    "played": 2,
    "best": 4500,
    "avg": 3200.0,
    "last_played_at": None,
    "latest_score": 4100,
}


def test_mahjong_stats_shape_preserves_aggregate_fields() -> None:
    shaped = mahjong_module.stats_shape(_RAW_MAHJONG)
    assert shaped["played"] == 2
    assert shaped["best"] == 4500
    assert shaped["avg"] == 3200.0


def test_mahjong_stats_shape_strips_latest_score() -> None:
    shaped = mahjong_module.stats_shape(_RAW_MAHJONG)
    assert "latest_score" not in shaped


# ---------------------------------------------------------------------------
# DailyWordModule.stats_shape — pass-through, strips latest_score
# ---------------------------------------------------------------------------

_RAW_DAILY_WORD = {
    "played": 10,
    "best": 6,
    "avg": 4.5,
    "last_played_at": None,
    "latest_score": 5,
}


def test_daily_word_stats_shape_preserves_aggregate_fields() -> None:
    shaped = daily_word_module.stats_shape(_RAW_DAILY_WORD)
    assert shaped["played"] == 10
    assert shaped["best"] == 6
    assert shaped["avg"] == 4.5


def test_daily_word_stats_shape_strips_latest_score() -> None:
    shaped = daily_word_module.stats_shape(_RAW_DAILY_WORD)
    assert "latest_score" not in shaped
