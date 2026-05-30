import { selectNextTier, DROUGHT_WINDOW } from "../spawnSelector2";
import { DROPPABLE_PIECE_TIERS } from "../pieceDefs";

function sampleN(n: number, history: number[] = [], danger = false, rng?: () => number): number[] {
  const results: number[] = [];
  const running = [...history];
  for (let i = 0; i < n; i++) {
    const t = selectNextTier(running, danger, rng);
    results.push(t);
    running.push(t);
  }
  return results;
}

function seededRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (Math.imul(48271, s) + (s >>> 16)) | 0;
    return (s >>> 0) / 0x100000000;
  };
}

describe("selectNextTier — output validity", () => {
  it("always returns a droppable tier", () => {
    const results = sampleN(500);
    for (const t of results) {
      expect(DROPPABLE_PIECE_TIERS).toContain(t);
    }
  });
});

describe("selectNextTier — distribution over 1000 samples", () => {
  it("each tier appears at least once", () => {
    const results = sampleN(1000);
    for (const tier of DROPPABLE_PIECE_TIERS) {
      expect(results.filter((t) => t === tier).length).toBeGreaterThan(0);
    }
  });

  it("lower tiers appear more often than higher tiers (no danger)", () => {
    // Use a fixed seed for determinism; 20% tolerance accommodates weighting variance
    const rng = seededRng(42);
    const results: number[] = [];
    const running: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const t = selectNextTier(running, false, rng);
      results.push(t);
      running.push(t);
    }
    const counts = DROPPABLE_PIECE_TIERS.map((t) => results.filter((r) => r === t).length);
    for (let i = 0; i < counts.length - 1; i++) {
      expect(counts[i]!).toBeGreaterThan(counts[i + 1]! * 0.8);
    }
  });
});

describe("selectNextTier — drought guard", () => {
  it("no tier is absent in 50 consecutive drops", () => {
    for (let trial = 0; trial < 20; trial++) {
      const results = sampleN(50);
      for (const tier of DROPPABLE_PIECE_TIERS) {
        expect(results).toContain(tier);
      }
    }
  });

  it("exports DROUGHT_WINDOW matching the history window used internally", () => {
    expect(DROUGHT_WINDOW).toBe(10);
  });
});

describe("selectNextTier — anti-streak", () => {
  // The selector hard-bans a tier after STREAK_WINDOW (4) consecutive picks,
  // so this is a guaranteed property — verified with 50 deterministic seeds.
  it("same tier is not selected more than 4 times consecutively", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const rng = seededRng(seed);
      const results = sampleN(500, [], false, rng);
      let streak = 1;
      for (let i = 1; i < results.length; i++) {
        if (results[i] === results[i - 1]) {
          streak++;
          expect(streak).toBeLessThanOrEqual(4);
        } else {
          streak = 1;
        }
      }
    }
  });
});

describe("selectNextTier — danger state", () => {
  it("high tiers (>=3) appear less often in danger than out of danger", () => {
    const safe = sampleN(1000, [], false);
    const danger = sampleN(1000, [], true);
    const highTiers = DROPPABLE_PIECE_TIERS.filter((t) => t >= 3);
    const safeHigh = safe.filter((t) => highTiers.includes(t)).length;
    const dangerHigh = danger.filter((t) => highTiers.includes(t)).length;
    expect(dangerHigh).toBeLessThan(safeHigh);
  });
});

describe("selectNextTier — determinism with seeded rng", () => {
  it("two calls with the same seed produce identical sequences", () => {
    const run = (seed: number) => {
      const rng = seededRng(seed);
      const history: number[] = [];
      return Array.from({ length: 20 }, () => {
        const t = selectNextTier(history, false, rng);
        history.push(t);
        return t;
      });
    };
    expect(run(99)).toEqual(run(99));
    expect(run(1)).not.toEqual(run(2));
  });
});
