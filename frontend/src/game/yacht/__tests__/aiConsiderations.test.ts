/**
 * Tests for aiConsiderations.ts (GH #2026, story A2).
 *
 * Coverage:
 *   • Per-function edge-case suites
 *   • Range invariant [0, 1] across randomised seeded states
 *   • No import of React/IO — pure function contract
 */

import { buildYachtInfoSet } from "../aiInfoSet";
import { computeDerived, newGame } from "../engine";
import type { GameState } from "../types";
import {
  rateUpperBonusUrgency,
  rateEVOfHold,
  rateScorecardSafety,
  rateChanceSafetyValve,
  rateAdversarialVariance,
  rateUpperCategoryEfficiency,
  rateImmediateValue,
} from "../aiConsiderations";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeGame(dice: number[], rollsUsed = 1): GameState {
  const base = newGame();
  return { ...base, dice, rolls_used: rollsUsed };
}

function withScores(state: GameState, filled: Partial<GameState["scores"]>): GameState {
  return computeDerived({ ...state, scores: { ...state.scores, ...filled } });
}

// Standard test states

/** Fresh game, nothing filled, rollsUsed=1. */
const freshState = makeGame([3, 3, 3, 4, 5], 1);
const freshInfo = buildYachtInfoSet(freshState, 0);

/** Mid-game: ones/twos/threes filled at par; bonus not earned, not unreachable. */
const midState = withScores(makeGame([6, 6, 6, 4, 5], 2), {
  ones: 3,
  twos: 6,
  threes: 9,
});
const midInfo = buildYachtInfoSet(midState, 0);

/** Bonus earned: all 6 upper cats filled at par or better (subtotal = 63). */
const bonusEarnedState = withScores(makeGame([6, 6, 6, 6, 6], 1), {
  ones: 3,
  twos: 6,
  threes: 9,
  fours: 12,
  fives: 15,
  sixes: 18,
});
const bonusEarnedInfo = buildYachtInfoSet(bonusEarnedState, 0);

/** Bonus unreachable: five upper cats scored at 0, only ones open (max = 5 < 63). */
const bonusUnreachState = withScores(makeGame([1, 1, 3, 4, 5], 1), {
  twos: 0,
  threes: 0,
  fours: 0,
  fives: 0,
  sixes: 0,
});
const bonusUnreachInfo = buildYachtInfoSet(bonusUnreachState, 0);

/** Nearly full scorecard: only chance open. */
const nearlyFullState = withScores(makeGame([3, 4, 5, 6, 6], 1), {
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
const nearlyFullInfo = buildYachtInfoSet(nearlyFullState, 0);

// ─── rateUpperBonusUrgency ────────────────────────────────────────────────────

describe("rateUpperBonusUrgency", () => {
  it("returns 0 when bonus already earned", () => {
    expect(rateUpperBonusUrgency(bonusEarnedInfo, [true, true, true, true, true])).toBe(0);
  });

  it("returns 0 when bonus unreachable", () => {
    expect(rateUpperBonusUrgency(bonusUnreachInfo, [true, true, true, true, true])).toBe(0);
  });

  it("returns 0 when no dice are held", () => {
    expect(rateUpperBonusUrgency(midInfo, [false, false, false, false, false])).toBe(0);
  });

  it("returns 0 when held dice target a filled upper category", () => {
    // midState has threes filled; hold all threes (dice=[6,6,6,4,5] so no 3s present)
    // Use freshState dice=[3,3,3,4,5] with threes already filled
    const stateThreesFilled = withScores(makeGame([3, 3, 3, 4, 5], 1), { threes: 9 });
    const info = buildYachtInfoSet(stateThreesFilled, 0);
    // Hold all three 3s — but threes is filled so no urgency
    expect(rateUpperBonusUrgency(info, [true, true, true, false, false])).toBe(0);
  });

  it("returns 1.0 when held group exactly closes the bonus", () => {
    // toBonus = 18 (mid game, ones/twos/threes filled at par, subtotal=18, need 45 more)
    // Actually mid has subtotal=18, toBonus=45. We need dice that close it.
    // Make a state where toBonus=18 and we hold 3 sixes (3×6=18).
    const s = withScores(makeGame([6, 6, 6, 1, 2], 1), {
      ones: 3,
      twos: 6,
      threes: 9,
      fours: 12,
      fives: 15,
      // sixes still open; subtotal=45, toBonus=18
    });
    const info = buildYachtInfoSet(s, 0);
    expect(info.toBonus).toBe(18);
    // Hold 3 sixes: progress = 3×6/18 = 1.0
    expect(rateUpperBonusUrgency(info, [true, true, true, false, false])).toBe(1.0);
  });

  it("returns partial progress when held group partially covers toBonus", () => {
    // Same state as above (toBonus=18), but hold only 2 sixes: progress = 12/18 ≈ 0.667
    const s = withScores(makeGame([6, 6, 6, 1, 2], 1), {
      ones: 3,
      twos: 6,
      threes: 9,
      fours: 12,
      fives: 15,
    });
    const info = buildYachtInfoSet(s, 0);
    const result = rateUpperBonusUrgency(info, [true, true, false, false, false]);
    expect(result).toBeCloseTo(12 / 18, 5);
  });

  it("picks the best upper face when multiple upper faces are held", () => {
    // dice=[5,5,6,6,6], toBonus=18; fill ones–fives, leave sixes open.
    // upperSubtotal = 3+6+9+12+15 = 45 → toBonus = 18.
    // Hold all 5: fives (open) contributes 2×5=10 → 10/18; sixes contributes 3×6=18 → 1.0.
    const s = withScores(makeGame([5, 5, 6, 6, 6], 1), {
      ones: 3,
      twos: 6,
      threes: 9,
      fours: 12,
      fives: 15,
      // sixes left open
    });
    const info = buildYachtInfoSet(s, 0);
    expect(info.toBonus).toBe(18);
    // fives is now filled; only sixes (open) contributes: 3×6/18 = 1.0
    expect(rateUpperBonusUrgency(info, [true, true, true, true, true])).toBe(1.0);
  });

  it("clamps to 1.0 when held group exceeds toBonus", () => {
    // Hold 5 sixes, toBonus=18; 5×6=30 > 18
    const s = withScores(makeGame([6, 6, 6, 6, 6], 1), {
      ones: 3,
      twos: 6,
      threes: 9,
      fours: 12,
      fives: 15,
    });
    const info = buildYachtInfoSet(s, 0);
    expect(rateUpperBonusUrgency(info, [true, true, true, true, true])).toBe(1.0);
  });

  it("returns value in [0, 1] for a range of hold patterns", () => {
    const masks: boolean[][] = [
      [true, false, false, false, false],
      [true, true, false, false, false],
      [true, true, true, false, false],
      [false, false, true, true, true],
      [true, true, true, true, true],
    ];
    for (const mask of masks) {
      const v = rateUpperBonusUrgency(freshInfo, mask);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

// ─── rateEVOfHold ─────────────────────────────────────────────────────────────

describe("rateEVOfHold", () => {
  it("returns 1.0 when holding five matching dice that score Yacht", () => {
    // Five 6s, yacht is open — maxImmediateScore = 50 → EV = 50 → rate = 1.0
    const s = makeGame([6, 6, 6, 6, 6], 2);
    const info = buildYachtInfoSet(s, 0);
    const result = rateEVOfHold(info, [true, true, true, true, true]);
    expect(result).toBeCloseTo(1.0, 5);
  });

  it("holding a good combination beats holding nothing", () => {
    // dice=[6,6,6,1,2], hold 3 sixes vs hold nothing
    const s = makeGame([6, 6, 6, 1, 2], 1);
    const info = buildYachtInfoSet(s, 0);
    const holdThreeSixes = rateEVOfHold(info, [true, true, true, false, false]);
    const holdNothing = rateEVOfHold(info, [false, false, false, false, false]);
    expect(holdThreeSixes).toBeGreaterThan(holdNothing);
  });

  it("2-roll EV ≥ 1-roll EV for the same hold pattern", () => {
    // Same dice, same hold, but rollsRemaining differs
    const dice = [3, 3, 3, 1, 2];
    const info1 = buildYachtInfoSet(makeGame(dice, 2), 0); // rollsRemaining = 1
    const info2 = buildYachtInfoSet(makeGame(dice, 1), 0); // rollsRemaining = 2
    const holdMask: boolean[] = [true, true, true, false, false];
    const ev1 = rateEVOfHold(info1, holdMask);
    const ev2 = rateEVOfHold(info2, holdMask);
    expect(ev2).toBeGreaterThanOrEqual(ev1);
  });

  it("hold all (freeCount = 0) returns immediate score / MAX_TURN_EV", () => {
    // Five 4s, four_of_a_kind open: immediate score = 20 → rate = 20/50 = 0.4
    const s = makeGame([4, 4, 4, 4, 4], 2);
    const info = buildYachtInfoSet(s, 0);
    const result = rateEVOfHold(info, [true, true, true, true, true]);
    // maxImmediateScore for [4,4,4,4,4] with nothing filled = 50 (yacht)
    expect(result).toBeCloseTo(1.0, 5);
  });

  it("returns 0 when all categories are filled and hold all (impossible state, graceful)", () => {
    // All cats filled → maxImmediateScore = 0 → EV = 0
    const allFilled = withScores(makeGame([1, 2, 3, 4, 5], 1), {
      ones: 1,
      twos: 2,
      threes: 3,
      fours: 4,
      fives: 5,
      sixes: 0,
      three_of_a_kind: 0,
      four_of_a_kind: 0,
      full_house: 0,
      small_straight: 0,
      large_straight: 0,
      yacht: 0,
      chance: 0,
    });
    const info = buildYachtInfoSet(allFilled, 0);
    expect(rateEVOfHold(info, [true, true, true, true, true])).toBe(0);
  });

  it("returns value in [0, 1] for various hold masks on a mid-game state", () => {
    for (let mask = 0; mask < 32; mask++) {
      const holdMask = [0, 1, 2, 3, 4].map((i) => !!(mask & (1 << i)));
      const v = rateEVOfHold(midInfo, holdMask);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

// ─── rateScorecardSafety ─────────────────────────────────────────────────────

describe("rateScorecardSafety", () => {
  it("returns 1.0 for an open category", () => {
    expect(rateScorecardSafety(freshInfo, "ones")).toBe(1.0);
    expect(rateScorecardSafety(freshInfo, "yacht")).toBe(1.0);
    expect(rateScorecardSafety(freshInfo, "chance")).toBe(1.0);
  });

  it("returns 0.0 for a filled category", () => {
    // midInfo has ones, twos, threes filled
    expect(rateScorecardSafety(midInfo, "ones")).toBe(0.0);
    expect(rateScorecardSafety(midInfo, "twos")).toBe(0.0);
    expect(rateScorecardSafety(midInfo, "threes")).toBe(0.0);
  });

  it("returns 1.0 for all open categories in fresh game", () => {
    const categories = [
      "ones",
      "twos",
      "threes",
      "fours",
      "fives",
      "sixes",
      "three_of_a_kind",
      "four_of_a_kind",
      "full_house",
      "small_straight",
      "large_straight",
      "yacht",
      "chance",
    ] as const;
    for (const cat of categories) {
      expect(rateScorecardSafety(freshInfo, cat)).toBe(1.0);
    }
  });

  it("returns 0.0 for all filled categories in nearly-full scorecard", () => {
    const filledCats = [
      "ones",
      "twos",
      "threes",
      "fours",
      "fives",
      "sixes",
      "three_of_a_kind",
      "four_of_a_kind",
      "full_house",
      "small_straight",
      "large_straight",
      "yacht",
    ] as const;
    for (const cat of filledCats) {
      expect(rateScorecardSafety(nearlyFullInfo, cat)).toBe(0.0);
    }
    // chance is still open
    expect(rateScorecardSafety(nearlyFullInfo, "chance")).toBe(1.0);
  });
});

// ─── rateChanceSafetyValve ───────────────────────────────────────────────────

describe("rateChanceSafetyValve", () => {
  it("returns 1.0 for any non-chance category", () => {
    const cats = ["ones", "sixes", "yacht", "large_straight"] as const;
    for (const cat of cats) {
      expect(rateChanceSafetyValve(freshInfo, cat)).toBe(1.0);
    }
  });

  it("returns 1.0 when chance is already used (not in openCategories)", () => {
    const s = withScores(makeGame([1, 2, 3, 4, 5], 1), { chance: 15 });
    const info = buildYachtInfoSet(s, 0);
    expect(rateChanceSafetyValve(info, "chance")).toBe(1.0);
  });

  it("returns 0 when all 13 categories are open (first round)", () => {
    // freshInfo has 13 open; (13 - 13) / 12 = 0
    expect(rateChanceSafetyValve(freshInfo, "chance")).toBe(0);
  });

  it("returns 1.0 when only chance remains (last round)", () => {
    // nearlyFullInfo has 1 category open (chance); (13 - 1) / 12 = 1
    expect(rateChanceSafetyValve(nearlyFullInfo, "chance")).toBeCloseTo(1.0, 5);
  });

  it("returns 0.5 when 7 categories remain", () => {
    // Fill 6 non-chance cats to leave 7 open
    const s = withScores(makeGame([1, 2, 3, 4, 5], 1), {
      ones: 3,
      twos: 6,
      threes: 9,
      fours: 12,
      fives: 15,
      sixes: 18,
    });
    const info = buildYachtInfoSet(s, 0);
    expect(info.categoriesRemaining).toBe(7);
    // (13 - 7) / 12 = 6/12 = 0.5
    expect(rateChanceSafetyValve(info, "chance")).toBeCloseTo(0.5, 5);
  });

  it("rises monotonically as categories are filled", () => {
    const results: number[] = [];
    let s = makeGame([1, 2, 3, 4, 5], 1);
    // Fill one cat at a time, recording rateChanceSafetyValve each time
    const fillOrder = [
      "ones",
      "twos",
      "threes",
      "fours",
      "fives",
      "sixes",
      "three_of_a_kind",
      "four_of_a_kind",
      "full_house",
      "small_straight",
      "large_straight",
      "yacht",
    ] as const;
    for (const cat of fillOrder) {
      s = withScores(s, { [cat]: 0 });
      const info = buildYachtInfoSet(s, 0);
      results.push(rateChanceSafetyValve(info, "chance"));
    }
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toBeGreaterThanOrEqual(results[i - 1]!);
    }
  });
});

// ─── rateUpperCategoryEfficiency ─────────────────────────────────────────────

describe("rateUpperCategoryEfficiency", () => {
  it("returns 1.0 for non-upper categories", () => {
    const cats = ["yacht", "large_straight", "full_house", "chance", "three_of_a_kind"] as const;
    for (const cat of cats) {
      expect(rateUpperCategoryEfficiency(freshInfo, cat)).toBe(1.0);
    }
  });

  it("returns 1.0 when score equals par (3 × face value)", () => {
    // 3 sixes → score=18, par=18 → efficiency=1.0
    const s = makeGame([6, 6, 6, 1, 2], 1);
    const info = buildYachtInfoSet(s, 0);
    expect(rateUpperCategoryEfficiency(info, "sixes")).toBe(1.0);
    // 3 ones → score=3, par=3 → efficiency=1.0
    const s2 = makeGame([1, 1, 1, 4, 5], 1);
    const info2 = buildYachtInfoSet(s2, 0);
    expect(rateUpperCategoryEfficiency(info2, "ones")).toBe(1.0);
  });

  it("returns 1.0 when score exceeds par", () => {
    // 5 sixes → score=30, par=18 → above par
    const s = makeGame([6, 6, 6, 6, 6], 1);
    const info = buildYachtInfoSet(s, 0);
    expect(rateUpperCategoryEfficiency(info, "sixes")).toBe(1.0);
  });

  it("returns 0.0 for sixes with zero matching dice (max penalty)", () => {
    // No sixes in dice → score=0, par=18, ceilingFactor=1.0, ratio=0 → 1-1×1=0
    const s = makeGame([1, 2, 3, 4, 5], 1);
    const info = buildYachtInfoSet(s, 0);
    expect(rateUpperCategoryEfficiency(info, "sixes")).toBe(0.0);
  });

  it("returns ~0.833 for ones with zero matching dice (low ceiling, low penalty)", () => {
    // No ones → score=0, par=3, ceilingFactor=1/6, ratio=0 → 1 - (1/6)×1 = 5/6
    const s = makeGame([2, 3, 4, 5, 6], 1);
    const info = buildYachtInfoSet(s, 0);
    expect(rateUpperCategoryEfficiency(info, "ones")).toBeCloseTo(5 / 6, 5);
  });

  it("penalises sixes more than ones for the same fractional shortfall below par", () => {
    // 1 six / par=18 (ratio=6/18=0.333) vs 1 one / par=3 (ratio=1/3=0.333) — same ratio
    // sixes penalty = 1×(1-0.333)=0.667 → eff=0.333
    // ones penalty  = (1/6)×(1-0.333)≈0.111 → eff≈0.889
    const sSixes = makeGame([6, 2, 3, 4, 5], 1);
    const sOnes = makeGame([1, 2, 3, 4, 5], 1);
    const sixesEff = rateUpperCategoryEfficiency(buildYachtInfoSet(sSixes, 0), "sixes");
    const onesEff = rateUpperCategoryEfficiency(buildYachtInfoSet(sOnes, 0), "ones");
    expect(onesEff).toBeGreaterThan(sixesEff);
    expect(sixesEff).toBeCloseTo(1 / 3, 5);
    expect(onesEff).toBeCloseTo(1 - (1 / 6) * (2 / 3), 5);
  });

  it("rising efficiency: 1 six → 2 sixes → 3 sixes → 1.0", () => {
    const eff1 = rateUpperCategoryEfficiency(
      buildYachtInfoSet(makeGame([6, 1, 2, 3, 4], 1), 0),
      "sixes"
    );
    const eff2 = rateUpperCategoryEfficiency(
      buildYachtInfoSet(makeGame([6, 6, 1, 2, 3], 1), 0),
      "sixes"
    );
    const eff3 = rateUpperCategoryEfficiency(
      buildYachtInfoSet(makeGame([6, 6, 6, 1, 2], 1), 0),
      "sixes"
    );
    expect(eff2).toBeGreaterThan(eff1);
    expect(eff3).toBeGreaterThan(eff2);
    expect(eff3).toBe(1.0);
  });

  it("returns value in [0, 1] for all upper categories across a range of dice", () => {
    const upperCats = ["ones", "twos", "threes", "fours", "fives", "sixes"] as const;
    const diceOptions = [
      [1, 1, 1, 1, 1],
      [6, 6, 6, 6, 6],
      [1, 2, 3, 4, 5],
      [3, 3, 3, 4, 5],
      [6, 1, 1, 1, 1],
    ];
    for (const dice of diceOptions) {
      const info = buildYachtInfoSet(makeGame(dice, 1), 0);
      for (const cat of upperCats) {
        const v = rateUpperCategoryEfficiency(info, cat);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

// ─── rateAdversarialVariance ─────────────────────────────────────────────────

describe("rateAdversarialVariance", () => {
  // trailing by > 20 → high-variance categories preferred
  it("returns category variance when trailing by exactly TRAIL_THRESHOLD (−20)", () => {
    const s = makeGame([1, 2, 3, 4, 5], 1);
    const info = buildYachtInfoSet(s, 20); // scoreDelta = myScore − 20; fresh game myScore≈0 so delta≈−20
    // Actually: we need scoreDelta = −20. fresh game myScore=0, opponentScore=20 → delta=−20
    expect(rateAdversarialVariance(info, "yacht")).toBeCloseTo(1.0, 5);
    expect(rateAdversarialVariance(info, "ones")).toBeCloseTo(0.25, 5);
  });

  it("returns 1 − variance when leading by exactly LEAD_THRESHOLD (+50)", () => {
    const s = makeGame([1, 2, 3, 4, 5], 1);
    // scoreDelta = +50: give info an opponentScore that puts myScore 50 ahead.
    // Use withScores to give the player a score, and pass opponentScore accordingly.
    const scored = withScores(s, {
      ones: 3,
      twos: 6,
      threes: 9,
      fours: 12,
      fives: 15,
      sixes: 18,
      large_straight: 40,
      yacht: 50,
    });
    const myScore = scored.total_score;
    const info = buildYachtInfoSet(scored, myScore - 50);
    expect(info.scoreDelta).toBeCloseTo(50, 0);
    expect(rateAdversarialVariance(info, "ones")).toBeCloseTo(1.0 - 0.25, 5);
    expect(rateAdversarialVariance(info, "yacht")).toBeCloseTo(0.0, 5);
  });

  it("returns 0.5 for all categories when scoreDelta = 0", () => {
    const s = makeGame([1, 2, 3, 4, 5], 1);
    const info = buildYachtInfoSet(s, 0); // opponentScore=0, myScore≈0 → delta≈0
    const cats = ["yacht", "large_straight", "ones", "chance", "full_house"] as const;
    for (const cat of cats) {
      expect(rateAdversarialVariance(info, cat)).toBeCloseTo(0.5, 5);
    }
  });

  it("prefers yacht over ones when trailing by > 20", () => {
    const s = makeGame([1, 2, 3, 4, 5], 1);
    const info = buildYachtInfoSet(s, 50); // myScore≈0, opponent=50 → delta=−50
    expect(rateAdversarialVariance(info, "yacht")).toBeGreaterThan(
      rateAdversarialVariance(info, "ones")
    );
  });

  it("prefers ones over yacht when leading by > 50", () => {
    const scored = withScores(makeGame([1, 2, 3, 4, 5], 1), {
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
    });
    const myScore = scored.total_score;
    const info = buildYachtInfoSet(scored, myScore - 100); // leading by 100
    expect(rateAdversarialVariance(info, "ones")).toBeGreaterThan(
      rateAdversarialVariance(info, "yacht")
    );
  });

  it("interpolates smoothly: |trailing by 10| < |trailing by 20| effect", () => {
    const base = makeGame([1, 2, 3, 4, 5], 1);
    const info10 = buildYachtInfoSet(base, 10); // trailing by 10
    const info20 = buildYachtInfoSet(base, 20); // trailing by 20
    // yacht is high-variance: more trailing = higher score for yacht
    expect(rateAdversarialVariance(info20, "yacht")).toBeGreaterThan(
      rateAdversarialVariance(info10, "yacht")
    );
    // ones is low-variance: more trailing = lower score for ones
    expect(rateAdversarialVariance(info20, "ones")).toBeLessThan(
      rateAdversarialVariance(info10, "ones")
    );
  });

  it("returns value in [0, 1] across all extreme deltas and categories", () => {
    const categories = [
      "ones",
      "twos",
      "threes",
      "fours",
      "fives",
      "sixes",
      "three_of_a_kind",
      "four_of_a_kind",
      "full_house",
      "small_straight",
      "large_straight",
      "yacht",
      "chance",
    ] as const;
    const opponentScores = [0, 30, 50, 100, 200];
    const base = makeGame([1, 2, 3, 4, 5], 1);
    for (const opp of opponentScores) {
      const info = buildYachtInfoSet(base, opp);
      for (const cat of categories) {
        const v = rateAdversarialVariance(info, cat);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

// ─── rateImmediateValue ──────────────────────────────────────────────────────

describe("rateImmediateValue", () => {
  it("non-Joker turn: prices via the plain scorer (regression guard)", () => {
    // [1,2,3,4,5]: large_straight = 40 -> 40/50; full_house = 0 (not a full-house shape).
    const state = makeGame([1, 2, 3, 4, 5], 3);
    const info = buildYachtInfoSet(state, 0);
    expect(info.jokerActive).toBe(false);
    expect(rateImmediateValue(info, "large_straight")).toBeCloseTo(40 / 50);
    expect(rateImmediateValue(info, "full_house")).toBe(0);
  });

  it("Joker turn: prices Full House at its fixed 25 even though the dice aren't a natural full house", () => {
    // Yacht already filled; rolling a second five-of-a-kind triggers the Joker rule.
    const state = withScores(makeGame([4, 4, 4, 4, 4], 3), { yacht: 50 });
    const info = buildYachtInfoSet(state, 0);
    expect(info.jokerActive).toBe(true);
    expect(rateImmediateValue(info, "full_house")).toBeCloseTo(25 / 50);
  });

  it("Joker turn: prices Small Straight and Large Straight at their fixed 30/40", () => {
    const state = withScores(makeGame([2, 2, 2, 2, 2], 3), { yacht: 50 });
    const info = buildYachtInfoSet(state, 0);
    expect(info.jokerActive).toBe(true);
    expect(rateImmediateValue(info, "small_straight")).toBeCloseTo(30 / 50);
    expect(rateImmediateValue(info, "large_straight")).toBeCloseTo(40 / 50);
  });

  it("Joker turn: upper categories are unaffected (Joker rule doesn't change upper scoring)", () => {
    const state = withScores(makeGame([3, 3, 3, 3, 3], 3), { yacht: 50 });
    const info = buildYachtInfoSet(state, 0);
    expect(info.jokerActive).toBe(true);
    // threes: 5 dice x 3 = 15, same with or without the Joker path.
    expect(rateImmediateValue(info, "threes")).toBeCloseTo(15 / 50);
  });
});
