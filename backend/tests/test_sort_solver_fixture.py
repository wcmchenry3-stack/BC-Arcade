"""The Sort solver parity fixture matches the backend solver (#3686).

``frontend/src/game/sort/__tests__/fixtures/solverParity.json`` is what the
client solver is tested against. Regenerate it with
``python scripts/sort_export_solver_fixture.py`` (from ``backend/``) when the
solver or the level catalog changes.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import sort_export_solver_fixture as export

from sort.catalog import LEVEL_COUNT
from sort.fast_solver import solve


def test_committed_fixture_is_current() -> None:
    expected = export.render(export.build_fixture())
    assert (
        export.FIXTURE_PATH.read_text() == expected
    ), "solverParity.json is stale: run `python scripts/sort_export_solver_fixture.py`"


def test_fixture_covers_every_catalog_level() -> None:
    fixture = export.build_fixture()
    assert len(fixture["catalog"]["levels"]) == LEVEL_COUNT
    assert len(fixture["catalog"]["states"]) == LEVEL_COUNT
    kinds = {b["kind"]: b["verdict"] for b in fixture["boards"]}
    assert kinds == {
        "dead-shuffle": "unsolvable",
        "dead-play": "unsolvable",
        "mid-game": "solvable",
    }


def test_exported_verdicts_are_the_solvers() -> None:
    for board in export.build_fixture()["boards"]:
        bottles = [list(b) for b in board["bottles"]]
        result = solve(bottles)
        assert result.solvable is (board["verdict"] == "solvable"), board["name"]
