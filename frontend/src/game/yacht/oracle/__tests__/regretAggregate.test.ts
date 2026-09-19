/**
 * regretAggregate.ts unit tests (#2244) — aggregation over a synthetic
 * decision log. No oracle involved: `RegretRecord`s are built directly so
 * summary/tail/significance math can be pinned to hand-computable numbers.
 */

import { bandForLoss, type CategoryEvLossResult, type HoldEvLossResult } from "../regret";
import {
  blundersPer1000,
  describeRegretRecord,
  meanDiffSignificant,
  summarizeRegret,
  worstDecisions,
  type RegretRecord,
} from "../regretAggregate";
import type { AiDifficulty } from "../../types";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function holdRecord(
  evLoss: number,
  opts: { difficulty?: AiDifficulty; round?: number } = {}
): RegretRecord {
  const result: HoldEvLossResult = {
    decisionType: "hold",
    evLoss,
    band: bandForLoss(evLoss),
    optimalEV: 20 + evLoss,
    chosenEV: 20,
    chosenHold: [1, 1],
    optimalHold: [1, 1, 6],
  };
  return {
    result,
    difficulty: opts.difficulty ?? "medium",
    round: opts.round ?? 1,
    dice: [1, 1, 2, 3, 6],
  };
}

function categoryRecord(
  evLoss: number,
  opts: { difficulty?: AiDifficulty; round?: number } = {}
): RegretRecord {
  const result: CategoryEvLossResult = {
    decisionType: "category",
    evLoss,
    band: bandForLoss(evLoss),
    optimalEV: 30 + evLoss,
    chosenEV: 30,
    chosenCategory: "ones",
    optimalCategory: "chance",
  };
  return {
    result,
    difficulty: opts.difficulty ?? "medium",
    round: opts.round ?? 1,
    dice: [1, 1, 2, 3, 4],
  };
}

// ---------------------------------------------------------------------------
// summarizeRegret
// ---------------------------------------------------------------------------

describe("summarizeRegret", () => {
  it("computes overall mean EV-loss and per-type splits from a mixed decision log", () => {
    const records: RegretRecord[] = [
      holdRecord(0), // optimal
      holdRecord(2), // mistake
      categoryRecord(0), // optimal
      categoryRecord(6), // blunder
    ];

    const summary = summarizeRegret(records);
    expect(summary.n).toBe(4);
    expect(summary.meanEvLoss).toBeCloseTo((0 + 2 + 0 + 6) / 4);

    expect(summary.byType.hold.n).toBe(2);
    expect(summary.byType.hold.meanEvLoss).toBeCloseTo(1);
    expect(summary.byType.hold.bandCounts).toEqual({
      optimal: 1,
      minor: 0,
      mistake: 1,
      blunder: 0,
    });

    expect(summary.byType.category.n).toBe(2);
    expect(summary.byType.category.meanEvLoss).toBeCloseTo(3);
    expect(summary.byType.category.bandCounts).toEqual({
      optimal: 1,
      minor: 0,
      mistake: 0,
      blunder: 1,
    });
  });

  it("returns zeroed summaries for an empty log, not NaN", () => {
    const summary = summarizeRegret([]);
    expect(summary.n).toBe(0);
    expect(summary.meanEvLoss).toBe(0);
    expect(summary.byType.hold.n).toBe(0);
    expect(summary.byType.hold.meanEvLoss).toBe(0);
    expect(summary.byType.category.n).toBe(0);
  });

  it("handles a log with only one decision type present", () => {
    const summary = summarizeRegret([holdRecord(1), holdRecord(3)]);
    expect(summary.byType.hold.n).toBe(2);
    expect(summary.byType.category.n).toBe(0);
    expect(summary.byType.category.meanEvLoss).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// worstDecisions / describeRegretRecord / blundersPer1000
// ---------------------------------------------------------------------------

describe("worstDecisions", () => {
  it("returns the top-k records sorted by descending EV-loss", () => {
    const records = [holdRecord(1), categoryRecord(9), holdRecord(0), categoryRecord(4)];
    const worst = worstDecisions(records, 2);
    expect(worst.map((r) => r.result.evLoss)).toEqual([9, 4]);
  });

  it("returns fewer than k records when the log is smaller than k", () => {
    const records = [holdRecord(1)];
    expect(worstDecisions(records, 5)).toHaveLength(1);
  });

  it("does not mutate the input array", () => {
    const records = [holdRecord(1), categoryRecord(9)];
    const copy = [...records];
    worstDecisions(records, 1);
    expect(records).toEqual(copy);
  });
});

describe("describeRegretRecord", () => {
  it("formats a hold record with dice, chosen vs optimal hold, and band", () => {
    const line = describeRegretRecord(holdRecord(5, { difficulty: "hard", round: 7 }));
    expect(line).toContain("[hard] round 7 hold:");
    expect(line).toContain("chose=[1,1]");
    expect(line).toContain("optimal=[1,1,6]");
    expect(line).toContain("evLoss=5.00");
    expect(line).toContain("(mistake)");
  });

  it("formats a category record with dice, chosen vs optimal category, and band", () => {
    const line = describeRegretRecord(categoryRecord(6, { difficulty: "easy", round: 3 }));
    expect(line).toContain("[easy] round 3 category:");
    expect(line).toContain("chose=ones");
    expect(line).toContain("optimal=chance");
    expect(line).toContain("(blunder)");
  });
});

describe("blundersPer1000", () => {
  it("normalizes the blunder rate per 1,000 decisions", () => {
    // 1 blunder (loss=6) out of 4 decisions -> 250 per 1,000.
    const records = [holdRecord(0), holdRecord(1), categoryRecord(6), categoryRecord(0.5)];
    expect(blundersPer1000(records)).toBe(250);
  });

  it("returns 0 for an empty log", () => {
    expect(blundersPer1000([])).toBe(0);
  });

  it("returns 0 when no decision is a blunder", () => {
    expect(blundersPer1000([holdRecord(0), holdRecord(0.5)])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// meanDiffSignificant
// ---------------------------------------------------------------------------

describe("meanDiffSignificant", () => {
  it("reports a clearly-separated, low-variance pair as significant", () => {
    const a = Array.from({ length: 200 }, () => 5); // constant, mean 5
    const b = Array.from({ length: 200 }, () => 1); // constant, mean 1
    const t = meanDiffSignificant(a, b);
    expect(t.meanA).toBeCloseTo(5);
    expect(t.meanB).toBeCloseTo(1);
    expect(t.meanDiff).toBeCloseTo(4);
    expect(t.significant).toBe(true);
  });

  it("reports identical distributions as not significant", () => {
    const a = [1, 2, 3, 4, 5];
    const b = [1, 2, 3, 4, 5];
    const t = meanDiffSignificant(a, b);
    expect(t.meanDiff).toBe(0);
    expect(t.tStat).toBe(0);
    expect(t.significant).toBe(false);
  });

  it("reports heavily-overlapping, high-variance samples as not significant", () => {
    // Same mean-ish, high spread -> t-stat should stay well under the threshold.
    const a = [0, 10, 0, 10, 0, 10];
    const b = [10, 0, 10, 0, 10, 0];
    const t = meanDiffSignificant(a, b);
    expect(t.significant).toBe(false);
  });

  it("reports not significant when a group has fewer than 2 samples, however large the gap", () => {
    // A single-point sample has no defined variance — treating it as 0 (rather
    // than unreliable/unknown) would otherwise let one noisy data point look
    // "significant" against the most lenient (large-df) critical value.
    const a = [10];
    const b = [1, 2, 3, 1, 2];
    const t = meanDiffSignificant(a, b);
    expect(t.significant).toBe(false);
    expect(t.tStat).toBe(0);

    // Same, empty-array case.
    expect(meanDiffSignificant([], b).significant).toBe(false);
    expect(meanDiffSignificant(a, []).significant).toBe(false);
  });
});
