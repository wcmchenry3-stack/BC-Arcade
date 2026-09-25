import { CATEGORIES, type Category } from "../../engine";
import type { BlockRecord, GameRecord, MatchupRun, PlayerResult } from "../harness";
import {
  aOutcome,
  belowParFills,
  difference,
  estimate,
  fillRound,
  formatReport,
  quantile,
  summarize,
  upperZeros,
} from "../stats";

// ---------------------------------------------------------------------------
// Synthetic game logs with hand-countable stats
// ---------------------------------------------------------------------------

function player(
  label: string,
  score: number,
  opts: {
    bonus?: boolean;
    upper?: number;
    cats?: Partial<Record<Category, number>>;
    jokers?: number;
    fillOrder?: Category[];
  } = {}
): PlayerResult {
  const categories = {} as Record<Category, number>;
  for (const cat of CATEGORIES) categories[cat] = opts.cats?.[cat] ?? 0;
  return {
    label,
    score,
    upperSubtotal: opts.upper ?? 0,
    bonus: opts.bonus ?? false,
    yachtBonusCount: opts.jokers ?? 0,
    categories,
    fillOrder: opts.fillOrder ?? [...CATEGORIES],
  };
}

function game(aFirst: boolean, aStream: "X" | "Y", a: PlayerResult, b: PlayerResult): GameRecord {
  return { aFirst, aStream, a, b };
}

/**
 * Block 1: A wins both A-first games, loses both B-first games (pure order effect).
 * Block 2: A wins game 0, ties game 1, loses game 2, wins game 3.
 */
const blocks: BlockRecord[] = [
  {
    games: [
      game(true, "X", player("p", 200, { bonus: true, upper: 70 }), player("q", 150)),
      game(true, "Y", player("p", 210, { bonus: true, upper: 64 }), player("q", 160)),
      game(false, "X", player("p", 140), player("q", 190, { bonus: true, upper: 63 })),
      game(false, "Y", player("p", 150), player("q", 200)),
    ],
  },
  {
    games: [
      game(true, "X", player("p", 250, { cats: { yacht: 50 } }), player("q", 100)),
      game(true, "Y", player("p", 180), player("q", 180)),
      game(false, "X", player("p", 120), player("q", 220, { cats: { yacht: 50 } })),
      game(false, "Y", player("p", 230, { bonus: true, upper: 80 }), player("q", 170)),
    ],
  },
];

const run: MatchupRun = { a: "p", b: "q", mode: "paired", seed: 1, blocks };

describe("estimate", () => {
  it("computes mean, standard error and a symmetric CI", () => {
    const e = estimate([1, 2, 3, 4]);
    expect(e.mean).toBe(2.5);
    expect(e.se).toBeCloseTo(Math.sqrt(5 / 3) / 2, 10);
    expect(e.mean - e.ciLow).toBeCloseTo(e.ciHigh - e.mean, 10);
    // t-critical at df=3 is ≈3.18; the Cornish-Fisher helper lands close.
    expect((e.ciHigh - e.mean) / e.se).toBeGreaterThan(2.8);
    expect(e.n).toBe(4);
  });

  it("degrades gracefully on tiny samples", () => {
    expect(estimate([])).toEqual({ mean: 0, se: 0, ciLow: 0, ciHigh: 0, n: 0 });
    expect(estimate([0.7])).toMatchObject({ mean: 0.7, se: 0, ciLow: 0.7, ciHigh: 0.7 });
  });

  it("approaches the normal 1.96 multiplier for large samples", () => {
    const values = Array.from({ length: 10_000 }, (_, i) => (i % 2 ? 1 : 0));
    const e = estimate(values);
    expect((e.ciHigh - e.mean) / e.se).toBeCloseTo(1.96, 2);
  });
});

describe("difference", () => {
  it("combines standard errors of independent estimates", () => {
    const left = { mean: 0.6, se: 0.03, ciLow: 0, ciHigh: 0, n: 500 };
    const right = { mean: 0.5, se: 0.04, ciLow: 0, ciHigh: 0, n: 500 };
    const d = difference(left, right);
    expect(d.mean).toBeCloseTo(0.1, 10);
    expect(d.se).toBeCloseTo(0.05, 10);
    expect(d.ciLow).toBeLessThan(0.1);
    expect(d.ciHigh).toBeGreaterThan(0.1);
  });
});

describe("aOutcome / belowParFills", () => {
  it("scores win 1, tie 0.5, loss 0", () => {
    expect(aOutcome(blocks[0]!.games[0])).toBe(1);
    expect(aOutcome(blocks[1]!.games[1])).toBe(0.5);
    expect(aOutcome(blocks[0]!.games[2])).toBe(0);
  });

  it("counts upper categories scored below 3 × face", () => {
    const p = player("p", 0, {
      cats: { ones: 3, twos: 4, threes: 9, fours: 0, fives: 20, sixes: 17 },
    });
    // twos (4 < 6), fours (0 < 12), sixes (17 < 18)
    expect(belowParFills(p)).toBe(3);
  });
});

describe("quantile / fillRound / upperZeros", () => {
  it("takes nearest-rank quantiles of sorted values", () => {
    const v = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(quantile(v, 0.1)).toBe(10);
    expect(quantile(v, 0.5)).toBe(50);
    expect(quantile(v, 0.9)).toBe(90);
    expect(quantile([], 0.5)).toBe(0);
  });

  it("finds the round a category was filled", () => {
    const order = [...CATEGORIES].reverse();
    const p = player("p", 0, { fillOrder: order });
    expect(fillRound(p, CATEGORIES[CATEGORIES.length - 1]!)).toBe(1);
    expect(fillRound(p, CATEGORIES[0]!)).toBe(13);
  });

  it("counts zeroed upper boxes and how many were Fours-Sixes", () => {
    const p = player("p", 0, {
      cats: { ones: 0, twos: 4, threes: 0, fours: 0, fives: 15, sixes: 0 },
    });
    expect(upperZeros(p)).toEqual([2, 4]); // zeroed: ones, threes, fours, sixes
  });
});

describe("summarize", () => {
  const report = summarize(run);

  it("reports sizes and identity", () => {
    expect(report).toMatchObject({ a: "p", b: "q", mode: "paired", seed: 1, blocks: 2, games: 8 });
  });

  it("computes the win rate with ties as half, and the tie rate", () => {
    // Block 1: 1,1,0,0 → 0.5. Block 2: 1,0.5,0,1 → 0.625.
    expect(report.aWinRate.mean).toBeCloseTo((0.5 + 0.625) / 2, 10);
    expect(report.tieRate).toBeCloseTo(1 / 8, 10);
  });

  it("splits by turn order and pairs the order effect within blocks", () => {
    // A first: block 1 → 1, block 2 → 0.75. A second: block 1 → 0, block 2 → 0.5.
    expect(report.aWinRateWhenFirst.mean).toBeCloseTo(0.875, 10);
    expect(report.aWinRateWhenSecond.mean).toBeCloseTo(0.25, 10);
    // Per block deltas 1 and 0.25.
    expect(report.orderEffect.mean).toBeCloseTo(0.625, 10);
    expect(report.orderEffect.n).toBe(2);
    // First mover: block 1 → (1 + 1)/2 = 1; block 2 → (0.75 + 0.5)/2 = 0.625.
    expect(report.firstMoverWinRate.mean).toBeCloseTo(0.8125, 10);
  });

  it("reports per-player stats symmetrically", () => {
    const { a, b, pooled } = report.players;
    expect(a.label).toBe("p");
    expect(b.label).toBe("q");
    expect(a.meanScore.mean).toBeCloseTo((200 + 210 + 140 + 150 + 250 + 180 + 120 + 230) / 8, 10);
    expect(b.meanScore.mean).toBeCloseTo((150 + 160 + 190 + 200 + 100 + 180 + 220 + 170) / 8, 10);
    expect(a.bonusRate.mean).toBeCloseTo(3 / 8, 10);
    expect(b.bonusRate.mean).toBeCloseTo(1 / 8, 10);
    expect(a.categories.yacht).toEqual({ meanScore: 50 / 8, hitRate: 1 / 8 });
    expect(b.categories.yacht).toEqual({ meanScore: 50 / 8, hitRate: 1 / 8 });
    expect(pooled.meanScore.mean).toBeCloseTo((a.meanScore.mean + b.meanScore.mean) / 2, 10);
    expect(pooled.bonusRate.mean).toBeCloseTo(4 / 16, 10);
  });

  it("reports the #2156 metrics: percentiles, yacht zeros, jokers, chance timing", () => {
    const { a, b } = report.players;
    // A's scores sorted: 120 140 150 180 200 210 230 250.
    expect(a.scorePercentiles).toEqual({ p10: 120, p50: 180, p90: 250 });
    // One game in eight scored the yacht box, for each player.
    expect(a.yachtZeroRate.mean).toBeCloseTo(7 / 8, 10);
    expect(b.yachtZeroRate.mean).toBeCloseTo(7 / 8, 10);
    expect(a.jokerRate.mean).toBe(0);
    // Default fill order is CATEGORIES order.
    expect(a.chanceRound.mean).toBe(CATEGORIES.indexOf("chance") + 1);
    // Every fixture player zeroes all six upper boxes except where set: 3 of 6 are high.
    expect(a.highUpperZeroShare.mean).toBeCloseTo(0.5, 10);
  });

  it("mirrors exactly when the two players swap roles", () => {
    const swapped: MatchupRun = {
      a: "q",
      b: "p",
      mode: "paired",
      seed: 1,
      blocks: blocks.map(({ games: [g0, g1, g2, g3] }) => {
        const swap = (g: GameRecord) => game(!g.aFirst, g.aStream, g.b, g.a);
        return { games: [swap(g0), swap(g1), swap(g2), swap(g3)] };
      }),
    };
    const r2 = summarize(swapped);
    expect(r2.aWinRate.mean).toBeCloseTo(1 - report.aWinRate.mean, 10);
    expect(r2.players.a).toEqual(report.players.b);
    expect(r2.players.b).toEqual(report.players.a);
    expect(r2.firstMoverWinRate.mean).toBeCloseTo(report.firstMoverWinRate.mean, 10);
  });

  it("formats a readable report", () => {
    const text = formatReport(report);
    expect(text).toContain("p (A) vs q (B) — paired dice, 2 blocks × 4 = 8 games");
    expect(text).toContain("order effect");
    expect(text).toContain("yacht");
    for (const label of ["score p10 / p50 / p90", "yacht zero rate", "joker", "chance filled"]) {
      expect(text).toContain(label);
    }
  });
});
