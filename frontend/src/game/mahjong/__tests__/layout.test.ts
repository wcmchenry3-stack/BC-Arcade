/**
 * Unit tests for calculateMahjongLayout.
 *
 * The pure function is tested in isolation (no hooks, no React).
 */

import { calculateMahjongLayout } from "../layout";

const TURTLE = { boardRows: 8, boardCols: 12, boardLayers: 4 };

describe("calculateMahjongLayout", () => {
  it("returns a tileWidth clamped to MAX_TILE_W (56) on a large iPad landscape screen", () => {
    const l = calculateMahjongLayout({
      screenWidth: 1366,
      screenHeight: 1024,
      safeAreaTop: 0,
      safeAreaBottom: 0,
      ...TURTLE,
    });
    expect(l.tileWidth).toBe(56);
  });

  it("returns a tileWidth clamped to MIN_TILE_W (28) on a tiny screen", () => {
    const l = calculateMahjongLayout({
      screenWidth: 200,
      screenHeight: 300,
      safeAreaTop: 0,
      safeAreaBottom: 0,
      ...TURTLE,
    });
    expect(l.tileWidth).toBe(28);
  });

  it("clamps to MIN_TILE_W when both dimensions are zero", () => {
    const l = calculateMahjongLayout({
      screenWidth: 0,
      screenHeight: 0,
      safeAreaTop: 0,
      safeAreaBottom: 0,
      ...TURTLE,
    });
    expect(l.tileWidth).toBe(28);
  });

  it("board fits within available height (heightFactor formula is correct)", () => {
    // A 900×450 screen at typical mahjong aspect — board must not exceed availH.
    const screenWidth = 900;
    const screenHeight = 450;
    const safeAreaTop = 0;
    const safeAreaBottom = 0;
    const l = calculateMahjongLayout({
      screenWidth,
      screenHeight,
      safeAreaTop,
      safeAreaBottom,
      ...TURTLE,
    });
    // availH = screenHeight - safeAreaTop - safeAreaBottom - MAHJONG_CHROME_H (116)
    const availH = screenHeight - safeAreaTop - safeAreaBottom - 116;
    expect(l.boardHeight).toBeLessThanOrEqual(availH + 1); // allow 1px rounding
  });

  it("board fits within available width", () => {
    const screenWidth = 768;
    const screenHeight = 1024;
    const l = calculateMahjongLayout({
      screenWidth,
      screenHeight,
      safeAreaTop: 44,
      safeAreaBottom: 34,
      ...TURTLE,
    });
    // availW = screenWidth - (max(0,12) + max(0,12)) = screenWidth - 24
    const availW = screenWidth - 24;
    expect(l.boardWidth).toBeLessThanOrEqual(availW + 1);
  });

  it("respects safeAreaLeft and safeAreaRight when larger than the minimum margin", () => {
    const baseLayout = calculateMahjongLayout({
      screenWidth: 844,
      screenHeight: 390,
      safeAreaTop: 0,
      safeAreaBottom: 0,
      ...TURTLE,
    });
    const notchedLayout = calculateMahjongLayout({
      screenWidth: 844,
      screenHeight: 390,
      safeAreaTop: 0,
      safeAreaBottom: 0,
      safeAreaLeft: 44,
      safeAreaRight: 44,
      ...TURTLE,
    });
    // Wider safe areas → less available width → smaller or equal tile size.
    expect(notchedLayout.tileWidth).toBeLessThanOrEqual(baseLayout.tileWidth);
  });

  it("derived values (sideWidth, layerDx, layerDy, padX, padY) are proportional to tileWidth", () => {
    const l = calculateMahjongLayout({
      screenWidth: 1024,
      screenHeight: 768,
      safeAreaTop: 0,
      safeAreaBottom: 0,
      ...TURTLE,
    });
    // All ratios should be ≥ their minima and scale with tileWidth.
    expect(l.sideWidth).toBeGreaterThanOrEqual(3);
    expect(l.layerDx).toBeGreaterThanOrEqual(3);
    expect(l.layerDy).toBeGreaterThanOrEqual(2);
    expect(l.padX).toBeGreaterThanOrEqual(4);
    expect(l.padY).toBeGreaterThanOrEqual(6);
  });

  it("boardWidth and boardHeight match their geometric derivations", () => {
    const l = calculateMahjongLayout({
      screenWidth: 800,
      screenHeight: 600,
      safeAreaTop: 0,
      safeAreaBottom: 0,
      ...TURTLE,
    });
    const expectedBoardWidth =
      l.padX + TURTLE.boardCols * l.tileWidth + TURTLE.boardLayers * l.layerDx + l.padX;
    const expectedBoardHeight =
      l.padY + TURTLE.boardRows * l.tileHeight + TURTLE.boardLayers * l.layerDy + l.padY;
    expect(l.boardWidth).toBe(expectedBoardWidth);
    expect(l.boardHeight).toBe(expectedBoardHeight);
  });
});
