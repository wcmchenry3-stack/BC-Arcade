/**
 * Blackjack table colours (#3580). The dealer's hole card has no table-level outline
 * since the card back (#3740) reads against the felt by itself; that contrast
 * (WCAG 1.4.11, 3:1) is checked in cardBackContrast.test.ts.
 */
import { dark, light, type Colors } from "../ThemeContext";
import * as table from "../../components/blackjack/tableColors";
import { feltColor } from "../../components/blackjack/tableColors";

it("the table no longer exports a hole-card outline (#3740)", () => {
  expect(Object.keys(table)).toEqual(["feltColor"]);
});

describe.each([
  ["dark", dark],
  ["light", light],
] as [string, Colors][])("Blackjack table, %s theme", (_name, colors) => {
  it("the felt token is opaque #rrggbb", () => {
    expect(feltColor(colors)).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
