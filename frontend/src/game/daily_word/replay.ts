/**
 * Daily Word replay recording (#3287, epic #3273; owner decision #3368).
 *
 * One `guess_submitted` event per game, carrying every scored guess, recorded
 * through the shared GameRecorder when the game ends: on a win or a loss, and
 * on an abandon (leaving, or a puzzle replaced) when at least one guess was
 * scored. It is built from the board (`DailyWordState`) at that moment, so a
 * puzzle resumed after a kill still logs all its rows. `record()` only pushes
 * to memory; the recorder (policy `on_session_end`) saves the game in the
 * single call that completes the session, ahead of `game_ended`. Nothing is
 * serialised or stored in a key handler.
 *
 * Approach: record at the end only. A recorder cannot replace an event it has
 * already handed to the queue, so saving a partial game on every background
 * would write several rows for one game. A puzzle killed mid-play and never
 * finished loses its log (the owner accepted this); the game row is still
 * swept as abandoned. `DailyWordProgress` (backend/daily_word/progress.py) stays
 * the rule enforcement; this is the log.
 *
 * The event's `data` (the recorder adds `v`, `unit` = 1 and `t_ms`), compact
 * keys, ASCII for en / fr / es (Hindi keeps its letters):
 *
 *     g     the scored guesses in order, as POSTed: folded lower-case letters
 *     t     each guess's result, one character per tile: c correct, p present,
 *           a absent
 *     d     each guess as the board shows it, with accents (fr / es), aligned
 *           with `g`; left out when none differs from `g`
 *     rj    refusals (not a word, already guessed) in the game, left out when 0
 *
 * A refused guess spends no row and gets no event; it is only counted.
 * The board rebuilds from the event alone (`rebuild`): an empty board plus the
 * scored guesses in order, accents included. The answer is not recorded: it is
 * the puzzle's, public once the game is over, and the results already say
 * everything the board needs.
 *
 * Cost → performance → data: one event of about 100-250 B per game, about 350 B
 * stored with the server's row overhead (docs/games/daily_word.md, "Replay
 * recording"). The game session (and so the games row) starts on the first
 * accepted guess, as before.
 */

import { captureThrottledMessage } from "../_shared/sentryThrottle";
import { applyServerResult, initialState, markComplete } from "./engine";
import type { DailyWordState, TileState, TileStatus } from "./types";

/** The event type (seeded since migration 0017, so no migration). */
export const GUESS_SUBMITTED = "guess_submitted";

/** The most refusals one event counts (a player hammering Enter); more are not counted. */
export const MAX_REFUSAL_COUNT = 99;

/** The game's one event `data`, before the recorder's envelope. */
export interface GameData {
  g: string[];
  t: string[];
  d?: string[];
  rj?: number;
}

/** The recorder calls the event needs (what `useGameRecorder` returns). */
export interface GuessSink {
  beginUnit: (n?: number) => number;
  record: (type: typeof GUESS_SUBMITTED, data?: Record<string, unknown>) => void;
  closeUnit: () => void;
}

/** What the guess hook and the screen need to record. */
export interface GuessReplay {
  /** A refused guess (not a word, already guessed): counted into the game's event. */
  refused(puzzleId: string): void;
  /**
   * The game ended (won, lost or abandoned): record its event from the board.
   * Does nothing for a board with no scored guess, or one already recorded.
   */
  finish(state: DailyWordState): void;
}

const CODE: Record<string, string> = { correct: "c", present: "p", absent: "a" };
const STATUS: Record<string, TileStatus> = { c: "correct", p: "present", a: "absent" };

/** The result string of a scored row: `capaa`. */
export function resultCodes(tiles: readonly Pick<TileState, "status">[]): string {
  let out = "";
  for (const tile of tiles) out += CODE[tile.status] ?? "a";
  return out;
}

/** The game's `data` from its board: `d` and `rj` are left out when there is nothing to say. */
export function gameData(state: DailyWordState, refusals = 0): GameData | null {
  const g: string[] = [];
  const t: string[] = [];
  const shown: string[] = [];
  let accented = false;
  for (const row of state.rows) {
    if (!row.submitted) continue;
    let letters = "";
    let display = "";
    for (const tile of row.tiles) {
      letters += tile.letter;
      display += tile.display !== undefined && tile.display !== "" ? tile.display : tile.letter;
    }
    if (display !== letters) accented = true;
    g.push(letters);
    t.push(resultCodes(row.tiles));
    shown.push(display);
  }
  if (g.length === 0) return null;
  const data: GameData = { g, t };
  if (accented) data.d = shown;
  if (refusals > 0) data.rj = refusals;
  return data;
}

/** Recording never gets in the way of play: a recorder that throws is caught, reported once (throttled, no values), and play carries on. */
function safely(sink: GuessSink, data: GameData): void {
  try {
    sink.beginUnit(1);
    sink.record(GUESS_SUBMITTED, data as unknown as Record<string, unknown>);
    sink.closeUnit();
  } catch {
    captureThrottledMessage("dailyWord.replay.record", "daily word: recording a game failed", {
      level: "warning",
      tags: { subsystem: "gameRecorder", game_type: "daily_word" },
    });
  }
}

/**
 * The replay recorder a screen hands the guess hook. The refusal count lives
 * here, in memory, keyed by puzzle: a refusal on one puzzle never lands on
 * another's event, whatever the recorder's session is doing. A game is
 * recorded once (by puzzle and rows scored); the count restarts with it.
 */
export function createGuessReplay(sink: GuessSink): GuessReplay {
  let puzzle = "";
  let refusals = 0;
  let recorded = "";
  const forPuzzle = (puzzleId: string) => {
    if (puzzleId !== puzzle) {
      puzzle = puzzleId;
      refusals = 0;
    }
  };
  return {
    refused(puzzleId) {
      forPuzzle(puzzleId);
      if (refusals < MAX_REFUSAL_COUNT) refusals += 1;
    },
    finish(state) {
      forPuzzle(state.puzzle_id);
      const data = gameData(state, refusals);
      if (!data) return;
      const key = `${state.puzzle_id}:${data.g.length}`;
      if (key === recorded) return;
      recorded = key;
      refusals = 0;
      safely(sink, data);
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
  /** The refusals the event counts. */
  readonly refusals: number;
  /** Where the event does not fit the board (a bad result, a missing event); empty when it does. */
  readonly problems: readonly string[];
}

/**
 * The board a game's `guess_submitted` event describes, played from an empty one.
 * @internal Exported for tests only (the golden replay); no production caller (knip --production, #3126).
 */
export function rebuild(
  events: readonly RecordedEvent[],
  puzzle: { puzzle_id: string; word_length: number; language: string }
): RebuiltBoard {
  let state = initialState(puzzle.puzzle_id, puzzle.word_length, puzzle.language);
  const problems: string[] = [];
  const found = events.filter((e) => e.type === GUESS_SUBMITTED);
  if (found.length === 0) problems.push("no guess_submitted event");
  if (found.length > 1) problems.push(`${found.length} guess_submitted events for one game`);
  const { g, t, d, rj } = (found[found.length - 1]?.data ?? {}) as Partial<GameData>;
  if (found.length > 0 && (!Array.isArray(g) || !Array.isArray(t) || g.length !== t.length)) {
    problems.push("guesses and results do not line up");
    return { state, refusals: 0, problems };
  }
  (g ?? []).forEach((guess, i) => {
    const result = (t as string[])[i] as string;
    const letters = Array.from(guess);
    if (letters.length !== result.length) {
      problems.push(`row ${i + 1}: result does not match the guess`);
      return;
    }
    const shown = Array.from(d?.[i] ?? "");
    const aligned = shown.length === letters.length;
    const tiles: TileState[] = letters.map((letter, k) => {
      const tile: TileState = { letter, status: STATUS[result[k] as string] ?? "absent" };
      const accent = aligned ? shown[k] : undefined;
      if (accent && accent !== letter) tile.display = accent;
      return tile;
    });
    state = applyServerResult(state, tiles);
    const won = tiles.every((tile) => tile.status === "correct");
    if (won || state.current_row >= 6) state = markComplete(state, won);
  });
  return { state, refusals: typeof rj === "number" ? rj : 0, problems };
}
