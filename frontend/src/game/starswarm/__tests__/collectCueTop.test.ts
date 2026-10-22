/**
 * #3187: the collect-the-power-ups line must sit below the HUD stack and the GUNS/HULL toast and
 * clear of the centred MISSION COMPLETE banner, at every displayed canvas height.
 */
import { collectCueTop, COLLECT_CUE_MIN_TOP } from "../render/pickupCue";

/** Bottom of the toast zone on native: its ~105 px bottom edge. */
const TOAST_ZONE_BOTTOM = 105;
const CUE_H = 22;
const BANNER_HALF_H = 14;

describe("collectCueTop", () => {
  it("uses 24% of the height on a tall canvas", () => {
    expect(collectCueTop(640)).toBeCloseTo(153.6);
  });

  it.each([320, 480, 640])(
    "at displayed height %i it clears the toast zone and the centred banner",
    (h) => {
      const top = collectCueTop(h);
      expect(top).toBeGreaterThanOrEqual(TOAST_ZONE_BOTTOM);
      expect(top).toBeGreaterThanOrEqual(COLLECT_CUE_MIN_TOP);
      expect(top + CUE_H).toBeLessThanOrEqual(h / 2 - BANNER_HALF_H);
    }
  );

  it("on a canvas too short for both, drops below the banner instead of overlapping it", () => {
    const h = 240;
    expect(collectCueTop(h)).toBeGreaterThanOrEqual(h / 2 + BANNER_HALF_H);
  });
});
