/**
 * Blackjack table colours (#3580). The dealer's hole card has no table-level outline
 * since the card back (#3740) reads against the felt by itself; that contrast
 * (WCAG 1.4.11, 3:1) is checked in cardBackContrast.test.ts.
 */
import { dark, light, type Colors, type Theme } from "../ThemeContext";
import * as table from "../../components/blackjack/tableColors";
import { feltColor, naturalColors } from "../../components/blackjack/tableColors";
import { NATURAL_SWEEP_PEAK } from "../../components/blackjack/blackjackMotion";

// WCAG 2.x relative luminance / contrast ratio for opaque #rrggbb colours — the same
// helper shape as gamePalettes.test.ts.
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

it("the table no longer exports a hole-card outline (#3740)", () => {
  expect(Object.keys(table).sort()).toEqual(["feltColor", "naturalColors"]);
});

describe.each([
  ["dark", dark],
  ["light", light],
] as [string, Colors][])("Blackjack table, %s theme", (_name, colors) => {
  it("the felt token is opaque #rrggbb", () => {
    expect(feltColor(colors)).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

/** `top` at `alpha` over the opaque `under`, as #rrggbb. */
function over(top: string, alpha: number, under: string): string {
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  return `#${[1, 3, 5]
    .map((i) => Math.round(ch(top, i) * alpha + ch(under, i) * (1 - alpha)))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

// #3621 review: the natural's edges read on the felt (WCAG 1.4.11, 3:1) in both themes, and its
// sweep shows, faintly, at its peak opacity: on the light felt the dark theme's colours fell to
// 1.48:1 (gold) and 1.58:1 (silver), and the cream sweep vanished.
describe.each([
  ["dark", dark],
  ["light", light],
] as [Theme, Colors][])("Blackjack natural, %s theme", (theme, colors) => {
  const n = naturalColors(theme);

  it("colours are opaque #rrggbb", () => {
    for (const c of [n.gold, n.silver, n.sweep]) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("the gold and the silver edge are at least 3:1 against the felt", () => {
    expect(contrast(n.gold, feltColor(colors))).toBeGreaterThanOrEqual(3);
    expect(contrast(n.silver, feltColor(colors))).toBeGreaterThanOrEqual(3);
  });

  it("the sweep at its peak shows on the felt, faintly", () => {
    const peak = over(n.sweep, NATURAL_SWEEP_PEAK, feltColor(colors));
    const c = contrast(peak, feltColor(colors));
    expect(c).toBeGreaterThanOrEqual(1.15);
    expect(c).toBeLessThanOrEqual(1.6);
  });
});

it("the dark theme keeps the audition's colours", () => {
  expect(naturalColors("dark")).toEqual({ gold: "#f5c542", silver: "#b9c6d6", sweep: "#fff6d8" });
});
