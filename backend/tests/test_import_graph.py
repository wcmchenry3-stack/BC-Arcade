"""Import graph of the games layer (#2992, epic #2950).

``games/schemas.py`` used to import ``games.leaderboard`` (for the
``RankReason`` Literal) and ``games.registry`` at module level, so importing
the request schemas imported every ``<game>/module.py``. ``RankReason`` now
lives in the declarative ``games/board.py`` and the registry is imported
lazily inside the metadata validator. These checks run in a fresh interpreter
because the test process has already imported everything.
"""

from __future__ import annotations

import importlib
import json
import pathlib
import subprocess
import sys
import typing

import pytest
from pydantic import ValidationError

BACKEND = pathlib.Path(__file__).resolve().parent.parent
GAME_PACKAGES = sorted(p.parent.name for p in BACKEND.glob("*/module.py"))
BOARDS_MODULES = ["limits", "partitions", "queries", "sql", "types"]


def _modules_after_import(module: str) -> set[str]:
    """``sys.modules`` of a fresh interpreter that imported only ``module``."""
    code = f"import json, sys\nimport {module}\nprint(json.dumps(sorted(sys.modules)))"
    out = subprocess.run(
        [sys.executable, "-c", code], cwd=BACKEND, capture_output=True, text=True, check=True
    )
    return set(json.loads(out.stdout.strip().splitlines()[-1]))


def test_every_game_package_is_found() -> None:
    # Guards the glob below: an empty list would make the next test vacuous.
    assert len(GAME_PACKAGES) >= 12, GAME_PACKAGES


def test_schemas_import_no_game_module_nor_the_query_layer() -> None:
    loaded = _modules_after_import("games.schemas")
    game_modules = sorted(f"{g}.module" for g in GAME_PACKAGES if f"{g}.module" in loaded)
    assert game_modules == [], f"games.schemas imports {game_modules}"
    assert "games.registry" not in loaded
    assert not any(m == "games.boards" or m.startswith("games.boards.") for m in loaded)


@pytest.mark.parametrize("name", BOARDS_MODULES)
def test_each_boards_module_imports_on_its_own(name: str) -> None:
    """No import cycle inside the package, whichever module is imported first."""
    assert f"games.boards.{name}" in _modules_after_import(f"games.boards.{name}")


def test_the_leaderboard_facade_is_gone() -> None:
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module("games.leaderboard")


def test_rank_reason_is_declared_once() -> None:
    from games import board, schemas
    from games.boards import types

    assert types.RankReason is board.RankReason
    assert typing.get_args(board.RankReason) == (
        "no_name",
        "not_finished",
        "not_rankable",
        "board_disabled",
    )
    hints = typing.get_type_hints(schemas.GameRankResponse)
    assert hints["reason"] == board.RankReason | None


def test_the_lazy_registry_lookup_still_validates_metadata() -> None:
    """Same ValidationError (so the same 422) for a registered game's bad metadata."""
    from games.schemas import CreateGameRequest

    with pytest.raises(ValidationError) as info:
        CreateGameRequest(game_type="sudoku", metadata={"difficulty": 7})
    assert info.value.errors()[0]["loc"] == ("difficulty",)
    # An unregistered game type still skips validation.
    assert CreateGameRequest(game_type="zz_future", metadata={"x": 1}).metadata == {"x": 1}
