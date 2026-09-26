import { createStream } from "../../../_shared/simRandom";
import { gaussianLlr, sprt, sprtBounds, twoSidedSprt, type SprtParams } from "../sprt";

/** Seeded N(mean, sd) draws (Box-Muller). */
function normals(seed: number, mean: number, sd: number): () => number {
  const rng = createStream(seed);
  return () => {
    const u = 1 - rng();
    const v = rng();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

/** Feed draws until the SPRT decides (or the cap truncates it). */
function runToDecision(
  draw: () => number,
  params: SprtParams,
  cap = 20000
): { decision: "h0" | "h1"; blocks: number; truncated: boolean } {
  const series: number[] = [];
  while (series.length < cap) {
    for (let i = 0; i < 10; i++) series.push(draw());
    const r = sprt(series, params, series.length >= cap);
    if (r.decision !== "continue") {
      return { decision: r.decision, blocks: series.length, truncated: r.truncated };
    }
  }
  throw new Error("unreachable");
}

describe("sprtBounds", () => {
  it("gives Wald's boundaries", () => {
    const { lower, upper } = sprtBounds(0.05, 0.05);
    expect(upper).toBeCloseTo(Math.log(19), 10);
    expect(lower).toBeCloseTo(-Math.log(19), 10);
  });

  it("rejects error rates outside (0, 1)", () => {
    expect(() => sprtBounds(0, 0.05)).toThrow(RangeError);
    expect(() => sprtBounds(0.05, 1)).toThrow(RangeError);
  });
});

describe("gaussianLlr", () => {
  it("matches the closed form with the sample variance", () => {
    const xs = [0.1, 0.3, 0.2, 0.4, 0.25];
    const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
    const variance = xs.reduce((s, v) => s + (v - mean) ** 2, 0) / (xs.length - 1);
    const direct = xs.reduce((s, x) => s + ((x - 0.2) ** 2 - (x - 0.3) ** 2), 0) / (2 * variance);
    expect(gaussianLlr(xs, 0.2, 0.3)).toBeCloseTo(direct, 10);
  });

  it("is 0 with fewer than two blocks (no variance estimate yet)", () => {
    expect(gaussianLlr([], 0, 1)).toBe(0);
    expect(gaussianLlr([5], 0, 1)).toBe(0);
  });

  it("stays finite and decisive on a constant series", () => {
    const atH0 = gaussianLlr([0.25, 0.25, 0.25], 0.25, 0.3);
    const atH1 = gaussianLlr([0.3, 0.3, 0.3], 0.25, 0.3);
    expect(Number.isFinite(atH0) && Number.isFinite(atH1)).toBe(true);
    expect(atH0).toBeLessThan(-100);
    expect(atH1).toBeGreaterThan(100);
  });
});

describe("sprt on synthetic sequences", () => {
  const params: SprtParams = { mu0: 0.25, mu1: 0.22, alpha: 0.05, beta: 0.05 };

  it("accepts H0 on data drawn at mu0 and H1 on data drawn at mu1", () => {
    expect(runToDecision(normals(1, 0.25, 0.2), params).decision).toBe("h0");
    expect(runToDecision(normals(2, 0.22, 0.2), params).decision).toBe("h1");
  });

  it("stops early on a clear case", () => {
    // 10-point shift, far outside the 3-point design: needs few blocks.
    const r = runToDecision(normals(3, 0.15, 0.2), params);
    expect(r.decision).toBe("h1");
    expect(r.blocks).toBeLessThan(150);
  });

  it("decides win/loss (Bernoulli) streams too", () => {
    const rng = createStream(4);
    const bern = (p: number) => () => (rng() < p ? 1 : 0);
    const p: SprtParams = { mu0: 0.5, mu1: 0.4, alpha: 0.05, beta: 0.05 };
    expect(runToDecision(bern(0.5), p).decision).toBe("h0");
    expect(runToDecision(bern(0.4), p).decision).toBe("h1");
  });

  it("keeps its error rates near alpha and beta over many runs", () => {
    // Wald's bounds are conservative, and the gate looks only every few
    // blocks, so observed rates should sit at or below the design values.
    const trials = 300;
    let falseFail = 0;
    let miss = 0;
    for (let t = 0; t < trials; t++) {
      if (runToDecision(normals(1000 + t, 0.25, 0.2), params).decision === "h1") falseFail++;
      if (runToDecision(normals(5000 + t, 0.22, 0.2), params).decision === "h0") miss++;
    }
    // 0.05 design rate; 0.09 is ~3 binomial SEs above it at n = 300.
    expect(falseFail / trials).toBeLessThan(0.09);
    expect(miss / trials).toBeLessThan(0.09);
  });

  it("truncates at the cap by the sign of the LLR (the midpoint rule)", () => {
    // Estimates just either side of the midpoint 0.235, with too little data to cross a boundary.
    const below = [0.2, 0.26, 0.24, 0.23, 0.2, 0.26];
    const above = below.map((x) => x + 0.006);
    const r1 = sprt(below, params, true);
    const r2 = sprt(above, params, true);
    expect(r1).toMatchObject({ decision: "h1", truncated: true });
    expect(r2).toMatchObject({ decision: "h0", truncated: true });
    expect(sprt(below, params, false).decision).toBe("continue");
  });
});

describe("twoSidedSprt", () => {
  const run = (seed: number, mean: number) => {
    const draw = normals(seed, mean, 0.2);
    const series: number[] = [];
    for (;;) {
      for (let i = 0; i < 10; i++) series.push(draw());
      const r = twoSidedSprt(series, 0.25, 0.03, 0.05, 0.05, series.length >= 20000);
      if (r.status !== "continue") return r.status;
    }
  };

  it("passes at the baseline and fails on a move either way", () => {
    expect(run(11, 0.25)).toBe("pass");
    expect(run(12, 0.21)).toBe("fail");
    expect(run(13, 0.29)).toBe("fail");
  });
});
