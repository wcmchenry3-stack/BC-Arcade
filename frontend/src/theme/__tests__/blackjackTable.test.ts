/**
 * Blackjack table colours (#3580): the dealer's hole card must read against
 * the felt. The deck's back can sit close to the felt's colour, so the table
 * outlines a face-down card; that outline holds WCAG 1.4.11 non-text contrast
 * (3:1) against the felt in both themes.
 */
import { dark, light, type Colors } from "../ThemeContext";
import { feltColor, holeCardOutline } from "../../components/blackjack/tableColors";

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

describe.each([
  ["dark", dark],
  ["light", light],
] as [string, Colors][])("Blackjack table, %s theme", (_name, colors) => {
  it("tokens are opaque #rrggbb", () => {
    expect(feltColor(colors)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(holeCardOutline(colors)).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("the hole card's outline is at least 3:1 against the felt", () => {
    expect(contrast(holeCardOutline(colors), feltColor(colors))).toBeGreaterThanOrEqual(3);
  });

  it("the card back alone would not be enough: the outline is needed", () => {
    // The Classic back (surfaceAlt) against the felt: why the table outlines it.
    expect(contrast(colors.surfaceAlt, feltColor(colors))).toBeLessThan(3);
  });
});
