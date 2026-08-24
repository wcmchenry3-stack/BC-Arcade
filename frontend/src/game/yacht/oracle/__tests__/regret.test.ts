/**
 * regret.ts pure-function unit tests (#2244).
 *
 * Fixed EV fixtures — no oracle table involved, so these run fast and pin
 * down exact EV-loss/band arithmetic independent of the table's real values
 * (that end-to-end wiring is covered separately by regretOracle.test.ts).
 */

import {
  bandForLoss,
  categoryEvLoss,
  DEFAULT_EV_LOSS_BANDS,
  holdEvLoss,
  keptValuesFromHold,
  type EvLossBands,
} from "../regret";
import type { HoldEV } from "../oracle";
import type { Category } from "../../engine";

describe("bandForLoss — boundary tests at exact thresholds", () => {
  it("loss <= 0 is optimal", () => {
    expect(bandForLoss(0)).toBe("optimal");
    expect(bandForLoss(-0)).toBe("optimal");
  });

  it("0 < loss < minor is minor", () => {
    expect(bandForLoss(0.001)).toBe("minor");
    expect(bandForLoss(0.5)).toBe("minor");
    expect(bandForLoss(0.999)).toBe("minor");
  });

  it("loss exactly at the minor boundary (1) is mistake, not minor", () => {
    expect(bandForLoss(1)).toBe("mistake");
  });

  it("minor <= loss <= mistake is mistake", () => {
    expect(bandForLoss(1)).toBe("mistake");
    expect(bandForLoss(3)).toBe("mistake");
    expect(bandForLoss(5)).toBe("mistake");
  });

  it("loss exactly at the mistake boundary (5) is mistake, not blunder", () => {
    expect(bandForLoss(5)).toBe("mistake");
  });

  it("loss > mistake is blunder", () => {
    expect(bandForLoss(5.0001)).toBe("blunder");
    expect(bandForLoss(10)).toBe("blunder");
  });

  it("respects custom bands", () => {
    const bands: EvLossBands = { minor: 2, mistake: 8 };
    expect(bandForLoss(1.5, bands)).toBe("minor");
    expect(bandForLoss(2, bands)).toBe("mistake");
    expect(bandForLoss(8, bands)).toBe("mistake");
    expect(bandForLoss(8.1, bands)).toBe("blunder");
  });

  it("DEFAULT_EV_LOSS_BANDS matches the documented {minor: 1, mistake: 5}", () => {
    expect(DEFAULT_EV_LOSS_BANDS).toEqual({ minor: 1, mistake: 5 });
  });
});

describe("keptValuesFromHold", () => {
  it("returns sorted kept values, parallel-indexed to the hold mask", () => {
    expect(keptValuesFromHold([1, 6, 2, 6, 3], [true, false, false, true, true])).toEqual([
      1, 3, 6,
    ]);
  });

  it("returns an empty array when nothing is held", () => {
    expect(keptValuesFromHold([1, 2, 3, 4, 5], [false, false, false, false, false])).toEqual([]);
  });

  it("returns all dice sorted when everything is held", () => {
    expect(keptValuesFromHold([5, 1, 3, 2, 4], [true, true, true, true, true])).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });
});

describe("holdEvLoss — pure core against a fixed HoldEV fixture", () => {
  const dice = [1, 1, 2, 3, 6];
  const holdEVs: readonly HoldEV[] = [
    { hold: [], ev: 5 },
    { hold: [1, 1], ev: 10 },
    { hold: [1, 1, 6], ev: 15 }, // the optimal option in this fixture
    { hold: [6], ev: 8 },
  ];

  it("the optimal hold nets exactly zero EV-loss (band: optimal)", () => {
    // Positions 0,1,4 -> values [1,1,6], matching holdEVs[2].
    const result = holdEvLoss(holdEVs, dice, [true, true, false, false, true]);
    expect(result.decisionType).toBe("hold");
    expect(result.chosenEV).toBe(15);
    expect(result.optimalEV).toBe(15);
    expect(result.evLoss).toBe(0);
    expect(result.band).toBe("optimal");
    expect(result.chosenHold).toEqual([1, 1, 6]);
    expect(result.optimalHold).toEqual([1, 1, 6]);
  });

  it("a suboptimal hold reports the exact EV gap and its band", () => {
    // Positions 0,1 -> values [1,1], ev=10; optimal is 15 -> loss=5 -> "mistake" (boundary-inclusive).
    const result = holdEvLoss(holdEVs, dice, [true, true, false, false, false]);
    expect(result.chosenEV).toBe(10);
    expect(result.optimalEV).toBe(15);
    expect(result.evLoss).toBe(5);
    expect(result.band).toBe("mistake");
    expect(result.optimalHold).toEqual([1, 1, 6]);
  });

  it("holding position order doesn't matter — only the resulting value multiset", () => {
    // Three 1s at positions 0,1,2: holding any two of them yields the same
    // [1,1] value-multiset, matching the same fixture entry regardless of
    // which two positions were actually held.
    const dupDice = [1, 1, 1, 2, 3];
    const dupHoldEVs: readonly HoldEV[] = [
      { hold: [1, 1], ev: 10 },
      { hold: [1, 1, 1], ev: 15 },
    ];
    const viaPositions01 = holdEvLoss(dupHoldEVs, dupDice, [true, true, false, false, false]);
    const viaPositions02 = holdEvLoss(dupHoldEVs, dupDice, [true, false, true, false, false]);
    const viaPositions12 = holdEvLoss(dupHoldEVs, dupDice, [false, true, true, false, false]);
    expect(viaPositions01).toEqual(viaPositions02);
    expect(viaPositions01).toEqual(viaPositions12);
    expect(viaPositions01.chosenEV).toBe(10);
  });

  it("throws when the chosen hold isn't among the legal options (fixture/engine mismatch)", () => {
    expect(() => holdEvLoss(holdEVs, dice, [false, false, true, false, false])).toThrow(
      /not among the/
    );
  });

  it("applies custom bands", () => {
    const result = holdEvLoss(holdEVs, dice, [true, true, false, false, false], {
      minor: 10,
      mistake: 20,
    });
    expect(result.evLoss).toBe(5);
    expect(result.band).toBe("minor");
  });
});

describe("categoryEvLoss — pure core against a fixed category-EV fixture", () => {
  const categoryEVs: Partial<Record<Category, number>> = {
    ones: 2,
    threes: 9,
    three_of_a_kind: 20,
    chance: 20,
    full_house: 0,
  };

  it("the optimal category nets exactly zero EV-loss (band: optimal)", () => {
    const result = categoryEvLoss(categoryEVs, "chance");
    expect(result.decisionType).toBe("category");
    expect(result.chosenEV).toBe(20);
    expect(result.optimalEV).toBe(20);
    expect(result.evLoss).toBe(0);
    expect(result.band).toBe("optimal");
    // Both "three_of_a_kind" and "chance" tie at 20 — whichever the loop visits
    // first (Object.entries order) is reported; only assert it's one of the ties.
    expect(["three_of_a_kind", "chance"]).toContain(result.optimalCategory);
  });

  it("a blunder-tier category reports the exact EV gap", () => {
    const result = categoryEvLoss(categoryEVs, "ones");
    expect(result.chosenEV).toBe(2);
    expect(result.optimalEV).toBe(20);
    expect(result.evLoss).toBe(18);
    expect(result.band).toBe("blunder");
  });

  it("throws when the chosen category isn't legal in this fixture", () => {
    expect(() => categoryEvLoss(categoryEVs, "yacht")).toThrow(/not among the legal categories/);
  });
});

describe("categoryEvLoss — Joker-turn fixture (fixed EV data, independent of #2242's fix)", () => {
  // On a Joker turn, Full House/Small Straight/Large Straight score their
  // fixed Joker values regardless of dice — categoryEvLoss itself is agnostic
  // to *how* the EVs were priced, so this fixture just confirms it grades a
  // Joker-priced EV map correctly, matching what optimalCategoryEVs (Joker-aware
  // via stateKey.ts) would hand it. End-to-end Joker pricing through the real
  // oracle is covered by regretOracle.test.ts.
  const jokerCategoryEVs: Partial<Record<Category, number>> = {
    full_house: 125, // 25 (fixed Joker value) + 100 (yacht/joker bonus), successor VTG folded to 0 in this fixture
    small_straight: 130,
    large_straight: 140, // optimal
    fives: 25,
  };

  it("grades the optimal Joker-priced category as zero loss", () => {
    const result = categoryEvLoss(jokerCategoryEVs, "large_straight");
    expect(result.evLoss).toBe(0);
    expect(result.band).toBe("optimal");
  });

  it("grades a suboptimal Joker-turn category with the correct EV gap", () => {
    const result = categoryEvLoss(jokerCategoryEVs, "fives");
    expect(result.evLoss).toBe(115);
    expect(result.band).toBe("blunder");
    expect(result.optimalCategory).toBe("large_straight");
  });
});
