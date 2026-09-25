#!/usr/bin/env python
"""Generate frontend/src/api/vocab.ts from backend/vocab.py and the game modules.

Usage (run from repo root):
    python backend/scripts/gen_vocab_ts.py > frontend/src/api/vocab.ts

``BOARDS`` comes from each registered ``GameModule``'s ``board`` (#2617);
a game type with no registered module, or a module whose ``board`` is
``None``, is exported as ``null``.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Allow importing from backend/ without installing the package.
sys.path.insert(0, str(Path(__file__).parents[1]))

from games.board import BoardDefinition
from games.registry import get_module
from vocab import GameOutcome, GameType


def board_for(game_type: GameType) -> BoardDefinition | None:
    """The board a game type declares, or ``None`` if it has none yet."""
    mod = get_module(game_type.value)
    return mod.board if mod is not None else None


def _board_ts(board: BoardDefinition | None) -> str:
    """One ``BOARDS`` value, formatted the way Prettier formats it."""
    if board is None:
        return "null"
    partitions = ", ".join(json.dumps(p) for p in board.partitions)
    return (
        "{\n"
        f"    metric: {json.dumps(board.metric)},\n"
        f"    direction: {json.dumps(board.direction)},\n"
        f"    labelKey: {json.dumps(board.label_key)},\n"
        f"    partitions: [{partitions}],\n"
        f"    enabled: {json.dumps(board.enabled)},\n"
        "  }"
    )


def render() -> str:
    """The full contents of ``frontend/src/api/vocab.ts``."""
    types = "\n".join(f'  "{v.value}",' for v in GameType)
    outcomes = "\n".join(f'  "{v.value}",' for v in GameOutcome)
    boards = "\n".join(f"  {v.value}: {_board_ts(board_for(v))}," for v in GameType)
    return f"""\
/**
 * Shared vocabulary constants — DO NOT edit by hand.
 *
 * Source of truth: backend/vocab.py (GameType, GameOutcome enums) and each
 * backend GameModule's `board` (backend/games/board.py).
 * To update: edit those, then run:
 *   python backend/scripts/gen_vocab_ts.py > frontend/src/api/vocab.ts
 *
 * The backend CI test (tests/test_vocab.py) will fail if this file
 * drifts from the Python enums (GameType, GameOutcome) or the boards.
 */

export const GAME_TYPES = [
{types}
] as const;

export type GameType = (typeof GAME_TYPES)[number];

export const GAME_OUTCOMES = [
{outcomes}
] as const;

export type GameOutcome = (typeof GAME_OUTCOMES)[number];

/** How one game is ranked on its leaderboard (backend/games/board.py). */
export interface BoardDefinition {{
  /** "final_score" (the games column) or a key in the game's metadata. */
  readonly metric: string;
  /** "desc": higher is better. "asc": lower is better. */
  readonly direction: "asc" | "desc";
  /** i18n key for the metric's label, e.g. "score", "moves", "level". */
  readonly labelKey: string;
  /** Metadata keys that split the game into separate boards. */
  readonly partitions: readonly string[];
  /** False for games with no leaderboard. */
  readonly enabled: boolean;
}}

/** Every game type's board; `null` until the game declares one. */
export const BOARDS: Readonly<Record<GameType, BoardDefinition | null>> = {{
{boards}
}};"""


if __name__ == "__main__":
    print(render())
