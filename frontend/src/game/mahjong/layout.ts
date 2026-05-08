import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
}

const TILE_ASPECT = 56 / 44;
const MIN_TILE_W = 28;
const MAX_TILE_W = 56;

// All proportional ratios derived from base constants (TILE_W=44, TILE_H=56)
const SIDE_R = 5 / 44;
const LAYER_DX_R = 6 / 44;
const LAYER_DY_R = 5 / 44;
const PAD_X_R = 6 / 44;
const PAD_Y_R = 10 / 44;

// Keep APP_HEADER_H in sync with AppHeader.APP_HEADER_HEIGHT
const APP_HEADER_H = 64;
const HUD_ROW_H = 36;
const MIN_BOTTOM_PAD = 16;
// App header + HUD row + bottom padding = 116
const MAHJONG_CHROME_H = APP_HEADER_H + HUD_ROW_H + MIN_BOTTOM_PAD;
// Minimum horizontal margin on each side when safe-area insets are absent
const MIN_HORIZ_MARGIN = 12;

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

  const horizPad = Math.max(safeAreaLeft, MIN_HORIZ_MARGIN) + Math.max(safeAreaRight, MIN_HORIZ_MARGIN);
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
  };
}

// Turtle layout board grid dimensions
const TURTLE_BOARD_ROWS = 8;
const TURTLE_BOARD_COLS = 12;
const TURTLE_BOARD_LAYERS = 4;

export function useMahjongCanvasLayout(): MahjongLayout {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return useMemo(
    () =>
      calculateMahjongLayout({
        screenWidth: width,
        screenHeight: height,
        safeAreaTop: insets.top,
        safeAreaBottom: insets.bottom,
        safeAreaLeft: insets.left,
        safeAreaRight: insets.right,
        boardRows: TURTLE_BOARD_ROWS,
        boardCols: TURTLE_BOARD_COLS,
        boardLayers: TURTLE_BOARD_LAYERS,
      }),
    [width, height, insets.top, insets.bottom, insets.left, insets.right]
  );
}
