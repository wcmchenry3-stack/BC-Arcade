#!/usr/bin/env python
"""Generate frontend/src/api/vocab.ts from backend/vocab.py and the game modules.

Usage (run from repo root):
    python backend/scripts/gen_vocab_ts.py > frontend/src/api/vocab.ts

``BOARDS`` comes from each registered ``GameModule``'s ``board`` (#2617). Every
``BoardDefinition`` field is exported, camelCased; tuple-of-pairs fields become
records. A game type with no registered module yet is exported as ``null``.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

# Allow importing from backend/ without installing the package.
sys.path.insert(0, str(Path(__file__).parents[1]))

from games.board import BoardDefinition
from games.registry import get_module
from vocab import GameOutcome, GameType


def board_for(game_type: GameType) -> BoardDefinition | None:
    """The board a game type declares, or ``None`` if it has no module yet."""
    mod = get_module(game_type.value)
    return mod.board if mod is not None else None


def _camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.title() for part in rest)


def _record(pairs: tuple[tuple[str, str], ...]) -> dict[str, str]:
    return dict(pairs)


def _list_record(pairs: tuple[tuple[str, tuple[str, ...]], ...]) -> dict[str, list[str]]:
    return {key: list(values) for key, values in pairs}


def _nested_record(triples: tuple[tuple[str, str, int], ...]) -> dict[str, dict[str, int]]:
    nested: dict[str, dict[str, int]] = {}
    for key, value, cap in triples:
        nested.setdefault(key, {})[value] = cap
    return nested


# Fields stored as tuples of pairs/triples (immutable on the backend) that the
# app reads as records. Every other field is exported as-is.
_AS_RECORD = {
    "partition_defaults": _record,
    "partition_values": _list_record,
    "partition_max_values": _nested_record,
}


def board_json(board: BoardDefinition | None) -> dict[str, Any] | None:
    """One ``BOARDS`` value as plain JSON data: every field, camelCased."""
    if board is None:
        return None
    out: dict[str, Any] = {}
    for name in BoardDefinition.model_fields:
        value = getattr(board, name)
        if name in _AS_RECORD:
            value = _AS_RECORD[name](value)
        elif isinstance(value, tuple):
            value = list(value)
        out[_camel(name)] = value
    return out


_IDENT = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")

# frontend/.prettierrc
_PRINT_WIDTH = 100


def _ts(value: Any, indent: str, prefix: int = 0) -> str:
    """*value* as a TypeScript literal, formatted the way Prettier formats it.

    *prefix* is how many characters precede the value on its line. An array
    stays on one line when it fits in ``_PRINT_WIDTH`` (with the trailing
    comma), else it is expanded one item per line, as Prettier does.
    Non-empty objects are expanded, one key per line, which Prettier
    preserves.
    """
    if isinstance(value, dict):
        if not value:
            return "{}"
        inner = indent + "  "
        lines = []
        for k, v in value.items():
            head = f"{inner}{k if _IDENT.match(k) else json.dumps(k)}: "
            lines.append(f"{head}{_ts(v, inner, len(head))},")
        return "{\n" + "\n".join(lines) + f"\n{indent}}}"
    if isinstance(value, list):
        one_line = "[" + ", ".join(_ts(v, indent) for v in value) + "]"
        if not value or prefix + len(one_line) + 1 <= _PRINT_WIDTH:
            return one_line
        inner = indent + "  "
        items = "\n".join(f"{inner}{_ts(v, inner, len(inner))}," for v in value)
        return "[\n" + items + f"\n{indent}]"
    return json.dumps(value)


def board_ts(board: BoardDefinition | None) -> str:
    """One ``BOARDS`` value as it appears in vocab.ts."""
    return _ts(board_json(board), "  ")


def render() -> str:
    """The full contents of ``frontend/src/api/vocab.ts``."""
    types = "\n".join(f'  "{v.value}",' for v in GameType)
    outcomes = "\n".join(f'  "{v.value}",' for v in GameOutcome)
    boards = "\n".join(f"  {v.value}: {board_ts(board_for(v))}," for v in GameType)
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
  /** [metadata key, direction] applied before the final completed_at-asc tie-break. */
  readonly tiebreak: readonly [string, "asc" | "desc"] | null;
  /** i18n key for the metric's label, e.g. "score", "moves", "level". */
  readonly labelKey: string;
  /** Metadata keys that split the game into separate boards. */
  readonly partitions: readonly string[];
  /** Partition key -> value assumed when a row lacks that key (legacy rows). */
  readonly partitionDefaults: Readonly<Record<string, string>>;
  /** Partition key -> the only values it has a board for; a key not listed takes any value. */
  readonly partitionValues: Readonly<Record<string, readonly string[]>>;
  /** Highest legitimate metric value on any board; null = no ceiling. */
  readonly maxValue: number | null;
  /** Partition key -> partition value -> tighter cap for that partition. */
  readonly partitionMaxValues: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** Outcomes that count toward the board and "best"; null = any non-abandoned row. */
  readonly qualifyingOutcomes: readonly GameOutcome[] | null;
  /** False for games with no leaderboard. */
  readonly enabled: boolean;
}}

/** Every game type's board; `null` until the game declares one. */
export const BOARDS: Readonly<Record<GameType, BoardDefinition | null>> = {{
{boards}
}};"""


if __name__ == "__main__":
    print(render())
