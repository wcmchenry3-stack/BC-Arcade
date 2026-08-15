"""Sudoku puzzle bank uniqueness audit (#623, #748).

Runs the uniqueness-checking solver from ``gen_sudoku_puzzles.py`` on
every puzzle in ``puzzles.json`` (classic 9×9) and a sampled subset of
``puzzles_mini.json`` (mini 6×6) and asserts exactly one solution each.

Runtime: ~40 s for 3 000 classic puzzles + ~3 s sampled mini on a modern
laptop; unconditional so generator regressions are caught before the bank
lands.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# Make the generator's helpers importable without installing the
# script as a package — it lives under backend/scripts/.
_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND / "scripts"))

from gen_sudoku_puzzles import (
    TIER_RANGES,
    TIER_RANGES_MINI,
    _make_peers,
    count_solutions,
)

_SUDOKU_DIR = Path(__file__).resolve().parents[2] / "frontend" / "src" / "game" / "sudoku"
_BANK_PATH = _SUDOKU_DIR / "puzzles.json"
_MINI_BANK_PATH = _SUDOKU_DIR / "puzzles_mini.json"

_CLASSIC_PEERS = _make_peers(9, 3, 3)
_MINI_PEERS = _make_peers(6, 2, 3)


def _load_bank() -> dict[str, list[str]]:
    return json.loads(_BANK_PATH.read_text())


def _load_mini_bank() -> dict[str, list[str]]:
    return json.loads(_MINI_BANK_PATH.read_text())


@pytest.fixture(scope="module")
def bank() -> dict[str, list[str]]:
    return _load_bank()


@pytest.fixture(scope="module")
def mini_bank() -> dict[str, list[str]]:
    return _load_mini_bank()


# ---------------------------------------------------------------------------
# Classic 9×9 bank
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("tier", ["easy", "medium", "hard"])
def test_every_puzzle_has_unique_solution(bank: dict[str, list[str]], tier: str) -> None:
    """``count_solutions`` with limit 2 must return exactly 1 for every
    puzzle.  If any puzzle returns 0 the generator produced an impossible
    grid; if any returns 2 the hollowing step accepted an ambiguous
    removal.  Both are shipping-blockers."""
    puzzles = bank[tier]
    assert len(puzzles) == 1000, f"{tier} bank is {len(puzzles)} puzzles, expected 1000"

    non_unique: list[tuple[int, int]] = []  # (index, count)
    for i, puzzle_str in enumerate(puzzles):
        assert len(puzzle_str) == 81, f"{tier}[{i}] wrong length {len(puzzle_str)}"
        grid = [int(c) for c in puzzle_str]
        ct = count_solutions(grid, 2, _CLASSIC_PEERS, 9)
        if ct != 1:
            non_unique.append((i, ct))
            if len(non_unique) >= 5:
                break

    if non_unique:
        sample = ", ".join(f"{tier}[{i}]={ct}" for i, ct in non_unique)
        pytest.fail(f"{len(non_unique)} {tier} puzzle(s) did not have a unique solution: {sample}")


@pytest.mark.parametrize("tier", ["easy", "medium", "hard"])
def test_every_puzzle_clue_count_in_range(bank: dict[str, list[str]], tier: str) -> None:
    """Each puzzle's clue count must land inside its tier's configured range."""
    lo, hi = TIER_RANGES[tier]
    out_of_range: list[tuple[int, int]] = []
    for i, puzzle_str in enumerate(bank[tier]):
        clues = sum(1 for ch in puzzle_str if ch != "0")
        if not (lo <= clues <= hi):
            out_of_range.append((i, clues))
            if len(out_of_range) >= 5:
                break

    if out_of_range:
        sample = ", ".join(f"{tier}[{i}]={clues}" for i, clues in out_of_range)
        pytest.fail(f"{len(out_of_range)} {tier} puzzle(s) outside [{lo}, {hi}]: {sample}")


def test_bank_totals(bank: dict[str, list[str]]) -> None:
    assert set(bank.keys()) == {"easy", "medium", "hard"}
    assert sum(len(v) for v in bank.values()) == 3000


# ---------------------------------------------------------------------------
# Mini 6×6 bank — sampled uniqueness check (50 per tier, ~3 s total)
# ---------------------------------------------------------------------------

_MINI_SAMPLE_SIZE = 50


@pytest.mark.parametrize("tier", ["easy", "medium", "hard"])
def test_mini_puzzle_has_unique_solution(mini_bank: dict[str, list[str]], tier: str) -> None:
    """Sample uniqueness check for the 6×6 mini bank (#748)."""
    puzzles = mini_bank[tier]
    assert (
        len(puzzles) >= _MINI_SAMPLE_SIZE
    ), f"{tier} mini bank has only {len(puzzles)} puzzles, expected ≥{_MINI_SAMPLE_SIZE}"

    non_unique: list[tuple[int, int]] = []
    for i, puzzle_str in enumerate(puzzles[:_MINI_SAMPLE_SIZE]):
        assert len(puzzle_str) == 36, f"mini {tier}[{i}] wrong length {len(puzzle_str)}"
        grid = [int(c) for c in puzzle_str]
        ct = count_solutions(grid, 2, _MINI_PEERS, 6)
        if ct != 1:
            non_unique.append((i, ct))
            if len(non_unique) >= 5:
                break

    if non_unique:
        sample = ", ".join(f"{tier}[{i}]={ct}" for i, ct in non_unique)
        pytest.fail(f"{len(non_unique)} mini {tier} puzzle(s) not unique: {sample}")


@pytest.mark.parametrize("tier", ["easy", "medium", "hard"])
def test_mini_puzzle_clue_count_in_range(mini_bank: dict[str, list[str]], tier: str) -> None:
    """Each 6×6 puzzle's clue count must land inside its tier's range."""
    lo, hi = TIER_RANGES_MINI[tier]
    out_of_range: list[tuple[int, int]] = []
    for i, puzzle_str in enumerate(mini_bank[tier]):
        clues = sum(1 for ch in puzzle_str if ch != "0")
        if not (lo <= clues <= hi):
            out_of_range.append((i, clues))
            if len(out_of_range) >= 5:
                break

    if out_of_range:
        sample = ", ".join(f"{tier}[{i}]={clues}" for i, clues in out_of_range)
        pytest.fail(f"{len(out_of_range)} mini {tier} puzzle(s) outside [{lo}, {hi}]: {sample}")


def test_mini_bank_totals(mini_bank: dict[str, list[str]]) -> None:
    assert set(mini_bank.keys()) == {"easy", "medium", "hard"}
    assert sum(len(v) for v in mini_bank.values()) == 3000
