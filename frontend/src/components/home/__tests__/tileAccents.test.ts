import { GAME_TYPES, type GameType } from "../../../api/vocab";
import { dark, light } from "../../../theme/ThemeContext";
import { lobbyColumns } from "../lobbyColumns";
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

  it("pins each game's pair, and the lookup takes a slug only", () => {
    expect(TILE_ACCENT_PAIR).toEqual({
      daily_word: 0,
      yacht: 1,
      cascade: 2,
      blackjack: 0,
      twenty48: 3,
      solitaire: 2,
      freecell: 1,
      hearts: 3,
      sudoku: 0,
      starswarm: 1,
      mahjong: 2,
      sort: 3,
    });
    // No position or list argument: a tile cannot be recoloured by where it sits.
    expect(tileAccent.length).toBe(3);
  });

  // The column counts the lobby really uses, read off its breakpoints (320 pt phone, 390 pt
  // phone, 800 pt tablet, 1200 pt tablet), not hardcoded.
  const COLUMNS = [320, 390, 800, 1200].map(lobbyColumns);
  const conflicts = (order: GameType[], cols: number) =>
    touching(order, cols).filter(([a, b]) => TILE_ACCENT_PAIR[a] === TILE_ACCENT_PAIR[b]);

  it("covers every column count the lobby has", () => {
    expect(COLUMNS).toEqual([1, 2, 3, 4]);
  });

  // The intended final order, Daily Word first (#4009, PR #4018). HomeScreen on this branch
  // still has Daily Word last until #4018 is merged in; the mapping does not depend on it.
  it("no touching tiles share a pair in the store lobby on a phone (1 and 2 columns)", () => {
    for (const cols of COLUMNS.filter((c) => c <= 2)) expect(conflicts(STORE, cols)).toEqual([]);
  });

  it("no touching tiles share a pair in the 12-game lobby on a phone (1 and 2 columns)", () => {
    for (const cols of COLUMNS.filter((c) => c <= 2)) expect(conflicts(INTERNAL, cols)).toEqual([]);
  });

  // With 4 pairs it is impossible to have none at every width: across the four layouts the
  // first five store tiles (daily_word, yacht, twenty48, solitaire, freecell) all touch one
  // another, a K5. The search for the best mapping (zero at 1 and 2 columns first) leaves the
  // least possible on tablets: exactly one store pair each at 3 and 4 columns. Pinned, so a
  // change can only improve it.
  it("tablet layouts keep the known minimum of conflicts", () => {
    expect(conflicts(STORE, 3)).toEqual([["yacht", "freecell"]]);
    expect(conflicts(STORE, 4)).toEqual([["twenty48", "sort"]]);
    // Internal 12-game lobby: 4 touching pairs at 3 columns, 1 at 4 columns.
    expect(conflicts(INTERNAL, 3)).toHaveLength(4);
    expect(conflicts(INTERNAL, 4)).toHaveLength(1);
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
