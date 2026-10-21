/**
 * #3187: the collect-the-power-ups line must sit below the HUD stack and the GUNS/HULL toast,
 * even on a short canvas where 24% of the height would land inside them.
 */
import { collectCueTop, COLLECT_CUE_MIN_TOP, PICKUP_CUE_MS } from "../render/pickupCue";

/** Bottom of the toast zone on native: its ~105 px bottom edge, plus 8 px margin. */
const TOAST_ZONE_BOTTOM = 105;

describe("collectCueTop", () => {
  it("uses 24% of the height on a tall canvas", () => {
    expect(collectCueTop(640)).toBeCloseTo(153.6);
  });

  it("floors below the HUD stack and toast zone on a short canvas (320 px)", () => {
    expect(320 * 0.24).toBeLessThan(TOAST_ZONE_BOTTOM);
    expect(collectCueTop(320)).toBe(COLLECT_CUE_MIN_TOP);
    expect(collectCueTop(320)).toBeGreaterThan(TOAST_ZONE_BOTTOM);
    expect(collectCueTop(200)).toBe(COLLECT_CUE_MIN_TOP);
  });

  it("the toast is a real, short-lived cue this is placed against", () => {
    expect(PICKUP_CUE_MS).toBeGreaterThan(0);
  });
});
