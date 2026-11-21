/**
 * Byte budget for the lobby tile images (#4011, #4012): `assets/home/*-tile.webp`. The gameplay
 * scenes are drawn by `tools/assets/draw_lobby_tile_art.py` at 3x the 64 pt display size, and
 * the owner's budget is 3,400 B per tile (#4010). A new tile must be added here with its budget,
 * so the lobby's image weight is a deliberate choice. See docs/ASSETS.md and docs/PERFORMANCE.md.
 */
import fs from "fs";
import path from "path";

const HOME = path.join(__dirname, "../../assets/home");

const TILE_BUDGET = 3400; // bytes per tile (owner, #4010)

/** Every lobby tile image and its cap. Measured 2026-11-21 (bytes in the comments). */
const TILES: Record<string, number> = {
  "daily_word-tile.webp": TILE_BUDGET, // 3,100 (#4012)
  "freecell-tile.webp": TILE_BUDGET, // 3,238 (#4012)
  "solitaire-tile.webp": TILE_BUDGET, // 3,348 (#4012)
  "sort-tile.webp": TILE_BUDGET, // 3,030
  "starswarm-tile.webp": TILE_BUDGET, // 2,698 (#3599; redrawn in #4013)
  "sudoku-tile.webp": TILE_BUDGET, // 2,578
  "twenty48-tile.webp": TILE_BUDGET, // 3,052
  "yacht-tile.webp": TILE_BUDGET, // 3,198 (five dice)
};

/** All the tiles together: 24,242 B measured (14,556 B before #4012's three), about 3% headroom. */
const TOTAL_BUDGET = 25000;

const tileFiles = () =>
  fs
    .readdirSync(HOME)
    .filter((f) => /-tile\.\w+$/.test(f))
    .sort();

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

  it(`the tiles together stay within ${TOTAL_BUDGET} B`, () => {
    const total = tileFiles().reduce((n, f) => n + fs.statSync(path.join(HOME, f)).size, 0);
    expect(total).toBeLessThanOrEqual(TOTAL_BUDGET);
  });
});
