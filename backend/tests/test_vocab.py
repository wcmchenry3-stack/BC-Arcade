"""Contract tests for shared vocabulary (#537, #538).

Verifies that frontend/src/api/vocab.ts stays in sync with backend/vocab.py,
and that the GameType enum stays in sync with the game_types DB table.

These tests run in CI on every push — a drift between the Python enums and
the committed TypeScript file (or the DB rows) will fail the build with an
actionable error message.
"""

from __future__ import annotations

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
    expected = {"win", "loss", "push", "blackjack", "completed", "abandoned", "kept_playing"}
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
