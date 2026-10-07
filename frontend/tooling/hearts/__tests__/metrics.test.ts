import { COUNTER_KEYS, type BlockRecord, emptyCounters } from "../harness";
import {
  METRICS,
  differenceSeries,
  meanEstimate,
  observations,
  ratioEstimate,
  ratioSeries,
  zCritical,
} from "../metrics";

describe("metric definitions", () => {
  it("gives every metric a numerator and a different, real denominator", () => {
    for (const m of Object.values(METRICS)) {
      expect(COUNTER_KEYS).toContain(m.numerator);
      expect(COUNTER_KEYS).toContain(m.denominator);
      expect(m.denominator).not.toBe(m.numerator);
      expect(m.description).toContain(" | ");
    }
  });

  it("pairs moon success with its own attempts (HRT-1, #2204)", () => {
    // Completions in attempted hands ÷ attempted hands — never all moons ÷
    // some narrower trigger count.
    expect(METRICS.moon_success).toMatchObject({
      numerator: "moonAttemptSuccesses",
      denominator: "moonAttempts",
    });
  });
});

describe("ratio estimates", () => {
  const obs = [
    { y: 3, n: 10 },
    { y: 1, n: 5 },
    { y: 4, n: 12 },
    { y: 0, n: 0 },
    { y: 2, n: 8 },
  ];

  it("estimates Σy / Σn with the delta-method standard error", () => {
    const e = ratioEstimate(obs);
    const r = 10 / 35;
    expect(e.mean).toBeCloseTo(r, 12);
    expect(e).toMatchObject({ num: 10, den: 35, blocks: 5 });
    const B = obs.length;
    const resid = obs.reduce((s, o) => s + (o.y - r * o.n) ** 2, 0);
    expect(e.se).toBeCloseTo(Math.sqrt(resid / (B * (B - 1))) / (35 / B), 12);
    expect(e.ciHigh - e.mean).toBeCloseTo(zCritical(0.05) * e.se, 12);
  });

  it("reports an undefined rate, not 0, when the denominator never occurred", () => {
    const e = ratioEstimate([
      { y: 0, n: 0 },
      { y: 0, n: 0 },
    ]);
    expect(e.mean).toBeNaN();
    expect(ratioSeries([{ y: 0, n: 0 }])).toEqual([]);
  });

  it("differences two rates block by block over their common prefix", () => {
    const left = [
      { y: 1, n: 1 },
      { y: 0, n: 1 },
      { y: 1, n: 1 },
      { y: 1, n: 1 },
    ];
    const right = [
      { y: 0, n: 1 },
      { y: 0, n: 1 },
      { y: 1, n: 1 },
    ];
    const d = meanEstimate(differenceSeries(left, right));
    expect(d.blocks).toBe(3);
    expect(d.mean).toBeCloseTo(2 / 3 - 1 / 3, 12);
  });

  it("widens a CI for a smaller alpha (Bonferroni)", () => {
    const wide = ratioEstimate(obs, 0.05 / 20);
    const narrow = ratioEstimate(obs, 0.05);
    expect(wide.ciHigh - wide.ciLow).toBeGreaterThan(narrow.ciHigh - narrow.ciLow);
    expect(zCritical(0.05)).toBeCloseTo(1.959964, 5);
  });

  it("reads a role's counters out of block records (missing role = 0/0)", () => {
    const c = { ...emptyCounters(), winShare: 0.5, seatGames: 2 };
    const blocks: BlockRecord[] = [{ index: 0, roles: { daring: c } }];
    expect(observations(blocks, "daring", METRICS.win_share)).toEqual([{ y: 0.5, n: 2 }]);
    expect(observations(blocks, "cautious", METRICS.win_share)).toEqual([{ y: 0, n: 0 }]);
  });
});
