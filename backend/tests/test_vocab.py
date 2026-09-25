"""Contract tests for shared vocabulary (#537, #538, #2617).

Verifies that frontend/src/api/vocab.ts stays in sync with backend/vocab.py
and every GameModule's ``board``, and that the GameType enum stays in sync
with the game_types DB table.

These tests run in CI on every push — a drift between the Python enums and
the committed TypeScript file (or the DB rows) will fail the build with an
actionable error message.
"""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path

import pytest
from sqlalchemy import select

from vocab import GameOutcome, GameType

_REPO_ROOT = Path(__file__).parents[2]
_VOCAB_TS = _REPO_ROOT / "frontend" / "src" / "api" / "vocab.ts"


# ---------------------------------------------------------------------------
# TypeScript file sync (file-based, no DB required)
# ---------------------------------------------------------------------------


def _parse_ts_array(array_name: str) -> set[str]:
    """Extract string literals from a named const array in vocab.ts."""
    content = _VOCAB_TS.read_text(encoding="utf-8")
    match = re.search(rf"{array_name}\s*=\s*\[(.*?)\]", content, re.DOTALL)
    assert match, f"Could not find {array_name} array in {_VOCAB_TS}"
    return set(re.findall(r'"([^"]+)"', match.group(1)))


def test_ts_vocab_file_exists() -> None:
    assert _VOCAB_TS.exists(), f"Missing {_VOCAB_TS} — run: python backend/scripts/gen_vocab_ts.py"


def _load_generator():
    """Import backend/scripts/gen_vocab_ts.py (``scripts`` is not a package)."""
    path = Path(__file__).parents[1] / "scripts" / "gen_vocab_ts.py"
    spec = importlib.util.spec_from_file_location("_gen_vocab_ts", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_REGEN = "Re-generate: python backend/scripts/gen_vocab_ts.py > frontend/src/api/vocab.ts"


def test_boards_ts_matches_modules() -> None:
    """Each game's ``BOARDS`` entry in vocab.ts is what the generator serialises
    from that game's ``GameModule.board`` (#2617)."""
    gen = _load_generator()
    content = _VOCAB_TS.read_text(encoding="utf-8")
    stale = [
        gt.value
        for gt in GameType
        if f"\n  {gt.value}: {gen.board_ts(gen.board_for(gt))},\n" not in content
    ]
    assert not stale, f"BOARDS in vocab.ts is stale for {stale}. {_REGEN}"


def test_generator_exports_every_board_field() -> None:
    """No ``BoardDefinition`` field is left out of the export or the TS interface."""
    from games.board import BoardDefinition

    gen = _load_generator()
    expected = {gen._camel(name) for name in BoardDefinition.model_fields}
    sudoku = gen.board_json(gen.board_for(GameType.SUDOKU))
    assert set(sudoku) == expected

    content = _VOCAB_TS.read_text(encoding="utf-8")
    interface = content[content.index("export interface BoardDefinition") :]
    interface = interface[: interface.index("\n}")]
    assert set(re.findall(r"^\s+readonly (\w+):", interface, re.MULTILINE)) == expected


def test_board_json_turns_pair_tuples_into_records() -> None:
    gen = _load_generator()
    sudoku = gen.board_json(gen.board_for(GameType.SUDOKU))
    assert sudoku["partitions"] == ["difficulty", "variant"]
    assert sudoku["partitionDefaults"] == {"variant": "classic"}
    assert sudoku["partitionMaxValues"] == {"difficulty": {"easy": 100, "medium": 200, "hard": 300}}
    sort = gen.board_json(gen.board_for(GameType.SORT))
    assert sort["tiebreak"] == ["total_moves", "asc"]
    assert sort["maxValue"] == 23
    assert gen.board_json(gen.board_for(GameType.DAILY_WORD))["qualifyingOutcomes"] == ["win"]
    starswarm = gen.board_json(gen.board_for(GameType.STARSWARM))
    assert starswarm["partitions"] == ["difficulty_tier"]
    assert starswarm["partitionDefaults"] == {"difficulty_tier": "LieutenantJG"}
    assert starswarm["partitionValues"]["difficulty_tier"][:2] == ["Ensign", "LieutenantJG"]
    assert sudoku["partitionValues"] == {}
    # Every GameType has a module since #2623; a future one without is still null.
    assert gen.board_json(None) is None


def test_long_arrays_wrap_like_prettier() -> None:
    """An array past the 100-column print width goes one item per line."""
    gen = _load_generator()
    assert gen._ts({"k": ["a", "b"]}, "  ") == '{\n    k: ["a", "b"],\n  }'
    wide = ["x" * 30, "y" * 30, "z" * 30]
    assert gen._ts({"k": wide}, "  ") == (
        '{\n    k: [\n      "'
        + wide[0]
        + '",\n      "'
        + wide[1]
        + '",\n      "'
        + wide[2]
        + '",\n    ],\n  }'
    )


def test_vocab_ts_matches_generator_output() -> None:
    """The committed vocab.ts is byte-for-byte what the generator prints."""
    rendered = _load_generator().render() + "\n"
    assert (
        _VOCAB_TS.read_text(encoding="utf-8") == rendered
    ), f"frontend/src/api/vocab.ts differs from the generator output. {_REGEN}"


def test_game_type_ts_in_sync() -> None:
    """GAME_TYPES in vocab.ts must exactly match GameType in vocab.py."""
    py_values = {v.value for v in GameType}
    ts_values = _parse_ts_array("GAME_TYPES")
    assert ts_values == py_values, (
        "frontend/src/api/vocab.ts is out of sync with backend/vocab.py.\n"
        f"  In Python only: {py_values - ts_values}\n"
        f"  In TypeScript only: {ts_values - py_values}\n"
        "Re-generate: python backend/scripts/gen_vocab_ts.py > frontend/src/api/vocab.ts"
    )


def test_game_outcome_ts_in_sync() -> None:
    """GAME_OUTCOMES in vocab.ts must exactly match GameOutcome in vocab.py."""
    py_values = {v.value for v in GameOutcome}
    ts_values = _parse_ts_array("GAME_OUTCOMES")
    assert ts_values == py_values, (
        "frontend/src/api/vocab.ts is out of sync with backend/vocab.py.\n"
        f"  In Python only: {py_values - ts_values}\n"
        f"  In TypeScript only: {ts_values - py_values}\n"
        "Re-generate: python backend/scripts/gen_vocab_ts.py > frontend/src/api/vocab.ts"
    )


def test_game_type_enum_values() -> None:
    """Regression guard — no value should be silently removed from GameType."""
    expected = {
        "yacht",
        "twenty48",
        "blackjack",
        "cascade",
        "solitaire",
        "hearts",
        "sudoku",
        "mahjong",
        "starswarm",
        "freecell",
        "sort",
        "daily_word",
    }
    assert {v.value for v in GameType} == expected


def test_game_outcome_enum_values() -> None:
    """Regression guard — no value should be silently removed from GameOutcome."""
    expected = {"win", "loss", "push", "completed", "abandoned", "kept_playing"}
    assert {v.value for v in GameOutcome} == expected


# ---------------------------------------------------------------------------
# DB sync (requires DATABASE_URL — always set by conftest.py in CI)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_game_type_enum_matches_db() -> None:
    """Every GameType enum member must have an active row in game_types, and
    every active row must have a corresponding enum member.

    This test catches a game being added to the DB without updating the enum,
    or vice versa. The conftest provisions a SQLite DB via alembic migrations
    so this runs in CI without an external Postgres instance.
    """
    from db.base import get_session_factory
    from db.models import GameType as GameTypeModel

    factory = get_session_factory()
    async with factory() as session:
        db_names = set(
            (
                await session.execute(
                    select(GameTypeModel.name).where(GameTypeModel.is_active.is_(True))
                )
            )
            .scalars()
            .all()
        )

    enum_values = {v.value for v in GameType}
    assert enum_values == db_names, (
        "GameType enum and active game_types DB rows are out of sync.\n"
        f"  In enum only (needs a migration): {enum_values - db_names}\n"
        f"  In DB only (needs an enum member): {db_names - enum_values}"
    )
