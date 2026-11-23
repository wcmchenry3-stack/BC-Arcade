/** The dev panel's step bench (#3697): the spike's protocol, timed into the frameStats ring. */
import {
  formatMergeStorm,
  formatStepBench,
  mergeStormPile,
  runMergeStormBench,
  runStepBench,
} from "../stepBench";

describe("runStepBench", () => {
  it("fills the board with the asked pieces and times the frames from 4 before the last", () => {
    let t = 0;
    // A fake clock that ticks 1 ms per read: every step costs exactly 1 ms.
    const now = () => (t += 1);
    const r = runStepBench({ pieces: 30, now });
    expect(r.pieces).toBe(30);
    // From the 26th drop (frame 375) to the 30th (frame 435), then 180 frames: 240 frames.
    expect(r.frames).toBe(240);
    expect(r.meanMs).toBe(1);
    expect(r.p95Ms).toBe(1);
    expect(r.maxMs).toBe(1);
  });

  it("keeps 90 pieces on the board with merges and the lid off, inside the ring", () => {
    const r = runStepBench();
    expect(r.pieces).toBe(90);
    expect(r.frames).toBeLessThanOrEqual(255);
    expect(r.meanMs).toBeGreaterThan(0);
    expect(r.p95Ms).toBeGreaterThanOrEqual(0);
    expect(formatStepBench(r)).toMatch(
      /^90 pieces · [\d.]+ ms mean · [\d.]+ p95 · [\d.]+ max \(\d+ f\)$/
    );
  });
});

// #4082: the merge storm, merges on: a big chain's step cost.
describe("runMergeStormBench", () => {
  it("sets off a dozen-plus merges in a few frames, the same every run", () => {
    const a = runMergeStormBench();
    expect(a.merges).toBeGreaterThanOrEqual(12);
    expect(a.peakMergesPerFrame).toBeGreaterThanOrEqual(4);
    expect(a.stormFrames).toBeGreaterThan(1);
    expect(a.stormFrames).toBeLessThan(120);
    expect(a.frames).toBe(240);
    const b = runMergeStormBench();
    expect([b.merges, b.peakMergesPerFrame, b.stormFrames, b.pieces]).toEqual([
      a.merges,
      a.peakMergesPerFrame,
      a.stormFrames,
      a.pieces,
    ]);
  });

  it("times every frame from the restore", () => {
    let t = 0;
    const r = runMergeStormBench({ frames: 60, now: () => (t += 1) });
    expect(r.frames).toBe(60);
    expect(r.meanMs).toBe(1);
    expect(r.p95Ms).toBe(1);
    expect(formatMergeStorm(r)).toMatch(
      /^storm: \d+ merges in \d+ f · 1\.00 ms mean · 1\.00 p95 · 1\.00 max \(60 f\)$/
    );
  });

  it("the pile: towers of distinct tiers and a block of cherries, inside the bin", () => {
    const pile = mergeStormPile();
    expect(pile.filter((p) => p.tier === 0)).toHaveLength(16);
    const towers = pile.filter((p) => p.tier > 0).map((p) => p.tier);
    expect(new Set(towers).size).toBe(towers.length);
    for (const p of pile) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(400);
      expect(p.y).toBeGreaterThan(80); // under the lid
      expect(p.y).toBeLessThan(580);
    }
  });
});
