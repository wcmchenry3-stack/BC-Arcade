import {
  BROKEN_TIMING,
  EASE_OUT,
  LINEAR,
  MOON_TIMING,
  QUEEN_TIMING,
  cubicBezier,
  seg,
} from "../momentTimeline";

describe("cubicBezier", () => {
  it("runs from 0 to 1", () => {
    expect(EASE_OUT(0)).toBe(0);
    expect(EASE_OUT(1)).toBe(1);
  });

  it("matches CSS ease-in-out's midpoint and ease-out's front-loading", () => {
    expect(cubicBezier(0.42, 0, 0.58, 1)(0.5)).toBeCloseTo(0.5, 3);
    // The mockup's cubic-bezier(.2,.8,.2,1) is most of the way there by a quarter.
    expect(EASE_OUT(0.25)).toBeGreaterThan(0.7);
  });

  it("is a straight line for (0,0,1,1)", () => {
    for (const t of [0.1, 0.33, 0.7]) expect(cubicBezier(0, 0, 1, 1)(t)).toBeCloseTo(t, 3);
  });
});

describe("seg", () => {
  it("holds the first value before the start and the last after the end", () => {
    expect(seg(0, 100, 200, [0, 1], [5, 9], LINEAR)).toBe(5);
    expect(seg(1000, 100, 200, [0, 1], [5, 9], LINEAR)).toBe(9);
  });

  it("maps progress through the offsets like the Web Animations API", () => {
    // The queen's lift: 1 → 1.32 at 30 %, 1.22 at the end (linear here to read the keyframes).
    const lift = (t: number) => seg(t, 0, 900, [0, 0.3, 1], [1, 1.32, 1.22], LINEAR);
    expect(lift(270)).toBeCloseTo(1.32);
    expect(lift(135)).toBeCloseTo(1.16);
    expect(lift(900)).toBeCloseTo(1.22);
  });
});

describe("timelines against the sounds (#3588)", () => {
  it("strikes the Q♠ with the gong at 230 ms and ends after the 1.7 s hold and the return", () => {
    expect(QUEEN_TIMING.strike).toBe(230);
    expect(QUEEN_TIMING.caption).toBeGreaterThan(QUEEN_TIMING.strike);
    expect(QUEEN_TIMING.end).toBeGreaterThan(QUEEN_TIMING.settle);
  });

  it("cracks the heart on the dub, 160 ms after the lub", () => {
    expect(BROKEN_TIMING.dub - BROKEN_TIMING.lub).toBe(160);
  });

  it("orders the moon shot: wolf, title, answer, penalty, fade, end", () => {
    const order = [
      MOON_TIMING.wolf,
      MOON_TIMING.title,
      MOON_TIMING.answer,
      MOON_TIMING.penalty,
      MOON_TIMING.fade,
      MOON_TIMING.end,
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("keeps Reduce Motion short: the scorecard is not held long", () => {
    for (const t of [QUEEN_TIMING, BROKEN_TIMING, MOON_TIMING]) {
      expect(t.reducedEnd).toBeLessThanOrEqual(1200);
    }
  });
});
