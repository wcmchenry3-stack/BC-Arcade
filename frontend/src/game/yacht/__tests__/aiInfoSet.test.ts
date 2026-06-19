/**
 * Tests for buildYachtInfoSet (GH #2025, story A1).
 *
 * Verifies information-set field correctness across four key game states:
 *   1. Mid-game (partially filled, bonus still in reach)
 *   2. Bonus already earned
 *   3. Bonus mathematically unreachable
 *   4. Scorecard nearly full (one category left)
 */

import { buildYachtInfoSet } from "../aiInfoSet";
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

// ─── Mid-game state ───────────────────────────────────────────────────────────

describe("buildYachtInfoSet — mid-game state", () => {
  // ones=3, twos=6, threes=9 filled; upperSubtotal=18, toBonus=45; round=4
  const midState = withScores(makeGame([4, 4, 4, 5, 6], 2), {
    ones: 3,
    twos: 6,
    threes: 9,
  });

  const infoSet = buildYachtInfoSet(midState, 80);

  it("kind is 'yacht'", () => {
    expect(infoSet.kind).toBe("yacht");
  });

  it("dice reflect current dice", () => {
    expect(infoSet.dice).toEqual([4, 4, 4, 5, 6]);
  });

  it("rollsUsed = 2, rollsRemaining = 1", () => {
    expect(infoSet.rollsUsed).toBe(2);
    expect(infoSet.rollsRemaining).toBe(1);
  });

  it("open categories do not include ones/twos/threes", () => {
    expect(infoSet.openCategories.has("ones")).toBe(false);
    expect(infoSet.openCategories.has("twos")).toBe(false);
    expect(infoSet.openCategories.has("threes")).toBe(false);
  });

  it("filled categories include ones/twos/threes", () => {
    expect(infoSet.filledCategories.has("ones")).toBe(true);
    expect(infoSet.filledCategories.has("twos")).toBe(true);
    expect(infoSet.filledCategories.has("threes")).toBe(true);
  });

  it("categoriesRemaining = 10 (13 total - 3 filled)", () => {
    expect(infoSet.categoriesRemaining).toBe(10);
  });

  it("upperSubtotal = 18", () => {
    expect(infoSet.upperSubtotal).toBe(18);
  });

  it("toBonus = 45", () => {
    expect(infoSet.toBonus).toBe(45);
  });

  it("bonusEarned = false", () => {
    expect(infoSet.bonusEarned).toBe(false);
  });

  it("bonusUnreachable = false (plenty of open upper cats remain)", () => {
    // fours(20) + fives(25) + sixes(30) = 75 available → 18+75=93 ≥ 63
    expect(infoSet.bonusUnreachable).toBe(false);
  });

  it("myScore matches state total_score", () => {
    expect(infoSet.myScore).toBe(midState.total_score);
  });

  it("opponentScore = 80", () => {
    expect(infoSet.opponentScore).toBe(80);
  });

  it("scoreDelta = myScore - 80 (negative when trailing)", () => {
    expect(infoSet.scoreDelta).toBe(infoSet.myScore - 80);
  });

  it("round = 1 (newGame round, scores don't advance it)", () => {
    // round is preserved from the GameState
    expect(infoSet.round).toBe(midState.round);
  });
});

// ─── Bonus earned ────────────────────────────────────────────────────────────

describe("buildYachtInfoSet — bonus already earned", () => {
  // Exact par scores: 3+6+9+12+15+18 = 63 → bonus earned
  const bonusState = withScores(makeGame([6, 6, 6, 6, 6], 1), {
    ones: 3,
    twos: 6,
    threes: 9,
    fours: 12,
    fives: 15,
    sixes: 18,
  });

  const infoSet = buildYachtInfoSet(bonusState, 0);

  it("bonusEarned = true", () => {
    expect(infoSet.bonusEarned).toBe(true);
  });

  it("toBonus = 0 when bonus is earned", () => {
    expect(infoSet.toBonus).toBe(0);
  });

  it("bonusUnreachable = false when bonus is already earned", () => {
    // bonusUnreachable only makes sense when the bonus is not yet earned
    expect(infoSet.bonusUnreachable).toBe(false);
  });

  it("upperSubtotal = 63", () => {
    expect(infoSet.upperSubtotal).toBe(63);
  });

  it("myScore includes the upper bonus (total_score)", () => {
    // The engine computes total_score including the 35-pt bonus
    expect(infoSet.myScore).toBe(bonusState.total_score);
  });
});

// ─── Bonus unreachable ───────────────────────────────────────────────────────

describe("buildYachtInfoSet — bonus mathematically unreachable", () => {
  // All upper cats filled at 0 except ones (open).  Max additional = 5 (ones×5).
  // upperSubtotal=0, maxAdditional=5, 0+5=5 < 63 → unreachable.
  const unreachState = withScores(makeGame([1, 1, 3, 4, 5], 1), {
    twos: 0,
    threes: 0,
    fours: 0,
    fives: 0,
    sixes: 0,
  });

  const infoSet = buildYachtInfoSet(unreachState, 0);

  it("bonusUnreachable = true", () => {
    expect(infoSet.bonusUnreachable).toBe(true);
  });

  it("bonusEarned = false", () => {
    expect(infoSet.bonusEarned).toBe(false);
  });

  it("toBonus > 0 (63 − 0 = 63)", () => {
    expect(infoSet.toBonus).toBe(63);
  });

  it("openCategories still contains ones", () => {
    expect(infoSet.openCategories.has("ones")).toBe(true);
  });
});

// ─── Scorecard nearly full ────────────────────────────────────────────────────

describe("buildYachtInfoSet — scorecard nearly full (1 category left)", () => {
  // Fill 12 of 13 categories; leave 'chance' open.
  const nearlyFull = withScores(makeGame([1, 2, 3, 4, 5], 1), {
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
    // chance left open
  });

  const infoSet = buildYachtInfoSet(nearlyFull, 200);

  it("categoriesRemaining = 1", () => {
    expect(infoSet.categoriesRemaining).toBe(1);
  });

  it("openCategories contains only 'chance'", () => {
    expect(infoSet.openCategories.has("chance")).toBe(true);
    expect(infoSet.openCategories.size).toBe(1);
  });

  it("filledCategories has 12 entries", () => {
    expect(infoSet.filledCategories.size).toBe(12);
  });

  it("bonusEarned = true (upperSubtotal = 63)", () => {
    expect(infoSet.bonusEarned).toBe(true);
    expect(infoSet.upperSubtotal).toBe(63);
  });

  it("scoreDelta = myScore - opponentScore (leading when positive)", () => {
    // opponent = 200; the filled scorecard has upper bonus + all lower cats → total ≈ 285
    // So scoreDelta ≈ 285 - 200 = 85 (positive = leading)
    expect(infoSet.scoreDelta).toBe(infoSet.myScore - 200);
    expect(infoSet.scoreDelta).toBeGreaterThan(0);
  });
});

// ─── Immutability ────────────────────────────────────────────────────────────

describe("buildYachtInfoSet — returned object is frozen", () => {
  const state = makeGame([1, 2, 3, 4, 5], 1);
  const infoSet = buildYachtInfoSet(state, 0);

  it("top-level object is frozen", () => {
    expect(Object.isFrozen(infoSet)).toBe(true);
  });

  it("dice array is frozen", () => {
    expect(Object.isFrozen(infoSet.dice)).toBe(true);
  });
});

// ─── rollsRemaining clamp ────────────────────────────────────────────────────

describe("buildYachtInfoSet — rollsRemaining is clamped to 0", () => {
  // rolls_used = 3 (all rolls used)
  const state = makeGame([1, 2, 3, 4, 5], 3);
  const infoSet = buildYachtInfoSet(state, 0);

  it("rollsRemaining = 0 when rolls_used = 3", () => {
    expect(infoSet.rollsRemaining).toBe(0);
  });
});

// ─── Fresh game ──────────────────────────────────────────────────────────────

describe("buildYachtInfoSet — fresh game (no rolls yet)", () => {
  const state = newGame();
  const infoSet = buildYachtInfoSet(state, 0);

  it("all 13 categories are open", () => {
    expect(infoSet.openCategories.size).toBe(13);
    expect(infoSet.filledCategories.size).toBe(0);
    expect(infoSet.categoriesRemaining).toBe(13);
  });

  it("rollsUsed = 0, rollsRemaining = 3", () => {
    expect(infoSet.rollsUsed).toBe(0);
    expect(infoSet.rollsRemaining).toBe(3);
  });

  it("upperSubtotal = 0, toBonus = 63", () => {
    expect(infoSet.upperSubtotal).toBe(0);
    expect(infoSet.toBonus).toBe(63);
  });

  it("bonusEarned = false, bonusUnreachable = false", () => {
    expect(infoSet.bonusEarned).toBe(false);
    // Max possible = 5+10+15+20+25+30 = 105 ≥ 63
    expect(infoSet.bonusUnreachable).toBe(false);
  });
});
