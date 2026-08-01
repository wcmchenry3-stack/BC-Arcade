#!/usr/bin/env python
"""Generate frontend/src/api/vocab.ts from backend/vocab.py.

Usage (run from repo root):
    python backend/scripts/gen_vocab_ts.py > frontend/src/api/vocab.ts
"""

from __future__ import annotations

import sys
from pathlib import Path

# Allow importing from backend/ without installing the package.
sys.path.insert(0, str(Path(__file__).parents[1]))

from vocab import GameOutcome, GameType

_TYPES = "\n".join(f'  "{v.value}",' for v in GameType)
_OUTCOMES = "\n".join(f'  "{v.value}",' for v in GameOutcome)

print(f"""\
/**
 * Shared vocabulary constants — DO NOT edit by hand.
 *
 * Source of truth: backend/vocab.py (GameType, GameOutcome enums).
 * To update: edit backend/vocab.py, then run:
 *   python backend/scripts/gen_vocab_ts.py > frontend/src/api/vocab.ts
 *
 * The backend CI test (tests/test_vocab.py) will fail if this file
 * drifts from the Python enums (GameType, GameOutcome).
 */

export const GAME_TYPES = [
{_TYPES}
] as const;

export type GameType = (typeof GAME_TYPES)[number];

export const GAME_OUTCOMES = [
{_OUTCOMES}
] as const;

export type GameOutcome = (typeof GAME_OUTCOMES)[number];""")
