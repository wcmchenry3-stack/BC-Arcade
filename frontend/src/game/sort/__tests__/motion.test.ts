/**
 * Sort motion (#3660): every duration stays under the owner's ceiling, the pour timeline's
 * numbers are the documented ones, and the helpers start and end where they should.
 */
import {
  CEILINGS_MS,
  COMPLETE_BADGE_MS,
  COMPLETE_PULSE_MS,
  COMPLETE_PULSE_SCALE,
  LEVEL_IN_ITEM_MS,
  LEVEL_IN_STAGGER_MAX_MS,
  LEVEL_IN_TOTAL_MS,
  POUR_LIFT_MS,
  POUR_RETURN_MS,
  POUR_TILT_MS,
  POUR_TRAVEL_MS,
  POUR_UNIT_MS,
  REDUCE_MOTION_POUR_MS,
  REFUSED_SHAKE_MS,
  SELECT_LIFT_FRAC,
  SELECT_LIFT_MS,
  SELECT_SETTLE_MS,
  UNDO_FADE_FROM,
  UNDO_FADE_MS,
  WIN_CASCADE_FADE_IN_MS,
  WIN_CASCADE_FADE_OUT_MS,
  WIN_CASCADE_HOLD_MS,
  WIN_CASCADE_MS,
  WIN_CASCADE_PIECES,
  WIN_CASCADE_STAGGER_MS,
  badgePopScale,
  clamp01,
  levelInDelayMs,
  levelInLook,
  pourFlowMs,
  pourTimeline,
  pourTotalMs,
  pulseScale,
  selectLiftPx,
  shakeOffsetPx,
} from "../motion";

describe("Sort motion — durations stay under the owner's ceilings (#3660)", () => {
  it("select, refused shake, complete, undo, level-in and the win cascade", () => {
    expect(SELECT_LIFT_MS).toBeLessThanOrEqual(CEILINGS_MS.select);
    expect(SELECT_SETTLE_MS).toBeLessThanOrEqual(CEILINGS_MS.select);
    expect(REFUSED_SHAKE_MS).toBeLessThanOrEqual(CEILINGS_MS.refusedShake);
    expect(COMPLETE_PULSE_MS).toBeLessThanOrEqual(CEILINGS_MS.complete);
    expect(COMPLETE_BADGE_MS).toBeLessThanOrEqual(COMPLETE_PULSE_MS);
    expect(UNDO_FADE_MS).toBeLessThanOrEqual(CEILINGS_MS.undo);
    expect(LEVEL_IN_TOTAL_MS).toBeLessThanOrEqual(CEILINGS_MS.levelIn);
    expect(WIN_CASCADE_MS).toBeLessThanOrEqual(CEILINGS_MS.winCascade);
  });

  it("the ceilings are the owner's numbers", () => {
    expect(CEILINGS_MS).toEqual({
      select: 200,
      pourOneUnit: 900,
      pourPerExtraUnit: 300,
      refusedShake: 250,
      complete: 450,
      undo: 300,
      levelIn: 600,
      winCascade: 1500,
    });
  });

  it.each([1, 2, 3, 4])("a pour of %i unit(s) is within 900 ms + 300 ms per extra unit", (n) => {
    expect(pourTotalMs(n)).toBeLessThanOrEqual(
      CEILINGS_MS.pourOneUnit + (n - 1) * CEILINGS_MS.pourPerExtraUnit
    );
  });

  it("the win cascade is its last piece's start, fade-in, hold and fade-out", () => {
    expect(WIN_CASCADE_MS).toBe(
      (WIN_CASCADE_PIECES - 1) * WIN_CASCADE_STAGGER_MS +
        WIN_CASCADE_FADE_IN_MS +
        WIN_CASCADE_HOLD_MS +
        WIN_CASCADE_FADE_OUT_MS
    );
  });

  it("Reduce Motion lands a pour at once", () => {
    expect(REDUCE_MOTION_POUR_MS).toBe(0);
  });
});

describe("pourTimeline", () => {
  it("one unit: lift 200, flow from 360, leaves at 540, lands at 660, ends at 900", () => {
    expect(pourTimeline(1)).toEqual({
      liftEndMs: 200,
      flowStartMs: 360,
      units: [{ leaveMs: 540, landMs: 660 }],
      flowEndMs: 660,
      endMs: 900,
    });
  });

  it("two, three and four units: 300 ms per unit, 1200 / 1500 / 1800 ms in all", () => {
    const two = pourTimeline(2);
    expect(two.units).toEqual([
      { leaveMs: 540, landMs: 660 },
      { leaveMs: 840, landMs: 960 },
    ]);
    expect(two.flowEndMs).toBe(960);
    expect(two.endMs).toBe(1200);
    expect(pourTimeline(3).endMs).toBe(1500);
    const four = pourTimeline(4);
    expect(four.units.map((u) => u.landMs)).toEqual([660, 960, 1260, 1560]);
    expect(four.flowEndMs).toBe(1560);
    expect(four.endMs).toBe(1800);
  });

  it.each([1, 2, 3, 4])("%i unit(s): in order, every unit lands before the stream stops", (n) => {
    const tl = pourTimeline(n);
    expect(tl.units).toHaveLength(n);
    expect(tl.liftEndMs).toBe(POUR_LIFT_MS);
    expect(tl.flowStartMs).toBe(POUR_LIFT_MS + POUR_TILT_MS);
    let prev = tl.flowStartMs;
    for (const u of tl.units) {
      expect(u.leaveMs).toBeGreaterThan(prev);
      expect(u.landMs).toBe(u.leaveMs + POUR_TRAVEL_MS);
      prev = u.leaveMs;
    }
    expect(tl.units[n - 1]!.landMs).toBeLessThanOrEqual(tl.flowEndMs);
    expect(tl.flowEndMs).toBe(tl.flowStartMs + pourFlowMs(n));
    expect(tl.endMs).toBe(tl.flowEndMs + POUR_RETURN_MS);
  });

  it("a unit count below one is a pour of one", () => {
    expect(pourTimeline(0)).toEqual(pourTimeline(1));
    expect(pourFlowMs(0)).toBe(POUR_UNIT_MS);
  });
});

describe("worklets", () => {
  it("clamp01", () => {
    expect([clamp01(-1), clamp01(0.4), clamp01(2)]).toEqual([0, 0.4, 1]);
  });

  it("select: lifts by a share of the bottle's height, never past the row gap, and holds", () => {
    expect(selectLiftPx(0, 156, 8)).toBe(-0);
    expect(selectLiftPx(1, 156, 8)).toBeCloseTo(-156 * SELECT_LIFT_FRAC, 5);
    // A bigger bottle lifts further, up to the gap above it and no more.
    expect(Math.abs(selectLiftPx(1, 100, 8))).toBeLessThan(Math.abs(selectLiftPx(1, 156, 8)));
    expect(selectLiftPx(1, 312, 8)).toBe(-8);
    // Past 1 it stays put: there is no bob.
    expect(selectLiftPx(0.5, 156, 8)).toBeCloseTo(selectLiftPx(1, 156, 8) / 2, 5);
  });

  it("the lift never exceeds the 10 px that used to reach into the row above", () => {
    for (const h of [60, 156, 250, 312]) expect(Math.abs(selectLiftPx(1, h, 8))).toBeLessThan(8.01);
  });

  it("shake: at rest at both ends, swings both ways in between", () => {
    expect(shakeOffsetPx(0, 52)).toBe(0);
    expect(shakeOffsetPx(1, 52)).toBe(0);
    const samples = Array.from({ length: 49 }, (_, i) => shakeOffsetPx((i + 1) / 50, 52));
    expect(Math.max(...samples)).toBeGreaterThan(0);
    expect(Math.min(...samples)).toBeLessThan(0);
    expect(Math.max(...samples.map(Math.abs))).toBeLessThanOrEqual(52 * 0.1 + 1e-9);
  });

  it("pulse: 1 at both ends, the peak scale in the middle", () => {
    expect(pulseScale(0)).toBe(1);
    expect(pulseScale(1)).toBe(1);
    expect(pulseScale(0.5)).toBeCloseTo(COMPLETE_PULSE_SCALE, 5);
  });

  it("badge pop: 0 to 1 with a small overshoot", () => {
    expect(badgePopScale(0)).toBe(0);
    expect(badgePopScale(1)).toBe(1);
    expect(Math.max(...[0.5, 0.6, 0.7, 0.8].map(badgePopScale))).toBeGreaterThan(1);
  });

  it("undo fades in from a lower opacity", () => {
    expect(UNDO_FADE_FROM).toBeGreaterThan(0);
    expect(UNDO_FADE_FROM).toBeLessThan(1);
  });
});

describe("level-in", () => {
  it.each([2, 3, 5, 7, 9, 12, 16])("%i bottles: all in place by 600 ms, in order", (count) => {
    const delays = Array.from({ length: count }, (_, i) => levelInDelayMs(i, count));
    expect(delays[0]).toBe(0);
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(delays[count - 1]! + LEVEL_IN_ITEM_MS).toBeLessThanOrEqual(LEVEL_IN_TOTAL_MS);
    if (count > 1) expect(delays[1]).toBeLessThanOrEqual(LEVEL_IN_STAGGER_MAX_MS);
  });

  it("one bottle has no delay", () => {
    expect(levelInDelayMs(0, 1)).toBe(0);
  });

  it("a bottle is hidden before its turn, in place after it, and the clock at 1 skips it all", () => {
    expect(levelInLook(0, 100)).toEqual({ opacity: 0, drop: 1 });
    const mid = levelInLook((100 + LEVEL_IN_ITEM_MS / 2) / LEVEL_IN_TOTAL_MS, 100);
    expect(mid.opacity).toBeGreaterThan(0);
    expect(mid.opacity).toBeLessThan(1);
    expect(mid.drop).toBeGreaterThan(0);
    for (const count of [2, 8, 16]) {
      for (let i = 0; i < count; i++) {
        expect(levelInLook(1, levelInDelayMs(i, count))).toEqual({ opacity: 1, drop: 0 });
      }
    }
  });
});
