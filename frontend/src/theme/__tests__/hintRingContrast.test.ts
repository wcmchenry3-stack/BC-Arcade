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
 * Sort's hint destination ring (#3658, #3660) is a 2 px border drawn on the game's page
 * background: WCAG 1.4.11 asks 3:1 for it.
 */
describe.each([
  ["dark", dark],
  ["light", light],
] as [string, Colors][])("%s: Sort hint destination ring", (_name, palette) => {
  it("hintRing reaches 3:1 on the board's background", () => {
    expect(contrast(palette.hintRing, palette.background)).toBeGreaterThanOrEqual(3);
  });
});

describe("why the ring is not colors.bonus", () => {
  it("bonus on the light theme's cream background is below 3:1", () => {
    expect(contrast(light.bonus, light.background)).toBeLessThan(3);
  });
});
