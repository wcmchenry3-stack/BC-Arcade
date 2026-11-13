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

const DARK_WAS = {
  secondaryText: "#d674ff",
  tertiaryText: "#cafd00",
  goldText: "#ffd700",
  warnText: "#ffb547",
} as const;
const LIGHT_IS = {
  secondaryText: "#8a3fb0",
  tertiaryText: "#586600",
  goldText: "#7a5600",
  warnText: "#8a5200",
} as const;
const TEXT_TOKENS = ["secondaryText", "tertiaryText", "goldText", "warnText"] as const;

describe.each([
  ["dark", dark],
  ["light", light],
] as [string, Colors][])(
  "%s secondaryText / tertiaryText / goldText / warnText (#3819)",
  (_n, p) => {
    describe.each(TEXT_TOKENS)("%s", (token) => {
      it.each(SURFACES)("reaches WCAG AA (4.5:1) as text on %s", (surface) => {
        expect(contrast(p[token], p[surface])).toBeGreaterThanOrEqual(4.5);
      });
    });
  }
);

describe("the #3819 text tokens follow the theme", () => {
  it.each(TEXT_TOKENS)("dark %s is exactly the colour it replaces", (token) => {
    expect(dark[token]).toBe(DARK_WAS[token]);
  });

  it("dark secondaryText / tertiaryText are the raw secondary / tertiary", () => {
    expect(dark.secondaryText).toBe(dark.secondary);
    expect(dark.tertiaryText).toBe(dark.tertiary);
  });

  it.each(TEXT_TOKENS)("light %s is the approved value", (token) => {
    expect(light[token]).toBe(LIGHT_IS[token]);
  });

  it("the raw colours they replace fail AA as text on cream", () => {
    expect(contrast(light.secondary, light.surface)).toBeLessThan(4.5);
    expect(contrast(light.tertiary, light.surface)).toBeLessThan(4.5);
    expect(contrast(DARK_WAS.goldText, light.surface)).toBeLessThan(3);
    expect(contrast(DARK_WAS.warnText, light.surface)).toBeLessThan(3);
  });
});

describe("labels on a fill (#3819)", () => {
  it("light textOnSecondary reaches 4.5:1 on the secondary fill; the cream it replaces does not", () => {
    expect(contrast(light.textOnSecondary, light.secondary)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light.surface, light.secondary)).toBeLessThan(4.5);
  });

  it("light textOnBonus reaches 4.5:1 on the bonus fill; the cream it replaces does not", () => {
    expect(contrast(light.textOnBonus, light.bonus)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light.surface, light.bonus)).toBeLessThan(4.5);
  });

  it("the Intermediate Deal button label (textOnSecondary) is white in light", () => {
    expect(light.textOnSecondary).toBe("#ffffff");
  });

  it("dark keeps today's label, the surface colour", () => {
    expect(dark.textOnSecondary).toBe(dark.surface);
    expect(dark.textOnBonus).toBe(dark.surface);
  });
});
