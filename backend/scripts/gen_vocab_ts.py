#!/usr/bin/env python
"""Generate frontend/src/api/vocab.ts from backend/vocab.py and the game modules.

Usage (run from repo root):
    python backend/scripts/gen_vocab_ts.py > frontend/src/api/vocab.ts

``BOARDS`` comes from each registered ``GameModule``'s ``board`` (#2617). Every
``BoardDefinition`` field is exported, camelCased; tuple-of-pairs fields become
records. A game type with no registered module yet is exported as ``null``.

``HAS_WINNER`` is each module's ``has_winner`` (#2619), and ``RESULT_OUTCOMES`` /
``LIFECYCLE_OUTCOMES`` split ``GameOutcome`` (``vocab.py``), so the app can check
that a game with no winner never records a result outcome (#2642). A game type
with no registered module yet is exported as ``false``: it declares no winner.
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
from vocab import LIFECYCLE_OUTCOMES, RESULT_OUTCOMES, GameOutcome, GameType


def board_for(game_type: GameType) -> BoardDefinition | None:
    """The board a game type declares, or ``None`` if it has no module yet."""
    mod = get_module(game_type.value)
    return mod.board if mod is not None else None


def has_winner_for(game_type: GameType) -> bool:
    """The module's ``has_winner``; ``False`` for a game type with no module yet."""
    mod = get_module(game_type.value)
    return bool(mod.has_winner) if mod is not None else False


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
    comma), else it is expanded as Prettier does: one item per line, or, for
    an array of numbers, as many per line as fit (``_fill``).
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
        if len(value) > 1 and all(_is_number(v) for v in value):
            return "[\n" + _fill(value, inner) + f"\n{indent}]"
        items = "\n".join(f"{inner}{_ts(v, inner, len(inner))}," for v in value)
        return "[\n" + items + f"\n{indent}]"
    return json.dumps(value)


def _is_number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def _fill(numbers: list[Any], indent: str) -> str:
    """A long number array's items the way Prettier prints them ("fill"): as
    many ``n,`` per line as fit in ``_PRINT_WIDTH``, not one per line."""
    lines: list[str] = []
    line = ""
    for n in numbers:
        item = f"{json.dumps(n)},"
        if line and len(line) + 1 + len(item) > _PRINT_WIDTH:
            lines.append(line)
            line = ""
        line = f"{line} {item}" if line else f"{indent}{item}"
    lines.append(line)
    return "\n".join(lines)


def outcome_list_ts(name: str, outcomes: tuple[GameOutcome, ...]) -> str:
    """``export const <name> = [...] as const satisfies ...;`` as Prettier prints it."""
    items = [json.dumps(o.value) for o in outcomes]
    head, tail = f"export const {name} = [", "] as const satisfies readonly GameOutcome[];"
    one_line = head + ", ".join(items) + tail
    if len(one_line) <= _PRINT_WIDTH:
        return one_line
    return head + "\n" + "".join(f"  {item},\n" for item in items) + tail


def board_ts(board: BoardDefinition | None) -> str:
    """One ``BOARDS`` value as it appears in vocab.ts."""
    return _ts(board_json(board), "  ")


def render() -> str:
    """The full contents of ``frontend/src/api/vocab.ts``."""
    types = "\n".join(f'  "{v.value}",' for v in GameType)
    outcomes = "\n".join(f'  "{v.value}",' for v in GameOutcome)
    boards = "\n".join(f"  {v.value}: {board_ts(board_for(v))}," for v in GameType)
    has_winner = "\n".join(
        f"  {v.value}: {'true' if has_winner_for(v) else 'false'}," for v in GameType
    )
    result_outcomes = outcome_list_ts("RESULT_OUTCOMES", RESULT_OUTCOMES)
    lifecycle_outcomes = outcome_list_ts("LIFECYCLE_OUTCOMES", LIFECYCLE_OUTCOMES)
    return f"""\
/**
 * Shared vocabulary constants — DO NOT edit by hand.
 *
 * Source of truth: backend/vocab.py (GameType, GameOutcome enums and the
 * outcome sets) and each backend GameModule's `board` (backend/games/board.py)
 * and `has_winner`.
 * To update: edit those, then run:
 *   python backend/scripts/gen_vocab_ts.py > frontend/src/api/vocab.ts
 *
 * The backend CI test (tests/test_vocab.py) will fail if this file
 * drifts from the Python enums (GameType, GameOutcome), the boards or has_winner.
 */

export const GAME_TYPES = [
{types}
] as const;

export type GameType = (typeof GAME_TYPES)[number];

export const GAME_OUTCOMES = [
{outcomes}
] as const;

export type GameOutcome = (typeof GAME_OUTCOMES)[number];

/** Outcomes that say who won. Only a game with a winner (`HAS_WINNER`) records them. */
{result_outcomes}

/** Every other outcome: all a game with no winner ever records. */
{lifecycle_outcomes}

/** Whether each game can record a result outcome (its backend module's `has_winner`). */
export const HAS_WINNER: Readonly<Record<GameType, boolean>> = {{
{has_winner}
}};

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
