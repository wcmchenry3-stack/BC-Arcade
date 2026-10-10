/**
 * #2963: display-list colours are packed 0xAARRGGBB numbers.
 */
import { alphaOf, cssColor, cssHex, cssRgba, opaque, rgbFromHex, withAlpha } from "../render/color";

describe("packed colours", () => {
  it("withAlpha packs a 0xRRGGBB colour with a byte alpha, unsigned", () => {
    expect(withAlpha(0x00aaff, 1)).toBe(0xff00aaff);
    expect(withAlpha(0xffffff, 0.5)).toBe(0x80ffffff);
    expect(withAlpha(0x123456, 0)).toBe(0x00123456);
    expect(withAlpha(0xffffff, 1)).toBeGreaterThan(0); // never a negative int32
  });

  it("alpha is clamped to 0–1, like CSS, and the rgb is masked to 24 bits", () => {
    expect(withAlpha(0x00aaff, 1.7)).toBe(0xff00aaff);
    expect(withAlpha(0x00aaff, -0.2)).toBe(0x0000aaff);
    expect(withAlpha(0xff00aaff, 0.5)).toBe(0x8000aaff);
  });

  it("alphaOf reads the alpha back to within a byte step", () => {
    expect(alphaOf(withAlpha(0x00aaff, 0.45))).toBeCloseTo(0.45, 2);
    expect(alphaOf(0xff000000)).toBe(1);
  });

  it("cssColor writes the rgba() the web canvas takes", () => {
    expect(cssColor(0xffff4422)).toBe("rgba(255,68,34,1)");
    expect(cssColor(withAlpha(0x00aaff, 0.45))).toBe("rgba(0,170,255,0.451)");
    expect(cssColor(0x00000000)).toBe("rgba(0,0,0,0)");
  });
});

describe("palette helpers (#2989)", () => {
  it("opaque packs a 0xRRGGBB colour at full alpha, unsigned", () => {
    expect(opaque(0x00ffcc)).toBe(0xff00ffcc);
    expect(opaque(0xffffff)).toBe(0xffffffff);
    expect(opaque(0x000010)).toBe(0xff000010);
  });

  it("rgbFromHex and cssHex round-trip the theme's #rrggbb strings", () => {
    expect(rgbFromHex("#00ffcc")).toBe(0x00ffcc);
    expect(cssHex(0x00ffcc)).toBe("#00ffcc");
    expect(cssHex(0x000010)).toBe("#000010");
    expect(cssHex(rgbFromHex("#ff4422"))).toBe("#ff4422");
  });

  it("cssRgba keeps the alpha exactly as given", () => {
    expect(cssRgba(0x00aaff, 0.25)).toBe("rgba(0,170,255,0.25)");
    expect(cssRgba(0xffffff, 0.2)).toBe("rgba(255,255,255,0.2)");
  });
});
