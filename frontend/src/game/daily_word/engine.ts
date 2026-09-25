/**
 * Client-side Daily Word engine — pure functions, no React, no I/O.
 *
 * State transitions:
 *   initialState → setCurrentRowLetter / deleteLastLetter (while typing)
 *               → applyServerResult (after server scores the guess)
 *               → markComplete (when won or all 6 guesses exhausted)
 */

import type { DailyWordState, LetterStatus, RowState, TileState, TileStatus } from "./types";

const MAX_ROWS = 6;

function emptyRow(wordLength: number): RowState {
  return {
    tiles: Array.from({ length: wordLength }, () => ({
      letter: "",
      status: "empty" as TileStatus,
    })),
    submitted: false,
  };
}

export function initialState(
  puzzle_id: string,
  word_length: number,
  language: string
): DailyWordState {
  return {
    _v: 1,
    puzzle_id,
    word_length,
    language,
    rows: Array.from({ length: MAX_ROWS }, () => emptyRow(word_length)),
    current_row: 0,
    keyboard_state: {},
    is_complete: false,
    won: false,
    completed_at: null,
  };
}

// Keyboard "best-seen" rule: correct > present > absent > unused.
// Once correct, never downgrade.
const STATUS_RANK: Record<LetterStatus, number> = {
  unused: 0,
  absent: 1,
  present: 2,
  correct: 3,
};

function promoteLetter(
  current: LetterStatus | undefined,
  incoming: "correct" | "present" | "absent"
): LetterStatus {
  if (current === undefined) return incoming;
  return STATUS_RANK[incoming] > STATUS_RANK[current] ? incoming : current;
}

export function applyServerResult(state: DailyWordState, tiles: TileState[]): DailyWordState {
  if (state.is_complete || state.current_row >= MAX_ROWS) return state;

  const newRows = state.rows.map((row, i) =>
    i === state.current_row ? { tiles, submitted: true } : row
  );

  const newKeyboard = { ...state.keyboard_state };
  for (const tile of tiles) {
    if (!tile.letter || tile.status === "empty" || tile.status === "tbd") continue;
    const status = tile.status as "correct" | "present" | "absent";
    newKeyboard[tile.letter] = promoteLetter(
      newKeyboard[tile.letter] as LetterStatus | undefined,
      status
    );
  }

  return {
    ...state,
    rows: newRows,
    current_row: state.current_row + 1,
    keyboard_state: newKeyboard,
  };
}

export function setCurrentRowLetter(state: DailyWordState, letter: string): DailyWordState {
  if (state.is_complete || state.current_row >= MAX_ROWS) return state;

  const row = state.rows[state.current_row];
  if (!row) return state;

  // Each tile holds exactly one grapheme cluster (one visible character, even
  // in Hindi where a cluster may span multiple code points). Counting
  // non-empty tiles equals counting clusters — no Intl.Segmenter needed.
  const filledCount = row.tiles.filter((t) => t.letter !== "").length;
  if (filledCount >= state.word_length) return state;

  const newTiles = [...row.tiles];
  newTiles[filledCount] = { letter, status: "tbd" };

  const newRows = state.rows.map((r, i) =>
    i === state.current_row ? { ...r, tiles: newTiles } : r
  );

  return { ...state, rows: newRows };
}

export function deleteLastLetter(state: DailyWordState): DailyWordState {
  if (state.is_complete || state.current_row >= MAX_ROWS) return state;

  const row = state.rows[state.current_row];
  if (!row) return state;

  let lastFilled = -1;
  for (let i = row.tiles.length - 1; i >= 0; i--) {
    if (row.tiles[i]!.letter !== "") {
      lastFilled = i;
      break;
    }
  }
  if (lastFilled === -1) return state;

  const newTiles = [...row.tiles];
  newTiles[lastFilled] = { letter: "", status: "empty" };

  const newRows = state.rows.map((r, i) =>
    i === state.current_row ? { ...r, tiles: newTiles } : r
  );

  return { ...state, rows: newRows };
}

export function markComplete(state: DailyWordState, won: boolean): DailyWordState {
  return {
    ...state,
    is_complete: true,
    won,
    completed_at: new Date().toISOString(),
  };
}

/**
 * Guesses spent on this puzzle (#2541). The larger of the server's count and
 * the board's submitted rows: the server's is authoritative when the board has
 * fallen behind it, and the board's covers a stale or missing server count
 * (an older save, or guesses scored while the record was unreachable). A
 * legitimate server count is never below the board's, so this only ever
 * corrects upward.
 */
export function guessCount(state: DailyWordState): number {
  const boardCount = state.rows.filter((row) => row.submitted).length;
  return Math.max(parseGuessCount(state.guesses_used) ?? 0, boardCount);
}

/**
 * A server guess count, if `value` is a plausible one (#2541). The value is
 * untrusted: it comes from a response body — the 200 from `POST /guess`, or
 * the `403` refusal (`no_guesses_remaining` / `already_solved`) via
 * `ApiError.body` — or from saved state that `looksValid` does not check.
 * Returns `undefined` for anything else, including an older API that sends
 * no count.
 */
export function parseGuessCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_ROWS
    ? value
    : undefined;
}

/**
 * `state` with the server's guess count recorded, if `value` is a plausible
 * one (#2541); otherwise `state` unchanged, so a response without a count —
 * an older API, or a guess scored while the record was unreachable (#2542) —
 * keeps whatever count the state already had.
 */
export function withServerGuessCount(state: DailyWordState, value: unknown): DailyWordState {
  const count = parseGuessCount(value);
  return count === undefined ? state : { ...state, guesses_used: count };
}

/**
 * The result block sent on `PATCH /games/{id}/complete` (#2451). Must satisfy
 * the backend `DailyWordResult`; the daily challenge reads exactly these fields.
 * `guessCount` rather than `current_row`, so it is right at the win (where
 * `current_row` has already advanced), mid-puzzle for an abandon, and when the
 * board is behind the server (#2541) — this count drives the daily challenge's
 * "win within N guesses" goal.
 */
export function sessionResult(state: DailyWordState | null): {
  is_complete: boolean;
  won: boolean;
  guesses_used: number;
} {
  if (!state) return { is_complete: false, won: false, guesses_used: 0 };
  return {
    is_complete: state.is_complete,
    won: state.won,
    guesses_used: guessCount(state),
  };
}

const TILE_EMOJI: Record<"correct" | "present" | "absent", string> = {
  correct: "🟩",
  present: "🟨",
  absent: "⬜",
};

// Sequential puzzle counter from launch day (day 1 = 2026-05-03).
const EPOCH_MS = new Date("2026-05-03T00:00:00Z").getTime();

function puzzleNumber(puzzleId: string): number {
  const dateStr = puzzleId.split(":")[0] ?? "";
  const dateMs = new Date(`${dateStr}T00:00:00Z`).getTime();
  return Math.floor((dateMs - EPOCH_MS) / 86400000) + 1;
}

export function buildShareText(state: DailyWordState, deepLink: string): string {
  const n = puzzleNumber(state.puzzle_id);
  const submittedRows = state.rows.filter((r) => r.submitted);
  // The count comes from `guessCount`, not the grid: when the board is behind
  // the server the grid is missing rows, but the result must not be (#2541).
  const result = state.won ? `${guessCount(state)}/6` : "X/6";

  const grid = submittedRows
    .map((row) =>
      row.tiles
        .map((t) => TILE_EMOJI[t.status as "correct" | "present" | "absent"] ?? "⬜")
        .join("")
    )
    .join("\n");

  return `Daily Word #${n} — ${result}\n${grid}\n${deepLink}`;
}
