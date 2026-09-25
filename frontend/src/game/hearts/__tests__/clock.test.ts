import { clockMs, pauseClock, pausedClock, runClock, withPlayTime } from "../clock";
import { dealGame } from "../engine";

describe("Hearts play clock (#2629)", () => {
  it("a new clock is paused at 0", () => {
    expect(pausedClock()).toEqual({ accumulatedMs: 0, runningSince: null });
    expect(clockMs(pausedClock(), 5_000)).toBe(0);
  });

  it("a bad stored total counts as 0", () => {
    expect(pausedClock(-5).accumulatedMs).toBe(0);
    expect(pausedClock(Number.NaN).accumulatedMs).toBe(0);
    expect(pausedClock(Number.POSITIVE_INFINITY).accumulatedMs).toBe(0);
  });

  it("adds up the running spans only", () => {
    let clock = runClock(pausedClock(1_000), 10_000);
    expect(clockMs(clock, 12_500)).toBe(3_500);
    clock = pauseClock(clock, 13_000);
    expect(clock).toEqual({ accumulatedMs: 4_000, runningSince: null });
    // Paused time adds nothing.
    expect(clockMs(clock, 99_000)).toBe(4_000);
    clock = runClock(clock, 100_000);
    expect(clockMs(clock, 101_000)).toBe(5_000);
  });

  it("running or pausing twice changes nothing", () => {
    const running = runClock(pausedClock(), 1_000);
    expect(runClock(running, 2_000)).toBe(running);
    const paused = pauseClock(running, 3_000);
    expect(pauseClock(paused, 4_000)).toBe(paused);
  });

  it("never counts backwards if the device clock jumps back", () => {
    expect(clockMs(runClock(pausedClock(2_000), 10_000), 9_000)).toBe(2_000);
  });

  it("withPlayTime stamps the state with the total so far, in whole ms", () => {
    const state = dealGame();
    const saved = withPlayTime(state, runClock(pausedClock(1_000.4), 0), 500);
    expect(saved.accumulatedMs).toBe(1_500);
    expect({ ...saved, accumulatedMs: undefined }).toEqual({ ...state, accumulatedMs: undefined });
  });
});
