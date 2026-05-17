/**
 * Unit tests for the Yacht AI hold and score strategies (GH #1602).
 *
 * Covers Easy / Medium / Hard for both holdStrategy and scoreStrategy.
 * These are pure-function tests — no rendering, no RNG, no side effects.
 */

import { holdStrategy, scoreStrategy } from "../ai";
import { computeDerived, newGame } from "../engine";
import type { GameState } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGame(dice: number[], rollsUsed = 1): GameState {
  const base = newGame();
  return { ...base, dice, rolls_used: rollsUsed };
}

/** Return a state with specified categories pre-filled and the rest null. */
function withScores(state: GameState, filled: Partial<GameState["scores"]>): GameState {
  return computeDerived({ ...state, scores: { ...state.scores, ...filled } });
}

// ---------------------------------------------------------------------------
// holdStrategy — shared contract
// ---------------------------------------------------------------------------

describe("holdStrategy — returns boolean[] of length 5", () => {
  const state = makeGame([1, 2, 3, 4, 5]);

  it("easy", () => {
    const held = holdStrategy(state, "easy");
    expect(held).toHaveLength(5);
    held.forEach((h) => expect(typeof h).toBe("boolean"));
  });

  it("medium", () => {
    const held = holdStrategy(state, "medium");
    expect(held).toHaveLength(5);
    held.forEach((h) => expect(typeof h).toBe("boolean"));
  });

  it("hard", () => {
    const held = holdStrategy(state, "hard");
    expect(held).toHaveLength(5);
    held.forEach((h) => expect(typeof h).toBe("boolean"));
  });
});

// ---------------------------------------------------------------------------
// holdStrategy — Easy
// ---------------------------------------------------------------------------

describe("holdStrategy — Easy", () => {
  it("holds the most-frequent face", () => {
    const state = makeGame([3, 3, 3, 1, 2]);
    expect(holdStrategy(state, "easy")).toEqual([true, true, true, false, false]);
  });

  it("ties on frequency go to the highest face", () => {
    // 1 and 4 both appear twice; tiebreak → hold 4s
    const state = makeGame([1, 1, 4, 4, 2]);
    expect(holdStrategy(state, "easy")).toEqual([false, false, true, true, false]);
  });

  it("holds a single die when all are unique (highest)", () => {
    const state = makeGame([1, 2, 3, 4, 6]);
    const held = holdStrategy(state, "easy");
    // Only the 6 is held (most-frequent = 1 occurrence each → highest wins)
    const heldDice = state.dice.filter((_, i) => held[i]);
    expect(heldDice).toEqual([6]);
  });
});

// ---------------------------------------------------------------------------
// holdStrategy — Medium
// ---------------------------------------------------------------------------

describe("holdStrategy — Medium", () => {
  it("holds 4+ of a kind", () => {
    const state = makeGame([5, 5, 5, 5, 2]);
    expect(holdStrategy(state, "medium")).toEqual([true, true, true, true, false]);
  });

  it("holds all 5 when full house is in hand", () => {
    const state = makeGame([2, 2, 3, 3, 3]);
    expect(holdStrategy(state, "medium")).toEqual([true, true, true, true, true]);
  });

  it("holds 4-run to complete a large straight", () => {
    const state = makeGame([1, 2, 3, 4, 6]);
    const held = holdStrategy(state, "medium");
    const heldDice = state.dice.filter((_, i) => held[i]).sort((a, b) => a - b);
    expect(heldDice).toEqual([1, 2, 3, 4]);
  });

  it("holds trips", () => {
    const state = makeGame([4, 4, 4, 1, 2]);
    expect(holdStrategy(state, "medium")).toEqual([true, true, true, false, false]);
  });

  it("holds a pair, preferring the higher face on a tie", () => {
    // [1,1,4,4,2]: two pairs, unique sorted [1,2,4] → max run is [1,2] (length 2),
    // so no 3-run fires; falls through to highest-pair logic → holds 4s.
    const state = makeGame([1, 1, 4, 4, 2]);
    const held = holdStrategy(state, "medium");
    const heldDice = state.dice.filter((_, i) => held[i]);
    expect(heldDice.every((d) => d === 4)).toBe(true);
  });

  it("pursues upper bonus when within 55 pts — holds open face appearing ≥2 times", () => {
    // upperSubtotal = ones(3)+twos(6) = 9 → toBonus = 54 ≤ 55
    // dice [4,4,1,6,2]: no run ≥3, no trips; fours is open and appears twice → hold 4s
    const state = withScores(makeGame([4, 4, 1, 6, 2]), { ones: 3, twos: 6 });
    const held = holdStrategy(state, "medium");
    const heldDice = state.dice.filter((_, i) => held[i]);
    expect(heldDice.every((d) => d === 4)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// holdStrategy — Hard
// ---------------------------------------------------------------------------

describe("holdStrategy — Hard", () => {
  it("at rollsUsed=2 uses EV: holds 4 sixes over nothing", () => {
    // EV of 4 sixes kept is clearly higher than any other pattern
    const state = makeGame([6, 6, 6, 6, 1], 2);
    expect(holdStrategy(state, "hard")).toEqual([true, true, true, true, false]);
  });

  it("at rollsUsed=1 falls back to medium (holds trips)", () => {
    const state = makeGame([4, 4, 4, 1, 2], 1);
    expect(holdStrategy(state, "hard")).toEqual([true, true, true, false, false]);
  });

  it("at rollsUsed=2 holds 5 of a kind (yacht) — best possible EV", () => {
    const state = makeGame([3, 3, 3, 3, 3], 2);
    expect(holdStrategy(state, "hard")).toEqual([true, true, true, true, true]);
  });
});

// ---------------------------------------------------------------------------
// scoreStrategy — shared contract
// ---------------------------------------------------------------------------

describe("scoreStrategy — never returns a filled category", () => {
  it("easy: skips filled yacht", () => {
    const state = withScores(makeGame([5, 5, 5, 5, 5], 3), { yacht: 50 });
    expect(scoreStrategy(state, "easy")).not.toBe("yacht");
  });

  it("medium: skips filled large_straight", () => {
    const state = withScores(makeGame([1, 2, 3, 4, 5], 3), { large_straight: 40 });
    expect(scoreStrategy(state, "medium")).not.toBe("large_straight");
  });

  it("hard: skips filled yacht", () => {
    const state = withScores(makeGame([6, 6, 6, 6, 6], 3), { yacht: 50 });
    expect(scoreStrategy(state, "hard", 0)).not.toBe("yacht");
  });
});

// ---------------------------------------------------------------------------
// scoreStrategy — Easy
// ---------------------------------------------------------------------------

describe("scoreStrategy — Easy", () => {
  it("takes Chance when sum >= 20 and > 6 categories are open", () => {
    // Fresh game has 13 open categories; [6,5,4,3,2] sums to 20
    const state = makeGame([6, 5, 4, 3, 2], 3);
    expect(scoreStrategy(state, "easy")).toBe("chance");
  });

  it("does NOT take Chance when sum < 20", () => {
    const state = makeGame([1, 2, 3, 4, 5], 3); // sum = 15
    expect(scoreStrategy(state, "easy")).not.toBe("chance");
  });

  it("takes highest-scoring available category when Chance condition fails", () => {
    // [1,2,3,4,5] is a large straight (40 pts) — best available, sum < 20 so chance is skipped
    const state = makeGame([1, 2, 3, 4, 5], 3);
    expect(scoreStrategy(state, "easy")).toBe("large_straight");
  });
});

// ---------------------------------------------------------------------------
// scoreStrategy — Medium
// ---------------------------------------------------------------------------

describe("scoreStrategy — Medium", () => {
  it("always takes Yacht (50 pts) when available", () => {
    const state = makeGame([6, 6, 6, 6, 6], 3);
    expect(scoreStrategy(state, "medium")).toBe("yacht");
  });

  it("always takes Large Straight (40 pts) when available", () => {
    const state = makeGame([1, 2, 3, 4, 5], 3);
    expect(scoreStrategy(state, "medium")).toBe("large_straight");
  });

  it("takes Four of a Kind when score > 20", () => {
    // [6,6,6,6,1]: four_of_a_kind = 25 > 20
    const state = makeGame([6, 6, 6, 6, 1], 3);
    expect(scoreStrategy(state, "medium")).toBe("four_of_a_kind");
  });

  it("takes Full House when available", () => {
    const state = makeGame([5, 5, 5, 2, 2], 3);
    expect(scoreStrategy(state, "medium")).toBe("full_house");
  });

  it("takes Three of a Kind when score > 15", () => {
    // [5,5,5,1,2]: no yacht/straight/four-of-a-kind/full-house; three_of_a_kind = 18 > 15
    const state = makeGame([5, 5, 5, 1, 2], 3);
    expect(scoreStrategy(state, "medium")).toBe("three_of_a_kind");
  });

  it("sacrifices ones when upper bonus is mathematically unreachable", () => {
    // All upper cats filled with 0 except ones; bonus max = 1×5 = 5 < 63
    const state = withScores(makeGame([1, 2, 4, 5, 6], 3), {
      twos: 0,
      threes: 0,
      fours: 0,
      fives: 0,
      sixes: 0,
    });
    expect(scoreStrategy(state, "medium")).toBe("ones");
  });
});

// ---------------------------------------------------------------------------
// scoreStrategy — Hard
// ---------------------------------------------------------------------------

describe("scoreStrategy — Hard", () => {
  it("always takes Yacht", () => {
    const state = makeGame([4, 4, 4, 4, 4], 3);
    expect(scoreStrategy(state, "hard", 0)).toBe("yacht");
  });

  it("always takes Large Straight", () => {
    const state = makeGame([2, 3, 4, 5, 6], 3);
    expect(scoreStrategy(state, "hard", 0)).toBe("large_straight");
  });

  it("trailing: takes four_of_a_kind for high-variance play", () => {
    // myScore=0 < opponentScore(50)-30=20 → trailing
    // [6,6,6,6,1]: four_of_a_kind = 25 > 16 threshold
    const state = makeGame([6, 6, 6, 6, 1], 3);
    expect(scoreStrategy(state, "hard", 50)).toBe("four_of_a_kind");
  });

  it("trailing: takes full_house when four_of_a_kind is unavailable", () => {
    // [3,3,3,6,6]: full_house=25, no four_of_a_kind (only 3 threes)
    // myScore=0 < opponentScore(50)-30=20 → trailing
    const state = makeGame([3, 3, 3, 6, 6], 3);
    expect(scoreStrategy(state, "hard", 50)).toBe("full_house");
  });

  it("leading: takes safe upper category (sixes with 3+ count)", () => {
    // myScore = 65 > opponentScore(0)+50 → leading
    const state = withScores(makeGame([6, 6, 6, 1, 2], 3), {
      ones: 5,
      twos: 10,
      threes: 15,
      fours: 20,
      fives: 15,
    });
    expect(scoreStrategy(state, "hard", 0)).toBe("sixes");
  });

  it("sacrifices ones when upper bonus is unreachable", () => {
    const state = withScores(makeGame([1, 2, 4, 5, 6], 3), {
      twos: 0,
      threes: 0,
      fours: 0,
      fives: 0,
      sixes: 0,
    });
    expect(scoreStrategy(state, "hard", 0)).toBe("ones");
  });
});
