/**
 * #3702: Cascade's sound pacing. Every sound plays from a timer (never inside the frame), chain
 * steps on the counter's 80 ms steps, landings and queues capped like the haptics, the danger
 * tick locked to the blink and never above 3 Hz, and nothing while quiet.
 */
import { createSoundPacer, DANGER_TICK_MIN_GAP_MS } from "../soundPacer";
import { DANGER_IDLE_PHASE, MOTION, dangerBlinkOn, stepDangerPhase } from "../motion";
import type { CascadeSoundName } from "../sounds";

/** A pacer on a fake clock: `played` lists [time, name, volume]. */
function pacerOnClock() {
  let now = 0;
  const timers: { at: number; run: () => void }[] = [];
  const played: [number, CascadeSoundName, number][] = [];
  const pacer = createSoundPacer({
    now: () => now,
    schedule: (run, delay) => {
      timers.push({ at: now + delay, run });
    },
    play: (name, volume) => played.push([now, name, volume]),
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
  /** `ms` of 60 Hz frames at the lid count `ratio`, as the loop steps the pacer. */
  const frames = (ms: number, ratio: number, quiet = false) => {
    for (let t = 0; t < ms; t += 16) {
      advance(16);
      pacer.danger(ratio, 16, quiet);
    }
    advance(0);
  };
  const names = () => played.map(([, n]) => n);
  return { pacer, played, advance, frames, names, timers };
}

describe("one-shot sounds", () => {
  it("play from a timer, never inside the call that found the event", () => {
    const { pacer, played, advance } = pacerOnClock();
    pacer.drop();
    pacer.land(3);
    pacer.merge(2, 1);
    pacer.win();
    expect(played).toEqual([]);
    advance(0);
    expect(played.map(([, n]) => n)).toEqual(["drop", "land-light", "merge-t2", "win"]);
  });

  it("a landing plays the light or heavy file at the tier's volume", () => {
    const { pacer, played, advance } = pacerOnClock();
    pacer.land(1);
    advance(100);
    pacer.land(9);
    advance(0);
    expect(played[0]![1]).toBe("land-light");
    expect(played[1]![1]).toBe("land-heavy");
    expect(played[1]![2]).toBeGreaterThan(played[0]![2]);
  });

  it("landings closer than landGapMs are dropped, not queued", () => {
    const { pacer, names, advance } = pacerOnClock();
    pacer.land(2);
    advance(MOTION.sound.landGapMs - 10);
    pacer.land(2);
    advance(20);
    pacer.land(2);
    advance(0);
    expect(names()).toEqual(["land-light", "land-light"]);
  });
});

describe("merges and chains", () => {
  it("a 4-chain plays its merges and chain steps on the counter's 80 ms steps", () => {
    const { pacer, played, advance } = pacerOnClock();
    // The engine reports a chain's links within one step or a few ms apart.
    pacer.merge(1, 1);
    pacer.merge(2, 2);
    advance(17);
    pacer.merge(3, 3);
    pacer.merge(4, 4);
    advance(1000);
    expect(played).toEqual([
      [0, "merge-t1", 1],
      [0, "merge-t2", 1],
      [0, "chain-1", 1],
      [80, "merge-t3", 1],
      [80, "chain-2", 1],
      [160, "merge-t4", 1],
      [160, "chain-3", 1],
    ]);
    expect(MOTION.chain.stepMs).toBe(80);
  });

  it("long chains replay chain-4, and at most maxQueued wait (rate limit)", () => {
    const { pacer, names, advance } = pacerOnClock();
    for (let link = 2; link <= 12; link++) pacer.merge(link % 11, link);
    advance(2000);
    expect(names().length).toBe(MOTION.sound.maxQueued);
    expect(names().filter((n) => n.startsWith("chain-"))).toEqual([
      "chain-1",
      "chain-2",
      "chain-3",
    ]);
  });

  it("the game over drops merges and chain steps still waiting, then plays its sound", () => {
    const { pacer, names, advance } = pacerOnClock();
    pacer.merge(1, 1);
    pacer.merge(2, 2);
    pacer.merge(3, 3);
    pacer.merge(4, 4);
    advance(0);
    pacer.gameOver();
    advance(1000);
    expect(names()).toEqual(["merge-t1", "merge-t2", "chain-1", "game-over"]);
  });

  it("a reset (a new game) drops what is waiting", () => {
    const { pacer, played, advance } = pacerOnClock();
    pacer.merge(1, 1);
    pacer.reset();
    advance(100);
    expect(played).toEqual([]);
  });
});

describe("the danger tick", () => {
  it.each([0.05, 0.3, 0.7, 1])(
    "at ratio %s ticks on the blink's on-beats, never more than 3 a second",
    (ratio) => {
      const { played, frames } = pacerOnClock();
      // The board's blink, stepped the same way: its on-beat onsets.
      let phase: number = DANGER_IDLE_PHASE;
      const onsets: number[] = [];
      for (let t = 16; t <= 10_000; t += 16) {
        const next = stepDangerPhase(phase, 16, ratio);
        if (!dangerBlinkOn(phase) && dangerBlinkOn(next)) onsets.push(t);
        phase = next;
      }
      frames(10_000, ratio);
      const ticks = played.map(([t]) => t);
      expect(ticks).toEqual(onsets);
      expect(ticks.length).toBeGreaterThan(0);
      for (let i = 1; i < ticks.length; i++) {
        expect(ticks[i]! - ticks[i - 1]!).toBeGreaterThanOrEqual(MOTION.danger.fastMs - 16);
        expect(ticks[i]! - ticks[i - 1]!).toBeGreaterThanOrEqual(DANGER_TICK_MIN_GAP_MS - 16);
      }
      // No window of one second ever holds more than maxHz ticks.
      for (const t0 of ticks) {
        expect(ticks.filter((t) => t >= t0 && t < t0 + 1000).length).toBeLessThanOrEqual(
          MOTION.danger.maxHz
        );
      }
    }
  );

  it("ticks faster and louder as the count runs out", () => {
    const slow = pacerOnClock();
    slow.frames(6000, 0.2);
    const fast = pacerOnClock();
    fast.frames(6000, 1);
    expect(fast.played.length).toBeGreaterThan(slow.played.length);
    expect(fast.played[0]![2]).toBeGreaterThan(slow.played[0]![2]);
    expect(fast.played.every(([, n]) => n === "danger")).toBe(true);
  });

  it("a ratio toggling every frame still never ticks above 3 Hz", () => {
    const { pacer, played, advance } = pacerOnClock();
    for (let i = 0; i < 1000; i++) {
      advance(16);
      pacer.danger(i % 2 ? 1 : 0, 16, false);
    }
    advance(0);
    const ticks = played.map(([t]) => t);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]! - ticks[i - 1]!).toBeGreaterThanOrEqual(DANGER_TICK_MIN_GAP_MS);
    }
  });

  it("a stalled frame moves the phase at most maxFrameStepMs", () => {
    const { pacer, played, advance } = pacerOnClock();
    advance(5000);
    pacer.danger(1, 5000, false); // one 5 s frame: no burst of ticks
    advance(0);
    expect(played.length).toBeLessThanOrEqual(1);
  });

  it("is silent at rest and while quiet, yet keeps its phase locked to the board's", () => {
    const { played, frames } = pacerOnClock();
    frames(3000, 0);
    expect(played).toEqual([]);
    frames(3000, 0.8, true);
    expect(played).toEqual([]);
    // After a quiet stretch the ticks resume on the blink's beat, not from a fresh phase: the
    // board's phase, stepped over the same 3 x 188 frames, has its first loud onset there.
    let phase: number = DANGER_IDLE_PHASE;
    let firstOnset = -1;
    for (let k = 1; k <= 3 * 188 && firstOnset < 0; k++) {
      const next = stepDangerPhase(phase, 16, k <= 188 ? 0 : 0.8);
      if (k > 2 * 188 && !dangerBlinkOn(phase) && dangerBlinkOn(next)) firstOnset = 16 * k;
      phase = next;
    }
    frames(3000, 0.8);
    expect(played[0]![0]).toBe(firstOnset);
  });
});
