/**
 * Sort Puzzle engine (#1175).
 *
 * Pure TypeScript. No React, AsyncStorage, HTTP, timers, or other
 * side-effect imports. The UI replaces the entire SortState object on
 * each transition — state is immutable.
 *
 * Pour mechanics mirror the backend BFS in backend/sort/generate_levels.py:
 * a pour moves the maximal same-color run from the top of the source
 * bottle, up to the available space in the destination.
 */

import type { Bottle, Color, SortState } from "./types";
import { BOTTLE_DEPTH } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function topColor(bottle: Bottle): Color | null {
  return bottle.length > 0 ? bottle[bottle.length - 1] : null;
}

/** Length of the matching-color run at the top of a bottle. */
function topRun(bottle: Bottle): number {
  if (bottle.length === 0) return 0;
  const color = bottle[bottle.length - 1];
  let n = 0;
  for (let i = bottle.length - 1; i >= 0; i--) {
    if (bottle[i] === color) n++;
    else break;
  }
  return n;
}

/** Number of units actually poured when moving from `from` to `to`. Assumes the move is valid. */
export function pourUnits(from: Bottle, to: Bottle): number {
  return Math.min(topRun(from), BOTTLE_DEPTH - to.length);
}

export function isBottleSolved(bottle: Bottle): boolean {
  return bottle.length === 0 || (bottle.length === BOTTLE_DEPTH && new Set(bottle).size === 1);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true if at least one unit can be poured from `from` into `to`.
 * Does NOT check bottle indices — caller supplies the bottles directly.
 */
export function isValidPour(from: Bottle, to: Bottle): boolean {
  if (from.length === 0) return false;
  if (to.length >= BOTTLE_DEPTH) return false;
  const top = topColor(to);
  return top === null || top === topColor(from);
}

/**
 * Returns a new state with the pour applied. Assumes the move is valid —
 * call `isValidPour` first. Pours as many units of the top run as fit.
 */
export function applyPour(state: SortState, fromIdx: number, toIdx: number): SortState {
  const src = [...state.bottles[fromIdx]] as Color[];
  const dst = [...state.bottles[toIdx]] as Color[];
  const run = topRun(src);
  const space = BOTTLE_DEPTH - dst.length;
  const n = Math.min(run, space);
  for (let i = 0; i < n; i++) {
    dst.push(src.pop()!);
  }
  const bottles = state.bottles.map((b, i) => {
    if (i === fromIdx) return src as readonly Color[];
    if (i === toIdx) return dst as readonly Color[];
    return b;
  });
  const complete = isComplete({ ...state, bottles });
  return {
    ...state,
    bottles,
    moveCount: state.moveCount + 1,
    isComplete: complete,
    selectedBottleIndex: null,
  };
}

/** True when every bottle is either empty or full with a single color. */
export function isComplete(state: SortState): boolean {
  return state.bottles.every(isBottleSolved);
}

/**
 * Pops the last state from `history` and returns it as the active state.
 * Increments `undosUsed`. Returns unchanged inputs if history is empty.
 */
export function undo(
  state: SortState,
  history: readonly SortState[]
): { state: SortState; history: readonly SortState[] } {
  if (history.length === 0) return { state, history };
  const prev = history[history.length - 1];
  return {
    state: { ...prev, undosUsed: state.undosUsed + 1, selectedBottleIndex: null },
    history: history.slice(0, -1),
  };
}

/**
 * Converts the API-format level bottles (padded with "" for empty slots)
 * into a SortState ready for play.
 */
export function initState(levelBottles: (Color | "")[][]): SortState {
  const bottles: Bottle[] = levelBottles.map(
    (b) => b.filter((s): s is Color => s !== "") as Bottle
  );
  return {
    bottles,
    moveCount: 0,
    undosUsed: 0,
    isComplete: false,
    selectedBottleIndex: null,
  };
}
