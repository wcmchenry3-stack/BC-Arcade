/**
 * Tests for the precomputed probability tables (GH #2025, story A1).
 *
 * Coverage:
 *   1. Table shape — expected multiset counts per free-dice count.
 *   2. Parity with evForHold (brute-force) for rolls-remaining = 1.
 *   3. Monotonicity: EV2 ≥ EV1 for the same hold pattern.
 *   4. Lazy-init idempotence: calling initProbTables() multiple times is safe.
 *   5. Probability sums to 1.0 for each free-dice count.
 */

import {
  evForHold1Roll,
  evForHold2Roll,
  initProbTables,
  getMultisets,
  multisetCount,
} from "../probTables";
import { evForHold, maxImmediateScore } from "../aiHelpers";
import { computeDerived, newGame } from "../engine";
import type { GameState } from "../types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeGame(dice: number[], rollsUsed = 1): GameState {
  const base = newGame();
  return { ...base, dice, rolls_used: rollsUsed };
}

function withScores(state: GameState, filled: Partial<GameState["scores"]>): GameState {
  return computeDerived({ ...state, scores: { ...state.scores, ...filled } });
}

// ─── Table shape ─────────────────────────────────────────────────────────────

describe("probTables — table shape (multiset counts)", () => {
  /**
   * Number of multisets of size n from a 6-face die = C(n+5, 5):
   *   n=0 → C(5,5) = 1
   *   n=1 → C(6,5) = 6
   *   n=2 → C(7,5) = 21
   *   n=3 → C(8,5) = 56
   *   n=4 → C(9,5) = 126
   *   n=5 → C(10,5) = 252
   */
  const expected = [1, 6, 21, 56, 126, 252];

  it.each([0, 1, 2, 3, 4, 5])("freeCount=%i has correct number of multisets", (n) => {
    expect(multisetCount(n)).toBe(expected[n]);
  });

  it("probabilities sum to ~1.0 for each free-dice count", () => {
    for (let n = 0; n <= 5; n++) {
      const entries = getMultisets(n);
      const total = entries.reduce((sum, e) => sum + e.prob, 0);
      expect(total).toBeCloseTo(1.0, 10);
    }
  });
});

// ─── Parity with brute-force evForHold ───────────────────────────────────────

describe("probTables — parity with brute-force evForHold (rolls=1)", () => {
  /**
   * For each scenario: held indices + dice + scorecard.
   * We compare evForHold1Roll against the exported brute-force evForHold.
   * Tolerance: ≤ 0.01 (as required by the issue spec).
   */

  // Scenario 1: fresh game, hold all fives (indices 0,1,2), 2 free dice
  it("hold three fives on fresh scorecard", () => {
    const state = makeGame([5, 5, 5, 1, 2], 2);
    const keptIndices = [0, 1, 2];
    const keptValues = keptIndices.map((i) => state.dice[i]!);
    const expected = evForHold(state.dice, keptIndices, state.scores);
    const actual = evForHold1Roll(keptValues, 2, state.scores);
    expect(actual).toBeCloseTo(expected, 2); // 2 decimals ≈ 0.005 tolerance — within the 0.01 parity AC (#2025)
  });

  // Scenario 2: hold two sixes, 3 free dice
  it("hold two sixes — 3 free dice", () => {
    const state = makeGame([6, 6, 1, 2, 3], 2);
    const keptIndices = [0, 1];
    const keptValues = keptIndices.map((i) => state.dice[i]!);
    const expected = evForHold(state.dice, keptIndices, state.scores);
    const actual = evForHold1Roll(keptValues, 3, state.scores);
    expect(actual).toBeCloseTo(expected, 2);
  });

  // Scenario 3: hold nothing (all 5 dice free)
  it("hold nothing — 5 free dice on fresh scorecard", () => {
    const state = makeGame([1, 2, 3, 4, 5], 1);
    const keptIndices: number[] = [];
    const keptValues: number[] = [];
    const expected = evForHold(state.dice, keptIndices, state.scores);
    const actual = evForHold1Roll(keptValues, 5, state.scores);
    expect(actual).toBeCloseTo(expected, 2);
  });

  // Scenario 4: hold all five dice (0 free)
  it("hold all five dice — 0 free dice", () => {
    const state = makeGame([4, 4, 4, 4, 4], 2);
    const keptIndices = [0, 1, 2, 3, 4];
    const keptValues = keptIndices.map((i) => state.dice[i]!);
    const expected = evForHold(state.dice, keptIndices, state.scores);
    const actual = evForHold1Roll(keptValues, 0, state.scores);
    expect(actual).toBeCloseTo(expected, 2);
  });

  // Scenario 5: mid-game with several categories filled — bonus credit matters
  it("hold four sixes with upper bonus in range", () => {
    const state = withScores(makeGame([6, 6, 6, 6, 1], 2), {
      ones: 3,
      twos: 6,
      threes: 9,
      fours: 12,
      fives: 15,
      // sixes open, upperSubtotal = 45, toBonus = 18; 4 sixes = 24 → would add 6 to sub = 51, not bonus yet
    });
    const keptIndices = [0, 1, 2, 3]; // hold 4 sixes, 1 free die
    const keptValues = keptIndices.map((i) => state.dice[i]!);
    const expected = evForHold(state.dice, keptIndices, state.scores);
    const actual = evForHold1Roll(keptValues, 1, state.scores);
    expect(actual).toBeCloseTo(expected, 2);
  });

  // Scenario 6: bonus already earned — no bonus credit should fire
  it("hold two fours with bonus already earned", () => {
    const state = withScores(makeGame([4, 4, 1, 2, 3], 2), {
      ones: 3,
      twos: 6,
      threes: 9,
      fours: 12, // already filled
      fives: 15,
      sixes: 18,
    });
    // fours already scored; hold indices 0,1 (both 4s) — pure scoring against lower cats
    const keptIndices = [0, 1];
    const keptValues = keptIndices.map((i) => state.dice[i]!);
    const expected = evForHold(state.dice, keptIndices, state.scores);
    const actual = evForHold1Roll(keptValues, 3, state.scores);
    expect(actual).toBeCloseTo(expected, 2);
  });

  // Scenario 7: hold a 4-run (1,2,3,4) — tests straight-scoring EV
  it("hold 4-run [1,2,3,4] with 1 free die", () => {
    const state = makeGame([1, 2, 3, 4, 6], 2);
    const keptIndices = [0, 1, 2, 3]; // hold 1,2,3,4
    const keptValues = keptIndices.map((i) => state.dice[i]!);
    const expected = evForHold(state.dice, keptIndices, state.scores);
    const actual = evForHold1Roll(keptValues, 1, state.scores);
    expect(actual).toBeCloseTo(expected, 2);
  });
});

// ─── Monotonicity: EV2 ≥ EV1 ────────────────────────────────────────────────

describe("probTables — monotonicity (EV2 ≥ EV1 for same hold)", () => {
  /**
   * EV with 2 rolls remaining must be at least as high as EV with 1 roll
   * remaining under the same hold pattern.  Monotonicity must hold regardless
   * of whether the approximation underestimates the true 2-roll EV.
   */

  it("hold nothing (5 free) — fresh scorecard", () => {
    const state = makeGame([1, 2, 3, 4, 5], 1);
    const ev1 = evForHold1Roll([], 5, state.scores);
    const ev2 = evForHold2Roll([], 5, state.scores);
    expect(ev2).toBeGreaterThanOrEqual(ev1 - 1e-9); // allow for floating-point noise
  });

  it("hold two sixes (3 free) — fresh scorecard", () => {
    const state = makeGame([6, 6, 1, 2, 3], 1);
    const keptValues = [6, 6];
    const ev1 = evForHold1Roll(keptValues, 3, state.scores);
    const ev2 = evForHold2Roll(keptValues, 3, state.scores);
    expect(ev2).toBeGreaterThanOrEqual(ev1 - 1e-9);
  });

  it("hold four fives (1 free) — mid-game", () => {
    const state = withScores(makeGame([5, 5, 5, 5, 2], 1), { fives: 20 });
    const keptValues = [5, 5, 5, 5];
    const ev1 = evForHold1Roll(keptValues, 1, state.scores);
    const ev2 = evForHold2Roll(keptValues, 1, state.scores);
    expect(ev2).toBeGreaterThanOrEqual(ev1 - 1e-9);
  });

  it("hold all five (0 free) — EV1 = EV2 (no free dice to improve)", () => {
    const state = makeGame([3, 3, 3, 3, 3], 2);
    const keptValues = [3, 3, 3, 3, 3];
    const ev1 = evForHold1Roll(keptValues, 0, state.scores);
    const ev2 = evForHold2Roll(keptValues, 0, state.scores);
    // With 0 free dice the result is deterministic; both should be equal.
    expect(ev2).toBeCloseTo(ev1, 10);
  });

  it("hold nothing (5 free) — near-full scorecard", () => {
    const state = withScores(makeGame([1, 2, 3, 4, 5], 1), {
      ones: 3,
      twos: 6,
      threes: 9,
      fours: 12,
      fives: 15,
      sixes: 18,
      three_of_a_kind: 20,
      four_of_a_kind: 22,
      full_house: 25,
      small_straight: 30,
      large_straight: 40,
      yacht: 50,
    });
    const ev1 = evForHold1Roll([], 5, state.scores);
    const ev2 = evForHold2Roll([], 5, state.scores);
    expect(ev2).toBeGreaterThanOrEqual(ev1 - 1e-9);
  });
});

// ─── Lazy-init idempotence ────────────────────────────────────────────────────

describe("probTables — lazy-init idempotence", () => {
  it("calling initProbTables() multiple times returns the same table sizes", () => {
    initProbTables();
    const counts1 = [0, 1, 2, 3, 4, 5].map((n) => multisetCount(n));

    initProbTables();
    const counts2 = [0, 1, 2, 3, 4, 5].map((n) => multisetCount(n));

    expect(counts1).toEqual(counts2);
  });

  it("EV results are the same before and after a second initProbTables() call", () => {
    const state = makeGame([5, 5, 5, 1, 2], 1);
    const ev1 = evForHold1Roll([5, 5, 5], 2, state.scores);

    initProbTables(); // second call — should be a no-op

    const ev2 = evForHold1Roll([5, 5, 5], 2, state.scores);
    expect(ev1).toBeCloseTo(ev2, 10);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe("probTables — edge cases", () => {
  it("freeCount=0: EV1 equals maxImmediateScore directly", () => {
    // With 0 free dice, EV = maxImmediateScore(keptValues).
    // Hold a yacht [6,6,6,6,6]: maxImmediate should be 50.
    const state = makeGame([6, 6, 6, 6, 6], 2);
    const ev = evForHold1Roll([6, 6, 6, 6, 6], 0, state.scores);
    expect(ev).toBe(50);
  });

  it("freeCount=0 with yacht already scored: scores chance or lower cat", () => {
    const state = withScores(makeGame([6, 6, 6, 6, 6], 2), { yacht: 50 });
    const ev = evForHold1Roll([6, 6, 6, 6, 6], 0, state.scores);
    // Best available: sixes = 30, or four_of_a_kind = 30, or three_of_a_kind = 30, or chance = 30
    // joker rule applies: sixes open → score sixes = 30
    expect(ev).toBe(30);
  });

  it("EV1 > 0 for any non-empty scorecard", () => {
    const state = makeGame([1, 2, 3, 4, 5], 1);
    const ev = evForHold1Roll([], 5, state.scores);
    expect(ev).toBeGreaterThan(0);
  });
});

// ─── Joker-aware maxImmediateScore (GH #2242) ─────────────────────────────────

describe("maxImmediateScore — Joker turn", () => {
  it("Priority 1: mandatory upper category is the only legal move, even when a lower category would score higher", () => {
    // Yacht filled; a second five-of-a-kind (fours) rolled, and the
    // corresponding upper category ("fours") is still open. Per Joker
    // priority rules, "fours" is the ONLY legal move here — large_straight's
    // Joker-fixed 40 (or full_house's 25) must NOT be considered, even
    // though both exceed fours' plain value of 20.
    const scores = withScores(makeGame([4, 4, 4, 4, 4], 2), { yacht: 50 }).scores;
    const curUpperSubtotal = 0;
    expect(maxImmediateScore([4, 4, 4, 4, 4], scores, curUpperSubtotal)).toBe(20);
  });

  it("Priority 2: prices open lower categories at their Joker-fixed values once the mandatory upper is filled", () => {
    // Yacht AND fours both filled; large_straight/full_house/small_straight
    // are now legally scoreable and must be Joker-priced (40/25/30), not the
    // 0 a non-Joker-aware scorer would give five-of-a-kind fours.
    const scores = withScores(makeGame([4, 4, 4, 4, 4], 2), { yacht: 50, fours: 20 }).scores;
    const curUpperSubtotal = 20;
    // Best among open lower cats: large_straight=40 beats full_house=25,
    // small_straight=30, and three_of_a_kind/four_of_a_kind/chance=20 each.
    expect(maxImmediateScore([4, 4, 4, 4, 4], scores, curUpperSubtotal)).toBe(40);
  });

  it("non-Joker combos within the same enumeration are unaffected", () => {
    // Yacht filled, but THIS combo isn't a five-of-a-kind — must be priced
    // via the plain scorer regardless of the scorecard's Joker eligibility.
    const scores = withScores(makeGame([1, 2, 3, 4, 5], 2), { yacht: 50 }).scores;
    // large_straight=40 (natural), full_house=0 (not a natural full house).
    expect(maxImmediateScore([1, 2, 3, 4, 5], scores, 0)).toBe(40);
  });

  it("regression: unaffected when yacht is not yet filled", () => {
    const scores = makeGame([4, 4, 4, 4, 4], 2).scores; // fresh scorecard, nothing filled
    // Yacht itself is the best legal move here (50), not a lower-category guess.
    expect(maxImmediateScore([4, 4, 4, 4, 4], scores, 0)).toBe(50);
  });
});
