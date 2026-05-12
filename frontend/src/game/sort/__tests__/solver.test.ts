/**
 * Sort Puzzle solver unit tests (#1176).
 */

import { applyPour, isValidPour } from "../engine";
import { getNextHint, solve } from "../solver";
import type { Color, SortState } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkState(bottles: string[][]): SortState {
  return {
    bottles: bottles as Color[][],
    moveCount: 0,
    undosUsed: 0,
    isComplete: false,
    selectedBottleIndex: null,
  };
}

// ---------------------------------------------------------------------------
// solve
// ---------------------------------------------------------------------------

describe("solve", () => {
  it("returns [] for an already-complete state", () => {
    const state = mkState([["red", "red", "red", "red"], ["blue", "blue", "blue", "blue"], []]);
    expect(solve({ ...state, isComplete: true })).toEqual([]);
  });

  it("returns a single-move solution", () => {
    // bottle[1] needs one more red from bottle[2]; blues already complete
    const state = mkState([["blue", "blue", "blue", "blue"], ["red", "red", "red"], ["red"], []]);
    const path = solve(state);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(1);
    let s = state;
    for (const move of path!) {
      s = applyPour(s, move.from, move.to);
    }
    expect(s.isComplete).toBe(true);
  });

  it("solves a 2-color, 1-empty puzzle", () => {
    const state = mkState([["red", "blue", "red", "blue"], ["blue", "red", "blue", "red"], []]);
    const path = solve(state);
    expect(path).not.toBeNull();
    let s = state;
    for (const move of path!) {
      s = applyPour(s, move.from, move.to);
    }
    expect(s.isComplete).toBe(true);
  });

  it("returns null for a dead-end (unsolvable) state", () => {
    // Two bottles each 2 units of the same color but no empty bottle and
    // no matching tops — actually let's make a truly locked state.
    // All bottles full, no matching tops, no empty bottle.
    const state = mkState([
      ["red", "blue", "red", "blue"],
      ["blue", "red", "blue", "red"],
    ]);
    // No empty bottle — every pour requires matching top, but tops alternate
    // and there's no space. This is unsolvable.
    expect(solve(state)).toBeNull();
  });

  it("path moves are valid (from/to are indices into bottles)", () => {
    const state = mkState([["blue", "blue", "blue", "blue"], ["red", "red", "red"], ["red"], []]);
    const path = solve(state);
    expect(path).not.toBeNull();
    for (const move of path!) {
      expect(move.from).toBeGreaterThanOrEqual(0);
      expect(move.to).toBeGreaterThanOrEqual(0);
      expect(move.from).toBeLessThan(state.bottles.length);
      expect(move.to).toBeLessThan(state.bottles.length);
      expect(move.from).not.toBe(move.to);
    }
  });
});

// ---------------------------------------------------------------------------
// getNextHint
// ---------------------------------------------------------------------------

describe("getNextHint", () => {
  it("returns null for a complete state", () => {
    const state = mkState([
      ["red", "red", "red", "red"],
      ["blue", "blue", "blue", "blue"],
    ]);
    expect(getNextHint({ ...state, isComplete: true })).toBeNull();
  });

  it("returns null for an unsolvable state", () => {
    const state = mkState([
      ["red", "blue", "red", "blue"],
      ["blue", "red", "blue", "red"],
    ]);
    expect(getNextHint(state)).toBeNull();
  });

  it("returns the first move of the optimal path", () => {
    const state = mkState([["blue", "blue", "blue", "blue"], ["red", "red", "red"], ["red"], []]);
    const hint = getNextHint(state);
    expect(hint).not.toBeNull();
    expect(hint).toHaveProperty("from");
    expect(hint).toHaveProperty("to");
  });

  it("hint move is valid for the current state", () => {
    const state = mkState([["blue", "blue", "blue", "blue"], ["red", "red", "red"], ["red"], []]);
    const hint = getNextHint(state);
    expect(hint).not.toBeNull();
    expect(isValidPour(state.bottles[hint!.from]!, state.bottles[hint!.to]!)).toBe(true);
  });
});
