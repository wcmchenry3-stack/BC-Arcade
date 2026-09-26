import { clockElapsedMs, clockForSave, clockOnLoad, pauseClock, resumeClock } from "../playClock";

describe("playClock (#2750)", () => {
  describe("pauseClock / resumeClock / clockElapsedMs", () => {
    it("banks the running segment on pause, and runs again from the resume", () => {
      const paused = pauseClock({ startedAt: 1_000, accumulatedMs: 500 }, 4_000);
      expect(paused).toEqual({ startedAt: null, accumulatedMs: 3_500 });
      expect(clockElapsedMs(paused, 99_000)).toBe(3_500);
      const resumed = resumeClock(paused, 10_000);
      expect(clockElapsedMs(resumed, 12_000)).toBe(5_500);
    });

    it("leaves a stopped clock stopped on pause, and a running one alone on resume", () => {
      const stopped = { startedAt: null, accumulatedMs: 0 };
      expect(pauseClock(stopped, 5)).toBe(stopped);
      const running = { startedAt: 1, accumulatedMs: 0 };
      expect(resumeClock(running, 5)).toBe(running);
    });
  });

  describe("clockForSave", () => {
    it("banks a running segment and keeps a running marker", () => {
      const saved = clockForSave({ startedAt: 1_000, accumulatedMs: 500 }, 4_000);
      expect(saved).toEqual({ startedAt: 4_000, accumulatedMs: 3_500 });
    });

    it("leaves a stopped clock as it is", () => {
      const state = { startedAt: null, accumulatedMs: 500 };
      expect(clockForSave(state, 4_000)).toBe(state);
    });

    it("keeps the rest of the state", () => {
      const saved = clockForSave({ startedAt: 1_000, accumulatedMs: 0, score: 7 }, 2_000);
      expect(saved.score).toBe(7);
    });
  });

  describe("clockOnLoad", () => {
    it("restarts a running clock from the load, so the time closed doesn't count", () => {
      const loaded = clockOnLoad({ startedAt: 4_000, accumulatedMs: 3_500 }, false, 900_000);
      expect(loaded).toEqual({ startedAt: 900_000, accumulatedMs: 3_500 });
    });

    it("restarts a clock that was paused with play banked", () => {
      const loaded = clockOnLoad({ startedAt: null, accumulatedMs: 3_500 }, false, 900_000);
      expect(loaded.startedAt).toBe(900_000);
    });

    it("leaves a game with no move yet waiting for its first", () => {
      const loaded = clockOnLoad({ startedAt: null, accumulatedMs: 0 }, false, 900_000);
      expect(loaded.startedAt).toBeNull();
    });

    it("keeps a finished game's clock frozen, even with a stray startedAt", () => {
      const loaded = clockOnLoad({ startedAt: 4_000, accumulatedMs: 3_500 }, true, 900_000);
      expect(loaded).toEqual({ startedAt: null, accumulatedMs: 3_500 });
    });

    // An older build saved the raw running segment: when the app closed is
    // unknown, so only the banked time carries over.
    it("drops an older build's unbanked running segment", () => {
      const loaded = clockOnLoad({ startedAt: 1_000, accumulatedMs: 0 }, false, 172_800_000);
      expect(loaded).toEqual({ startedAt: 172_800_000, accumulatedMs: 0 });
    });

    it("round-trips with clockForSave: earlier play kept, the gap excluded", () => {
      const saved = clockForSave({ startedAt: 0, accumulatedMs: 10_000 }, 30_000);
      const loaded = clockOnLoad(saved, false, 30_000 + 2 * 86_400_000);
      const now = loaded.startedAt! + 5_000;
      expect(loaded.accumulatedMs + (now - loaded.startedAt!)).toBe(45_000);
    });
  });
});
