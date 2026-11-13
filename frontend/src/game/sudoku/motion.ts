/**
 * Sudoku motion (#3774, "Calm"): how long each animation and pause takes, in one module, so the
 * sounds (#3775) can be timed to the same numbers. Each stays under its story ceiling (checked in
 * `__tests__/motion.test.ts`). Everything is a single run: no loops, no timer left running.
 *
 *   A digit or a hint lands (t = 0, the render of the move):
 *     t = 0                       its digit fades in and scales 0.9 to 1, over PLACE_MS
 *   An illegal digit (same render):
 *     t = 0                       the cell pulses red once, ERROR_PULSE_MS
 *     t = CLASH_BLINK_DELAY_MS    the clashing cells' red ring blinks once
 *   A unit completed (same render), along the real row / column / box:
 *     t = UNIT_SWEEP_START_MS     a soft teal glow starts at the first cell and travels to the last
 *     t = UNIT_SWEEP_TOTAL_MS     it is over
 *   The puzzle solved, from the solving entry (a wave replaces the unit sweeps):
 *     t = 0                       a teal brighten wave runs along the diagonals, WAVE_TOTAL_MS
 *     t = SOLVED_BEAT_MS          the result card (and what #3775 plays with it)
 *
 * Under Reduce Motion nothing animates: digits appear at once, an error shows only its static
 * style, there is no sweep or wave, and the card shows the moment the puzzle is solved
 * (docs/ACCESSIBILITY.md section 3). A key's pressed state is press feedback, not motion: it stays.
 */
import type { GameEvent, SudokuState, Variant } from "./types";
import { variantConfig } from "./types";

// ---------------------------------------------------------------------------
// Place
// ---------------------------------------------------------------------------

/** A digit (or a hint) landing: fade in and scale `PLACE_FROM_SCALE` to 1. */
export const PLACE_MS = 150;
export const PLACE_FROM_SCALE = 0.9;

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/** The cell of an illegal digit pulses red once: up to `ERROR_PULSE_PEAK` and back. */
export const ERROR_PULSE_MS = 380;
export const ERROR_PULSE_PEAK = 0.55;
/** The clashing cells' ring: on for this long, then off for `CLASH_BLINK_OFF_MS`, then on again. */
export const CLASH_BLINK_DELAY_MS = 100;
export const CLASH_BLINK_OFF_MS = 120;
/** How far the ring dims (its opacity) in the blink. */
export const CLASH_BLINK_DIM = 0.15;
/** The ring fades out and in over this long at each end of the blink. */
export const CLASH_BLINK_EDGE_MS = 20;

/**
 * From the move to the end of the blink.
 * @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126).
 */
export const CLASH_BLINK_TOTAL_MS =
  CLASH_BLINK_DELAY_MS + CLASH_BLINK_OFF_MS + 2 * CLASH_BLINK_EDGE_MS;

// ---------------------------------------------------------------------------
// Unit complete
// ---------------------------------------------------------------------------

/** The glow starts this long after the move. */
export const UNIT_SWEEP_START_MS = 50;
/** From the first cell starting to glow to the last one finishing, whatever the unit's length. */
export const UNIT_SWEEP_MS = 450;
/** One cell's glow: up to `UNIT_PEAK` and back. */
export const UNIT_CELL_MS = 200;
export const UNIT_PEAK = 0.34;
/**
 * From the move to the sweep being over (a short settle after the last cell).
 * @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126).
 */
export const UNIT_SWEEP_TOTAL_MS = 550;

/** When cell `index` of a unit of `count` cells starts to glow, from the move. */
export function unitSweepDelayMs(index: number, count: number): number {
  if (count <= 1) return UNIT_SWEEP_START_MS;
  return UNIT_SWEEP_START_MS + (index * (UNIT_SWEEP_MS - UNIT_CELL_MS)) / (count - 1);
}

// ---------------------------------------------------------------------------
// Solved
// ---------------------------------------------------------------------------

/** One cell's brighten: up to `WAVE_PEAK` and back. */
export const WAVE_CELL_MS = 300;
export const WAVE_PEAK = 0.3;
/** The wave reaches the far corner this long after it starts at the near one. */
export const WAVE_STAGGER_MS = 600;
/**
 * From the solving move to the wave being over.
 * @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126).
 */
export const WAVE_TOTAL_MS = WAVE_STAGGER_MS + WAVE_CELL_MS;
/** The result card shows this long after the solving move (owner: about 1 s, as Yacht and 2048). */
export const SOLVED_BEAT_MS = 1000;

/** When the wave reaches cell (`row`, `col`) of a `size` x `size` board, from the solving move. */
export function waveDelayMs(row: number, col: number, size: number): number {
  return ((row + col) / (2 * (size - 1))) * WAVE_STAGGER_MS;
}

// ---------------------------------------------------------------------------
// Which cells
// ---------------------------------------------------------------------------

export type UnitKind = "row" | "col" | "box";

/**
 * The cells of a completed unit as `row * size + col`, in sweep order: a row left to right, a
 * column top to bottom, a box in reading order. A box's `index` is the engine's: the index of its
 * top-left cell (`row * size + col`), so Mini's 2 x 3 boxes work too.
 */
export function unitCells(unit: UnitKind, index: number, variant: Variant): number[] {
  const { size, boxRows, boxCols } = variantConfig(variant);
  const out: number[] = [];
  if (unit === "row") {
    for (let c = 0; c < size; c++) out.push(index * size + c);
  } else if (unit === "col") {
    for (let r = 0; r < size; r++) out.push(r * size + index);
  } else {
    const top = Math.floor(index / size);
    const left = index % size;
    for (let r = top; r < top + boxRows; r++) {
      for (let c = left; c < left + boxCols; c++) out.push(r * size + c);
    }
  }
  return out;
}

/** What one move's events ask the board to show. */
export interface SudokuMotion {
  /** New for each move, so a cell can tell a new effect from the one it already played. */
  readonly id: number;
  /** The cell the digit landed in (`row * size + col`), when one is selected. */
  readonly placed: number | null;
  /** The digit was an illegal one. */
  readonly error: boolean;
  /** The units that were completed (none on the solving move: the wave stands in for them). */
  readonly units: readonly { readonly unit: UnitKind; readonly index: number }[];
}

let nextMotionId = 0;

/**
 * A move's events as motion, or null when the move placed nothing. Pure of the screen: the
 * engine's events and the selection of the state they came with (a digit and a hint both land in
 * the selected cell). The sweep is keyed off the event's `unit` / `index`, whenever the engine
 * emits it.
 */
export function deriveMotion(
  state: Pick<SudokuState, "events" | "selectedRow" | "selectedCol" | "variant">
): SudokuMotion | null {
  const events: readonly GameEvent[] | undefined = state.events;
  if (!events || !events.some((e) => e.type === "digitPlace")) return null;
  const { size } = variantConfig(state.variant);
  const solved = events.some((e) => e.type === "puzzleComplete");
  const units: { unit: UnitKind; index: number }[] = [];
  if (!solved) {
    for (const e of events)
      if (e.type === "unitComplete") units.push({ unit: e.unit, index: e.index });
  }
  return {
    id: ++nextMotionId,
    placed:
      state.selectedRow !== null && state.selectedCol !== null
        ? state.selectedRow * size + state.selectedCol
        : null,
    error: events.some((e) => e.type === "errorEntered"),
    units,
  };
}
