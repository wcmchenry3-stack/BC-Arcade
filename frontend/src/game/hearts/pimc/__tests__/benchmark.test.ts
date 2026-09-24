import { createSeededRng, getRng, getValidPlays, setRng } from "../../engine";
import { collectDecisions, runPimcBenchmark } from "../benchmark";

afterEach(() => setRng(Math.random));

describe("collectDecisions", () => {
  it("collects real seat-1 decisions with a choice to make, repeatably", () => {
    const states = collectDecisions(12);
    expect(states).toHaveLength(12);
    for (const s of states) {
      expect(s.phase).toBe("playing");
      expect(s.currentPlayerIndex).toBe(1);
      expect(getValidPlays(s, 1).length).toBeGreaterThanOrEqual(1);
    }
    expect(collectDecisions(12)).toEqual(states);
  });

  it("leaves the engine RNG as it found it", () => {
    const mine = createSeededRng(9);
    setRng(mine);
    collectDecisions(3);
    expect(getRng()).toBe(mine);
  });
});

describe("runPimcBenchmark", () => {
  it("reports median, p95 and worst per sample count, with progress", async () => {
    let t = 0;
    const progress: number[] = [];
    const rows = await runPimcBenchmark({
      sampleCounts: [2, 4],
      decisions: 4,
      now: () => (t += 5), // every timed move takes 5 ms
      onProgress: (done) => progress.push(done),
    });
    expect(rows).toEqual([
      { samples: 2, decisions: 4, p50: 5, p95: 5, max: 5 },
      { samples: 4, decisions: 4, p50: 5, p95: 5, max: 5 },
    ]);
    expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("stops between moves when cancelled, returning the rows so far", async () => {
    let moves = 0;
    const rows = await runPimcBenchmark({
      sampleCounts: [2, 4],
      decisions: 3,
      now: () => 0,
      onProgress: () => moves++,
      cancelled: () => moves >= 4, // stops one move into the second count
    });
    expect(moves).toBe(4);
    expect(rows.map((r) => r.samples)).toEqual([2]);
  });
});
