import {
  clockElapsedMs,
  clockForSave,
  clockOnLoad,
  pauseClock,
  resumeClock,
  startClockOnMove,
  stopClock,
  type PlayClock,
} from "../playClock";
import { monotonicNow } from "../monotonicNow";

/** A drivable monotonic source and a separate wall clock, so one can move without the other. */
function installClocks() {
  let mono = 1_000;
  let wall = 1_700_000_000_000;
  jest.spyOn(globalThis.performance, "now").mockImplementation(() => mono);
  jest.spyOn(Date, "now").mockImplementation(() => wall);
  return {
    advance: (ms: number) => {
      mono += ms;
      wall += ms;
    },
    setWall: (ms: number) => {
      wall = ms;
    },
    getWall: () => wall,
  };
}

describe("monotonicNow (#3925)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("reads performance.now, not the wall clock", () => {
    const c = installClocks();
    expect(monotonicNow()).toBe(1_000);
    c.setWall(5);
    expect(monotonicNow()).toBe(1_000);
  });

  it("falls back to Date.now when performance is missing", () => {
    jest.spyOn(Date, "now").mockReturnValue(42);
    const original = globalThis.performance;
    Object.defineProperty(globalThis, "performance", { value: undefined, configurable: true });
    try {
      expect(monotonicNow()).toBe(42);
    } finally {
      Object.defineProperty(globalThis, "performance", { value: original, configurable: true });
    }
  });
});

describe("play clock vs the device clock (#3925)", () => {
  afterEach(() => jest.restoreAllMocks());

  const start = (): PlayClock => startClockOnMove({ startedAt: null, accumulatedMs: 0 });

  it("a wall-clock jump backwards mid-game leaves the measured time unchanged", () => {
    const c = installClocks();
    const clock = start();
    c.advance(60_000);
    c.setWall(c.getWall() - 3_600_000); // an hour back
    c.advance(30_000);
    expect(clockElapsedMs(clock)).toBe(90_000);
    expect(clockElapsedMs(stopClock(clock))).toBe(90_000);
  });

  it("a wall-clock jump forwards mid-game leaves the measured time unchanged", () => {
    const c = installClocks();
    const clock = start();
    c.advance(60_000);
    c.setWall(c.getWall() + 3_600_000); // an hour ahead
    c.advance(30_000);
    expect(clockElapsedMs(clock)).toBe(90_000);
  });

  it("pause and resume still exclude time away, whatever the wall clock does", () => {
    const c = installClocks();
    let clock = start();
    c.advance(10_000);
    clock = pauseClock(clock);
    c.advance(120_000);
    c.setWall(c.getWall() - 600_000);
    clock = resumeClock(clock);
    c.advance(5_000);
    expect(clockElapsedMs(clock)).toBe(15_000);
  });

  it("save and restore continue from the banked play, in a new run with another origin", () => {
    const c = installClocks();
    const clock = start();
    c.advance(40_000);
    const saved = clockForSave(clock);
    expect(saved.accumulatedMs).toBe(40_000);

    // The app restarts: performance.now() starts again from a small number, the wall clock moved on.
    const stored: PlayClock = JSON.parse(JSON.stringify(saved));
    jest.restoreAllMocks();
    jest.spyOn(globalThis.performance, "now").mockReturnValue(50);
    jest.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const loaded = clockOnLoad(stored, false);
    expect(loaded.startedAt).toBe(50);
    expect(clockElapsedMs(loaded)).toBe(40_000);
    jest.spyOn(globalThis.performance, "now").mockReturnValue(2_050);
    expect(clockElapsedMs(loaded)).toBe(42_000);
  });
});
