/**
 * The card back (#3740) must read against every felt in both themes: through its margin or its
 * field the back holds WCAG 1.4.11 non-text contrast (3:1) against the Blackjack, Solitaire /
 * FreeCell and Hearts felts. One back for both themes, like the face.
 */
import { dark, light, type Colors } from "../ThemeContext";
import { NEON_DECK } from "../theme.cards";
import {
  TABLE_FELT_CENTRE_DARK,
  TABLE_FELT_CENTRE_LIGHT,
  TABLE_FELT_EDGE_DARK,
  TABLE_FELT_EDGE_LIGHT,
} from "../theme.table";
import { HEARTS_FELT_CENTRE, HEARTS_FELT_EDGE } from "../theme.hearts";
import { feltColor } from "../../components/blackjack/tableColors";

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

/** The helper reads #rrggbb: expand the #rgb card tokens. */
const expand = (hex: string) =>
  hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;

/** The felts a card sits on, per theme. */
const felts = (c: Colors, centre: string, edge: string): Record<string, string> => ({
  blackjack: feltColor(c),
  "solitaire/freecell centre": centre,
  "solitaire/freecell edge": edge,
  "hearts table": c.background,
  "hearts felt centre": HEARTS_FELT_CENTRE,
  "hearts felt edge": HEARTS_FELT_EDGE,
});

describe.each([
  ["dark", dark, TABLE_FELT_CENTRE_DARK, TABLE_FELT_EDGE_DARK],
  ["light", light, TABLE_FELT_CENTRE_LIGHT, TABLE_FELT_EDGE_LIGHT],
] as [string, Colors, string, string][])("card back, %s theme", (_n, colors, centre, edge) => {
  const classic = { margin: expand(colors.cardFace), field: expand(colors.cardBack) };
  const neon = { margin: NEON_DECK.backRim, field: NEON_DECK.backField };

  describe.each([
    ["classic / minimal", classic],
    ["neon", neon],
  ])("%s", (_d, back) => {
    for (const [name, felt] of Object.entries(felts(colors, centre, edge))) {
      it(`reads at 3:1 against the ${name} felt, through the margin or the field`, () => {
        const best = Math.max(contrast(back.margin, felt), contrast(back.field, felt));
        expect(best).toBeGreaterThanOrEqual(3);
      });
    }
  });

  it("the lattice and line are visible on the field (3:1)", () => {
    expect(contrast(expand(colors.cardBackInk), expand(colors.cardBack))).toBeGreaterThanOrEqual(3);
    expect(contrast(NEON_DECK.backLine, NEON_DECK.backField)).toBeGreaterThanOrEqual(3);
  });
});

describe("card back tokens", () => {
  it("are the same in light and dark, like the card face", () => {
    expect(light.cardBack).toBe(dark.cardBack);
    expect(light.cardBackInk).toBe(dark.cardBackInk);
  });
});
