/**
 * Contrast of the Sudoku board's digits on the cell backgrounds they actually sit on (#3773):
 * the base surface and each wash composited over it, in both themes. The entered digit is
 * `accentText` (the plain accent is 1.6-2:1 on cream); a rule conflict and a mistake draw the
 * `error` digit, which is large bold text here (a cell digit is >= 18.7 px bold at the smallest
 * board), so it is held to 3:1.
 */
import { dark, light, type Colors } from "../../../theme/ThemeContext";
import { SUDOKU_WASHES } from "../../../theme/theme.sudoku";
import { cellBackground, composite, parseColor } from "../cellStyle";

function luminance(hex: string): number {
  const [r, g, b] = parseColor(hex);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The board base SudokuGrid paints under the cells. */
const baseOf = (name: "dark" | "light", c: Colors) =>
  name === "light" ? c.surfaceHigh : c.surface;

describe.each([
  ["dark", dark],
  ["light", light],
] as const)("%s board contrast", (name, colors) => {
  const washes = SUDOKU_WASHES[name];
  const base = baseOf(name, colors);
  const bg = (o: { peer?: boolean; sameDigit?: boolean; conflict?: boolean }) =>
    cellBackground({
      base,
      selectedFill: colors.accent,
      washes,
      selected: false,
      peer: o.peer ?? false,
      sameDigit: o.sameDigit ?? false,
      conflict: o.conflict ?? false,
    });

  const backgrounds: [string, string][] = [
    ["the plain surface", bg({})],
    ["the row/column/box wash", bg({ peer: true })],
    ["the same-digit wash", bg({ sameDigit: true })],
    ["the same-digit wash in a peer cell", bg({ sameDigit: true, peer: true })],
  ];

  it.each(backgrounds)("an entered digit (accentText) reaches AA (4.5:1) on %s", (_n, color) => {
    expect(contrast(colors.accentText, color)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(backgrounds)("a given digit (text) reaches AA (4.5:1) on %s", (_n, color) => {
    expect(contrast(colors.text, color)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["the plain surface", bg({})],
    ["the row/column/box wash", bg({ peer: true })],
  ])("a pencil note (textMuted) reaches AA (4.5:1) on %s", (_n, color) => {
    expect(contrast(colors.textMuted, color)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ...backgrounds,
    ["the conflict wash", bg({ conflict: true })],
    ["the conflict wash in a peer cell", bg({ conflict: true, peer: true })],
  ])("an error digit reaches 3:1 (large text) on %s", (_n, color) => {
    expect(contrast(colors.error, color)).toBeGreaterThanOrEqual(3);
  });

  it("the selected cell's digits reach AA (4.5:1) on the accent fill", () => {
    expect(contrast(colors.textOnAccent, colors.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.errorOnAccent, colors.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it("each wash is visibly different from the surface and from the others", () => {
    const [plain, peer, same, conflict] = [
      bg({}),
      bg({ peer: true }),
      bg({ sameDigit: true }),
      bg({ conflict: true }),
    ];
    const distance = (a: string, b: string) => {
      const [ra, ga, ba] = parseColor(a);
      const [rb, gb, bb] = parseColor(b);
      return Math.hypot(ra - rb, ga - gb, ba - bb);
    };
    expect(distance(plain, peer)).toBeGreaterThan(12);
    expect(distance(peer, same)).toBeGreaterThan(12);
    expect(distance(plain, conflict)).toBeGreaterThan(12);
  });

  it("composites a wash over the base the way a screen does", () => {
    expect(bg({ peer: true })).toBe(composite(base, washes.peer));
  });
});

describe("the entered-digit colour, light mode (#3773)", () => {
  it("is darker than the plain accent, which fails AA on the board surfaces", () => {
    expect(contrast(light.accent, light.surfaceHigh)).toBeLessThan(4.5);
    expect(contrast(light.accentText, light.surfaceHigh)).toBeGreaterThanOrEqual(4.5);
  });
});
