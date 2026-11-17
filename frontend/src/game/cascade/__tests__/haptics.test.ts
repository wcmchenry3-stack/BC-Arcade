/**
 * #3701: Cascade's haptics — B's map plus C's danger warning, paced, fired from timers (never
 * inside the frame), best effort, and nothing on web.
 */
import { Platform } from "react-native";
import * as Haptics from "expo-haptics";
import {
  chainHaptic,
  createHapticPacer,
  fireCascadeHaptic,
  landHaptic,
  mergeHaptic,
  type CascadeHaptic,
} from "../haptics";
import { MOTION } from "../motion";

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

/** A pacer on a fake clock: `fired` lists [time, kind]. */
function pacerOnClock() {
  let now = 0;
  const timers: { at: number; run: () => void }[] = [];
  const fired: [number, CascadeHaptic][] = [];
  const pacer = createHapticPacer({
    now: () => now,
    schedule: (run, delay) => {
      timers.push({ at: now + delay, run });
    },
    fire: (kind) => fired.push([now, kind]),
  });
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      now = next.at;
      next.run();
    }
    now = end;
  };
  return { pacer, fired, advance, timers };
}

describe("the map (owner pick B + C's danger)", () => {
  it("land: Light, Medium for big pieces", () => {
    expect(landHaptic(0)).toBe("light");
    expect(landHaptic(5)).toBe("light");
    expect(landHaptic(6)).toBe("medium");
  });

  it("merge: Medium, Heavy, then a double Heavy, by the tier it made", () => {
    expect(mergeHaptic(1)).toEqual({ kind: "medium", double: false });
    expect(mergeHaptic(5)).toEqual({ kind: "heavy", double: false });
    expect(mergeHaptic(8)).toEqual({ kind: "heavy", double: true });
  });

  it("chain: a rising run", () => {
    expect([2, 3, 4, 7].map(chainHaptic)).toEqual(["light", "medium", "heavy", "heavy"]);
  });
});

describe("pacing", () => {
  it("fires from a timer, never inside the call that reported the event", () => {
    const { pacer, fired, advance } = pacerOnClock();
    pacer.merge(2, 1);
    expect(fired).toEqual([]);
    advance(0);
    expect(fired).toEqual([[0, "medium"]]);
  });

  it("a chain's pulses follow the counter's steps, 80 ms apart, rising", () => {
    const { pacer, fired, advance } = pacerOnClock();
    pacer.merge(1, 1); // the drop's first merge
    advance(17);
    pacer.merge(2, 2); // the links arrive 17-50 ms apart …
    advance(17);
    pacer.merge(3, 3);
    advance(33);
    pacer.merge(4, 4);
    advance(1000);
    expect(fired).toEqual([
      [0, "medium"],
      [MOTION.haptics.minGapMs, "light"], // 17 ms after the merge: waits for the gap
      [17 + MOTION.chain.stepMs, "medium"],
      [17 + 2 * MOTION.chain.stepMs, "heavy"],
    ]);
  });

  it("no two pulses closer than the minimum gap; a big merge's double comes after it", () => {
    const { pacer, fired, advance } = pacerOnClock();
    pacer.merge(8, 1);
    pacer.merge(1, 1);
    advance(500);
    const times = fired.map(([t]) => t);
    expect(times).toEqual([0, MOTION.haptics.doubleGapMs, MOTION.haptics.doubleGapMs + 40]);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(MOTION.haptics.minGapMs);
    }
  });

  it("drops a landing that comes right after another, or while pulses wait", () => {
    const { pacer, fired, advance } = pacerOnClock();
    pacer.land(1);
    advance(30);
    pacer.land(1); // 30 ms later: dropped
    advance(100);
    pacer.land(6);
    advance(10);
    pacer.merge(8, 1); // Heavy now and in 50 ms
    advance(10);
    pacer.land(2); // a pulse is still waiting: dropped
    advance(500);
    expect(fired.map(([, k]) => k)).toEqual(["light", "medium", "heavy", "heavy"]);
  });

  it("queues at most maxQueued; more are dropped", () => {
    const { pacer, fired, advance } = pacerOnClock();
    for (let i = 0; i < 20; i++) pacer.merge(1, 1);
    advance(5000);
    expect(fired).toHaveLength(MOTION.haptics.maxQueued);
  });

  it("danger: one Warning when the count passes 0.5, again only after it cleared", () => {
    const { pacer, fired, advance } = pacerOnClock();
    for (const r of [0.1, 0.49, 0.5, 0.7, 0.99]) pacer.danger(r);
    advance(100);
    expect(fired.map(([, k]) => k)).toEqual(["warning"]);
    pacer.danger(0.6);
    pacer.danger(0);
    pacer.danger(0.8);
    advance(100);
    expect(fired.map(([, k]) => k)).toEqual(["warning", "warning"]);
  });

  // #3928: one selection tick when a press becomes a drag.
  it("a drag start is one selection tick", () => {
    const { pacer, fired, advance } = pacerOnClock();
    pacer.dragStart();
    advance(100);
    expect(fired).toEqual([[0, "selection"]]);
  });

  it("reset cancels what is waiting", () => {
    const { pacer, fired, advance } = pacerOnClock();
    pacer.merge(8, 1);
    pacer.reset();
    advance(500);
    expect(fired).toEqual([]);
  });
});

describe("fireCascadeHaptic (best effort)", () => {
  const os = Platform.OS;
  afterEach(() => {
    Platform.OS = os;
    jest.clearAllMocks();
  });

  it("a selection tick is expo-haptics' selectionAsync", () => {
    Platform.OS = "ios";
    fireCascadeHaptic("selection");
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });

  it("maps to expo-haptics", () => {
    Platform.OS = "ios";
    fireCascadeHaptic("light");
    fireCascadeHaptic("heavy");
    fireCascadeHaptic("warning");
    expect(Haptics.impactAsync).toHaveBeenNthCalledWith(1, "light");
    expect(Haptics.impactAsync).toHaveBeenNthCalledWith(2, "heavy");
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("warning");
  });

  it("does nothing on web", () => {
    Platform.OS = "web";
    fireCascadeHaptic("heavy");
    fireCascadeHaptic("warning");
    fireCascadeHaptic("selection");
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  });

  it("swallows a failure, sync or async", async () => {
    Platform.OS = "android";
    (Haptics.impactAsync as jest.Mock).mockImplementationOnce(() => {
      throw new Error("no motor");
    });
    expect(() => fireCascadeHaptic("light")).not.toThrow();
    (Haptics.impactAsync as jest.Mock).mockImplementationOnce(() => Promise.reject(new Error("x")));
    expect(() => fireCascadeHaptic("medium")).not.toThrow();
    await Promise.resolve();
  });
});
