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
  "completed",
  "abandoned",
  "kept_playing",
] as const;

export type GameOutcome = (typeof GAME_OUTCOMES)[number];

/** Outcomes that say who won. Only a game with a winner (`HAS_WINNER`) records them. */
export const RESULT_OUTCOMES = ["win", "loss", "push"] as const satisfies readonly GameOutcome[];

/** Every other outcome: all a game with no winner ever records. */
export const LIFECYCLE_OUTCOMES = [
  "completed",
  "abandoned",
  "kept_playing",
] as const satisfies readonly GameOutcome[];

/** Whether each game can record a result outcome (its backend module's `has_winner`). */
export const HAS_WINNER: Readonly<Record<GameType, boolean>> = {
  yacht: true,
  twenty48: true,
  blackjack: true,
  cascade: false,
  solitaire: false,
  hearts: true,
  sudoku: false,
  mahjong: true,
  starswarm: false,
  freecell: false,
  sort: false,
  daily_word: true,
};

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
    partitionValues: {},
    maxValue: 1575,
    partitionMaxValues: {},
    qualifyingOutcomes: null,
    enabled: true,
  },
  twenty48: {
    metric: "final_score",
    direction: "desc",
    tiebreak: null,
    labelKey: "score",
    partitions: [],
    partitionDefaults: {},
    partitionValues: {},
    maxValue: null,
    partitionMaxValues: {},
    qualifyingOutcomes: null,
    enabled: true,
  },
  blackjack: {
    metric: "final_score",
    direction: "desc",
    tiebreak: null,
    labelKey: "chips",
    partitions: [],
    partitionDefaults: {},
    partitionValues: {},
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
    partitionValues: {},
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
    partitionValues: {},
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
    partitionValues: {},
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
    partitionValues: {},
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
    partitionValues: {},
    maxValue: 1220,
    partitionMaxValues: {},
    qualifyingOutcomes: null,
    enabled: true,
  },
  starswarm: {
    metric: "final_score",
    direction: "desc",
    tiebreak: null,
    labelKey: "score",
    partitions: ["difficulty_tier"],
    partitionDefaults: {
      difficulty_tier: "LieutenantJG",
    },
    partitionValues: {
      difficulty_tier: [
        "Ensign",
        "LieutenantJG",
        "Lieutenant",
        "LieutenantCommander",
        "Commander",
        "Captain",
        "RearAdmiral",
        "ViceAdmiral",
        "Admiral",
        "FleetAdmiral",
      ],
    },
    maxValue: null,
    partitionMaxValues: {},
    qualifyingOutcomes: null,
    enabled: true,
  },
  freecell: {
    metric: "final_score",
    direction: "asc",
    tiebreak: null,
    labelKey: "moves",
    partitions: [],
    partitionDefaults: {},
    partitionValues: {},
    maxValue: null,
    partitionMaxValues: {},
    qualifyingOutcomes: null,
    enabled: true,
  },
  sort: {
    metric: "level_reached",
    direction: "desc",
    tiebreak: null,
    labelKey: "level",
    partitions: [],
    partitionDefaults: {},
    partitionValues: {},
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
    partitionValues: {},
    maxValue: null,
    partitionMaxValues: {},
    qualifyingOutcomes: ["win"],
    enabled: false,
  },
};
