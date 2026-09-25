/** #2567: the frame-stats ring buffer behind the on-screen "Frame" readout. */
import {
  createFrameStats,
  recordFrame,
  recordCommit,
  summarizeFrameStats,
  percentile,
  formatFrameStats,
} from "../render/frameStats";

describe("percentile (nearest rank)", () => {
  it("picks the ceil(p·n)-th smallest value", () => {
    const xs = Array.from({ length: 20 }, (_, i) => i + 1); // 1..20
    expect(percentile(xs, 0.95)).toBe(19);
    expect(percentile(xs, 0.5)).toBe(10);
    expect(percentile(xs, 1)).toBe(20);
    expect(percentile([7], 0.95)).toBe(7);
    expect(percentile([], 0.95)).toBe(0);
  });
});

describe("summarizeFrameStats", () => {
  it("average and p95 over a known sample set in the last second", () => {
    const s = createFrameStats();
    // 57 smooth frames and 3 long ones, all inside the window
    let t = 0;
    for (let i = 0; i < 60; i++) {
      const dt = i % 20 === 19 ? 50 : 16;
      t += dt / 4; // keep all 60 inside one second
      recordFrame(s, t, dt);
    }
    const sum = summarizeFrameStats(s, t)!;
    expect(sum.frames).toBe(60);
    expect(sum.avgMs).toBeCloseTo((57 * 16 + 3 * 50) / 60, 10);
    // 95th percentile of 60 samples is the 57th smallest: the last smooth frame
    expect(sum.p95Ms).toBe(16);
  });

  it("p95 catches jank once long frames pass 5%", () => {
    const s = createFrameStats();
    for (let i = 0; i < 60; i++) recordFrame(s, i * 10, i < 54 ? 16 : 40);
    expect(summarizeFrameStats(s, 600)!.p95Ms).toBe(40);
  });

  it("only the last window counts; older frames and commits drop out", () => {
    const s = createFrameStats();
    for (let t = 0; t <= 2000; t += 100) recordFrame(s, t, t < 1000 ? 100 : 20);
    for (const t of [100, 500, 1500, 1800, 1900]) recordCommit(s, t);
    const sum = summarizeFrameStats(s, 2000)!;
    expect(sum.frames).toBe(10); // 1100..2000
    expect(sum.avgMs).toBe(20);
    expect(sum.commitsPerSec).toBe(3);
  });

  it("wraps the ring without losing the newest samples", () => {
    const s = createFrameStats(8);
    for (let i = 1; i <= 30; i++) recordFrame(s, i, i);
    const sum = summarizeFrameStats(s, 30, 1000)!;
    expect(sum.frames).toBe(8); // capacity-bounded
    expect(sum.avgMs).toBe((23 + 30) / 2); // 23..30
  });

  it("null with nothing in the window — a stalled or backgrounded loop", () => {
    const s = createFrameStats();
    expect(summarizeFrameStats(s, 1000)).toBeNull();
    recordFrame(s, 100, 16);
    expect(summarizeFrameStats(s, 5000)).toBeNull();
  });

  it("zero commits in steady state reads 0/s", () => {
    const s = createFrameStats();
    for (let i = 0; i < 60; i++) recordFrame(s, i * 16, 16);
    expect(summarizeFrameStats(s, 960)!.commitsPerSec).toBe(0);
  });
});

describe("formatFrameStats", () => {
  it("one readable line", () => {
    expect(formatFrameStats({ avgMs: 16.66, p95Ms: 18.24, frames: 60, commitsPerSec: 2 })).toBe(
      "16.7 ms avg · 18.2 p95 · 60 f · 2 commits/s"
    );
    expect(formatFrameStats(null)).toBe("frame: no samples");
  });
});
