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

const OUTCOME_KEYS = ["outcomeWin", "outcomeLoss", "outcomeDraw", "outcomeEnded"] as const;

describe.each([
  ["dark", dark],
  ["light", light],
] as [string, Colors][])("%s outcome tokens (#2501)", (_name, palette) => {
  it.each(OUTCOME_KEYS)("%s reaches WCAG AA (4.5:1) on surfaceHigh", (key) => {
    expect(contrast(palette[key], palette.surfaceHigh)).toBeGreaterThanOrEqual(4.5);
  });

  it("celebration reaches WCAG AA on surfaceHigh", () => {
    expect(contrast(palette.celebration, palette.surfaceHigh)).toBeGreaterThanOrEqual(4.5);
  });

  it("gives every outcome a distinct colour", () => {
    const values = OUTCOME_KEYS.map((k) => palette[k].toLowerCase());
    expect(new Set(values).size).toBe(values.length);
  });
});

it("uses a lighter scrim in light mode than in dark mode", () => {
  const alpha = (rgba: string) => Number(rgba.match(/[\d.]+\)$/)?.[0].replace(")", ""));
  expect(alpha(light.overlay)).toBeLessThan(alpha(dark.overlay));
});
