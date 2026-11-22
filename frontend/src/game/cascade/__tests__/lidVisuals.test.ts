import { CASCADE_LID_PALETTE } from "../../../theme/theme.cascade";
import { OVERFLOW_LINE_Y } from "../constants";
import {
  RING_GLOW_FROM,
  SPAWNER,
  isOverLid,
  lidColor,
  mixHex,
  overLidWash,
  ringArcPath,
  ringState,
  spawnerPieceRadius,
} from "../lidVisuals";

const light = CASCADE_LID_PALETTE.light;
const dark = CASCADE_LID_PALETTE.dark;

describe("mixHex", () => {
  it("returns the ends at 0 and 1 and the midpoint between", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("clamps t and treats a non-finite t as 0", () => {
    expect(mixHex("#102030", "#ffffff", -1)).toBe("#102030");
    expect(mixHex("#102030", "#ffffff", 9)).toBe("#ffffff");
    expect(mixHex("#102030", "#ffffff", NaN)).toBe("#102030");
  });
});

describe("ringState: the spawner clock ring from dangerRatio", () => {
  it.each([
    ["light", light],
    ["dark", dark],
  ] as const)("%s: calm is a full cyan ring with no glow", (_name, palette) => {
    expect(ringState(0, palette)).toEqual({
      remaining: 1,
      sweepDeg: 360,
      color: palette.ringSafe,
      glow: false,
    });
  });

  it("drains clockwise as the danger rises: remaining = 1 - dangerRatio", () => {
    expect(ringState(0.25, light).sweepDeg).toBeCloseTo(270);
    expect(ringState(0.5, light).remaining).toBeCloseTo(0.5);
    expect(ringState(0.9, light).sweepDeg).toBeCloseTo(36);
    expect(ringState(1, light).remaining).toBe(0);
  });

  it("turns from cyan to red, and is fully red before the end", () => {
    const half = ringState(0.5, dark).color;
    expect(half).not.toBe(dark.ringSafe);
    expect(half).not.toBe(dark.danger);
    expect(ringState(0.8, dark).color).toBe(dark.danger);
    expect(ringState(0.95, dark).color).toBe(dark.danger);
  });

  it("glows only near the end", () => {
    expect(ringState(RING_GLOW_FROM - 0.01, light).glow).toBe(false);
    expect(ringState(RING_GLOW_FROM, light).glow).toBe(true);
    expect(ringState(0.9, light).glow).toBe(true);
    // Nothing left to glow at game over.
    expect(ringState(1, light).glow).toBe(false);
  });

  it("treats out-of-range ratios as their ends", () => {
    expect(ringState(-1, light)).toEqual(ringState(0, light));
    expect(ringState(2, light)).toEqual(ringState(1, light));
  });
});

describe("ringArcPath", () => {
  it("starts at 12 o'clock and runs clockwise", () => {
    // A quarter sweep ends at 3 o'clock.
    expect(ringArcPath(100, 100, 10, 90)).toBe("M 100 90 A 10 10 0 0 1 110 100");
    // Three quarters ends at 9 o'clock, with the large-arc flag.
    expect(ringArcPath(100, 100, 10, 270)).toBe("M 100 90 A 10 10 0 1 1 90 100");
  });

  it("is empty with nothing left", () => {
    expect(ringArcPath(0, 0, 10, 0)).toBe("");
  });
});

describe("lidColor", () => {
  it("is the calm lid colour when safe and the danger colour at the end", () => {
    expect(lidColor(0, light)).toBe(light.lid);
    expect(lidColor(1, light)).toBe(light.danger);
  });
});

describe("isOverLid / overLidWash: which pieces get the red wash", () => {
  it("uses the piece's top edge, not its centre", () => {
    expect(isOverLid({ y: OVERFLOW_LINE_Y + 10 }, 20)).toBe(true);
    expect(isOverLid({ y: OVERFLOW_LINE_Y + 20 }, 20)).toBe(false);
    expect(isOverLid({ y: OVERFLOW_LINE_Y + 30 }, 20)).toBe(false);
  });

  it("no wash while calm, even for a piece over the lid (e.g. one just dropped)", () => {
    expect(overLidWash({ y: 40 }, 20, 0)).toBeNull();
  });

  it("washes pieces over the lid while the count runs, stronger as it rises", () => {
    const low = overLidWash({ y: 40 }, 20, 0.2)!;
    const high = overLidWash({ y: 40 }, 20, 0.9)!;
    expect(low.opacity).toBeGreaterThan(0);
    expect(high.opacity).toBeGreaterThan(low.opacity);
    expect(high.opacity).toBeLessThanOrEqual(1);
  });

  it("does not wash pieces under the lid while the count runs", () => {
    expect(overLidWash({ y: 300 }, 20, 0.9)).toBeNull();
  });
});

describe("the spawner fits between the canvas top and the lid", () => {
  it("ring stays inside 0..OVERFLOW_LINE_Y", () => {
    const outer = SPAWNER.ringRadius + SPAWNER.ringWidth / 2;
    expect(SPAWNER.cy - outer).toBeGreaterThanOrEqual(0);
    expect(SPAWNER.cy + outer).toBeLessThanOrEqual(OVERFLOW_LINE_Y);
    expect(SPAWNER.maxPieceRadius).toBeLessThan(SPAWNER.ringRadius - SPAWNER.ringWidth / 2);
  });

  it("caps a big piece's drawn radius, keeps a small one", () => {
    expect(spawnerPieceRadius(16)).toBe(16);
    expect(spawnerPieceRadius(44)).toBe(SPAWNER.maxPieceRadius);
  });
});
