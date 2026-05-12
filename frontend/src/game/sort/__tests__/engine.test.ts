/**
 * Sort Puzzle engine unit tests (#1175).
 */

import { applyPour, initState, isBottleSolved, isComplete, isValidPour, undo } from "../engine";
import type { Color, SortState } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkState(bottles: (string | "")[][], overrides: Partial<SortState> = {}): SortState {
  return {
    bottles: bottles.map((b) => b.filter((s): s is Color => s !== "")),
    moveCount: 0,
    undosUsed: 0,
    isComplete: false,
    selectedBottleIndex: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isBottleSolved
// ---------------------------------------------------------------------------

describe("isBottleSolved", () => {
  it("returns true for an empty bottle", () => {
    expect(isBottleSolved([])).toBe(true);
  });

  it("returns true for a full single-color bottle", () => {
    expect(isBottleSolved(["red", "red", "red", "red"])).toBe(true);
  });

  it("returns false for a partial single-color bottle", () => {
    expect(isBottleSolved(["red", "red", "red"])).toBe(false);
  });

  it("returns false for a full mixed-color bottle", () => {
    expect(isBottleSolved(["red", "blue", "red", "blue"])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidPour
// ---------------------------------------------------------------------------

describe("isValidPour", () => {
  it("returns false when source is empty", () => {
    expect(isValidPour([], ["red", "red", "red", "red"])).toBe(false);
  });

  it("returns false when destination is full", () => {
    expect(isValidPour(["red"], ["blue", "blue", "blue", "blue"])).toBe(false);
  });

  it("returns false when destination top does not match source top", () => {
    expect(isValidPour(["red"], ["blue"])).toBe(false);
  });

  it("returns true when destination is empty", () => {
    expect(isValidPour(["red"], [])).toBe(true);
  });

  it("returns true when destination top matches source top", () => {
    expect(isValidPour(["blue", "red"], ["red"])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyPour
// ---------------------------------------------------------------------------

describe("applyPour", () => {
  it("moves a single unit when tops match", () => {
    const state = mkState([["blue", "red"], ["red", "green"], []]);
    const next = applyPour(state, 0, 1);
    expect(next.bottles[0]).toEqual(["blue"]);
    expect(next.bottles[1]).toEqual(["red", "green", "red"]);
    expect(next.moveCount).toBe(1);
  });

  it("moves the full matching run", () => {
    // source top has 2 reds, destination has space for 2
    const state = mkState([["blue", "red", "red"], ["green"], []]);
    const next = applyPour(state, 0, 2);
    expect(next.bottles[0]).toEqual(["blue"]);
    expect(next.bottles[2]).toEqual(["red", "red"]);
  });

  it("pours only as many as fit in destination", () => {
    // run of 3 into empty bottle — all 3 fit
    const state = mkState([["blue", "blue", "blue"], ["red", "red", "red"], []]);
    const next = applyPour(state, 0, 2);
    expect(next.bottles[2]).toEqual(["blue", "blue", "blue"]);
    // run of 3 reds into dest with 1 space — clamp to 1
    const state2 = mkState([
      ["blue", "red", "red", "red"],
      ["red", "red", "red"],
    ]);
    const next2 = applyPour(state2, 0, 1);
    expect(next2.bottles[0]).toEqual(["blue", "red", "red"]);
    expect(next2.bottles[1]).toEqual(["red", "red", "red", "red"]);
  });

  it("resets selectedBottleIndex to null", () => {
    const state = mkState([["red"], []], { selectedBottleIndex: 0 });
    expect(applyPour(state, 0, 1).selectedBottleIndex).toBeNull();
  });

  it("sets isComplete when solved", () => {
    // One pour away from complete
    const state = mkState([["red", "red", "red"], ["red"], []]);
    const next = applyPour(state, 1, 0);
    expect(next.isComplete).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isComplete
// ---------------------------------------------------------------------------

describe("isComplete", () => {
  it("returns true when all bottles are empty", () => {
    expect(isComplete(mkState([[], [], []]))).toBe(true);
  });

  it("returns true when all bottles are full single-color", () => {
    const state = mkState([["red", "red", "red", "red"], ["blue", "blue", "blue", "blue"], []]);
    expect(isComplete(state)).toBe(true);
  });

  it("returns false when a bottle is mixed", () => {
    const state = mkState([["red", "blue"], ["red", "red", "red", "red"], []]);
    expect(isComplete(state)).toBe(false);
  });

  it("returns false when a bottle is a single color but not full", () => {
    const state = mkState([["red", "red", "red"], ["blue", "blue", "blue", "blue"], []]);
    expect(isComplete(state)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// undo
// ---------------------------------------------------------------------------

describe("undo", () => {
  it("returns unchanged state when history is empty", () => {
    const state = mkState([["red"], []]);
    const result = undo(state, []);
    expect(result.state).toBe(state);
    expect(result.history).toHaveLength(0);
  });

  it("restores previous state and pops history", () => {
    const prev = mkState([["red", "blue"], []]);
    const cur = mkState([["red"], ["blue"]]);
    const { state, history } = undo(cur, [prev]);
    expect(state.bottles).toEqual(prev.bottles);
    expect(history).toHaveLength(0);
  });

  it("increments undosUsed", () => {
    const prev = mkState([["red"], []]);
    const cur = mkState([[], ["red"]], { undosUsed: 2 });
    const { state } = undo(cur, [prev]);
    expect(state.undosUsed).toBe(3);
  });

  it("resets selectedBottleIndex to null", () => {
    const prev = mkState([["red"], []], { selectedBottleIndex: 0 });
    const cur = mkState([[], ["red"]], { selectedBottleIndex: 1 });
    const { state } = undo(cur, [prev]);
    expect(state.selectedBottleIndex).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// initState
// ---------------------------------------------------------------------------

describe("initState", () => {
  it("strips empty string slots from API bottles", () => {
    const apiBottles = [
      ["red", "blue", "", ""],
      ["green", "green", "green", "green"],
      ["", "", "", ""],
    ];
    const state = initState(apiBottles as (Color | "")[][]);
    expect(state.bottles[0]).toEqual(["red", "blue"]);
    expect(state.bottles[1]).toEqual(["green", "green", "green", "green"]);
    expect(state.bottles[2]).toEqual([]);
  });

  it("initialises counters to zero and isComplete to false", () => {
    const state = initState([
      ["red", "", "", ""],
      ["", "", "", ""],
    ]);
    expect(state.moveCount).toBe(0);
    expect(state.undosUsed).toBe(0);
    expect(state.isComplete).toBe(false);
    expect(state.selectedBottleIndex).toBeNull();
  });
});
