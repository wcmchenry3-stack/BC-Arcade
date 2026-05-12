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
] as const;

export type GameType = (typeof GAME_TYPES)[number];

export const GAME_OUTCOMES = [
  "win",
  "loss",
  "push",
  "blackjack",
  "completed",
  "abandoned",
  "kept_playing",
] as const;

export type GameOutcome = (typeof GAME_OUTCOMES)[number];
