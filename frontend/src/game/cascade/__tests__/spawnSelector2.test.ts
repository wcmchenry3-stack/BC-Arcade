import { selectNextTier } from "../spawnSelector2";
import { DROPPABLE_PIECE_TIERS } from "../pieceDefs";

function sampleN(n: number, history: number[] = [], danger = false): number[] {
  const results: number[] = [];
  const running = [...history];
  for (let i = 0; i < n; i++) {
    const t = selectNextTier(running, danger);
    results.push(t);
    running.push(t);
  }
  return results;
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
    const results = sampleN(1000);
    const counts = DROPPABLE_PIECE_TIERS.map(
      (t) => results.filter((r) => r === t).length
    );
    // Each tier should appear more than the next higher tier on average
    for (let i = 0; i < counts.length - 1; i++) {
      expect(counts[i]!).toBeGreaterThan(counts[i + 1]!);
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
});

describe("selectNextTier — anti-streak", () => {
  it("same tier is not selected more than 4 times consecutively", () => {
    const results = sampleN(500);
    let streak = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] === results[i - 1]) {
        streak++;
        expect(streak).toBeLessThanOrEqual(4);
      } else {
        streak = 1;
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
