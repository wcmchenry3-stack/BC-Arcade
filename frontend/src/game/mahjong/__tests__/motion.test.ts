/**
 * Mahjong motion (#3613): every duration stays under the story's ceiling, and each animation
 * starts and ends where it should, so a tile never ends an animation anywhere but at rest.
 */
import {
  DEAL_IN_MS,
  HINT_BREATHE_MS,
  LIFT_SCALE,
  MATCH_MEET_AT,
  MATCH_MS,
  MISMATCH_SHAKE_MS,
  MOTION_CEILINGS_MS,
  SELECT_LIFT_MS,
  SHUFFLE_MS,
  WIN_CASCADE_MS,
  burstSparks,
  cascadeSparks,
  dealDelay,
  matchTileLook,
  restLook,
  shuffleDelay,
  tileLook,
} from "../motion";
import type { MotionClock, TileMotion } from "../motion";

const clock: MotionClock = { progress: { value: 0 }, t0: 0, duration: 100 };
const at = (p: number, over: Partial<Record<string, number>> = {}) => ({
  lift: p,
  shake: p,
  hint: p,
  deal: p,
  shuffle: p,
  dim: p,
  ...over,
});
const TW = 44;
const TH = 56;

describe("Mahjong motion — durations", () => {
  it("each animation stays under its ceiling", () => {
    expect(SELECT_LIFT_MS).toBeLessThanOrEqual(MOTION_CEILINGS_MS.select);
    expect(MISMATCH_SHAKE_MS).toBeLessThanOrEqual(MOTION_CEILINGS_MS.mismatch);
    expect(MATCH_MS).toBeLessThanOrEqual(MOTION_CEILINGS_MS.match);
    expect(HINT_BREATHE_MS).toBeLessThanOrEqual(MOTION_CEILINGS_MS.hint);
    expect(DEAL_IN_MS).toBeLessThanOrEqual(MOTION_CEILINGS_MS.dealIn);
    expect(SHUFFLE_MS).toBeLessThanOrEqual(MOTION_CEILINGS_MS.shuffle);
    expect(WIN_CASCADE_MS).toBeLessThanOrEqual(MOTION_CEILINGS_MS.win);
  });
});

describe("Mahjong motion — a tile's look", () => {
  it("at rest: flat, or lifted and a little larger when selected", () => {
    expect(restLook(false)).toMatchObject({ dx: 0, dy: 0, lift: 0, scale: 1, alpha: 1 });
    expect(restLook(true)).toMatchObject({ lift: 1, scale: LIFT_SCALE });
  });

  it("a select lifts to the selected look, with a spring's small overshoot on the way", () => {
    const m: TileMotion = { lift: { ...clock, from: 0, to: 1 } };
    expect(tileLook(m, true, at(0), TW, TH).lift).toBeCloseTo(0, 5);
    const mid = [0.5, 0.6, 0.7, 0.8].map((p) => tileLook(m, true, at(p), TW, TH).lift);
    expect(Math.max(...mid)).toBeGreaterThan(1);
    const end = tileLook(m, true, at(1), TW, TH);
    expect(end.lift).toBeCloseTo(1, 5);
    expect(end.scale).toBeCloseTo(LIFT_SCALE, 5);
  });

  it("a deselect settles back down to flat", () => {
    const m: TileMotion = { lift: { ...clock, from: 1, to: 0 } };
    expect(tileLook(m, false, at(0), TW, TH).lift).toBeCloseTo(1, 5);
    const end = tileLook(m, false, at(1), TW, TH);
    expect(end.lift).toBeCloseTo(0, 5);
    expect(end.scale).toBeCloseTo(1, 5);
  });

  it("a mismatch shakes sideways and comes to rest", () => {
    const m: TileMotion = { shake: clock };
    const swings = [0.05, 0.1, 0.2, 0.3].map((p) => tileLook(m, true, at(p), TW, TH).dx);
    expect(Math.max(...swings.map(Math.abs))).toBeGreaterThan(1);
    expect(tileLook(m, true, at(1), TW, TH).dx).toBeCloseTo(0, 5);
  });

  it("the deal drops each layer in from above, the top layer last", () => {
    const top = { deal: { ...clock, delay: dealDelay(4, 5) } };
    const bottom = { deal: { ...clock, delay: dealDelay(0, 5) } };
    expect(dealDelay(0, 5)).toBe(0);
    expect(dealDelay(4, 5)).toBeGreaterThan(dealDelay(2, 5));
    const start = tileLook(top, false, at(0), TW, TH);
    expect(start.dy).toBeLessThan(0);
    expect(start.alpha).toBe(0);
    // Half way, the bottom layer is further along than the top.
    expect(tileLook(bottom, false, at(0.4), TW, TH).dy).toBeGreaterThan(
      tileLook(top, false, at(0.4), TW, TH).dy
    );
    for (const m of [top, bottom]) {
      expect(tileLook(m, false, at(1), TW, TH)).toMatchObject({ dy: 0, alpha: 1 });
    }
  });

  it("the shuffle swirls each tile from its old place to its new one, in a wave", () => {
    const m: TileMotion = {
      shuffle: { ...clock, delay: shuffleDelay(0, 10), fromX: 80, fromY: -40 },
    };
    const start = tileLook(m, false, at(0), TW, TH);
    expect(start.dx).toBeCloseTo(80, 5);
    expect(start.dy).toBeCloseTo(-40, 5);
    // Lifted in mid-flight, on a curve (not the straight line back).
    const mid = tileLook(m, false, at(0.3), TW, TH);
    expect(mid.lift).toBeGreaterThan(0);
    expect(Math.abs(mid.dx / 80 - mid.dy / -40)).toBeGreaterThan(0.01);
    const end = tileLook(m, false, at(1), TW, TH);
    expect(end.dx).toBeCloseTo(0, 5);
    expect(end.dy).toBeCloseTo(0, 5);
    expect(end.lift).toBeCloseTo(0, 5);
    expect(shuffleDelay(9, 10)).toBeGreaterThan(shuffleDelay(1, 10));
  });

  it("the hint breathes, and the deadlock dims and clears", () => {
    const hint = { hint: clock };
    const glows = [0, 0.125, 0.25, 0.375, 0.5].map((p) => tileLook(hint, false, at(p), TW, TH));
    expect(glows[0]!.hintGlow).toBeCloseTo(0, 5);
    expect(glows[1]!.hintGlow).toBeCloseTo(0.5, 5);
    expect(glows[2]!.hintGlow).toBeCloseTo(1, 5);
    expect(glows[4]!.hintGlow).toBeCloseTo(0, 5);
    const dim = { dim: clock };
    expect(tileLook(dim, false, at(0.5), TW, TH).dim).toBeCloseTo(1, 5);
    expect(tileLook(dim, false, at(1), TW, TH).dim).toBeCloseTo(0, 5);
  });
});

describe("Mahjong motion — a match and the win", () => {
  it("the pair lifts, meets face to face at the middle, then bursts and fades", () => {
    const fw = 36;
    const left = (p: number) => matchTileLook(p, 0, 100, 100, 50, -1, fw);
    const right = (p: number) => matchTileLook(p, 200, 0, 100, 50, 1, fw);
    expect(left(0)).toMatchObject({ x: 0, y: 100, alpha: 1 });
    const meetL = left(MATCH_MEET_AT);
    const meetR = right(MATCH_MEET_AT);
    expect(meetL.x).toBeCloseTo(100 - fw / 2, 5);
    expect(meetR.x).toBeCloseTo(100 + fw / 2, 5);
    expect(meetL.y).toBeCloseTo(50, 5);
    expect(meetL.alpha).toBeCloseTo(1, 5);
    expect(left(1).alpha).toBeCloseTo(0, 5);
  });

  it("sparks fly from the meeting point only after the pair meets, and are gone at the end", () => {
    expect(burstSparks(MATCH_MEET_AT * 0.9, 50, 50, 40, 10)).toEqual([]);
    const sparks = burstSparks((MATCH_MEET_AT + 1) / 2, 50, 50, 40, 10);
    expect(sparks).toHaveLength(10);
    for (const s of sparks) {
      expect(Math.hypot(s.x - 50, s.y - 50)).toBeLessThanOrEqual(40);
      expect(s.alpha).toBeGreaterThan(0);
    }
    expect(burstSparks(1, 50, 50, 40, 10)).toEqual([]);
  });

  it("the win cascade spreads sparks across the board and ends empty", () => {
    const mid = cascadeSparks(0.5, 200, 150, 400, 300, 48);
    expect(mid.length).toBeGreaterThan(10);
    const spread = Math.max(...mid.map((s) => Math.hypot(s.x - 200, s.y - 150)));
    expect(spread).toBeGreaterThan(100);
    expect(cascadeSparks(1, 200, 150, 400, 300, 48)).toEqual([]);
  });
});
