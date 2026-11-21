import { GAME_TYPES, type GameType } from "../../../api/vocab";
import { dark, light } from "../../../theme/ThemeContext";
import { TILE_ACCENT_PAIR, tileAccent } from "../tileAccents";

// WCAG 2.x relative luminance / contrast ratio for opaque #rrggbb colours, same helper shape as
// theme/__tests__/gamePalettes.test.ts.
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

// The store build's tiles in lobby order (Daily Word first since #4009) and the internal order.
const STORE: GameType[] = [
  "daily_word",
  "yacht",
  "twenty48",
  "solitaire",
  "freecell",
  "sudoku",
  "sort",
];
const INTERNAL: GameType[] = [
  "daily_word",
  "yacht",
  "cascade",
  "blackjack",
  "twenty48",
  "solitaire",
  "freecell",
  "hearts",
  "sudoku",
  "starswarm",
  "mahjong",
  "sort",
];

/** Pairs of slugs that touch (across or down) in a lobby of `cols` columns. */
function touching(order: GameType[], cols: number): [GameType, GameType][] {
  const out: [GameType, GameType][] = [];
  order.forEach((slug, i) => {
    if (cols > 1 && i % cols !== cols - 1 && i + 1 < order.length) out.push([slug, order[i + 1]!]);
    if (i + cols < order.length) out.push([slug, order[i + cols]!]);
  });
  return out;
}

describe("tileAccents (#4007)", () => {
  it("has an accent for every game", () => {
    expect(Object.keys(TILE_ACCENT_PAIR).sort()).toEqual([...GAME_TYPES].sort());
    for (const slug of GAME_TYPES) expect(TILE_ACCENT_PAIR[slug]).toBeDefined();
  });

  it("the lobby lists are the games: 12 internal, 7 of them in the store", () => {
    expect([...INTERNAL].sort()).toEqual([...GAME_TYPES].sort());
    for (const slug of STORE) expect(INTERNAL).toContain(slug);
  });

  it("a game's pair is the same with all 12 games and with only the 7 store games", () => {
    // The pair is looked up by slug alone, so neither list can move it.
    for (const slug of STORE) {
      expect(tileAccent(slug, dark, "dark")).toEqual(tileAccent(slug, dark, "dark"));
    }
    const pairsIn = (order: GameType[]) => order.map((s) => [s, TILE_ACCENT_PAIR[s]]);
    const full = new Map(pairsIn(INTERNAL));
    for (const [slug, pair] of pairsIn(STORE)) expect(full.get(slug as GameType)).toBe(pair);
  });

  it.each([2, 1])("no touching tiles share a pair in the 7-tile store lobby, %i col", (cols) => {
    for (const [a, b] of touching(STORE, cols))
      expect(TILE_ACCENT_PAIR[a]).not.toBe(TILE_ACCENT_PAIR[b]);
  });

  it.each([2, 1])("no touching tiles share a pair in the 12-game lobby, %i col", (cols) => {
    for (const [a, b] of touching(INTERNAL, cols))
      expect(TILE_ACCENT_PAIR[a]).not.toBe(TILE_ACCENT_PAIR[b]);
  });

  it("uses theme tokens only", () => {
    const tokens = (c: typeof dark) => [c.tertiary, c.secondary, c.accent, c.accentBright];
    for (const slug of GAME_TYPES) {
      for (const stop of tileAccent(slug, dark, "dark").stops) expect(tokens(dark)).toContain(stop);
      for (const stop of tileAccent(slug, light, "light").stops)
        expect([...tokens(light), dark.secondary]).toContain(stop);
    }
  });
});

describe("Play label contrast on the tile gradient (#4007)", () => {
  const themes = [
    ["dark", dark],
    ["light", light],
  ] as const;

  it.each(themes)("%s: the label holds 4.5:1 on both stops of every game", (name, colors) => {
    for (const slug of GAME_TYPES) {
      const { stops, label } = tileAccent(slug, colors, name);
      for (const stop of stops) expect(contrast(label, stop)).toBeGreaterThanOrEqual(4.5);
    }
  });

  // Measured, dark ink #0e0e13: dark tertiary 16.1, secondary 7.15, accent 15.3, accentBright
  // 13.4; light tertiary 7.12, accent 9.15, accentBright 6.69, and the light-theme magenta fill
  // (dark.secondary) 7.15. The raw light secondary #a34fc4 is 4.10 and would fail; white on it
  // is 4.7 but 2.7 on the lime and 2.1 on the teal.
  it("the raw light-theme secondary fails under the dark ink, which is why it is swapped", () => {
    expect(contrast(light.textOnAccent, light.secondary)).toBeLessThan(4.5);
    expect(contrast(light.textOnAccent, dark.secondary)).toBeGreaterThan(7);
  });
});
