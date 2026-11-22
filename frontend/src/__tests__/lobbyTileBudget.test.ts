/**
 * Byte budget for the lobby tile images (#4011, #4012, #4013): `assets/home/*-tile.webp`. The
 * gameplay scenes are drawn by `tools/assets/draw_lobby_tile_art.py` at 3x the 64 pt display size,
 * and the owner's budget is 3,400 B per tile (#4010). A new tile must be added here with its
 * budget, so the lobby's image weight is a deliberate choice. See docs/ASSETS.md and
 * docs/PERFORMANCE.md.
 *
 * Two totals (#4013): the store tiles (games a store build shows), which every store build
 * packages, and the hidden tiles (games in HIDDEN_GAMES or DISABLED_GAMES), which only dev, e2e and
 * pre-launch builds package (a store bundle stubs `hiddenGameTileArt.ts`). Membership comes from
 * `gameVisibility.ts`, the same source `scripts/size-report.mjs` reads, so unhiding a game moves
 * its tile into the store total with no second edit.
 */
import fs from "fs";
import path from "path";

import { DISABLED_GAMES, HIDDEN_GAMES } from "../entitlements/gameVisibility";

const HOME = path.join(__dirname, "../../assets/home");

const TILE_BUDGET = 3400; // bytes per tile (owner, #4010)

/** Every lobby tile image and its cap. Measured 2026-11-21/22 (bytes in the comments). */
const TILES: Record<string, number> = {
  "blackjack-tile.webp": TILE_BUDGET, // 2,738 (#4013, hidden)
  "cascade-tile.webp": TILE_BUDGET, // 2,954 (#4013, hidden)
  "daily_word-tile.webp": TILE_BUDGET, // 3,352 (#4012)
  "freecell-tile.webp": TILE_BUDGET, // 3,276 (#4012)
  "hearts-tile.webp": TILE_BUDGET, // 3,096 (#4013, hidden)
  "mahjong-tile.webp": TILE_BUDGET, // 2,930 (#4013, hidden)
  "solitaire-tile.webp": TILE_BUDGET, // 2,916 (#4012)
  "sort-tile.webp": TILE_BUDGET, // 3,030
  "starswarm-tile.webp": TILE_BUDGET, // 3,202 (#4013 redraw, hidden; the #3599 badge was 2,698)
  "sudoku-tile.webp": TILE_BUDGET, // 2,578
  "twenty48-tile.webp": TILE_BUDGET, // 3,052
  "yacht-tile.webp": TILE_BUDGET, // 3,198 (five dice)
};

/** The store tiles together: 21,402 B measured, about 15% headroom (unchanged by #4013). */
const STORE_TOTAL_BUDGET = 25000;
/** The hidden tiles together: 14,920 B measured; five tiles at the per-tile budget. */
const HIDDEN_TOTAL_BUDGET = 5 * TILE_BUDGET;

/** Games a store build leaves out, as `isGameVisible` does there and size-report reads them. */
const STORE_EXCLUDED: ReadonlySet<string> = new Set([...HIDDEN_GAMES, ...DISABLED_GAMES]);

const tileFiles = () =>
  fs
    .readdirSync(HOME)
    .filter((f) => /-tile\.\w+$/.test(f))
    .sort();

/** A tile file's game slug: `<slug>-tile.<ext>`. */
const slugOf = (file: string) => file.replace(/-tile\.\w+$/, "");

/** The tiles split by whether a store build packages them. */
function splitTiles(files: readonly string[], excluded: ReadonlySet<string>) {
  return {
    store: files.filter((f) => !excluded.has(slugOf(f))),
    hidden: files.filter((f) => excluded.has(slugOf(f))),
  };
}

const bytes = (files: readonly string[]) =>
  files.reduce((n, f) => n + fs.statSync(path.join(HOME, f)).size, 0);

describe("lobby tile images byte budget (#4011)", () => {
  it("every tile image is listed with a budget", () => {
    expect(tileFiles()).toEqual(Object.keys(TILES).sort());
  });

  it.each(Object.entries(TILES))("%s is a WebP within %i B", (file, max) => {
    const data = fs.readFileSync(path.join(HOME, file));
    expect(data.subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(data.subarray(8, 12).toString("latin1")).toBe("WEBP");
    expect(data.length).toBeLessThanOrEqual(max);
  });

  it(`the store tiles together stay within ${STORE_TOTAL_BUDGET} B`, () => {
    const { store } = splitTiles(tileFiles(), STORE_EXCLUDED);
    expect(store.length).toBeGreaterThan(0);
    expect(bytes(store)).toBeLessThanOrEqual(STORE_TOTAL_BUDGET);
  });

  it(`the hidden tiles together stay within ${HIDDEN_TOTAL_BUDGET} B (#4013)`, () => {
    const { hidden } = splitTiles(tileFiles(), STORE_EXCLUDED);
    expect(hidden.map(slugOf).sort()).toEqual(
      [...STORE_EXCLUDED].filter((slug) => tileFiles().includes(`${slug}-tile.webp`)).sort()
    );
    expect(bytes(hidden)).toBeLessThanOrEqual(HIDDEN_TOTAL_BUDGET);
  });
});

describe("the store / hidden split follows gameVisibility (#4013)", () => {
  const files = ["cascade-tile.webp", "hearts-tile.webp", "yacht-tile.webp"];

  it("a hidden or disabled game's tile counts as hidden, every other tile as store", () => {
    expect(splitTiles(files, new Set(["cascade", "hearts"]))).toEqual({
      store: ["yacht-tile.webp"],
      hidden: ["cascade-tile.webp", "hearts-tile.webp"],
    });
  });

  it("unhiding a game moves its tile into the store total, with no list to edit here", () => {
    expect(splitTiles(files, new Set(["cascade"]))).toEqual({
      store: ["hearts-tile.webp", "yacht-tile.webp"],
      hidden: ["cascade-tile.webp"],
    });
  });

  it("today's split is the five hidden games", () => {
    const { hidden } = splitTiles(tileFiles(), STORE_EXCLUDED);
    expect(hidden.map(slugOf).sort()).toEqual([
      "blackjack",
      "cascade",
      "hearts",
      "mahjong",
      "starswarm",
    ]);
  });
});
