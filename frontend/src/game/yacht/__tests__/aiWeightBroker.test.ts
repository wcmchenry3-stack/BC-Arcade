/**
 * Tests for the Yacht Utility AI weight broker and decision selector (GH #2027, story A3).
 *
 * Validates three properties:
 * 1. Legality — every hold and score decision over full seeded games is a legal action.
 * 2. Weighted-sum selection — consideration ratings produce correct argmax decisions.
 * 3. Noise determinism — same seed ⇒ same sequence of decisions; Hard ⇒ no
 *    random picks regardless of RNG state.
 */

import { holdStrategy, scoreStrategy } from "../ai";
import { createSeededRng, newGame, possibleScores, roll, score, setRng } from "../engine";
import type { AiDifficulty, GameState } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGame(dice: number[], rollsUsed = 1): GameState {
  const base = newGame();
  return { ...base, dice, rolls_used: rollsUsed };
}

/** Run one full 13-round game, returning all decisions made. */
function collectDecisions(
  difficulty: AiDifficulty,
  seed: number
): { holds: boolean[][]; scores: string[] } {
  setRng(createSeededRng(seed));
  let state = newGame();
  const holds: boolean[][] = [];
  const scores: string[] = [];

  for (let round = 0; round < 13; round++) {
    state = roll(state, [false, false, false, false, false]);
    while (state.rolls_used < 3) {
      const held = holdStrategy(state, difficulty);
      holds.push(held);
      state = roll(state, held);
    }
    const cat = scoreStrategy(state, difficulty, 0);
    scores.push(cat);
    state = score(state, cat);
  }

  return { holds, scores };
}

// ---------------------------------------------------------------------------
// Legality
// ---------------------------------------------------------------------------

describe("Utility AI — decision legality", () => {
  afterEach(() => setRng(Math.random));

  const DIFFICULTIES: AiDifficulty[] = ["easy", "medium", "hard"];

  for (const difficulty of DIFFICULTIES) {
    it(`holdStrategy always returns boolean[5] — ${difficulty}`, () => {
      for (const seed of [1, 42, 999]) {
        setRng(createSeededRng(seed));
        let state = newGame();
        for (let round = 0; round < 13; round++) {
          state = roll(state, [false, false, false, false, false]);
          while (state.rolls_used < 3) {
            const held = holdStrategy(state, difficulty);
            expect(held).toHaveLength(5);
            held.forEach((h) => expect(typeof h).toBe("boolean"));
            state = roll(state, held);
          }
          state = score(state, scoreStrategy(state, difficulty, 0));
        }
      }
    });

    it(`scoreStrategy always returns a legal category — ${difficulty}`, () => {
      for (const seed of [1, 42, 999]) {
        setRng(createSeededRng(seed));
        let state = newGame();
        for (let round = 0; round < 13; round++) {
          state = roll(state, [false, false, false, false, false]);
          while (state.rolls_used < 3) {
            state = roll(state, holdStrategy(state, difficulty));
          }
          const legal = possibleScores(state);
          const cat = scoreStrategy(state, difficulty, 0);
          expect(cat in legal).toBe(true);
          state = score(state, cat);
        }
      }
    });
  }

  it("completes a full game without throwing at each difficulty", () => {
    for (const difficulty of DIFFICULTIES) {
      expect(() => collectDecisions(difficulty, 7)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Weighted-sum selection on hand-built states
// ---------------------------------------------------------------------------

describe("Utility AI — weighted-sum selection", () => {
  // Freeze RNG so noise never fires: getRng() returns a function that always
  // returns 0.99 (> any noise rate), ensuring the best action is always picked.
  beforeEach(() => setRng(() => 0.99));
  afterEach(() => setRng(Math.random));

  it("scorecardSafety blocks filled categories from being selected", () => {
    // State: yacht already scored; dice show a yacht (5-of-a-kind)
    // The utility AI must not select "yacht" (filled).
    let state = makeGame([5, 5, 5, 5, 5], 3);
    state = { ...state, scores: { ...state.scores, yacht: 50 } };
    const cat = scoreStrategy(state, "hard", 0);
    expect(cat).not.toBe("yacht");
    // The selected category must be in possibleScores (legal)
    expect(cat in possibleScores(state)).toBe(true);
  });

  it("Hard hold: prefers keeping a pair of sixes over holding nothing", () => {
    // [6,6,1,2,3] — keeping the sixes should have higher EV than holding nothing
    const state = makeGame([6, 6, 1, 2, 3], 2);
    const held = holdStrategy(state, "hard");
    // At least one 6 should be held
    const heldDice = state.dice.filter((_, i) => held[i]);
    expect(heldDice.some((d) => d === 6)).toBe(true);
  });

  it("Hard hold: hold-all wins when dice are already optimal (five sixes)", () => {
    const state = makeGame([6, 6, 6, 6, 6], 2);
    const held = holdStrategy(state, "hard");
    expect(held).toEqual([true, true, true, true, true]);
  });

  it("Chance safety valve: Hard avoids Chance when many categories remain", () => {
    // All categories open, dice sum = 18; chanceSafetyValve returns near 0 early game,
    // so adversarialVariance pushes the selector toward other options over Chance.
    const state = makeGame([3, 3, 3, 3, 3], 3);
    const cat = scoreStrategy(state, "hard", 0);
    // With 13 categories remaining, chanceSafetyValve(chance) ≈ 0 → Chance gets low score
    expect(cat).not.toBe("chance");
  });
});

// ---------------------------------------------------------------------------
// Noise determinism
// ---------------------------------------------------------------------------

describe("Utility AI — noise determinism", () => {
  afterEach(() => setRng(Math.random));

  it("same seed produces identical hold decisions — easy", () => {
    const a = collectDecisions("easy", 100);
    const b = collectDecisions("easy", 100);
    expect(a.holds).toEqual(b.holds);
  });

  it("same seed produces identical score decisions — easy", () => {
    const a = collectDecisions("easy", 200);
    const b = collectDecisions("easy", 200);
    expect(a.scores).toEqual(b.scores);
  });

  it("same seed produces identical decisions — medium", () => {
    const a = collectDecisions("medium", 300);
    const b = collectDecisions("medium", 300);
    expect(a.holds).toEqual(b.holds);
    expect(a.scores).toEqual(b.scores);
  });

  it("Hard produces zero random deviations — noise rate is 0.0", () => {
    // Verify by running with two completely different RNG seeds and asserting
    // the decisions are identical (since noise rate = 0, the RNG is never
    // consulted and the pure weighted-sum argmax is always returned).
    setRng(createSeededRng(1));
    let state1 = newGame();
    setRng(createSeededRng(9999));
    let state2 = newGame();

    // Use a fixed dice sequence for both games so outcomes are comparable
    const fixedDice = [4, 4, 4, 6, 6];
    state1 = { ...state1, dice: fixedDice, rolls_used: 2 };
    state2 = { ...state2, dice: fixedDice, rolls_used: 2 };

    const held1 = holdStrategy(state1, "hard");
    const held2 = holdStrategy(state2, "hard");
    expect(held1).toEqual(held2);

    state1 = { ...state1, rolls_used: 3 };
    state2 = { ...state2, rolls_used: 3 };
    const cat1 = scoreStrategy(state1, "hard", 50);
    const cat2 = scoreStrategy(state2, "hard", 50);
    expect(cat1).toEqual(cat2);
  });

  it("different seeds produce different Easy decision sequences (probabilistic)", () => {
    // With 25% noise per hold/score decision across 13 rounds (~26 decisions),
    // the probability that two different seeds produce identical sequences is
    // astronomically small. This verifies noise is actually firing.
    const a = collectDecisions("easy", 1);
    const b = collectDecisions("easy", 2);
    // At least one decision should differ across 13 rounds of dice + scoring
    const holdsMatch = JSON.stringify(a.holds) === JSON.stringify(b.holds);
    const scoresMatch = JSON.stringify(a.scores) === JSON.stringify(b.scores);
    expect(holdsMatch && scoresMatch).toBe(false);
  });
});
