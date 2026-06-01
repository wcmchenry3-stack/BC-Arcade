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
  /** Smallest row index in the layout (default 0). Used to eliminate empty canvas space above the top tile row. */
  minRow?: number;
  /** Smallest col index in the layout (default 0). Used to eliminate empty canvas space left of the first tile column. */
  minCol?: number;
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
  boardLayers: number;
  minRow: number;
  minCol: number;
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
    boardLayers,
    minRow,
    minCol,
  } = layout;
  // Derived coordinate-transform values — internal to the camera.
  const layerOffsetY = boardLayers * layerDy;
  const rowOffset = minRow * tileHeight;
  const colOffset = Math.round((minCol / 2) * tileWidth);
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
        // colOffset shifts the origin so the leftmost used column starts at padX.
        x: padX + (col / 2) * tileWidth + layer * layerDx - colOffset,
        // layerOffsetY pushes tiles down so the highest layer sits at y=padY
        // (not negative). rowOffset removes empty rows above the first used row.
        y: padY + layerOffsetY + row * tileHeight - layer * layerDy - rowOffset,
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
// Target ~1 tile of green margin on every side. Overflow protection in
// calculateMahjongLayout caps padX/padY so the board always fits the viewport.
const PAD_X_R = 1; // 1 × tileWidth on left and right
const PAD_Y_R = 56 / 44; // 1 × tileHeight on top and bottom

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
    minRow = 0,
    minCol = 0,
  } = input;

  const horizPad =
    Math.max(safeAreaLeft, MIN_HORIZ_MARGIN) + Math.max(safeAreaRight, MIN_HORIZ_MARGIN);
  const availW = Math.max(1, screenWidth - horizPad);
  const availH = Math.max(1, screenHeight - safeAreaTop - safeAreaBottom - MAHJONG_CHROME_H);

  // Solve for the largest tileWidth that fits the tile + layer area within the
  // viewport. Padding is added separately (with overflow protection) so that
  // the MIN_TILE_W clamp never causes the board to exceed the available space.
  const widthFactor = boardCols + boardLayers * LAYER_DX_R + 2 * PAD_X_R;
  const heightFactor = boardRows * TILE_ASPECT + boardLayers * LAYER_DY_R + 2 * PAD_Y_R;

  const rawTileW = Math.min(availW / widthFactor, availH / heightFactor);
  const tileWidth = Math.max(MIN_TILE_W, Math.min(MAX_TILE_W, rawTileW));

  const tileHeight = Math.round(tileWidth * TILE_ASPECT);
  const sideWidth = Math.max(3, Math.round(tileWidth * SIDE_R));
  const layerDx = Math.max(3, Math.round(tileWidth * LAYER_DX_R));
  const layerDy = Math.max(2, Math.round(tileWidth * LAYER_DY_R));

  // Target padding is ~1 tile on each side. Cap it so the board never exceeds
  // the available viewport even when tileWidth is clamped to MIN_TILE_W.
  const slotsW = boardCols * tileWidth + boardLayers * layerDx;
  const slotsH = boardRows * tileHeight + boardLayers * layerDy;
  const padX = Math.max(
    4,
    Math.min(Math.round(tileWidth * PAD_X_R), Math.floor((availW - slotsW) / 2))
  );
  const padY = Math.max(
    6,
    Math.min(Math.round(tileWidth * PAD_Y_R), Math.floor((availH - slotsH) / 2))
  );

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
    boardLayers,
    minRow,
    minCol,
  };
}

const TURTLE_BOUNDS = { boardCols: 12, boardRows: 8, boardLayers: 4, minRow: 0, minCol: 0 };

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
  minRow: number;
  minCol: number;
} {
  if (slots.length === 0) throw new Error("layoutBounds: empty slot array");
  let maxCol = 0,
    maxRow = 0,
    maxLayer = 0;
  // Non-null: length check above guarantees slots[0] exists.
  let minCol = slots[0]!.col,
    minRow = slots[0]!.row;
  for (const s of slots) {
    if (s.col > maxCol) maxCol = s.col;
    if (s.col < minCol) minCol = s.col;
    if (s.row > maxRow) maxRow = s.row;
    if (s.row < minRow) minRow = s.row;
    if (s.layer > maxLayer) maxLayer = s.layer;
  }
  return {
    // Use the actual used range so unused rows/cols don't leave empty canvas space.
    boardCols: (maxCol - minCol) / 2 + 1,
    boardRows: maxRow - minRow + 1,
    boardLayers: maxLayer,
    minRow,
    minCol,
  };
}

export function useMahjongCanvasLayout(slots?: readonly Slot[]): MahjongLayout {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { boardCols, boardRows, boardLayers, minRow, minCol } = slots
    ? layoutBounds(slots)
    : TURTLE_BOUNDS;
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
        minRow,
        minCol,
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
      minRow,
      minCol,
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
