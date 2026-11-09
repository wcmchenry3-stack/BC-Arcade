/** Daily Word board sizing (#3663): the tiles fill the space above the keyboard, within caps. */
import { BOARD_ROWS, DEFAULT_BOARD, MAX_TILE, MIN_TILE, boardSize } from "../layout";

/** The board's width and height for a size: n tiles and n - 1 gaps each way. */
function extent(size: { tile: number; gap: number }, cols: number) {
  return {
    width: cols * size.tile + (cols - 1) * size.gap,
    height: BOARD_ROWS * size.tile + (BOARD_ROWS - 1) * size.gap,
  };
}

describe("Daily Word boardSize", () => {
  it("fills a 390 x 844 phone's board area with tiles of at least 56 px", () => {
    // The area left on a 390 x 844 phone: 358 px wide (16 px gutters), ~470 px tall.
    const size = boardSize(358, 470, 5);
    expect(size.tile).toBeGreaterThanOrEqual(56);
    const { width, height } = extent(size, 5);
    expect(width).toBeLessThanOrEqual(358);
    expect(height).toBeLessThanOrEqual(470);
  });

  it.each([4, 5, 6, 7])("never overflows a 320 x 568 screen's area, %i letters", (len) => {
    const size = boardSize(288, 300, len);
    const { width, height } = extent(size, len);
    expect(width).toBeLessThanOrEqual(288);
    expect(height).toBeLessThanOrEqual(300);
    expect(size.tile).toBeGreaterThanOrEqual(MIN_TILE);
  });

  it("is capped on tablets and the web", () => {
    expect(boardSize(1000, 1000, 5).tile).toBe(MAX_TILE);
  });

  it("is limited by height on a short, wide area", () => {
    const size = boardSize(600, 300, 5);
    expect(extent(size, 5).height).toBeLessThanOrEqual(300);
    expect(size.tile).toBeLessThan(boardSize(600, 600, 5).tile);
  });

  it("scales the letter and gap with the tile, from the old 52 px look", () => {
    expect(DEFAULT_BOARD).toEqual({ tile: 52, gap: 6, fontSize: 22 });
    const big = boardSize(1000, 1000, 5);
    expect(big.fontSize).toBe(Math.round((72 * 22) / 52));
    expect(big.gap).toBe(Math.floor((72 * 6) / 52));
  });
});
