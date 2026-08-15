/**
 * Unit tests for the Yacht AI hold and score strategies (GH #1602; updated A4 #2028).
 *
 * Tests the utility-AI path. Contract tests (length, legality) apply to all
 * difficulties. Behavioral tests are EV- and weight-based, not heuristic-based.
 */

import { holdStrategy, scoreStrategy } from "../ai";
import { computeDerived, newGame, setRng } from "../engine";
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

// Freeze noise so Easy/Medium tests are deterministic (noise rate > 0.99 never fires).
beforeEach(() => setRng(() => 0.99));
afterEach(() => setRng(Math.random));

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
// holdStrategy — EV-driven behaviors (all difficulties)
// ---------------------------------------------------------------------------

describe("holdStrategy — EV-driven hold behaviors", () => {
  it("holds five of a kind — hold-all is universally best EV", () => {
    const state = makeGame([6, 6, 6, 6, 6], 2);
    expect(holdStrategy(state, "hard")).toEqual([true, true, true, true, true]);
    expect(holdStrategy(state, "medium")).toEqual([true, true, true, true, true]);
  });

  it("Hard: holds 4 sixes — clearly best EV on final roll", () => {
    const state = makeGame([6, 6, 6, 6, 1], 2);
    expect(holdStrategy(state, "hard")).toEqual([true, true, true, true, false]);
  });

  it("Hard: holds trips at rollsUsed=1 — best 2-roll EV", () => {
    const state = makeGame([4, 4, 4, 1, 2], 1);
    expect(holdStrategy(state, "hard")).toEqual([true, true, true, false, false]);
  });

  it("Hard: holds 4-run when outside bonus-proximity threshold", () => {
    const state = withScores(makeGame([1, 2, 3, 4, 6], 2), {
      ones: 3,
      twos: 6,
      threes: 9,
    });
    const held = holdStrategy(state, "hard");
    const heldDice = state.dice.filter((_, i) => held[i]);
    expect(heldDice.includes(6)).toBe(false);
  });

  it("Easy: holds 4-run [1,2,3,4,6] — better EV than lone 6", () => {
    // Utility Easy uses EV (not 'hold most frequent' heuristic).
    // [1,2,3,4] → large_straight potential is better EV than single 6.
    const state = makeGame([1, 2, 3, 4, 6]);
    const held = holdStrategy(state, "easy");
    const heldDice = state.dice.filter((_, i) => held[i]).sort((a, b) => a - b);
    expect(heldDice).toEqual([1, 2, 3, 4]);
  });

  it("does not hold straights when both are already scored — falls back to next-best", () => {
    const state = withScores(makeGame([1, 2, 3, 4, 6]), {
      large_straight: 40,
      small_straight: 30,
    });
    const held = holdStrategy(state, "medium");
    const heldDice = state.dice.filter((_, i) => held[i]).sort((a, b) => a - b);
    expect(heldDice).not.toEqual([1, 2, 3, 4]);
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
// scoreStrategy — immediate value (rateImmediateValue drives selection)
// ---------------------------------------------------------------------------

describe("scoreStrategy — immediate value", () => {
  it("takes Yacht (50 pts) when available — highest immediate value", () => {
    const state = makeGame([6, 6, 6, 6, 6], 3);
    expect(scoreStrategy(state, "hard", 0)).toBe("yacht");
    expect(scoreStrategy(state, "medium")).toBe("yacht");
  });

  it("takes Large Straight (40 pts) when available", () => {
    const state = makeGame([1, 2, 3, 4, 5], 3);
    expect(scoreStrategy(state, "hard", 0)).toBe("large_straight");
    expect(scoreStrategy(state, "medium")).toBe("large_straight");
  });

  it("takes highest-value category when multiple are tied", () => {
    // [1,2,3,4,5]: large_straight = 40, chance = 15; large_straight wins
    const state = makeGame([1, 2, 3, 4, 5], 3);
    expect(scoreStrategy(state, "easy")).toBe("large_straight");
  });

  it("Full House wins over lower-value categories when available", () => {
    const state = makeGame([5, 5, 5, 2, 2], 3);
    expect(scoreStrategy(state, "medium")).toBe("full_house");
    expect(scoreStrategy(state, "hard", 0)).toBe("full_house");
  });

  it("Three of a Kind beats lower-value categories when no better option", () => {
    // sixes already scored; [6,6,6,1,2]: three_of_a_kind = 21, chance = 21; tie → tiebreak
    const state = withScores(makeGame([6, 6, 6, 1, 2], 3), { sixes: 18 });
    const cat = scoreStrategy(state, "medium");
    // Three of a kind or chance — both score same; either is fine
    expect(["three_of_a_kind", "chance"].includes(cat)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// scoreStrategy — Chance-preservation (rateChanceSafetyValve)
// ---------------------------------------------------------------------------

describe("scoreStrategy — Chance is penalised early game", () => {
  it("does NOT take Chance in the first round even with decent sum", () => {
    // [6,5,4,3,2]: chance = 20; but chanceSafetyValve≈0 early → utility AI avoids it
    const state = makeGame([6, 5, 4, 3, 2], 3);
    expect(scoreStrategy(state, "easy")).not.toBe("chance");
    expect(scoreStrategy(state, "medium")).not.toBe("chance");
    expect(scoreStrategy(state, "hard", 0)).not.toBe("chance");
  });

  it("does NOT take Chance when sum < 20 (regardless of game phase)", () => {
    const state = makeGame([1, 2, 3, 4, 5], 3); // sum = 15
    expect(scoreStrategy(state, "easy")).not.toBe("chance");
  });
});

// ---------------------------------------------------------------------------
// scoreStrategy — adversarial variance (Hard trailing/leading)
// ---------------------------------------------------------------------------

describe("scoreStrategy — Hard adversarial variance", () => {
  it("trailing: favours high-variance play (four_of_a_kind) over safe categories", () => {
    // myScore=0 < opponentScore(50)-20=30 → trailing
    const state = makeGame([6, 6, 6, 6, 1], 3);
    expect(scoreStrategy(state, "hard", 50)).toBe("four_of_a_kind");
  });

  it("trailing: takes full_house when four_of_a_kind unavailable", () => {
    const state = makeGame([3, 3, 3, 6, 6], 3);
    expect(scoreStrategy(state, "hard", 50)).toBe("full_house");
  });

  it("leading: locks in upper-section points when ahead", () => {
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

  // GH #2200: accepts an optional opponentRound so callers with real turn-order
  // info (production, simulators) can avoid comparing against a stale snapshot.
  it("accepts an optional opponentRound without throwing, for both mover positions", () => {
    const state = withScores({ ...makeGame([6, 6, 6, 6, 1], 3), round: 8 }, { yacht: 50 });
    expect(() => scoreStrategy(state, "hard", 139, 9)).not.toThrow(); // opponent already played
    expect(() => scoreStrategy(state, "hard", 139, 8)).not.toThrow(); // opponent pending
  });
});

// ---------------------------------------------------------------------------
// scoreStrategy — Joker safety
// ---------------------------------------------------------------------------

describe("scoreStrategy — Joker rule compliance", () => {
  it("Medium Joker: picks highest-value open lower cat", () => {
    // yacht=50 (joker active), sixes filled; legal set is constrained by engine
    const state = withScores(makeGame([6, 6, 6, 6, 6], 3), {
      yacht: 50,
      sixes: 30,
      large_straight: 40,
      four_of_a_kind: 0,
    });
    const cat = scoreStrategy(state, "medium");
    expect(cat).not.toBe("full_house"); // engine would return highest-value legal cat
  });

  it("Hard Joker: picks highest-value open lower cat", () => {
    const state = withScores(makeGame([6, 6, 6, 6, 6], 3), {
      yacht: 50,
      sixes: 30,
      large_straight: 40,
      four_of_a_kind: 0,
    });
    const cat = scoreStrategy(state, "hard", 0);
    expect(cat).not.toBe("full_house");
  });

  // GH #2242: rateImmediateValue used the non-Joker scorer, which returns 0 for
  // Full House / Small Straight / Large Straight on Joker turns (they aren't a
  // natural full-house/straight shape). That made the AI undervalue the boxes
  // that are actually worth the most on a Joker turn and steer toward a lower
  // real-value category instead. Fixture: five 2s, yacht + twos filled, so the
  // legal set (Priority 2) is full_house(25)/small_straight(30)/large_straight(40)
  // vs. three_of_a_kind/four_of_a_kind/chance(10 each, via sumDice). Correct
  // Joker-aware valuation must prefer large_straight (40) over the 10-point
  // categories that the pre-fix code would have rated equal-or-higher.
  it.each(["easy", "medium", "hard"] as const)(
    "%s Joker: prefers the 25/40 fixed Full House / Large Straight value over a lower-value legal cat",
    (difficulty) => {
      const state = withScores(makeGame([2, 2, 2, 2, 2], 3), { yacht: 50, twos: 10 });
      const cat = scoreStrategy(state, difficulty, 0);
      expect(cat).toBe("large_straight");
    }
  );
});
