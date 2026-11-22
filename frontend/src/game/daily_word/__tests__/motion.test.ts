/**
 * Daily Word motion (#3664): every animation stays under its story ceiling, so the game never
 * feels slow, and the sounds (#3665) can be timed to the same numbers.
 */
import {
  DELETE_PULSE_MS,
  FLIP_HALF_MS,
  LOSS_REVEAL_STAGGER_MS,
  SHAKE_MS,
  TILE_STAGGER_MS,
  TYPE_POP_MS,
  TYPE_POP_SCALE,
  WIN_HOP_MS,
  WIN_HOP_STAGGER_MS,
  WIN_SPARKLE_MS,
  lossRevealMs,
  rowFlipMs,
  winCelebrationMs,
  winDanceMs,
} from "../motion";

// The story's ceilings (#3664), kept here rather than exported from the module.
const CEILING = {
  typePop: 120,
  shake: 400,
  winDance: 600,
  sparkle: 1200,
  lossReveal: 900,
  rowFlip: 5 * 100 + 300,
};

describe("Daily Word motion", () => {
  it("a typed letter pops quickly, and a delete is quicker", () => {
    expect(TYPE_POP_MS).toBeLessThanOrEqual(CEILING.typePop);
    expect(DELETE_PULSE_MS).toBeLessThan(TYPE_POP_MS);
    expect(TYPE_POP_SCALE).toBeGreaterThan(1);
    expect(TYPE_POP_SCALE).toBeLessThanOrEqual(1.15);
  });

  it("a refusal's shake is short", () => {
    expect(SHAKE_MS).toBeLessThanOrEqual(CEILING.shake);
  });

  it("a row of up to six tiles turns over inside its ceiling", () => {
    expect(rowFlipMs(1)).toBe(2 * FLIP_HALF_MS);
    expect(rowFlipMs(5)).toBe(4 * TILE_STAGGER_MS + 2 * FLIP_HALF_MS);
    for (const n of [4, 5, 6]) expect(rowFlipMs(n)).toBeLessThanOrEqual(CEILING.rowFlip);
  });

  it("the win dance and sparkle stay under their ceilings, and the card waits for both", () => {
    for (const n of [4, 5, 6]) {
      expect(winDanceMs(n)).toBe((n - 1) * WIN_HOP_STAGGER_MS + WIN_HOP_MS);
      expect(winDanceMs(n)).toBeLessThanOrEqual(CEILING.winDance);
      expect(winCelebrationMs(n)).toBeGreaterThanOrEqual(winDanceMs(n));
      expect(winCelebrationMs(n)).toBeGreaterThanOrEqual(WIN_SPARKLE_MS);
    }
    expect(WIN_SPARKLE_MS).toBeLessThanOrEqual(CEILING.sparkle);
  });

  it("the loss reveal of up to six letters stays under its ceiling", () => {
    expect(lossRevealMs(5)).toBe(4 * LOSS_REVEAL_STAGGER_MS + 2 * FLIP_HALF_MS);
    for (const n of [4, 5, 6]) expect(lossRevealMs(n)).toBeLessThanOrEqual(CEILING.lossReveal);
  });

  it("an empty row takes no stagger", () => {
    expect(rowFlipMs(0)).toBe(2 * FLIP_HALF_MS);
    expect(winDanceMs(0)).toBe(WIN_HOP_MS);
  });
});
