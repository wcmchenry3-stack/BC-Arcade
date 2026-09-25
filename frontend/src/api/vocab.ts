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

/** How one game is ranked on its leaderboard (backend/games/board.py). */
export interface BoardDefinition {
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
}

/** Every game type's board; `null` until the game declares one. */
export const BOARDS: Readonly<Record<GameType, BoardDefinition | null>> = {
  yacht: {
    metric: "final_score",
    direction: "desc",
    labelKey: "score",
    partitions: [],
    enabled: true,
  },
  twenty48: {
    metric: "final_score",
    direction: "desc",
    labelKey: "score",
    partitions: [],
    enabled: true,
  },
  blackjack: {
    metric: "final_score",
    direction: "desc",
    labelKey: "chips",
    partitions: [],
    enabled: false,
  },
  cascade: {
    metric: "final_score",
    direction: "desc",
    labelKey: "score",
    partitions: [],
    enabled: true,
  },
  solitaire: {
    metric: "final_score",
    direction: "desc",
    labelKey: "score",
    partitions: [],
    enabled: true,
  },
  hearts: {
    metric: "final_score",
    direction: "desc",
    labelKey: "score",
    partitions: [],
    enabled: true,
  },
  sudoku: {
    metric: "final_score",
    direction: "desc",
    labelKey: "score",
    partitions: ["difficulty", "variant"],
    enabled: true,
  },
  mahjong: {
    metric: "final_score",
    direction: "desc",
    labelKey: "score",
    partitions: [],
    enabled: true,
  },
  starswarm: {
    metric: "final_score",
    direction: "desc",
    labelKey: "score",
    partitions: ["difficulty_tier"],
    enabled: true,
  },
  freecell: {
    metric: "final_score",
    direction: "asc",
    labelKey: "moves",
    partitions: [],
    enabled: true,
  },
  sort: {
    metric: "level_reached",
    direction: "desc",
    labelKey: "level",
    partitions: [],
    enabled: true,
  },
  daily_word: {
    metric: "guesses_used",
    direction: "asc",
    labelKey: "guesses",
    partitions: [],
    enabled: false,
  },
};
