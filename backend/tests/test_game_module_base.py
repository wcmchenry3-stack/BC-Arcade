"""Tests for ``GameModuleBase``, the registry and ``LegacyPlayerName`` (#2995)."""

from __future__ import annotations

import importlib
import pathlib
from typing import Any, cast

import pytest
from pydantic import BaseModel, ValidationError

from games.board import SCORE_METRIC, BoardDefinition
from games.metadata import LEGACY_PLAYER_NAME_MAX_LENGTH
from games.module_base import GameModuleBase
from games.protocol import GameModule
from games.registry import _MODULES, _REGISTRY
from games.schemas import CreateGameRequest
from vocab import GameType

BACKEND = pathlib.Path(__file__).resolve().parent.parent


class _Meta(BaseModel):
    pass


class _Minimal(GameModuleBase):
    game_type = GameType.CASCADE
    metadata_model = _Meta
    board = BoardDefinition(metric=SCORE_METRIC, direction="desc", label_key="score")


# ---------------------------------------------------------------------------
# Base-class defaults
# ---------------------------------------------------------------------------


def test_minimal_subclass_satisfies_the_protocol() -> None:
    assert isinstance(_Minimal(), GameModule)


def test_declaration_defaults() -> None:
    assert _Minimal.result_model is None
    assert _Minimal.has_winner is False


def test_default_stats_shape_passes_last_played_at_only() -> None:
    raw = {"best": 1, "last_played_at": "t", "latest_score": 2, "metadata": {"k": 1}}
    assert _Minimal().stats_shape(raw) == {"last_played_at": "t"}


@pytest.mark.parametrize("final_score", [None, 0, 42])
@pytest.mark.parametrize("outcome", [None, "completed", "abandoned"])
def test_default_derive_final_score_keeps_the_sent_score(
    final_score: int | None, outcome: str | None
) -> None:
    assert _Minimal().derive_final_score(final_score, outcome, {"x": 7}) == final_score


async def test_default_reconcile_result_returns_the_result_unchanged() -> None:
    result = {"won": True, "moves": 3}
    out = await _Minimal().reconcile_result(cast(Any, None), cast(Any, None), result)
    assert out is result


@pytest.mark.parametrize("missing", ["game_type", "metadata_model", "board"])
def test_subclass_missing_a_required_declaration_fails_at_class_creation(missing: str) -> None:
    attrs: dict[str, Any] = {
        "game_type": GameType.CASCADE,
        "metadata_model": _Meta,
        "board": _Minimal.board,
    }
    del attrs[missing]
    with pytest.raises(TypeError, match=missing):
        type("_Broken", (GameModuleBase,), attrs)


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


def _module_packages() -> list[str]:
    return sorted(
        p.parent.name
        for p in BACKEND.glob("*/module.py")
        if hasattr(importlib.import_module(f"{p.parent.name}.module"), "module")
    )


def test_every_game_module_file_is_registered() -> None:
    """Every ``<game>/module.py`` singleton is in the registry, and nothing else is."""
    registered = sorted(type(m).__module__.split(".")[0] for m in _MODULES)
    assert registered == _module_packages()


def test_registry_has_one_module_per_game_type() -> None:
    assert len(_REGISTRY) == len(_MODULES) == len(GameType)


@pytest.mark.parametrize("name", sorted(_REGISTRY))
def test_every_registered_module_subclasses_the_base(name: str) -> None:
    assert isinstance(_REGISTRY[name], GameModuleBase)


# Only these modules override a hook; everyone else inherits the defaults.
_OVERRIDES = {
    "stats_shape": {"blackjack"},
    "derive_final_score": {"blackjack"},
    "reconcile_result": {"daily_word"},
}


@pytest.mark.parametrize("hook", sorted(_OVERRIDES))
def test_hooks_are_overridden_only_where_documented(hook: str) -> None:
    overriding = {
        name
        for name, mod in _REGISTRY.items()
        if getattr(type(mod), hook) is not getattr(GameModuleBase, hook)
    }
    assert overriding == _OVERRIDES[hook]


# ---------------------------------------------------------------------------
# LegacyPlayerName: 64 characters in every game that accepts it
# ---------------------------------------------------------------------------

_WITH_PLAYER_NAME = sorted(
    name for name, mod in _REGISTRY.items() if "player_name" in mod.metadata_model.model_fields
)
# Fields a model needs besides player_name to validate.
_REQUIRED_EXTRA: dict[str, dict[str, Any]] = {"sudoku": {"difficulty": "easy"}}


def test_the_six_legacy_name_games() -> None:
    assert _WITH_PLAYER_NAME == ["cascade", "hearts", "mahjong", "solitaire", "sort", "sudoku"]
    assert LEGACY_PLAYER_NAME_MAX_LENGTH == 64


@pytest.mark.parametrize("name", _WITH_PLAYER_NAME)
def test_player_name_of_64_characters_is_accepted(name: str) -> None:
    metadata = {**_REQUIRED_EXTRA.get(name, {}), "player_name": "x" * 64}
    model = _REGISTRY[name].metadata_model
    assert model.model_validate(metadata).player_name == "x" * 64
    req = CreateGameRequest(game_type=name, metadata=metadata)
    assert req.metadata["player_name"] == "x" * 64


@pytest.mark.parametrize("name", _WITH_PLAYER_NAME)
def test_player_name_of_65_characters_is_rejected(name: str) -> None:
    metadata = {**_REQUIRED_EXTRA.get(name, {}), "player_name": "x" * 65}
    with pytest.raises(ValidationError) as exc:
        _REGISTRY[name].metadata_model.model_validate(metadata)
    assert exc.value.errors()[0]["type"] == "string_too_long"
    with pytest.raises(ValidationError):
        CreateGameRequest(game_type=name, metadata=metadata)


@pytest.mark.parametrize("name", _WITH_PLAYER_NAME)
def test_player_name_defaults_to_empty(name: str) -> None:
    model = _REGISTRY[name].metadata_model
    assert model.model_validate(_REQUIRED_EXTRA.get(name, {})).player_name == ""
