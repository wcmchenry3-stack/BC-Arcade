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
  /** [metadata key, direction] applied before the final completed_at-asc tie-break. */
  readonly tiebreak: readonly [string, "asc" | "desc"] | null;
  /** i18n key for the metric's label, e.g. "score", "moves", "level". */
  readonly labelKey: string;
  /** Metadata keys that split the game into separate boards. */
  readonly partitions: readonly string[];
  /** Partition key -> value assumed when a row lacks that key (legacy rows). */
  readonly partitionDefaults: Readonly<Record<string, string>>;
  /** Highest legitimate metric value on any board; null = no ceiling. */
  readonly maxValue: number | null;
  /** Partition key -> partition value -> tighter cap for that partition. */
  readonly partitionMaxValues: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** Outcomes that count toward the board and "best"; null = any non-abandoned row. */
  readonly qualifyingOutcomes: readonly GameOutcome[] | null;
  /** False for games with no leaderboard. */
  readonly enabled: boolean;
}

/** Every game type's board; `null` until the game declares one. */
export const BOARDS: Readonly<Record<GameType, BoardDefinition | null>> = {
  yacht: {
    metric: "final_score",
    direction: "desc",
    tiebreak: null,
    labelKey: "score",
    partitions: [],
    partitionDefaults: {},
    maxValue: 1575,
    partitionMaxValues: {},
    qualifyingOutcomes: null,
    enabled: true,
  },
  twenty48: null,
  blackjack: {
    metric: "final_score",
    direction: "desc",
    tiebreak: null,
    labelKey: "chips",
    partitions: [],
    partitionDefaults: {},
    maxValue: null,
    partitionMaxValues: {},
    qualifyingOutcomes: null,
    enabled: false,
  },
  cascade: {
    metric: "final_score",
    direction: "desc",
    tiebreak: null,
    labelKey: "score",
    partitions: [],
    partitionDefaults: {},
    maxValue: null,
    partitionMaxValues: {},
    qualifyingOutcomes: null,
    enabled: true,
  },
  solitaire: {
    metric: "final_score",
    direction: "desc",
    tiebreak: null,
    labelKey: "score",
    partitions: [],
    partitionDefaults: {},
    maxValue: 1245,
    partitionMaxValues: {},
    qualifyingOutcomes: null,
    enabled: true,
  },
  hearts: {
    metric: "final_score",
    direction: "desc",
    tiebreak: null,
    labelKey: "score",
    partitions: [],
    partitionDefaults: {},
    maxValue: 100,
    partitionMaxValues: {},
    qualifyingOutcomes: null,
    enabled: true,
  },
  sudoku: {
    metric: "final_score",
    direction: "desc",
    tiebreak: null,
    labelKey: "score",
    partitions: ["difficulty", "variant"],
    partitionDefaults: {
      variant: "classic",
    },
    maxValue: 300,
    partitionMaxValues: {
      difficulty: {
        easy: 100,
        medium: 200,
        hard: 300,
      },
    },
    qualifyingOutcomes: null,
    enabled: true,
  },
  mahjong: {
    metric: "final_score",
    direction: "desc",
    tiebreak: null,
    labelKey: "score",
    partitions: [],
    partitionDefaults: {},
    maxValue: 1220,
    partitionMaxValues: {},
    qualifyingOutcomes: null,
    enabled: true,
  },
  starswarm: null,
  freecell: {
    metric: "final_score",
    direction: "asc",
    tiebreak: null,
    labelKey: "moves",
    partitions: [],
    partitionDefaults: {},
    maxValue: null,
    partitionMaxValues: {},
    qualifyingOutcomes: null,
    enabled: true,
  },
  sort: {
    metric: "level_reached",
    direction: "desc",
    tiebreak: ["total_moves", "asc"],
    labelKey: "level",
    partitions: [],
    partitionDefaults: {},
    maxValue: 23,
    partitionMaxValues: {},
    qualifyingOutcomes: null,
    enabled: true,
  },
  daily_word: {
    metric: "guesses_used",
    direction: "asc",
    tiebreak: null,
    labelKey: "guesses",
    partitions: [],
    partitionDefaults: {},
    maxValue: null,
    partitionMaxValues: {},
    qualifyingOutcomes: ["win"],
    enabled: false,
  },
};
