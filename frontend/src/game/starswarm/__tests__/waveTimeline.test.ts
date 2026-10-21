/**
 * #3392: the wave timeline's buffer, admission, byte arithmetic and run-level collection
 * (engine/waveTimeline.ts; contract: docs/games/starswarm-diagnostics.md). The engine capture at
 * each trigger point is in waveTimeline.capture.test.ts.
 *
 * Tests may serialize (the engine tick never does): every byte count here is checked against
 * `JSON.stringify` of the wire form.
 */
import { CANVAS_H, CANVAS_W, closeWave, initStarSwarm } from "../engine";
import {
  EMPTY_TIMELINE,
  NO_TIMELINE_OVERFLOW,
  TIMELINE_MAX_BYTES,
  TIMELINE_MAX_ENTRIES,
  TIMELINE_ORDINARY_SLOTS,
  TIMELINE_POWERUP_MAX,
  TIMELINE_RUN_MAX_BYTES,
  TIMELINE_RUN_MAX_WAVES,
  TIMELINE_TRANSITION_MAX,
  TL,
  collectClosedTimeline,
  digits,
  openTimelineRun,
  revertTimeline,
  timelineT,
  timelineWireBytes,
  timelineX,
  tlBonusLife,
  tlBuffEnd,
  tlCarrierDown,
  tlCarrierStage,
  tlDropTerminal,
  tlHullHit,
  tlLifeLost,
  tlPhase,
  tlPickup,
  tlPlatingUp,
  tlRout,
  tlTerminal,
  toTimelineWire,
  type WaveTimeline,
} from "../engine/waveTimeline";
import type { WaveStatsSnapshot } from "../engine/waveStats";
import type { StarSwarmState } from "../types";
import { fitsSaveShape, restoreSavedState } from "../saveShape";

const W = CANVAS_W;

/** A recording run's state, wave `wave`. */
function recordingRun(wave = 1): StarSwarmState {
  return initStarSwarm(CANVAS_W, CANVAS_H, wave, 42, "Commander", undefined, undefined, {
    timelineOn: true,
  });
}

/** A snapshot of wave `wave` closing as `outcome`, with `lifeHits` / `platingHits` bullet hits. */
function snapOf(
  wave: number,
  outcome: "cleared" | "died",
  { durationMs = 12_345, life = 0, plating = 0, dev = false } = {}
): WaveStatsSnapshot {
  const s = recordingRun();
  const ws = s.waveStats;
  const bullet = { ...ws.damage.hits.bullet, life, plating };
  return closeWave(
    {
      ...s,
      wave,
      waveStats: {
        ...ws,
        dev,
        pacing: { ...ws.pacing, durationMs },
        damage: {
          ...ws.damage,
          hits: { ...ws.damage.hits, bullet },
          deathCause: outcome === "died" ? "bullet" : null,
        },
      },
    },
    outcome
  );
}

/** `n` hull hits at the widest `t`. */
function hits(n: number, tl: WaveTimeline = EMPTY_TIMELINE, ms = 6_553_500): WaveTimeline {
  for (let i = 0; i < n; i++) tl = tlHullHit(tl, ms, "ram", W, W, 1);
  return tl;
}

const stringified = (v: unknown) => JSON.stringify(v).length;

/** Every kept timeline's length, and the running total, equal the serialized lengths. */
function expectBytesExact(s: StarSwarmState): void {
  expect(s.closedTimelinesLens).toHaveLength(s.closedTimelines.length);
  s.closedTimelines.forEach((tl, i) => expect(s.closedTimelinesLens[i]).toBe(stringified(tl)));
  expect(s.closedTimelinesBytes).toBe(s.closedTimelines.reduce((n, tl) => n + stringified(tl), 0));
}

/** The buffer's arithmetic entry-list length equals the serialized one. */
function expectEBytes(tl: WaveTimeline): void {
  expect(tl.eBytes).toBe(stringified(tl.e));
}

describe("time and position quantization", () => {
  it("t is floor(round(durationMs) / 100), clamped at 65535", () => {
    expect(timelineT(0)).toBe(0);
    expect(timelineT(99.4)).toBe(0);
    expect(timelineT(99.5)).toBe(1); // rounds to 100 first
    expect(timelineT(199.49)).toBe(1);
    expect(timelineT(30_149)).toBe(301);
    expect(timelineT(6_553_599)).toBe(65_535);
    expect(timelineT(6_553_600)).toBe(65_535);
    expect(timelineT(1e12)).toBe(65_535);
  });

  it("t agrees with the snapshot's rounded ms: t == floor(stageReachedMs / 100) for the same raw value", () => {
    for (const raw of [0, 49.5, 99.5, 100.49, 12_345.67, 29_999.5]) {
      expect(timelineT(raw)).toBe(Math.floor(Math.round(raw) / 100));
    }
  });

  it("x is one of 64 columns of the run's own width, clamped at both edges", () => {
    expect(timelineX(0, W)).toBe(0);
    expect(timelineX(W, W)).toBe(63);
    expect(timelineX(W / 2, W)).toBe(32); // 31.5 rounds up
    expect(timelineX(-50, W)).toBe(0);
    expect(timelineX(W + 100, W)).toBe(63);
    expect(timelineX(100, 0)).toBe(63); // Infinity clamps
    expect(timelineX(0, 0)).toBe(0); // NaN reads as column 0
  });

  it("digits counts decimal digits", () => {
    expect([0, 9, 10, 99, 100, 65_535, 9_999_999].map(digits)).toEqual([1, 1, 2, 2, 3, 5, 7]);
  });
});

describe("entries: codes, arity and order", () => {
  it("each capture function writes its code's exact entry", () => {
    const ms = 12_345;
    let tl = EMPTY_TIMELINE;
    tl = tlPhase(tl, ms, "Playing");
    tl = tlHullHit(tl, ms, "bullet", 0, W, 0);
    tl = tlLifeLost(tl, ms, "ram", W, W, 2);
    tl = tlBonusLife(tl, ms, 2, 4);
    tl = tlPlatingUp(tl, ms, 1);
    tl = tlCarrierStage(tl, ms, "exposed");
    tl = tlCarrierDown(tl, ms, "buddy");
    tl = tlRout(tl, ms);
    tl = tlPickup(tl, ms, "bomb");
    tl = tlBuffEnd(tl, ms, "shield");
    expect(tl.e).toEqual([
      [123, TL.PHASE, 1],
      [123, TL.HULL_HIT, 0, 0, 0],
      [123, TL.LIFE_LOST, 3, 63, 2],
      [123, TL.BONUS_LIFE, 2, 4],
      [123, TL.PLATING_UP, 1],
      [123, TL.CARRIER_STAGE, 1],
      [123, TL.CARRIER_DOWN, 6],
      [123, TL.ROUT],
      [123, TL.PICKUP, 3],
      [123, TL.BUFF_END, 1],
    ]);
    expectEBytes(tl);
  });

  it("is append order: a later call is a later entry, and nothing reorders by t", () => {
    let tl = EMPTY_TIMELINE;
    tl = tlPickup(tl, 1_000, "shield");
    tl = tlHullHit(tl, 2_000, "rock", 10, W, 0);
    tl = tlBuffEnd(tl, 6_000, "shield");
    tl = tlLifeLost(tl, 6_000, "bullet", 10, W, 1);
    expect(tl.e.map((e) => e[1])).toEqual([TL.PICKUP, TL.HULL_HIT, TL.BUFF_END, TL.LIFE_LOST]);
    expect(tl.e.map((e) => e[0])).toEqual([10, 20, 60, 60]);
  });

  it("records nothing for the implicit or excluded values", () => {
    expect(tlPhase(EMPTY_TIMELINE, 0, "SwoopIn")).toBe(EMPTY_TIMELINE);
    expect(tlPhase(EMPTY_TIMELINE, 0, "GameOver")).toBe(EMPTY_TIMELINE);
    expect(tlCarrierStage(EMPTY_TIMELINE, 0, "protected")).toBe(EMPTY_TIMELINE);
    expect(tlPickup(EMPTY_TIMELINE, 0, "salvage")).toBe(EMPTY_TIMELINE);
    expect(tlPickup(EMPTY_TIMELINE, 0, "hull")).toBe(EMPTY_TIMELINE);
  });

  it("lives saturate at 255 and never go below 0", () => {
    const tl = tlBonusLife(tlLifeLost(EMPTY_TIMELINE, 0, "rock", 0, W, -3), 0, 999, 1_000);
    expect(tl.e).toEqual([
      [0, TL.LIFE_LOST, 1, 0, 0],
      [0, TL.BONUS_LIFE, 255, 255],
    ]);
  });

  it("an append is copy-on-write: the input buffer is never changed", () => {
    const one = tlRout(EMPTY_TIMELINE, 100);
    const two = tlRout(one, 200);
    expect(one.e).toHaveLength(1);
    expect(two.e).toHaveLength(2);
    expect(EMPTY_TIMELINE.e).toHaveLength(0);
    expect(two.e[0]).toBe(one.e[0]);
  });
});

describe("capacity and priority (D3)", () => {
  it("the 9th power-up entry is refused and counted in ovf[2]", () => {
    let tl = EMPTY_TIMELINE;
    for (let i = 0; i < TIMELINE_POWERUP_MAX; i++) tl = tlPickup(tl, i * 100, "shield");
    const full = tl;
    tl = tlBuffEnd(tl, 900, "shield");
    expect(tl.e).toBe(full.e); // a refusal shares the entry list
    expect(tl.e).toHaveLength(TIMELINE_POWERUP_MAX);
    expect(tl.ovf).toEqual([0, 0, 1]);
    // other classes still get in
    expect(tlRout(tl, 1_000).e).toHaveLength(TIMELINE_POWERUP_MAX + 1);
    expect(tlHullHit(tl, 1_000, "bullet", 0, W, 0).e).toHaveLength(TIMELINE_POWERUP_MAX + 1);
  });

  it("the 9th transition entry is refused and counted in ovf[1]", () => {
    let tl = EMPTY_TIMELINE;
    for (let i = 0; i < TIMELINE_TRANSITION_MAX; i++) tl = tlPhase(tl, i * 100, "Extraction");
    tl = tlCarrierDown(tl, 900, "shot");
    tl = tlRout(tl, 900);
    expect(tl.e).toHaveLength(TIMELINE_TRANSITION_MAX);
    expect(tl.ovf).toEqual([0, 2, 0]);
  });

  it("damage fills the 30 ordinary slots; a non-lethal hit is then refused, a lethal one takes slot 31 once", () => {
    let tl = hits(TIMELINE_ORDINARY_SLOTS);
    expect(tl.ord).toBe(TIMELINE_ORDINARY_SLOTS);
    const kept = tl.e;
    tl = tlHullHit(tl, 1, "bullet", 0, W, 0);
    tl = tlLifeLost(tl, 1, "bullet", 0, W, 2); // not lethal
    tl = tlBonusLife(tl, 1, 1, 3);
    tl = tlPickup(tl, 1, "shield");
    tl = tlRout(tl, 1);
    expect(tl.e).toBe(kept);
    expect(tl.ovf).toEqual([3, 1, 1]);
    tl = tlLifeLost(tl, 2_000, "beam", 0, W, 0); // lethal: slot 31
    expect(tl.e).toHaveLength(TIMELINE_ORDINARY_SLOTS + 1);
    expect(tl.e.at(-1)).toEqual([20, TL.LIFE_LOST, 2, 0, 0]);
    expect(tl.lethal).toBe(true);
    // a second lethal blow (after a rescue) finds the slot taken
    const after = tlLifeLost(tl, 3_000, "rock", 0, W, 0);
    expect(after.e).toBe(tl.e);
    expect(after.ovf).toEqual([4, 1, 1]);
    // the terminal entry is still admitted into the full buffer: 32 in all, nothing evicted
    const closed = tlTerminal(after, snapOf(1, "died", { durationMs: 4_000 }));
    expect(closed.e).toHaveLength(TIMELINE_MAX_ENTRIES);
    expect(closed.e.slice(0, -1)).toEqual(after.e);
    expect(closed.e.at(-1)).toEqual([40, TL.RUN_LOST, 0]);
    expectEBytes(closed);
  });

  it("a lethal blow takes an ordinary slot while one is free (slot 31 stays held)", () => {
    const tl = tlLifeLost(hits(3), 0, "ram", 0, W, 0);
    expect(tl.ord).toBe(4);
    expect(tl.lethal).toBe(false);
  });

  it("damage always has at least 14 ordinary slots, whatever P and C did", () => {
    let tl = EMPTY_TIMELINE;
    for (let i = 0; i < 20; i++) tl = tlPickup(tlRout(tl, i), i, "bomb");
    tl = hits(20, tl);
    expect(tl.p).toBe(TIMELINE_POWERUP_MAX);
    expect(tl.c).toBe(TIMELINE_TRANSITION_MAX);
    expect(tl.ord).toBe(TIMELINE_ORDINARY_SLOTS);
    expect(tl.e.filter((e) => e[1] === TL.HULL_HIT)).toHaveLength(14);
    expect(tl.ovf).toEqual([6, 12, 12]);
  });

  it("ovf saturates at 65535 (and a saturated refusal changes nothing)", () => {
    const sat: WaveTimeline = { ...hits(TIMELINE_ORDINARY_SLOTS), ovf: [65_534, 0, 0] };
    const once = tlHullHit(sat, 0, "bullet", 0, W, 0);
    expect(once.ovf).toEqual([65_535, 0, 0]);
    expect(tlHullHit(once, 0, "bullet", 0, W, 0)).toBe(once);
  });

  it("a refusal shares the entry list and replaces only ovf", () => {
    const full = hits(TIMELINE_ORDINARY_SLOTS);
    const refused = tlHullHit(full, 0, "bullet", 0, W, 0);
    expect(refused.e).toBe(full.e);
    expect({ ...refused, ovf: full.ovf }).toEqual(full);
  });
});

describe("bytes without serializing", () => {
  it("the entry list's arithmetic length equals its JSON after every append and the terminal pop", () => {
    let tl = EMPTY_TIMELINE;
    expectEBytes(tl);
    const steps: ((t: WaveTimeline) => WaveTimeline)[] = [
      (t) => tlPhase(t, 2_100, "Playing"),
      (t) => tlPickup(t, 14_800, "shield"),
      (t) => tlHullHit(t, 26_300, "bullet", 200, W, 0),
      (t) => tlLifeLost(t, 6_553_600, "ram", W, W, 255),
      (t) => tlBonusLife(t, 99_999, 3, 3),
      (t) => tlRout(t, 0),
    ];
    for (const step of steps) {
      tl = step(tl);
      expectEBytes(tl);
    }
    const closed = tlTerminal(tl, snapOf(3, "died"));
    expectEBytes(closed);
    const popped = tlDropTerminal(closed);
    expectEBytes(popped);
    expect(popped.e).toEqual(tl.e);
    expect(popped.term).toBe(false);
    // a lone terminal entry pops back to "[]"
    expectEBytes(tlDropTerminal(tlTerminal(EMPTY_TIMELINE, snapOf(1, "died"))));
  });

  it("the wire length equals JSON.stringify for every header value, ovf digit growth and the dev flag", () => {
    const tl = hits(TIMELINE_ORDINARY_SLOTS);
    for (const wave of [1, 9, 10, 99_999, 9_999_999]) {
      for (const outcome of ["cleared", "died"] as const) {
        for (const dev of [false, true]) {
          for (const ovf of [
            [0, 0, 0],
            [9, 0, 0],
            [10, 99, 100],
            [65_535, 65_535, 65_535],
          ] as const) {
            const snap = { ...snapOf(wave, outcome), dev };
            const closed = { ...tlTerminal(tl, snap), ovf };
            const wire = toTimelineWire(closed, snap);
            expect(timelineWireBytes(wave, outcome, dev, ovf, closed.eBytes)).toBe(
              stringified(wire)
            );
          }
        }
      }
    }
  });

  it("the doc's worked example (wave 7 death) is 169 B", () => {
    let tl = EMPTY_TIMELINE;
    tl = tlPhase(tl, 2_000, "Playing");
    tl = tlPickup(tl, 9_500, "bomb");
    tl = tlHullHit(tl, 16_000, "bullet", (12 / 63) * W, W, 0);
    tl = tlLifeLost(tl, 18_700, "rock", (50 / 63) * W, W, 1);
    tl = tlPickup(tl, 21_400, "shield");
    tl = tlBuffEnd(tl, 26_400, "shield");
    tl = tlLifeLost(tl, 30_100, "ram", (29 / 63) * W, W, 0);
    const snap = { ...snapOf(7, "died", { durationMs: 30_100 }) };
    const s = collectClosedTimeline(recordingRun(), tl, {
      ...snap,
      damage: { ...snap.damage, deathCause: "ram" },
    });
    expect(JSON.stringify(s.closedTimelines[0])).toBe(
      '{"v":1,"ev":1,"wave":7,"outcome":"died","dev":false,"ovf":[0,0,0],"e":[[20,10,1],[95,20,3],[160,1,0,12,0],[187,2,1,50,1],[214,20,1],[264,21,1],[301,2,3,29,0],[301,9,3]]}'
    );
    expect(s.closedTimelinesBytes).toBe(169);
    expectBytesExact(s);
  });

  it("the widest realistic timeline is under the per-event cap", () => {
    let tl = EMPTY_TIMELINE;
    for (let i = 0; i < TIMELINE_ORDINARY_SLOTS; i++)
      tl = tlLifeLost(tl, 6_553_500, "ram", W, W, 255);
    tl = tlLifeLost(tl, 6_553_500, "ram", W, W, 0);
    const snap = snapOf(9_999_999, "cleared", { durationMs: 6_553_500 });
    const closed = { ...tlTerminal(tl, snap), ovf: [65_535, 65_535, 65_535] as const };
    const bytes = stringified(toTimelineWire(closed, snap));
    expect(bytes).toBe(690); // the doc's worst case
    expect(bytes).toBeLessThan(TIMELINE_MAX_BYTES);
  });
});

describe("run-level collection (D1-C)", () => {
  it("a clean cleared wave is not kept: clean counts it", () => {
    const s = collectClosedTimeline(
      recordingRun(),
      tlRout(EMPTY_TIMELINE, 0),
      snapOf(1, "cleared")
    );
    expect(s.closedTimelines).toEqual([]);
    expect(s.closedTimelinesOverflow).toEqual({ ...NO_TIMELINE_OVERFLOW, clean: 1 });
  });

  it("a cleared wave that took plating or life damage is kept, ending WAVE_CLEARED", () => {
    for (const hit of [{ plating: 1 }, { life: 1 }]) {
      const snap = snapOf(2, "cleared", { durationMs: 40_249, ...hit });
      const s = collectClosedTimeline(recordingRun(), hits(1), snap);
      expect(s.closedTimelines).toHaveLength(1);
      expect(s.closedTimelines[0]).toMatchObject({ v: 1, ev: 1, wave: 2, outcome: "cleared" });
      expect(s.closedTimelines[0]!.e.at(-1)).toEqual([402, TL.WAVE_CLEARED]);
      expectBytesExact(s);
      // a cleared close leaves the target's live buffer alone (the next wave's)
      expect(s.waveTimeline).toBe(EMPTY_TIMELINE);
    }
  });

  it("the counters decide, not the buffer: a damaged wave whose damage entries were all refused is kept", () => {
    let tl = EMPTY_TIMELINE;
    for (let i = 0; i < TIMELINE_ORDINARY_SLOTS; i++)
      tl = tlPhase(tlPickup(tl, i, "bomb"), i, "Playing");
    // fill the rest with transitions/power-ups only... and leave no damage entry at all
    const noDamage: WaveTimeline = { ...tl, ord: TIMELINE_ORDINARY_SLOTS };
    const refused = tlHullHit(noDamage, 0, "bullet", 0, W, 0);
    expect(refused.e.some((e) => e[1] === TL.HULL_HIT)).toBe(false);
    const s = collectClosedTimeline(recordingRun(), refused, snapOf(1, "cleared", { plating: 1 }));
    expect(s.closedTimelines).toHaveLength(1);
    expect(s.closedTimelines[0]!.ovf[0]).toBe(1);
  });

  it("a died timeline is always a candidate, ends RUN_LOST with the death cause, and stays live", () => {
    const snap = snapOf(4, "died", { durationMs: 30_100, life: 1 });
    const s = collectClosedTimeline(recordingRun(), hits(2), {
      ...snap,
      damage: { ...snap.damage, deathCause: "beam" },
    });
    expect(s.closedTimelines[0]!.e.at(-1)).toEqual([301, TL.RUN_LOST, 2]);
    expect(s.waveTimeline!.term).toBe(true);
    expect(s.waveTimeline!.e).toBe(s.closedTimelines[0]!.e);
    expectBytesExact(s);
  });

  it("no buffer: unrecorded when recording was on or lost, nothing at all when the dial was off", () => {
    const on = collectClosedTimeline(recordingRun(), null, snapOf(1, "died"));
    expect(on.closedTimelinesOverflow).toEqual({ ...NO_TIMELINE_OVERFLOW, unrecorded: 1 });
    const lost = { ...recordingRun(), ...openTimelineRun(false), timelineLost: true };
    expect(
      collectClosedTimeline(lost, null, snapOf(1, "cleared", { life: 1 })).closedTimelinesOverflow
    ).toEqual({ ...NO_TIMELINE_OVERFLOW, unrecorded: 1 });
    const off = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Commander");
    expect(collectClosedTimeline(off, null, snapOf(1, "died"))).toBe(off);
  });

  it("the budget closes the list to cleared waves (full) while the died reserve still fits", () => {
    let s = recordingRun();
    let wave = 1;
    const big = hits(TIMELINE_ORDINARY_SLOTS);
    while (!s.closedTimelinesOverflow.full) {
      s = collectClosedTimeline(
        s,
        big,
        snapOf(wave++, "cleared", { plating: 1, durationMs: 6_553_500 })
      );
      expect(s.closedTimelinesBytes).toBeLessThanOrEqual(
        TIMELINE_RUN_MAX_BYTES - TIMELINE_MAX_BYTES
      );
      expectBytesExact(s);
    }
    const keptCleared = s.closedTimelines.length;
    expect(s.closedTimelinesOverflow).toMatchObject({ waves: 1, full: true });
    // closed: a later cleared wave that would fit is still refused
    s = collectClosedTimeline(s, EMPTY_TIMELINE, snapOf(wave++, "cleared", { plating: 1 }));
    expect(s.closedTimelines).toHaveLength(keptCleared);
    expect(s.closedTimelinesOverflow.waves).toBe(2);
    // the worst-case death still fits
    s = collectClosedTimeline(s, big, snapOf(wave, "died", { durationMs: 6_553_500 }));
    expect(s.closedTimelines).toHaveLength(keptCleared + 1);
    expect(s.closedTimelines.at(-1)!.outcome).toBe("died");
    expect(s.closedTimelinesBytes).toBeLessThanOrEqual(TIMELINE_RUN_MAX_BYTES);
    expectBytesExact(s);
  });

  it("at most 64 timelines a run: 63 cleared, then room for the death", () => {
    let s = recordingRun();
    for (let wave = 1; wave <= 70; wave++) {
      s = collectClosedTimeline(s, EMPTY_TIMELINE, snapOf(wave, "cleared", { life: 1 }));
    }
    expect(s.closedTimelines).toHaveLength(TIMELINE_RUN_MAX_WAVES - 1);
    expect(s.closedTimelinesOverflow).toMatchObject({ waves: 7, full: true });
    s = collectClosedTimeline(s, EMPTY_TIMELINE, snapOf(71, "died"));
    expect(s.closedTimelines).toHaveLength(TIMELINE_RUN_MAX_WAVES);
    // a second death of another wave (dev only) finds the hard cap
    s = collectClosedTimeline(s, EMPTY_TIMELINE, snapOf(72, "died"));
    expect(s.closedTimelines).toHaveLength(TIMELINE_RUN_MAX_WAVES);
    expect(s.closedTimelinesOverflow.waves).toBe(8);
    expectBytesExact(s);
  });

  it("an oversize timeline is refused and counted, without closing the list", () => {
    const snap = snapOf(1, "cleared", { life: 1 });
    const huge: WaveTimeline = { ...hits(3), eBytes: TIMELINE_MAX_BYTES }; // past the cap
    const s = collectClosedTimeline(recordingRun(), huge, snap);
    expect(s.closedTimelines).toEqual([]);
    expect(s.closedTimelinesOverflow).toMatchObject({ waves: 1, full: false });
    expect(s.closedTimelinesOverflow.bytes).toBeGreaterThan(TIMELINE_MAX_BYTES);
  });

  it("a repeated died close of one wave replaces the kept one (the latest that fits), counting devRepeats", () => {
    let s = collectClosedTimeline(recordingRun(), hits(1), snapOf(3, "cleared", { life: 1 }));
    s = collectClosedTimeline(s, hits(1), snapOf(4, "died", { durationMs: 1_000 }));
    const before = s.closedTimelinesBytes;
    const oldLen = s.closedTimelinesLens[1]!;
    s = collectClosedTimeline(s, hits(5), snapOf(4, "died", { durationMs: 2_000 }));
    expect(s.closedTimelines).toHaveLength(2);
    expect(s.closedTimelines[1]!.e.at(-1)).toEqual([20, TL.RUN_LOST, 0]);
    expect(s.closedTimelines[1]!.e).toHaveLength(6);
    expect(s.closedTimelinesBytes).toBe(before - oldLen + s.closedTimelinesLens[1]!);
    expect(s.closedTimelinesOverflow).toEqual({ ...NO_TIMELINE_OVERFLOW, devRepeats: 1 });
    expectBytesExact(s);
  });

  it("a replacement that doesn't fit counts only in devRepeats (not waves), and the earlier one stays", () => {
    let s = recordingRun();
    const big = hits(TIMELINE_ORDINARY_SLOTS);
    let wave = 1;
    while (!s.closedTimelinesOverflow.full)
      s = collectClosedTimeline(
        s,
        big,
        snapOf(wave++, "cleared", { plating: 1, durationMs: 6_553_500 })
      );
    s = collectClosedTimeline(s, EMPTY_TIMELINE, snapOf(wave, "died", { durationMs: 100 }));
    const kept = s.closedTimelines.at(-1)!;
    // pad the total right up to the hard cap so a bigger replacement can't fit
    s = { ...s, closedTimelinesBytes: TIMELINE_RUN_MAX_BYTES - 1 };
    const waves = s.closedTimelinesOverflow.waves;
    s = collectClosedTimeline(s, big, snapOf(wave, "died", { durationMs: 6_553_500 }));
    expect(s.closedTimelines.at(-1)).toBe(kept);
    expect(s.closedTimelinesOverflow.devRepeats).toBe(1);
    expect(s.closedTimelinesOverflow.waves).toBe(waves);
  });
});

describe("revertTimeline (the dev panel's infinite lives)", () => {
  it("pops the trailing RUN_LOST from the live buffer and flags the died timeline kept this tick", () => {
    const prev = recordingRun();
    const live = tlLifeLost(hits(2, EMPTY_TIMELINE, 1_000), 1_500, "bullet", 0, W, 0);
    const closed = collectClosedTimeline({ ...prev, waveTimeline: live }, live, snapOf(1, "died"));
    const reverted = revertTimeline(prev, closed);
    expect(reverted.waveTimeline!.e).toEqual(live.e);
    expect(reverted.waveTimeline!.term).toBe(false);
    expectEBytes(reverted.waveTimeline!);
    expect(reverted.closedTimelines[0]!.dev).toBe(true);
    expect(reverted.closedTimelinesBytes).toBe(closed.closedTimelinesBytes - 1);
    expectBytesExact(reverted);
    // the engine's own values are never mutated
    expect(closed.closedTimelines[0]!.dev).toBe(false);
    expect(closed.waveTimeline!.term).toBe(true);
  });

  it("leaves a tick that kept nothing, and timelines closed earlier, alone", () => {
    const prev = collectClosedTimeline(recordingRun(), hits(1), snapOf(1, "died"));
    const again = { ...prev, waveTimeline: tlDropTerminal(prev.waveTimeline!) };
    expect(revertTimeline(again, again)).toBe(again);
  });
});

describe("paused-run saves (#3393 restores the timeline)", () => {
  it("a save with the fields still fits, and the closed timelines restore as saved", () => {
    const recording = collectClosedTimeline(
      recordingRun(),
      hits(2, EMPTY_TIMELINE, 1_000),
      snapOf(1, "cleared", { plating: 2 })
    );
    expect(recording.closedTimelines).toHaveLength(1);
    const saved = JSON.parse(JSON.stringify(recording));
    expect(fitsSaveShape(saved)).toBe(true);
    const restored = restoreSavedState(saved);
    expect(restored).toMatchObject({
      timelineOn: true,
      timelineLost: false,
      closedTimelines: recording.closedTimelines,
      closedTimelinesLens: recording.closedTimelinesLens,
      closedTimelinesBytes: recording.closedTimelinesBytes,
      closedTimelinesOverflow: recording.closedTimelinesOverflow,
    });
    // a run whose dial was off stays off and counts nothing; a save without the flags (an older
    // build's) restores with recording lost
    const off = JSON.parse(JSON.stringify(initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Commander")));
    expect(restoreSavedState(off)).toMatchObject({ timelineOn: false, timelineLost: false });
    const { timelineOn: _on, timelineLost: _lost, waveTimeline: _tl, ...older } = off;
    expect(fitsSaveShape(older)).toBe(true);
    expect(restoreSavedState(older)).toMatchObject({
      waveTimeline: null,
      timelineOn: false,
      timelineLost: true,
      closedTimelines: [],
      closedTimelinesLens: [],
      closedTimelinesBytes: 0,
      closedTimelinesOverflow: NO_TIMELINE_OVERFLOW,
    });
  });
});
