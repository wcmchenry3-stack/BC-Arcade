"""Tests for the GameModule Protocol and per-game stats_shape() (#540, #541)."""

from __future__ import annotations

import sys
import uuid

import pytest
from fastapi.testclient import TestClient

from blackjack.module import module as blackjack_module
from cascade.module import module as cascade_module
from daily_word.module import module as daily_word_module
from games import service
from games.board import SCORE_METRIC, BoardDefinition
from games.protocol import GameModule, default_stats_shape
from games.registry import _REGISTRY, get_module
from hearts.module import module as hearts_module
from mahjong.module import module as mahjong_module
from main import app
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


@pytest.mark.parametrize(
    "mod,expects_model",
    [
        (blackjack_module, True),
        (mahjong_module, True),
        (solitaire_module, True),
        (sudoku_module, True),
        (cascade_module, False),
        (daily_word_module, True),
        (hearts_module, False),
    ],
    ids=["blackjack", "mahjong", "solitaire", "sudoku", "cascade", "daily_word", "hearts"],
)
def test_result_model_declared(mod, expects_model) -> None:
    """result_model is a distinct attribute from metadata_model (#2449)."""
    assert (mod.result_model is not None) == expects_model
    if expects_model:
        assert mod.result_model is not mod.metadata_model


# Games whose finished rows record ``win`` / ``loss`` / ``push`` (see
# ``vocab.GameOutcome``). Twenty48 (true) and Star Swarm (false) join when #2623
# registers them.
# True only where the client writes win / loss / push today (#2619).
_HAS_WINNER = {
    "yacht": True,
    "hearts": True,
    "daily_word": True,
    # A cleared board records win, a deadlock left by the player loss (#2627).
    "mahjong": True,
    # A run records win (goal reached) / loss (out of chips) since #2628.
    "blackjack": True,
    "solitaire": False,
    "freecell": False,
    "sudoku": False,
    "cascade": False,
    "sort": False,
    # #2631: reaching 2048 records a win, a game over before it a loss.
    "twenty48": True,
    "starswarm": False,
}


@pytest.mark.parametrize("name", sorted(_REGISTRY))
def test_has_winner_declared(name: str) -> None:
    """Every registered module declares ``has_winner`` as a bool (#2619)."""
    mod = _REGISTRY[name]
    assert isinstance(
        type(mod).__dict__.get("has_winner"), bool
    ), f"{name} module must declare has_winner: bool as a class attribute"
    assert name in _HAS_WINNER, f"add {name} to _HAS_WINNER (see vocab.GameOutcome)"
    assert mod.has_winner is _HAS_WINNER[name]


def test_module_without_has_winner_fails_protocol() -> None:
    class _NoWinnerFlag:
        game_type = GameType.YACHT
        metadata_model = None
        result_model = None

        def stats_shape(self, raw_stats: dict) -> dict:
            return raw_stats

    assert not isinstance(_NoWinnerFlag(), GameModule)


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
# Board definition (#2617)
# ---------------------------------------------------------------------------

_REGISTERED = [(gt.value, get_module(gt.value)) for gt in GameType if get_module(gt.value)]


def test_every_game_type_has_a_module() -> None:
    """Twenty48 and Star Swarm were the last two without one (#2623)."""
    assert {name for name, _ in _REGISTERED} == {gt.value for gt in GameType}


def _carryable(mod, key: str) -> bool:
    """Whether a row of *mod*'s game can carry *key* in ``games.metadata``.

    ``games.metadata`` is the creation-time metadata merged with the result
    block. A module with ``result_model = None`` accepts any result key.
    """
    if mod.result_model is None:
        return True
    return key in mod.metadata_model.model_fields or key in mod.result_model.model_fields


@pytest.mark.parametrize("name,mod", _REGISTERED, ids=[n for n, _ in _REGISTERED])
def test_module_satisfies_protocol_with_board(name, mod) -> None:
    assert isinstance(mod, GameModule), f"{name} does not satisfy the GameModule Protocol"
    assert isinstance(mod.board, BoardDefinition), f"{name} must declare a BoardDefinition"


@pytest.mark.parametrize("name,mod", _REGISTERED, ids=[n for n, _ in _REGISTERED])
def test_board_keys_are_carried_by_the_module(name, mod) -> None:
    """Every metadata key a board ranks, breaks ties or partitions on can be stored."""
    board = mod.board
    keys = list(board.partitions)
    if board.tiebreak is not None:
        keys.append(board.tiebreak[0])
    if board.metric != SCORE_METRIC:
        keys.append(board.metric)
    missing = [k for k in keys if not _carryable(mod, k)]
    assert not missing, f"{name}: board keys {missing} are not in its metadata/result model"


def test_module_without_board_fails_protocol() -> None:
    class NoBoard:
        game_type = GameType.CASCADE
        metadata_model = cascade_module.metadata_model
        result_model = None

        def stats_shape(self, raw_stats: dict) -> dict:
            return raw_stats

    assert not isinstance(NoBoard(), GameModule)


# ---------------------------------------------------------------------------
# BlackjackModule.stats_shape — chip figures under "extras" (#2620)
# ---------------------------------------------------------------------------

_RAW_BJ = {
    "best": 2400,
    "last_played_at": None,
    "latest_score": 2100,
}


def test_blackjack_stats_shape_renames_best_to_best_chips() -> None:
    shaped = blackjack_module.stats_shape(_RAW_BJ)
    assert shaped["extras"]["best_chips"] == 2400
    assert "best" not in shaped


def test_blackjack_stats_shape_maps_latest_score_to_current_chips() -> None:
    shaped = blackjack_module.stats_shape(_RAW_BJ)
    assert shaped["extras"]["current_chips"] == 2100


def test_blackjack_stats_shape_is_last_played_at_and_extras_only() -> None:
    shaped = blackjack_module.stats_shape(_RAW_BJ)
    assert set(shaped) == {"last_played_at", "extras"}
    assert shaped["last_played_at"] is None


def test_blackjack_stats_shape_none_latest_score() -> None:
    raw = {**_RAW_BJ, "latest_score": None}
    shaped = blackjack_module.stats_shape(raw)
    assert shaped["extras"]["current_chips"] is None


def test_blackjack_stats_shape_no_metadata_key_returns_none_run_fields() -> None:
    shaped = blackjack_module.stats_shape(_RAW_BJ)
    assert shaped["extras"].get("best_run_chips") is None
    assert shaped["extras"].get("total_runs") is None
    assert shaped["extras"].get("runs_completed") is None
    assert shaped["extras"].get("current_table") is None


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
    assert shaped["extras"]["best_run_chips"] == 3000
    assert shaped["extras"]["total_runs"] == 12
    assert shaped["extras"]["runs_completed"] == 4
    assert shaped["extras"]["current_table"] == "intermediate"


def test_blackjack_stats_shape_empty_metadata_returns_none_run_fields() -> None:
    shaped = blackjack_module.stats_shape({**_RAW_BJ, "metadata": {}})
    assert shaped["extras"].get("best_run_chips") is None
    assert shaped["extras"].get("current_table") is None


# ---------------------------------------------------------------------------
# default_stats_shape — the one shared pass-through
# ---------------------------------------------------------------------------

_RAW = {
    "best": 9500,
    "last_played_at": None,
    "latest_score": 8000,
    "metadata": {"k": 1},
}


def test_default_stats_shape_passes_last_played_at_only() -> None:
    """``best``, ``latest_score`` and ``metadata`` are inputs, not API fields;
    the deprecated ``played`` / ``best`` / ``avg`` aliases are gone (#2644)."""
    shaped = default_stats_shape(dict(_RAW))
    assert shaped == {"last_played_at": None}


@pytest.mark.parametrize(
    "mod",
    [
        cascade_module,
        daily_word_module,
        hearts_module,
        mahjong_module,
        solitaire_module,
        sudoku_module,
    ],
    ids=["cascade", "daily_word", "hearts", "mahjong", "solitaire", "sudoku"],
)
def test_pass_through_stats_shape(mod) -> None:
    assert mod.stats_shape(dict(_RAW)) == {"last_played_at": None}


_PASS_THROUGH = sorted(name for name in _REGISTRY if name != "blackjack")


def test_every_game_but_blackjack_is_pass_through() -> None:
    assert len(_PASS_THROUGH) == len(_REGISTRY) - 1


@pytest.mark.parametrize("name", _PASS_THROUGH)
def test_pass_through_modules_use_the_shared_stats_shape(
    name: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Every pass-through module delegates to ``default_stats_shape``, not a copy of it."""
    mod = _REGISTRY[name]
    shaped = {"shaped_by": "default_stats_shape"}
    monkeypatch.setattr(
        sys.modules[type(mod).__module__], "default_stats_shape", lambda raw: shaped
    )
    assert mod.stats_shape(dict(_RAW)) is shaped


# ---------------------------------------------------------------------------
# A game without a module fails loudly (#2623 left no fallback)
# ---------------------------------------------------------------------------


def _without_module(monkeypatch: pytest.MonkeyPatch, missing: str) -> None:
    real = service.get_module
    monkeypatch.setattr(service, "get_module", lambda n: None if n == missing else real(n))


def test_stats_leave_out_a_game_without_a_module(monkeypatch: pytest.MonkeyPatch) -> None:
    """No board or stats shape is guessed for a game type with no module, and
    it doesn't take /stats/me down either: it is reported and left out."""
    sid = str(uuid.uuid4())
    headers = {"X-Session-ID": sid, "Content-Type": "application/json"}
    client = TestClient(app)
    for game_type, score in (("twenty48", 10), ("yacht", 20)):
        gid = client.post("/games", headers=headers, json={"game_type": game_type}).json()["id"]
        r = client.patch(
            f"/games/{gid}/complete",
            headers=headers,
            json={"final_score": score, "outcome": "completed"},
        )
        assert r.status_code == 200, r.text
    # Warm the (cached) best-value expression while every module is registered:
    # it covers the vocab game types, which a test elsewhere keeps registered.
    assert set(client.get("/stats/me", headers=headers).json()["by_game"]) == {
        "twenty48",
        "yacht",
    }

    captured: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        service.sentry_sdk, "capture_message", lambda msg, **kw: captured.append((msg, kw))
    )
    _without_module(monkeypatch, "twenty48")
    r = client.get("/stats/me", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body["by_game"]) == {"yacht"}
    assert body["total_games"] == 1
    assert len(captured) == 1
    assert "twenty48" in captured[0][0]
    assert captured[0][1]["level"] == "error"


def test_the_best_value_expression_fails_loudly_without_a_module(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service._best_candidate.cache_clear()
    _without_module(monkeypatch, "starswarm")
    try:
        with pytest.raises(LookupError, match="starswarm"):
            service._best_candidate("sqlite")
    finally:
        monkeypatch.undo()
        service._best_candidate.cache_clear()
