import { dark, light, type Colors } from "../ThemeContext";

function luminance(hex: string): number {
  const linear = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(1) + 0.7152 * linear(3) + 0.0722 * linear(5);
}
function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const SURFACES = ["background", "surface", "surfacePeer", "surfaceAlt", "surfaceHigh"] as const;

describe.each([
  ["dark", dark],
  ["light", light],
] as [string, Colors][])("%s errorText token (#3773)", (_name, palette) => {
  it.each(SURFACES)("reaches WCAG AA (4.5:1) as text on %s", (surface) => {
    expect(contrast(palette.errorText, palette[surface])).toBeGreaterThanOrEqual(4.5);
  });
});

describe("errorText follows the theme", () => {
  it("light is darker than its error, which fails AA as text on cream", () => {
    expect(contrast(light.error, light.background)).toBeLessThan(4.5);
    expect(luminance(light.errorText)).toBeLessThan(luminance(light.error));
  });
});
