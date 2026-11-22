import { dark, light, type Colors } from "../ThemeContext";

// WCAG 2.x relative luminance / contrast ratio for opaque #rrggbb colours.
function luminance(hex: string): number {
  const linear = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(1) + 0.7152 * linear(3) + 0.0722 * linear(5);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Sort's stars (#3687) are graphics drawn on the level tile and the result card
 * (both `surfaceHigh`): WCAG 1.4.11 asks 3:1. The filled star is `celebration`,
 * the outlined one `textMuted`; the shape, not the colour, tells them apart.
 */
describe.each([
  ["dark", dark],
  ["light", light],
] as [string, Colors][])("%s: Sort stars", (_name, palette) => {
  it("a filled star reaches 3:1 on the tile and card surface", () => {
    expect(contrast(palette.celebration, palette.surfaceHigh)).toBeGreaterThanOrEqual(3);
  });

  it("an outlined star reaches 3:1 on the tile and card surface", () => {
    expect(contrast(palette.textMuted, palette.surfaceHigh)).toBeGreaterThanOrEqual(3);
  });
});
