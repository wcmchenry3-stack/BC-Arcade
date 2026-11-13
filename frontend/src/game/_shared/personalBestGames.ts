/**
 * What "best" means for each game that keeps one (#3757), and where its best lived before.
 *
 * Owner decision (#3798, Q2): each game keeps the metric it already had; a "new best" moment only
 * where a best already existed. Adding a game here is all `personalBest.ts` needs.
 *
 * `legacy` reads the game's save from before #3757 (raw AsyncStorage strings, by key) into bests
 * by variant, exactly as the game's own loader read it then. It may throw on a corrupt save: that
 * reads as no best. `personalBest.ts` merges it in on the first read and then removes the key.
 */
import { MAHJONG_MIN_CLEAR_MS } from "../mahjong/engine";

export type PersonalBestGame =
  "cascade" | "freecell" | "mahjong" | "solitaire" | "starswarm" | "sudoku" | "twenty48" | "yacht";

type RawStore = Readonly<Record<string, string | null>>;

export interface LegacySave {
  /** The game's keys before #3757. */
  readonly keys: readonly string[];
  /** Bests by variant from those keys' raw values (a key absent from storage is null). */
  read(stored: RawStore): Record<string, number>;
}

export interface PersonalBestSpec {
  /** Fewer moves or a faster time wins, rather than a higher score. */
  readonly lowerIsBetter: boolean;
  /**
   * `value` can be a best at all. Anything else is never stored or a new best (a 0 score, a time
   * from a broken clock).
   */
  isPlausible(value: number): boolean;
  readonly legacy?: LegacySave;
}

const positive = (value: number): boolean => value > 0;

/** The most a Yacht game can score (every row at its best, twelve Yacht bonuses). */
export const MAX_YACHT_SCORE = 1575;

/** Sudoku's best is per mode and difficulty: `"classic.easy"`, `"mini.hard"`. */
export function sudokuVariant(mode: string, difficulty: string): string {
  return `${mode}.${difficulty}`;
}

const SUDOKU_MODES = ["classic", "mini"] as const;
const SUDOKU_DIFFICULTIES = ["easy", "medium", "hard"] as const;

/** A number stored as a string (the older single-score keys). */
function storedNumber(raw: string | null): number {
  return raw === null ? 0 : Number(raw);
}

/** A key holding one number: variant `"_"`. */
function singleNumber(key: string, normalise: (n: number) => number = (n) => n): LegacySave {
  return {
    keys: [key],
    read: (stored) => ({ _: normalise(storedNumber(stored[key] ?? null)) }),
  };
}

function parsedObject(raw: string | null): Record<string, unknown> {
  const parsed: unknown = raw === null ? null : JSON.parse(raw);
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

/** A JSON stats record whose one field `field` is the best: variant `"_"`. */
function statsField(key: string, field: string): LegacySave {
  return {
    keys: [key],
    read: (stored): Record<string, number> => {
      const value = parsedObject(stored[key] ?? null)[field];
      return typeof value === "number" ? { _: value } : {};
    },
  };
}

export const PERSONAL_BEST_GAMES: Readonly<Record<PersonalBestGame, PersonalBestSpec>> = {
  // Highest score (#2515): `cascade_best_score`, a whole number as a string.
  cascade: {
    lowerIsBetter: false,
    isPlausible: positive,
    legacy: singleNumber("cascade_best_score", Math.floor),
  },
  // Fewest moves in a win: `freecell_stats_v1`, `{"bestMoves":n}`.
  freecell: {
    lowerIsBetter: true,
    isPlausible: positive,
    legacy: statsField("freecell_stats_v1", "bestMoves"),
  },
  // Fastest clear per layout (#2747), never under the ranking floor: `mahjong_stats_v1`,
  // `{"bestTimeMsByLayout":{"<layout>":ms}}` (its older cross-layout `bestTimeMs` is ignored, as
  // it was before).
  mahjong: {
    lowerIsBetter: true,
    isPlausible: (ms) => ms >= MAHJONG_MIN_CLEAR_MS,
    legacy: {
      keys: ["mahjong_stats_v1"],
      read: (stored) => {
        const byLayout = parsedObject(stored.mahjong_stats_v1 ?? null).bestTimeMsByLayout;
        const out: Record<string, number> = {};
        if (byLayout === null || typeof byLayout !== "object" || Array.isArray(byLayout)) {
          return out;
        }
        for (const [layout, ms] of Object.entries(byLayout as Record<string, unknown>)) {
          if (typeof ms === "number") out[layout] = ms;
        }
        return out;
      },
    },
  },
  // Fastest win: `solitaire_stats_v1`, `{"bestTimeMs":n}`.
  solitaire: {
    lowerIsBetter: true,
    isPlausible: positive,
    legacy: statsField("solitaire_stats_v1", "bestTimeMs"),
  },
  // Highest score (#2516): `starswarm.bestScore`, a whole number as a string.
  starswarm: {
    lowerIsBetter: false,
    isPlausible: positive,
    legacy: singleNumber("starswarm.bestScore", Math.floor),
  },
  // Fastest solve per mode and difficulty: `sudoku_stats_v1`,
  // `{"classic":{"easy":{"bestTimeS":s},…},"mini":{…}}`, or before #748 the classic difficulties
  // flat at the top level.
  sudoku: {
    lowerIsBetter: true,
    isPlausible: positive,
    legacy: {
      keys: ["sudoku_stats_v1"],
      read: (stored) => {
        const parsed = parsedObject(stored.sudoku_stats_v1 ?? null);
        const nested = "classic" in parsed || "mini" in parsed;
        const out: Record<string, number> = {};
        for (const mode of SUDOKU_MODES) {
          const byDifficulty = nested ? parsed[mode] : mode === "classic" ? parsed : null;
          if (byDifficulty === null || typeof byDifficulty !== "object") continue;
          for (const difficulty of SUDOKU_DIFFICULTIES) {
            const entry = (byDifficulty as Record<string, unknown>)[difficulty];
            if (entry === null || typeof entry !== "object") continue;
            const seconds = (entry as Record<string, unknown>).bestTimeS;
            if (typeof seconds === "number") out[sudokuVariant(mode, difficulty)] = seconds;
          }
        }
        return out;
      },
    },
  },
  // Highest score: `twenty48_best_score_v1`, a number as a string.
  twenty48: {
    lowerIsBetter: false,
    isPlausible: positive,
    legacy: singleNumber("twenty48_best_score_v1"),
  },
  // Highest solo score (#3749): `yacht_best_score_v1`, a number as a string. Anything above the
  // most a game can score is corrupt.
  yacht: {
    lowerIsBetter: false,
    isPlausible: (score) => score > 0 && score <= MAX_YACHT_SCORE,
    legacy: singleNumber("yacht_best_score_v1"),
  },
};
