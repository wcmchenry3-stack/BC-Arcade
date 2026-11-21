/**
 * #3702: Cascade's sound pacing. Every sound plays from a timer (never inside the frame), chain
 * steps on the counter's 80 ms steps, landings and queues capped like the haptics, the danger
 * tick on the board's blink onsets (its own timer only under Reduce Motion) and never above 3 Hz,
 * and nothing but the end sounds while quiet.
 */
import { CALM_WIN_OFFSET_S, createSoundPacer, DANGER_TICK_MIN_GAP_MS } from "../soundPacer";
import { MOTION, dangerPeriodMs } from "../motion";
import { CELEBRATION_CARD_MS, CELEBRATION_CARD_MS_REDUCED } from "../celebration";
import type { CascadeSoundName } from "../sounds";

/** A pacer on a fake clock: `played` lists [time, name, volume, fromSeconds]. */
function pacerOnClock() {
  let now = 0;
  const timers: { at: number; run: () => void }[] = [];
  const played: [number, CascadeSoundName, number, number][] = [];
  const warmed: CascadeSoundName[] = [];
  const stopped: CascadeSoundName[] = [];
  const pacer = createSoundPacer({
    now: () => now,
    schedule: (run, delay) => {
      timers.push({ at: now + delay, run });
    },
    play: (name, volume, from) => played.push([now, name, volume, from]),
    prewarm: (name) => warmed.push(name),
    stop: (name) => stopped.push(name),
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
  const names = () => played.map(([, n]) => n);
  return { pacer, played, warmed, stopped, advance, names, timers };
}

describe("one-shot sounds", () => {
  it("play from a timer, never inside the call that found the event", () => {
    const { pacer, played, names, advance } = pacerOnClock();
    pacer.drop();
    pacer.land(3);
    pacer.merge(2, 1);
    pacer.win();
    expect(played).toEqual([]);
    advance(0);
    expect(names()).toEqual(["drop", "land-light", "merge-t2", "merge-t11", "win"]);
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

  it("landings within landGapMs are one sound: the highest tier among them", () => {
    const { pacer, played, advance } = pacerOnClock();
    // Three in one step: one sound, the heaviest.
    pacer.land(2);
    pacer.land(7);
    pacer.land(4);
    advance(0);
    expect(played.map(([, n, v]) => [n, v])).toEqual([["land-heavy", expect.any(Number)]]);
    expect(played[0]![2]).toBeCloseTo(0.6 + 0.4 * (7 / 11));
    // A lighter one inside the gap is dropped; a heavier one still plays.
    advance(MOTION.sound.landGapMs - 20);
    pacer.land(3);
    advance(0);
    expect(played).toHaveLength(1);
    pacer.land(9);
    advance(0);
    expect(played).toHaveLength(2);
    expect(played[1]![2]).toBeCloseTo(0.6 + 0.4 * (9 / 11));
    // After the gap anything plays again.
    advance(MOTION.sound.landGapMs + 1);
    pacer.land(0);
    advance(0);
    expect(played).toHaveLength(3);
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
    expect(played.map(([t, n]) => [t, n])).toEqual([
      [0, "merge-t1"],
      [0, "merge-t2"],
      [0, "chain-1"],
      [80, "merge-t3"],
      [80, "chain-2"],
      [160, "merge-t4"],
      [160, "chain-3"],
    ]);
    expect(MOTION.chain.stepMs).toBe(80);
  });

  it("long chains replay chain-4, and at most maxQueued links wait (a merge and its step are one)", () => {
    const { pacer, names, advance } = pacerOnClock();
    for (let link = 2; link <= 12; link++) pacer.merge(link % 11, link);
    advance(2000);
    const steps = names().filter((n) => n.startsWith("chain-"));
    expect(steps).toHaveLength(MOTION.sound.maxQueued);
    expect(names().filter((n) => n.startsWith("merge-"))).toHaveLength(MOTION.sound.maxQueued);
    expect(steps.slice(0, 4)).toEqual(["chain-1", "chain-2", "chain-3", "chain-4"]);
  });

  it("a merge of the same tier at the same time as the last is skipped (one sound, no flam)", () => {
    const { pacer, names, advance } = pacerOnClock();
    pacer.merge(3, 1);
    pacer.merge(3, 1);
    advance(0);
    expect(names()).toEqual(["merge-t3"]);
    advance(MOTION.sound.sameMergeMs + 1);
    pacer.merge(3, 1);
    advance(0);
    expect(names()).toEqual(["merge-t3", "merge-t3"]);
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

  it("a reset (a new game) drops what is waiting and stops the end sounds", () => {
    const { pacer, played, stopped, advance } = pacerOnClock();
    pacer.merge(1, 1);
    pacer.reset();
    advance(100);
    expect(played).toEqual([]);
    expect(stopped.sort()).toEqual(["game-over", "win"]);
  });
});

describe("the end sounds", () => {
  it("under Reduce Motion the win starts 0.5 s in, so its chord lands with the earlier card", () => {
    expect(CALM_WIN_OFFSET_S * 1000).toBe(CELEBRATION_CARD_MS - CELEBRATION_CARD_MS_REDUCED);
    expect(CALM_WIN_OFFSET_S).toBeCloseTo(0.5);
    const { pacer, played, advance } = pacerOnClock();
    pacer.win();
    advance(0);
    pacer.setCalm(true);
    pacer.win();
    advance(0);
    // The winning merge's own file always starts at 0; only the chord's file seeks.
    expect(played.map(([, n, , from]) => [n, from])).toEqual([
      ["merge-t11", 0],
      ["win", 0],
      ["merge-t11", 0],
      ["win", CALM_WIN_OFFSET_S],
    ]);
  });

  it("the winning merge plays merge-t11 with the win chord at the same instant (#3966)", () => {
    const { pacer, played, advance } = pacerOnClock();
    pacer.merge(10, 1);
    advance(500);
    pacer.win();
    advance(0);
    expect(played.map(([at, n, v, from]) => [at, n, v, from])).toEqual([
      [0, "merge-t10", 1, 0],
      [500, "merge-t11", 1, 0],
      [500, "win", 1, 0],
    ]);
  });

  it("the winning merge is not a paced merge: it needs no queue slot and no gap (#3966)", () => {
    const { pacer, names, advance } = pacerOnClock();
    // A full queue of chain links, then the win: merge-t11 and win still play.
    for (let link = 2; link <= 12; link++) pacer.merge(link % 10, link);
    pacer.win();
    advance(0);
    expect(names().slice(-2)).toEqual(["merge-t11", "win"]);
  });

  it("a plain merge never plays merge-t11 (#3966)", () => {
    const { pacer, names, advance } = pacerOnClock();
    for (let t = 0; t <= 10; t++) pacer.merge(t, 1);
    advance(1000);
    expect(names()).not.toContain("merge-t11");
  });

  it("a landing of tier 5 is light and tier 6 heavy (heavyLandTier 6, #3966)", () => {
    const { pacer, names, advance } = pacerOnClock();
    pacer.land(5);
    advance(100);
    pacer.land(6);
    advance(0);
    expect(names()).toEqual(["land-light", "land-heavy"]);
  });

  it("the end sounds play while quiet", () => {
    const { pacer, names, advance } = pacerOnClock();
    pacer.danger(0, true);
    pacer.gameOver();
    advance(0);
    expect(names()).toEqual(["game-over"]);
  });
});

describe("the danger tick", () => {
  it("plays on each board onset while the count runs, louder with the ratio", () => {
    const { pacer, played, advance } = pacerOnClock();
    pacer.danger(0.3, false);
    pacer.dangerOnset();
    advance(800);
    pacer.danger(0.9, false);
    pacer.dangerOnset();
    advance(0);
    expect(played.map(([t, n]) => [t, n])).toEqual([
      [0, "danger"],
      [800, "danger"],
    ]);
    expect(played[1]![2]).toBeGreaterThan(played[0]![2]);
  });

  it("never more than 3 a second, however often onsets come", () => {
    const { pacer, played, advance } = pacerOnClock();
    pacer.danger(1, false);
    for (let i = 0; i < 100; i++) {
      pacer.dangerOnset();
      advance(50);
    }
    const ticks = played.map(([t]) => t);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]! - ticks[i - 1]!).toBeGreaterThanOrEqual(DANGER_TICK_MIN_GAP_MS);
    }
  });

  it("is silent at rest and while quiet", () => {
    const { pacer, played, advance } = pacerOnClock();
    pacer.dangerOnset();
    pacer.danger(0.8, true);
    pacer.dangerOnset();
    advance(500);
    expect(played).toEqual([]);
  });

  it("pre-warms the danger and game-over players when the count first runs, once", () => {
    const { pacer, warmed, advance } = pacerOnClock();
    pacer.danger(0, false);
    advance(0);
    expect(warmed).toEqual([]);
    pacer.danger(0.1, false);
    pacer.danger(0.2, false);
    pacer.danger(0, false);
    pacer.danger(0.3, false);
    advance(0);
    expect(warmed).toEqual(["danger", "game-over"]);
  });

  it("under Reduce Motion (no blink) ticks on its own timer at the blink's period", () => {
    const { pacer, played, advance } = pacerOnClock();
    pacer.setCalm(true);
    pacer.danger(1, false);
    pacer.dangerOnset(); // there is no blink under Reduce Motion: an onset would be ignored
    advance(3000);
    const ticks = played.map(([t]) => t);
    const period = dangerPeriodMs(1);
    expect(ticks[0]).toBeCloseTo(period * MOTION.danger.duty);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]! - ticks[i - 1]!).toBeCloseTo(period);
    // The count stops: so does the ticker.
    pacer.danger(0, false);
    const n = ticks.length;
    advance(3000);
    expect(played).toHaveLength(n);
    // Reduce Motion off: the board's onsets take over again.
    pacer.setCalm(false);
    pacer.danger(0.5, false);
    advance(3000);
    expect(played).toHaveLength(n);
    pacer.dangerOnset();
    advance(0);
    expect(played).toHaveLength(n + 1);
  });

  it("is silent while the screen is away, and picks the count back up on return", () => {
    // The board's blink keeps running under a covering screen: its onsets must not tick.
    const { pacer, played, advance } = pacerOnClock();
    pacer.danger(0.5, false);
    pacer.setAway(true);
    pacer.dangerOnset();
    advance(2000);
    expect(played).toEqual([]);
    pacer.setAway(false);
    pacer.dangerOnset();
    advance(0);
    expect(played.map(([, n]) => n)).toEqual(["danger"]);
  });

  it("under Reduce Motion the calm ticker stops while away and restarts on return", () => {
    const { pacer, played, advance } = pacerOnClock();
    pacer.setCalm(true);
    pacer.danger(1, false);
    advance(1000);
    const before = played.length;
    expect(before).toBeGreaterThan(0);
    pacer.setAway(true);
    advance(10_000);
    expect(played).toHaveLength(before);
    pacer.setAway(false);
    advance(dangerPeriodMs(1) * MOTION.danger.duty);
    expect(played).toHaveLength(before + 1);
  });
});
