/**
 * The die's tumble and hold (#3749): a full turn with a hop, faces flicking until it lands on its
 * final face with a squash; rolled dice start 35 ms apart; the hold eases over HOLD_MS; nothing
 * moves under Reduce Motion.
 */
import React from "react";
import { render } from "@testing-library/react-native";
import * as Reanimated from "react-native-reanimated";
import Die, { tumbleFace, tumbleTransform } from "../Die";
import { ThemeProvider } from "../../theme/ThemeContext";
import {
  HOLD_MS,
  TUMBLE_HOP_PX,
  TUMBLE_LAND_AT,
  TUMBLE_MS,
  TUMBLE_SQUASH_SCALE,
  TUMBLE_STAGGER_MS,
} from "../../game/yacht/motion";

type Transform = [{ translateY: number }, { rotate: string }, { scale: number }];
const parts = (p: number, lift = 0) => {
  const [y, r, s] = tumbleTransform(p, lift) as Transform;
  return { y: y.translateY, deg: parseFloat(r.rotate), scale: s.scale };
};

describe("tumbleFace", () => {
  it("flicks through faces while the die is in the air", () => {
    const seen = new Set<number>();
    for (let p = 0; p < TUMBLE_LAND_AT; p += 0.02) seen.add(tumbleFace(p, 4, 2));
    expect(seen.size).toBeGreaterThanOrEqual(3);
    for (const f of seen) {
      expect(f).toBeGreaterThanOrEqual(1);
      expect(f).toBeLessThanOrEqual(6);
    }
  });

  it("shows the final face from the landing on", () => {
    for (const p of [TUMBLE_LAND_AT, 0.9, 1]) expect(tumbleFace(p, 5, 0)).toBe(5);
  });
});

describe("tumbleTransform", () => {
  it("at rest: just the hold lift", () => {
    expect(parts(1, -4)).toEqual({ y: -4, deg: 0, scale: 1 });
  });

  it("turns a full 360 degrees, hops up to 18 pt, and lands with a small squash", () => {
    const start = parts(0);
    expect(start.y).toBeCloseTo(0);
    expect(start.deg).toBe(0);
    expect(start.scale).toBe(1);
    const mid = parts(0.4);
    expect(mid.y).toBeLessThan(-TUMBLE_HOP_PX * 0.9);
    expect(mid.y).toBeGreaterThanOrEqual(-TUMBLE_HOP_PX);
    expect(mid.deg).toBeGreaterThan(180);
    expect(parts(0.86).deg).toBeCloseTo(360);
    const squash = parts(0.9);
    expect(squash.scale).toBeGreaterThan(1);
    expect(squash.scale).toBeLessThanOrEqual(TUMBLE_SQUASH_SCALE);
    // Back on the table by the landing.
    expect(parts(TUMBLE_LAND_AT).y).toBeCloseTo(0);
  });
});

describe("Die", () => {
  const props = {
    value: 3,
    held: false,
    onPress: jest.fn(),
    disabled: false,
    index: 2,
    size: 56,
  };
  const renderDie = (over: Partial<React.ComponentProps<typeof Die>> = {}) =>
    render(
      <ThemeProvider>
        <Die {...props} {...over} />
      </ThemeProvider>
    );

  afterEach(() => jest.restoreAllMocks());

  it("a rolled die starts its tumble after its place's stagger, for TUMBLE_MS", async () => {
    const withDelay = jest.spyOn(Reanimated, "withDelay");
    const withTiming = jest.spyOn(Reanimated, "withTiming");
    const r = await renderDie();
    await r.rerender(
      <ThemeProvider>
        <Die {...props} rolling rollOrder={2} />
      </ThemeProvider>
    );
    expect(withDelay).toHaveBeenCalledWith(2 * TUMBLE_STAGGER_MS, expect.anything());
    expect(withTiming).toHaveBeenCalledWith(1, expect.objectContaining({ duration: TUMBLE_MS }));
  });

  it("at 2x (the computer's last turn) the stagger and the tumble are halved", async () => {
    const withDelay = jest.spyOn(Reanimated, "withDelay");
    const withTiming = jest.spyOn(Reanimated, "withTiming");
    const r = await renderDie();
    await r.rerender(
      <ThemeProvider>
        <Die {...props} rolling rollOrder={1} tumbleSpeed={2} />
      </ThemeProvider>
    );
    expect(withDelay).toHaveBeenCalledWith(TUMBLE_STAGGER_MS / 2, expect.anything());
    expect(withTiming).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ duration: TUMBLE_MS / 2 })
    );
  });

  it("under Reduce Motion it never tumbles: the face changes in place", async () => {
    const withDelay = jest.spyOn(Reanimated, "withDelay");
    const r = await renderDie({ reduceMotion: true });
    await r.rerender(
      <ThemeProvider>
        <Die {...props} value={6} rolling reduceMotion />
      </ThemeProvider>
    );
    expect(withDelay).not.toHaveBeenCalled();
    expect(r.getByTestId("yacht-die-2").props.accessibilityLabel).toMatch(/showing 6/);
  });

  it("a hold eases the lift and the ring in over HOLD_MS", async () => {
    const withTiming = jest.spyOn(Reanimated, "withTiming");
    const r = await renderDie();
    expect(withTiming).not.toHaveBeenCalled();
    await r.rerender(
      <ThemeProvider>
        <Die {...props} held />
      </ThemeProvider>
    );
    const durations = withTiming.mock.calls.map((c) => c[1]?.duration);
    expect(durations.filter((d) => d === HOLD_MS)).toHaveLength(2);
    expect(r.getByTestId("yacht-die-2-held-ring")).toBeTruthy();
  });
});
