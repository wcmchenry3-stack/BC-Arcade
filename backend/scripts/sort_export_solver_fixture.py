"""Export the Sort solver parity fixture (#3686).

Run from ``backend/``::

    python scripts/sort_export_solver_fixture.py

It writes ``frontend/src/game/sort/__tests__/fixtures/solverParity.json``, which
the client solver's Jest test (``solver.parity.test.ts``) replays: the TS solver
must reach the same verdict as ``sort.fast_solver.solve`` on every board.
``backend/tests/test_sort_solver_fixture.py`` regenerates it in memory and
asserts it equals the committed file, so the two can't drift.

Format (all deterministic; fixed seeds):

* A board is a list of strings, one per bottle, bottom first, one letter per
  unit (``"ABCA"``), ``""`` for an empty bottle. Letters are assigned in order
  of first appearance on the board, so they carry no colour; the solver only
  compares them. The bottle order is the board as shown (it is not sorted).
* ``levelSets``: ``build_levels(seed)`` for 20 seeds, each ``levels[i]`` being
  level ``i + 1``. All are solvable (the generator proves it).
* ``boards``: ``{"name", "kind", "bottles", "verdict", "states"}``. ``kind`` is
  ``dead-shuffle`` (a raw random shuffle), ``dead-play`` (a position reached by
  random play), or ``mid-game`` (a solvable position reached by random play).
  ``verdict`` is ``solvable`` or ``unsolvable`` (proven); boards the backend
  can't decide are never exported.
* ``states`` (here and in ``levelSets[].states``) is the number of distinct
  states ``fast_solver`` visited, so the TS port can be held to the same search.
"""

from __future__ import annotations

import json
import os
import random
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sort.fast_solver import DEPTH, solve
from sort.generate_levels import LEVEL_SPECS, build_levels

FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "frontend/src/game/sort/__tests__/fixtures/solverParity.json"
)

LEVEL_SET_SEEDS = list(range(20))
_PLAY_SEEDS = [0, 1, 2]
_MAX_STATES = 20_000  # keeps every boards entry quick to prove in Jest
_BUDGET = 60_000
_DEAD_SHUFFLES = 16
_DEAD_PLAYS = 16
_MID_GAMES = 16

Board = list[str]


def _letters(bottles: list[list[str]]) -> Board:
    """Bottles as one-letter-per-unit strings, lettered by first appearance."""
    codes: dict[str, str] = {}
    return ["".join(codes.setdefault(c, chr(65 + len(codes))) for c in b if c) for b in bottles]


def _random_pour(board: list[list[str]], rng: random.Random) -> bool:
    """Play one random legal pour (whole top run, as much as fits); False if none."""
    moves = []
    for i, src in enumerate(board):
        if not src:
            continue
        for j, dst in enumerate(board):
            if i != j and len(dst) < DEPTH and (not dst or dst[-1] == src[-1]):
                moves.append((i, j))
    if not moves:
        return False
    i, j = rng.choice(moves)
    src, dst = board[i], board[j]
    run = 1
    while run < len(src) and src[-1 - run] == src[-1]:
        run += 1
    k = min(run, DEPTH - len(dst))
    for _ in range(k):
        dst.append(src.pop())
    return True


def _entry(name: str, kind: str, board: list[list[str]]) -> dict | None:
    result = solve(board, _BUDGET)
    if result.solvable is None or result.seen > _MAX_STATES:
        return None
    verdict = "solvable" if result.solvable else "unsolvable"
    return {
        "name": name,
        "kind": kind,
        "bottles": _letters(board),
        "verdict": verdict,
        "states": result.seen,
    }


def _boards() -> list[dict]:
    out: list[dict] = []

    # Raw dead shuffles, round-robin over the level configurations (no generator filter).
    rng = random.Random(3686)
    specs = [s for s in LEVEL_SPECS if len(s[1]) >= 5]
    n = 0
    while sum(b["kind"] == "dead-shuffle" for b in out) < _DEAD_SHUFFLES:
        level_id, colors, n_empty = specs[n % len(specs)]
        n += 1
        units = [c for c in colors for _ in range(DEPTH)]
        rng.shuffle(units)
        board = [units[i * DEPTH : (i + 1) * DEPTH] for i in range(len(colors))]
        board += [[] for _ in range(n_empty)]
        entry = _entry(f"shuffle-L{level_id}-{n}", "dead-shuffle", board)
        if entry and entry["verdict"] == "unsolvable":
            out.append(entry)

    # Random play from generated levels: dead ends and solvable mid-game positions.
    rng = random.Random(36860)
    dead = mid = 0
    levels = [(seed, lv) for seed in _PLAY_SEEDS for lv in build_levels(seed)]
    attempt = 0
    while (dead < _DEAD_PLAYS or mid < _MID_GAMES) and attempt < 5_000:
        seed, lv = levels[attempt % len(levels)]
        attempt += 1
        board = [[c for c in b if c] for b in lv["bottles"]]
        for _ in range(rng.randint(6, 80)):
            if not _random_pour(board, rng):
                break
        name = f"play-s{seed}-L{lv['id']}-{attempt}"
        entry = _entry(name, "dead-play", board)
        if entry is None:
            continue
        if entry["verdict"] == "unsolvable" and dead < _DEAD_PLAYS:
            out.append(entry)
            dead += 1
        elif entry["verdict"] == "solvable" and mid < _MID_GAMES and any(board):
            entry["kind"] = "mid-game"
            out.append(entry)
            mid += 1
    return out


def build_fixture() -> dict:
    sets = []
    for seed in LEVEL_SET_SEEDS:
        levels, states = [], []
        for level in build_levels(seed):
            result = solve(level["bottles"])
            assert result.solvable is True
            levels.append(_letters(level["bottles"]))
            states.append(result.seen)
        sets.append({"seed": seed, "levels": levels, "states": states})
    return {"levelSets": sets, "boards": _boards()}


def render(fixture: dict) -> str:
    """One line per set / board, so diffs and size stay small."""

    def line(obj: object) -> str:
        return json.dumps(obj, separators=(",", ":"))

    sets = ",\n".join("    " + line(s) for s in fixture["levelSets"])
    boards = ",\n".join("    " + line(b) for b in fixture["boards"])
    return f'{{\n  "levelSets": [\n{sets}\n  ],\n  "boards": [\n{boards}\n  ]\n}}\n'


def main() -> None:
    fixture = build_fixture()
    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_PATH.write_text(render(fixture))
    worst = max(max(s["states"]) for s in fixture["levelSets"])
    kinds = {
        k: sum(b["kind"] == k for b in fixture["boards"])
        for k in {b["kind"] for b in fixture["boards"]}
    }
    print(f"wrote {FIXTURE_PATH} ({FIXTURE_PATH.stat().st_size} bytes)")
    print(f"worst-case states over level sets: {worst}; boards: {kinds}")


if __name__ == "__main__":
    main()
