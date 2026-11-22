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
* ``catalog``: ``{"levels", "states"}`` for the 120 levels of the shipped catalog
  (``levels.catalog.json``, #2761), ``levels[i]`` being level ``i + 1``. All are
  solvable (the catalog build proves it). The file is read as committed, so
  ``test_sort_catalog.py`` is what keeps it current.
* ``boards``: ``{"name", "kind", "bottles", "verdict", "states"}``. ``kind`` is
  ``dead-shuffle`` (a raw random shuffle), ``dead-play`` (a position reached by
  random play), or ``mid-game`` (a solvable position reached by random play).
  ``verdict`` is ``solvable`` or ``unsolvable`` (proven); boards the backend
  can't decide are never exported.
* ``states`` (here and in ``catalog.states``) is the number of distinct
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
from sort.generate_levels import COLORS_14

FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "frontend/src/game/sort/__tests__/fixtures/solverParity.json"
)

CATALOG_PATH = Path(__file__).resolve().parents[2] / "frontend/src/game/sort/levels.catalog.json"

_MAX_STATES = 20_000  # keeps every boards entry quick to prove in Jest
_BUDGET = 60_000
_DEAD_SHUFFLES = 16
_DEAD_PLAYS = 16
_MID_GAMES = 16

Board = list[str]


def _catalog_levels() -> list[list[list[str]]]:
    """The committed catalog's levels as colour-name bottles, level 1 first."""
    levels = json.loads(CATALOG_PATH.read_text())["levels"]
    return [
        [[COLORS_14[ord(ch) - 65] for ch in b] for b in encoded.split(",")]
        for encoded, _par in levels
    ]


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

    levels = _catalog_levels()

    # Raw dead shuffles, round-robin over the catalog's (colours, empty bottles)
    # configurations of 5+ colours (no generator filter).
    rng = random.Random(3686)
    configs = sorted(
        {
            (sum(1 for b in lv if b), sum(1 for b in lv if not b))
            for lv in levels
            if sum(1 for b in lv if b) >= 5
        }
    )
    n = 0
    while sum(b["kind"] == "dead-shuffle" for b in out) < _DEAD_SHUFFLES:
        n_colors, n_empty = configs[n % len(configs)]
        n += 1
        units = [c for c in COLORS_14[:n_colors] for _ in range(DEPTH)]
        rng.shuffle(units)
        board = [units[i * DEPTH : (i + 1) * DEPTH] for i in range(n_colors)]
        board += [[] for _ in range(n_empty)]
        entry = _entry(f"shuffle-{n_colors}c{n_empty}e-{n}", "dead-shuffle", board)
        if entry and entry["verdict"] == "unsolvable":
            out.append(entry)

    # Random play from the catalog's levels: dead ends and solvable mid-game positions.
    rng = random.Random(36860)
    dead = mid = 0
    attempt = 0
    while (dead < _DEAD_PLAYS or mid < _MID_GAMES) and attempt < 5_000:
        level_no = attempt % len(levels) + 1
        board = [list(b) for b in levels[level_no - 1]]
        attempt += 1
        for _ in range(rng.randint(6, 80)):
            if not _random_pour(board, rng):
                break
        name = f"play-L{level_no}-{attempt}"
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
    letters, states = [], []
    for bottles in _catalog_levels():
        result = solve(bottles)
        assert result.solvable is True
        letters.append(_letters(bottles))
        states.append(result.seen)
    return {"catalog": {"levels": letters, "states": states}, "boards": _boards()}


def render(fixture: dict) -> str:
    """One line per set / board, so diffs and size stay small."""

    def line(obj: object) -> str:
        return json.dumps(obj, separators=(",", ":"))

    boards = ",\n".join("    " + line(b) for b in fixture["boards"])
    return f'{{\n  "catalog": {line(fixture["catalog"])},\n' f'  "boards": [\n{boards}\n  ]\n}}\n'


def main() -> None:
    fixture = build_fixture()
    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_PATH.write_text(render(fixture))
    worst = max(fixture["catalog"]["states"])
    kinds = {
        k: sum(b["kind"] == k for b in fixture["boards"])
        for k in {b["kind"] for b in fixture["boards"]}
    }
    print(f"wrote {FIXTURE_PATH} ({FIXTURE_PATH.stat().st_size} bytes)")
    print(f"worst-case states over catalog levels: {worst}; boards: {kinds}")


if __name__ == "__main__":
    main()
