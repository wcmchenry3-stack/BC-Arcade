/**
 * Daily Word replay recording (#3287, epic #3273).
 *
 * Every guess attempt is one `guess_submitted` event through the shared
 * GameRecorder: one recorder unit (the row being filled), one event, one
 * storage write. `record()` only pushes to memory; the recorder measures and
 * saves the unit at an idle moment, after the flip animation has started, never
 * in a key handler. `DailyWordProgress` (backend/daily_word/progress.py) stays
 * the rule enforcement; this is the log.
 *
 * The event's `data` (the recorder adds `v`, `unit` and `t_ms`), compact keys,
 * ASCII for en / fr / es (Hindi keeps its letters):
 *
 *     n     the row the guess was made on, 1..6 (also the recorder unit)
 *     g     the guess as typed and POSTed: the tiles' folded letters, lower-case
 *     t     an accepted guess's result, one character per tile:
 *           c correct, p present, a absent
 *     rej   instead of `t`, a refused guess (no row spent): nw not a word,
 *           dup already guessed on this board
 *
 * The board rebuilds from the events alone: an empty board plus the accepted
 * guesses in order (`rebuild`) is the board the player saw. The answer is not
 * recorded: it is the puzzle's, public once the game is over, and the results
 * already say everything the board needs.
 *
 * Cost → performance → data: a game is at most 6 accepted guesses plus
 * `MAX_RECORDED_REJECTIONS` refusals, each about 60-90 B (docs/games/daily_word.md,
 * "Replay recording"). A guess that is refused before the game's first accepted
 * one waits in the recorder's memory and is saved when that guess opens the
 * session: the session (and so the game row) starts on the first accepted
 * guess, as before.
 */

import { applyServerResult, initialState, markComplete } from "./engine";
import type { DailyWordState, TileState, TileStatus } from "./types";

/** The event type (seeded since migration 0017, so no migration). */
export const GUESS_SUBMITTED = "guess_submitted";

/** Refusals recorded per puzzle; later ones are not (a player hammering Enter). */
export const MAX_RECORDED_REJECTIONS = 10;

/** Why a guess was refused: not in the word list, or already on the board. */
export type Rejection = "nw" | "dup";

/** One attempt's `data`, before the recorder's envelope. */
export interface GuessData {
  n: number;
  g: string;
  t?: string;
  rej?: Rejection;
}

/** The recorder calls an attempt needs (what `useGameRecorder` returns). */
export interface GuessSink {
  beginUnit: (n?: number) => number;
  record: (type: typeof GUESS_SUBMITTED, data?: Record<string, unknown>) => void;
  closeUnit: () => void;
}

/** What the guess hook needs to record: the two kinds of attempt. */
export interface GuessReplay {
  /** A scored guess: `tiles` as the board stores them, spent on `row` (1-based). */
  accepted(row: number, tiles: readonly Pick<TileState, "letter" | "status">[]): void;
  /** A refused guess on `row` (1-based). */
  rejected(puzzleId: string, row: number, guess: string, why: Rejection): void;
}

const CODE: Record<string, string> = { correct: "c", present: "p", absent: "a" };
const STATUS: Record<string, TileStatus> = { c: "correct", p: "present", a: "absent" };

/** The result string of a scored row: `capaa`. */
export function resultCodes(tiles: readonly Pick<TileState, "status">[]): string {
  let out = "";
  for (const tile of tiles) out += CODE[tile.status] ?? "a";
  return out;
}

function wordOf(tiles: readonly Pick<TileState, "letter">[]): string {
  let out = "";
  for (const tile of tiles) out += tile.letter;
  return out;
}

/** An accepted guess's `data`. */
export function acceptedData(
  row: number,
  tiles: readonly Pick<TileState, "letter" | "status">[]
): GuessData {
  return { n: row, g: wordOf(tiles), t: resultCodes(tiles) };
}

/** A refused guess's `data`. */
export function rejectedData(row: number, guess: string, why: Rejection): GuessData {
  return { n: row, g: guess, rej: why };
}

/** One attempt: a unit numbered by the row (derived from the board, so a resumed game continues it), one event. */
export function emitGuess(sink: GuessSink, data: GuessData): void {
  sink.beginUnit(data.n);
  sink.record(GUESS_SUBMITTED, data as unknown as Record<string, unknown>);
  sink.closeUnit();
}

/**
 * The replay recorder a screen hands the guess hook. Refusals are limited to
 * `MAX_RECORDED_REJECTIONS` per puzzle, counted in memory (a new puzzle, or a
 * new instance, starts again at zero).
 */
export function createGuessReplay(sink: GuessSink): GuessReplay {
  let puzzle = "";
  let refused = 0;
  return {
    accepted(row, tiles) {
      emitGuess(sink, acceptedData(row, tiles));
    },
    rejected(puzzleId, row, guess, why) {
      if (puzzleId !== puzzle) {
        puzzle = puzzleId;
        refused = 0;
      }
      if (refused >= MAX_RECORDED_REJECTIONS) return;
      refused += 1;
      emitGuess(sink, rejectedData(row, guess, why));
    },
  };
}

// ---------------------------------------------------------------------------
// Rebuild (the golden replay, and the model for backend/daily_word/replay.py)
// ---------------------------------------------------------------------------

/** A recorded event as the rebuild reads it. */
export interface RecordedEvent {
  readonly type: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface RebuiltBoard {
  readonly state: DailyWordState;
  /** The refused guesses, in order. */
  readonly refused: readonly { n: number; g: string; rej: string }[];
  /** Where the events do not fit the board (a gap, a repeated row, a bad result); empty when they do. */
  readonly problems: readonly string[];
}

/**
 * The board a game's `guess_submitted` events describe, played from an empty one.
 * @internal Exported for tests only (the golden replay); no production caller (knip --production, #3126).
 */
export function rebuild(
  events: readonly RecordedEvent[],
  puzzle: { puzzle_id: string; word_length: number; language: string }
): RebuiltBoard {
  let state = initialState(puzzle.puzzle_id, puzzle.word_length, puzzle.language);
  const refused: { n: number; g: string; rej: string }[] = [];
  const problems: string[] = [];
  for (const event of events) {
    if (event.type !== GUESS_SUBMITTED) continue;
    const { n, g, t, rej } = event.data as Partial<GuessData>;
    if (typeof n !== "number" || typeof g !== "string") {
      problems.push("a guess without a row or a word");
      continue;
    }
    if (typeof rej === "string") {
      refused.push({ n, g, rej });
      continue;
    }
    const letters = Array.from(g);
    if (typeof t !== "string" || letters.length !== t.length) {
      problems.push(`row ${n}: result does not match the guess`);
      continue;
    }
    if (n !== state.current_row + 1) {
      problems.push(`row ${n} recorded after ${state.current_row} rows`);
      continue;
    }
    const tiles: TileState[] = letters.map((letter, i) => ({
      letter,
      status: STATUS[t[i] as string] ?? "absent",
    }));
    state = applyServerResult(state, tiles);
    const won = tiles.every((tile) => tile.status === "correct");
    if (won || state.current_row >= 6) state = markComplete(state, won);
  }
  return { state, refused, problems };
}
