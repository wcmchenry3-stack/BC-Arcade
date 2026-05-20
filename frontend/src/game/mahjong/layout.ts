import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Slot } from "./types";

export interface MahjongLayoutInput {
  screenWidth: number;
  screenHeight: number;
  safeAreaTop: number;
  safeAreaBottom: number;
  safeAreaLeft?: number;
  safeAreaRight?: number;
  boardRows: number;
  boardCols: number;
  boardLayers: number;
}

export interface MahjongLayout {
  tileWidth: number;
  tileHeight: number;
  sideWidth: number;
  layerDx: number;
  layerDy: number;
  padX: number;
  padY: number;
  boardWidth: number;
  boardHeight: number;
  availWidth: number;
  availHeight: number;
}

// ---------------------------------------------------------------------------
// Camera abstraction — authoritative world→screen converter.
// Future implementations can swap tileToScreen to add zoom/pan without
// touching any rendering or hit-test code.
// ---------------------------------------------------------------------------

export interface CameraState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function fitToScreen(
  boardWidth: number,
  boardHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  margin = 16
): CameraState {
  const scaleX = (viewportWidth - margin * 2) / boardWidth;
  const scaleY = (viewportHeight - margin * 2) / boardHeight;
  // Cap at 1 — never scale up beyond natural tile size; user zooms in via gesture (#1454).
  // Floor at 0.01 — guards against negative scale when margin > viewport/2.
  const scale = Math.max(0.01, Math.min(1, scaleX, scaleY));
  return {
    scale,
    offsetX: (viewportWidth - boardWidth * scale) / 2,
    offsetY: (viewportHeight - boardHeight * scale) / 2,
  };
}

export interface BoardCamera {
  tileToScreen(col: number, row: number, layer: number): { x: number; y: number };
  tileWidth: number;
  tileHeight: number;
  faceWidth: number;
  faceHeight: number;
  sideWidth: number;
  boardWidth: number;
  boardHeight: number;
  // Camera transform — applied to the canvas container by MahjongScreen.
  // tileToScreen() returns world-space coords (pre-transform); MahjongScreen
  // applies scale via a View transform and centers via flexbox, so offsetX/offsetY
  // are reserved for the gesture-driven zoom/pan layer (#1454) and not used for
  // static positioning.
  scale: number;
  offsetX: number;
  offsetY: number;
  viewportWidth: number;
  viewportHeight: number;
}

export function makeBoardCamera(
  layout: MahjongLayout,
  viewportWidth = layout.boardWidth,
  viewportHeight = layout.boardHeight,
  margin = 0
): BoardCamera {
  const {
    tileWidth,
    tileHeight,
    sideWidth,
    layerDx,
    layerDy,
    padX,
    padY,
    boardWidth,
    boardHeight,
  } = layout;
  const { scale, offsetX, offsetY } = fitToScreen(
    boardWidth,
    boardHeight,
    viewportWidth,
    viewportHeight,
    margin
  );
  return {
    tileToScreen(col, row, layer) {
      return {
        x: padX + (col / 2) * tileWidth + layer * layerDx,
        y: padY + row * tileHeight - layer * layerDy,
      };
    },
    tileWidth,
    tileHeight,
    faceWidth: tileWidth - sideWidth,
    faceHeight: tileHeight - sideWidth,
    sideWidth,
    boardWidth,
    boardHeight,
    scale,
    offsetX,
    offsetY,
    viewportWidth,
    viewportHeight,
  };
}

const TILE_ASPECT = 56 / 44;
const MIN_TILE_W = 28;
const MAX_TILE_W = 56;

// All proportional ratios derived from base constants (TILE_W=44, TILE_H=56)
const SIDE_R = 5 / 44;
const LAYER_DX_R = 6 / 44;
const LAYER_DY_R = 5 / 44;
const PAD_X_R = 10 / 44;
const PAD_Y_R = 14 / 44;

// Keep APP_HEADER_H in sync with AppHeader.APP_HEADER_HEIGHT
const APP_HEADER_H = 64;
// hudRow paddingVertical:8 (×2 = 16) + button minHeight:32 = 48
const HUD_ROW_H = 48;
const MIN_BOTTOM_PAD = 16;
// App header + HUD row + bottom padding = 128
const MAHJONG_CHROME_H = APP_HEADER_H + HUD_ROW_H + MIN_BOTTOM_PAD;
// Minimum horizontal margin on each side when safe-area insets are absent
const MIN_HORIZ_MARGIN = 8;

export function calculateMahjongLayout(input: MahjongLayoutInput): MahjongLayout {
  const {
    screenWidth,
    screenHeight,
    safeAreaTop,
    safeAreaBottom,
    safeAreaLeft = 0,
    safeAreaRight = 0,
    boardRows,
    boardCols,
    boardLayers,
  } = input;

  const horizPad =
    Math.max(safeAreaLeft, MIN_HORIZ_MARGIN) + Math.max(safeAreaRight, MIN_HORIZ_MARGIN);
  const availW = Math.max(1, screenWidth - horizPad);
  const availH = Math.max(1, screenHeight - safeAreaTop - safeAreaBottom - MAHJONG_CHROME_H);

  // Approximate board dimensions as a multiplier of tileWidth (all derived
  // values scale proportionally, so we can solve for tileWidth directly).
  // widthFactor: boardCols half-steps + layer offsets + two padX amounts
  // heightFactor: board rows (tile-height units) + layer offsets + two padY amounts
  const widthFactor = boardCols + boardLayers * LAYER_DX_R + 2 * PAD_X_R;
  const heightFactor = boardRows * TILE_ASPECT + boardLayers * LAYER_DY_R + 2 * PAD_Y_R;

  const rawTileW = Math.min(availW / widthFactor, availH / heightFactor);
  const tileWidth = Math.max(MIN_TILE_W, Math.min(MAX_TILE_W, rawTileW));

  const tileHeight = Math.round(tileWidth * TILE_ASPECT);
  const sideWidth = Math.max(3, Math.round(tileWidth * SIDE_R));
  const layerDx = Math.max(3, Math.round(tileWidth * LAYER_DX_R));
  const layerDy = Math.max(2, Math.round(tileWidth * LAYER_DY_R));
  const padX = Math.max(4, Math.round(tileWidth * PAD_X_R));
  const padY = Math.max(6, Math.round(tileWidth * PAD_Y_R));

  const boardWidth = padX + boardCols * tileWidth + boardLayers * layerDx + padX;
  const boardHeight = padY + boardRows * tileHeight + boardLayers * layerDy + padY;

  return {
    tileWidth,
    tileHeight,
    sideWidth,
    layerDx,
    layerDy,
    padX,
    padY,
    boardWidth,
    boardHeight,
    availWidth: availW,
    availHeight: availH,
  };
}

const TURTLE_BOUNDS = { boardCols: 12, boardRows: 8, boardLayers: 4 };

/**
 * Compute the grid dimensions needed to render a layout without clipping.
 *
 * col values step by 2 (each tile is 2 grid units wide), so boardCols =
 * maxCol/2 + 1 gives the number of tile-width columns required.
 * boardLayers equals maxLayer (not +1) because the formula in
 * calculateMahjongLayout adds boardLayers*layerDx/layerDy as the extra
 * space needed for the highest layer's isometric offset, not as a count.
 */
export function layoutBounds(slots: readonly Slot[]): {
  boardCols: number;
  boardRows: number;
  boardLayers: number;
} {
  if (slots.length === 0) throw new Error("layoutBounds: empty slot array");
  let maxCol = 0,
    maxRow = 0,
    maxLayer = 0;
  for (const s of slots) {
    if (s.col > maxCol) maxCol = s.col;
    if (s.row > maxRow) maxRow = s.row;
    if (s.layer > maxLayer) maxLayer = s.layer;
  }
  return {
    boardCols: maxCol / 2 + 1,
    boardRows: maxRow + 1,
    boardLayers: maxLayer,
  };
}

export function useMahjongCanvasLayout(slots?: readonly Slot[]): MahjongLayout {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { boardCols, boardRows, boardLayers } = slots ? layoutBounds(slots) : TURTLE_BOUNDS;
  return useMemo(
    () =>
      calculateMahjongLayout({
        screenWidth: width,
        screenHeight: height,
        safeAreaTop: insets.top,
        safeAreaBottom: insets.bottom,
        safeAreaLeft: insets.left,
        safeAreaRight: insets.right,
        boardCols,
        boardRows,
        boardLayers,
      }),
    [
      width,
      height,
      insets.top,
      insets.bottom,
      insets.left,
      insets.right,
      boardCols,
      boardRows,
      boardLayers,
    ]
  );
}

export function useMahjongCamera(slots?: readonly Slot[]): BoardCamera {
  const layout = useMahjongCanvasLayout(slots);
  return useMemo(
    () => makeBoardCamera(layout, layout.availWidth, layout.availHeight, 16),
    [layout]
  );
}
