"""Migration 0028's frozen rules match ``games.legacy_outcomes`` (#2703).

Migration ``0028_backfill_win_outcomes`` rewrote older builds' certain wins to
``win`` from its own frozen copy of the rules; ``complete_game`` applies the
live copy in ``games.legacy_outcomes`` to every completion since. This checks
that, today, both compile to the same SQL on Postgres and SQLite, so the
backfilled rows and the rows completed afterwards follow one rule.

The migration's copy must never be edited once released: a migration has to
keep meaning what it meant when written. To change a rule, change the helper
(and, if stored rows need it, add a new migration). This test will then fail by
design; update it to pin the new difference, never the 0028 copy.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest
from sqlalchemy.dialects import postgresql, sqlite

from games import legacy_outcomes

_MIGRATION = (
    Path(__file__).resolve().parent.parent
    / "alembic"
    / "versions"
    / "0028_backfill_win_outcomes.py"
)
_DIALECTS = {"postgresql": postgresql.dialect(), "sqlite": sqlite.dialect()}


def _migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("_mig_0028_parity", _MIGRATION)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _sql(statement, dialect: str) -> str:
    return str(
        statement.compile(dialect=_DIALECTS[dialect], compile_kwargs={"literal_binds": True})
    )


def test_both_copies_cover_the_same_games_and_outcomes() -> None:
    migration = _migration()
    assert migration.LEGACY_OUTCOMES == legacy_outcomes.LEGACY_OUTCOMES
    assert migration.WIN == legacy_outcomes.WIN
    assert migration.TWENTY48_WIN_TILE == legacy_outcomes.TWENTY48_WIN_TILE


@pytest.mark.parametrize("dialect", sorted(_DIALECTS))
@pytest.mark.parametrize("game_type", sorted(legacy_outcomes.LEGACY_OUTCOMES))
def test_the_migration_statement_equals_the_helpers(game_type: str, dialect: str) -> None:
    frozen = _sql(_migration().win_update(game_type, dialect), dialect)
    live = _sql(legacy_outcomes.win_update(game_type, dialect), dialect)
    assert frozen == live
