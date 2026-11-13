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

/** Every surface a screen paints text on (the page, cards, trays, raised bands) in both themes. */
const SURFACES = ["background", "surface", "surfacePeer", "surfaceAlt", "surfaceHigh"] as const;

describe.each([
  ["dark", dark],
  ["light", light],
] as [string, Colors][])("%s accentText token (#3748)", (_name, palette) => {
  it.each(SURFACES)("reaches WCAG AA (4.5:1) as text on %s", (surface) => {
    expect(contrast(palette.accentText, palette[surface])).toBeGreaterThanOrEqual(4.5);
  });

  it("reaches AA on the held-die tint, where the held pips and ring sit", () => {
    expect(contrast(palette.accentText, palette.heldBg)).toBeGreaterThanOrEqual(4.5);
  });

  it("is the colour of a Yacht potential score", () => {
    expect(palette.potential).toBe(palette.accentText);
  });

  it("the computer's purple (outcomeDraw) reaches AA on the scorecard surface", () => {
    expect(contrast(palette.outcomeDraw, palette.surface)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("accentText follows the theme", () => {
  it("dark keeps today's accent", () => {
    expect(dark.accentText).toBe(dark.accent);
  });

  it("light is darker than its accent, which fails AA as text on cream", () => {
    expect(light.accentText).not.toBe(light.accent);
    expect(contrast(light.accent, light.surface)).toBeLessThan(4.5);
    expect(luminance(light.accentText)).toBeLessThan(luminance(light.accent));
  });

  it("light is a teal still: about #00737e", () => {
    expect(light.accentText).toMatch(/^#00[67][0-9a-f]7[0-9a-f]$/i);
  });
});

describe.each([
  ["dark", dark],
  ["light", light],
] as [string, Colors][])("%s bonusText token (#3754)", (_name, palette) => {
  it.each(SURFACES)("reaches WCAG AA (4.5:1) as text on %s", (surface) => {
    expect(contrast(palette.bonusText, palette[surface])).toBeGreaterThanOrEqual(4.5);
  });
});

describe("bonusText follows the theme", () => {
  it("dark keeps today's bonus", () => {
    expect(dark.bonusText).toBe(dark.bonus);
  });

  it("light is darker than its bonus, which fails AA as text on cream", () => {
    expect(light.bonusText).toBe("#17692f");
    expect(light.bonusText).not.toBe(light.bonus);
    expect(contrast(light.bonus, light.background)).toBeLessThan(4.5);
    expect(luminance(light.bonusText)).toBeLessThan(luminance(light.bonus));
  });
});
