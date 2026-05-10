/**
 * Unit tests for calculateMahjongLayout and makeBoardCamera.
 *
 * Pure functions tested in isolation (no hooks, no React).
 */

import { calculateMahjongLayout, fitToScreen, makeBoardCamera } from "../layout";

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

describe("fitToScreen", () => {
  it("returns scale=1 when board fits within viewport minus margin", () => {
    const { scale } = fitToScreen(400, 300, 800, 600, 16);
    expect(scale).toBe(1);
  });

  it("scales down when board is larger than viewport minus margin", () => {
    const { scale } = fitToScreen(800, 600, 400, 300, 0);
    expect(scale).toBeCloseTo(0.5, 5);
  });

  it("is constrained by the tighter dimension and capped at 1", () => {
    // board (100×200) fits inside viewport (200×300) — uncapped would be 1.5 but cap applies
    const { scale } = fitToScreen(100, 200, 200, 300, 0);
    expect(scale).toBe(1);
    // verify the width dimension actually constrains when height has more room
    const { scale: s2 } = fitToScreen(800, 200, 400, 300, 0);
    // scaleX = 400/800 = 0.5, scaleY = 300/200 = 1.5 → min = 0.5
    expect(s2).toBeCloseTo(0.5, 5);
  });

  it("never exceeds 1 even when board is much smaller than viewport", () => {
    const { scale } = fitToScreen(200, 150, 1366, 1024, 16);
    expect(scale).toBe(1);
  });

  it("centers the board horizontally and vertically", () => {
    const boardWidth = 400;
    const boardHeight = 300;
    const viewportWidth = 500;
    const viewportHeight = 400;
    const { scale, offsetX, offsetY } = fitToScreen(
      boardWidth,
      boardHeight,
      viewportWidth,
      viewportHeight,
      0
    );
    expect(offsetX).toBeCloseTo((viewportWidth - boardWidth * scale) / 2, 5);
    expect(offsetY).toBeCloseTo((viewportHeight - boardHeight * scale) / 2, 5);
  });

  it("applies margin symmetrically", () => {
    const margin = 20;
    const { scale } = fitToScreen(400, 300, 400, 300, margin);
    const expectedScale = Math.min((400 - margin * 2) / 400, (300 - margin * 2) / 300);
    expect(scale).toBeCloseTo(expectedScale, 5);
  });
});

describe("makeBoardCamera", () => {
  const layout = calculateMahjongLayout({
    screenWidth: 800,
    screenHeight: 600,
    safeAreaTop: 0,
    safeAreaBottom: 0,
    ...TURTLE,
  });
  const cam = makeBoardCamera(layout);

  it("tileToScreen(0, 0, 0) returns the pad origin", () => {
    const { x, y } = cam.tileToScreen(0, 0, 0);
    expect(x).toBe(layout.padX);
    expect(y).toBe(layout.padY);
  });

  it("tileToScreen advances x by tileWidth per 2 col units", () => {
    const { x: x0 } = cam.tileToScreen(0, 0, 0);
    const { x: x2 } = cam.tileToScreen(2, 0, 0);
    expect(x2 - x0).toBe(layout.tileWidth);
  });

  it("tileToScreen advances y by tileHeight per row", () => {
    const { y: y0 } = cam.tileToScreen(0, 0, 0);
    const { y: y1 } = cam.tileToScreen(0, 1, 0);
    expect(y1 - y0).toBe(layout.tileHeight);
  });

  it("tileToScreen shifts right and up by layer offsets", () => {
    const { x: x0, y: y0 } = cam.tileToScreen(0, 0, 0);
    const { x: x1, y: y1 } = cam.tileToScreen(0, 0, 1);
    expect(x1 - x0).toBe(layout.layerDx);
    expect(y0 - y1).toBe(layout.layerDy);
  });

  it("faceWidth and faceHeight equal tileWidth/tileHeight minus sideWidth", () => {
    expect(cam.faceWidth).toBe(layout.tileWidth - layout.sideWidth);
    expect(cam.faceHeight).toBe(layout.tileHeight - layout.sideWidth);
  });

  it("exposes boardWidth and boardHeight matching the source layout", () => {
    expect(cam.boardWidth).toBe(layout.boardWidth);
    expect(cam.boardHeight).toBe(layout.boardHeight);
  });

  it("defaults to scale=1 and zero offsets when no viewport args are given", () => {
    expect(cam.scale).toBe(1);
    expect(cam.offsetX).toBe(0);
    expect(cam.offsetY).toBe(0);
    expect(cam.viewportWidth).toBe(layout.boardWidth);
    expect(cam.viewportHeight).toBe(layout.boardHeight);
  });

  it("computes fit-to-screen scale when viewport and margin are provided", () => {
    const fitCam = makeBoardCamera(layout, layout.boardWidth * 2, layout.boardHeight * 2, 0);
    // Viewport is 2× the board — scale capped at 1
    expect(fitCam.scale).toBe(1);
    // Viewport is half the board — scale = 0.5
    const smallCam = makeBoardCamera(layout, layout.boardWidth / 2, layout.boardHeight / 2, 0);
    expect(smallCam.scale).toBeCloseTo(0.5, 5);
  });
});
