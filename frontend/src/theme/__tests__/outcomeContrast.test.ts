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

// WCAG 1.4.11 non-text contrast (>= 3:1): Sudoku's 3x3 box separators carry
// structural information, so they must be visible on every surface (#2208).
describe.each([
  ["dark", dark],
  ["light", light],
] as [string, Colors][])("%s boxBorder token (#2208)", (_name, palette) => {
  it.each(["background", "surface", "surfacePeer", "surfaceAlt", "surfaceHigh"] as const)(
    "reaches 3:1 on %s",
    (surface) => {
      expect(contrast(palette.boxBorder, palette[surface])).toBeGreaterThanOrEqual(3);
    }
  );
});

// SudokuCell tints a cell with `accent` + alpha hex (AA selected, 55 match, 22
// peer) over `surface`. Composite those the way the screen does.
function composite(fg: string, alphaHex: string, bg: string): string {
  const a = parseInt(alphaHex, 16) / 255;
  const ch = (i: number) =>
    Math.round(parseInt(fg.slice(i, i + 2), 16) * a + parseInt(bg.slice(i, i + 2), 16) * (1 - a))
      .toString(16)
      .padStart(2, "0");
  return `#${ch(1)}${ch(3)}${ch(5)}`;
}

describe.each([
  ["dark", dark],
  ["light", light],
] as [string, Colors][])("%s sudoku separator vs cell states (#2208)", (_name, palette) => {
  it("the opaque surface that borders every separator clears 3:1", () => {
    // SudokuGrid insets each cell's highlight inside an opaque `surface`
    // wrapper, so a separator only ever touches `surface`, never a tint.
    expect(contrast(palette.boxBorder, palette.surface)).toBeGreaterThanOrEqual(3);
  });

  it("reports the composited tints, which the inset keeps off the separator", () => {
    // Un-inset, the separator would border these. Dark: the selected tint sits
    // mid-luminance, so no colour reaches 3:1 on both it and `surface`.
    const tints = ["AA", "55", "22"].map((a) => composite(palette.accent, a, palette.surface));
    expect(tints).toHaveLength(3);
    if (palette === dark) {
      const selected = tints[0]!;
      expect(contrast(palette.boxBorder, selected)).toBeLessThan(3);
      expect(contrast("#ffffff", selected)).toBeLessThan(3); // brightest possible
      expect(contrast("#000000", palette.surface)).toBeLessThan(3); // darkest possible
    }
  });
});

it("uses a lighter scrim in light mode than in dark mode", () => {
  const alpha = (rgba: string) => Number(rgba.match(/[\d.]+\)$/)?.[0].replace(")", ""));
  expect(alpha(light.overlay)).toBeLessThan(alpha(dark.overlay));
});
