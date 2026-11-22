/** The dev panel's step bench (#3697): the spike's protocol, timed into the frameStats ring. */
import { formatStepBench, runStepBench } from "../stepBench";

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
