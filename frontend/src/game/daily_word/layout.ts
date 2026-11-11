/**
 * Daily Word board sizing (#3663): the tiles grow to fill the space between the header and the
 * keyboard, for six rows of the puzzle's word length, within the screen's width.
 */

/** The board area's gutter beside the tiles, and its space above the keyboard. */
export const BOARD_AREA_PAD_X = 16;
export const BOARD_AREA_PAD_BOTTOM = 12;

/** Rows on the board. */
export const BOARD_ROWS = 6;
/** The tile size before the board area is measured (the first frame), and the old fixed size. */
export const DEFAULT_TILE = 52;
/** Never larger than this (tablets, web). */
export const MAX_TILE = 72;
/** The tile's letter, as a share of its side (22 px on the old 52 px tile). */
const LETTER_RATIO = 22 / 52;
/** The gap between tiles, as a share of a tile (6 px on the old 52 px tile). */
const GAP_RATIO = 6 / 52;

export interface BoardSize {
  readonly tile: number;
  readonly gap: number;
  readonly fontSize: number;
}

/** The size of one tile and its gaps for a board area `width` × `height`. */
export function boardSize(width: number, height: number, wordLength: number): BoardSize {
  const cols = Math.max(1, wordLength);
  // n tiles and n - 1 gaps, each gap GAP_RATIO of a tile.
  const byWidth = width / (cols + (cols - 1) * GAP_RATIO);
  const byHeight = height / (BOARD_ROWS + (BOARD_ROWS - 1) * GAP_RATIO);
  // No floor: a tile shrinks rather than let the board overflow its area (a landscape phone, a
  // long word on a narrow screen).
  const tile = Math.max(1, Math.floor(Math.min(byWidth, byHeight, MAX_TILE)));
  return {
    tile,
    gap: Math.floor(tile * GAP_RATIO),
    fontSize: Math.round(tile * LETTER_RATIO),
  };
}

/** The first frame's size, before the board area is measured. */
export const DEFAULT_BOARD: BoardSize = {
  tile: DEFAULT_TILE,
  gap: 6,
  fontSize: 22,
};

/**
 * The centre of board row `row`, from the top of the board area `areaHeight` tall (#3664: where
 * the win's sparks start). The grid is centred in the area above its bottom pad.
 */
export function solvedRowCentre(areaHeight: number, size: BoardSize, row: number): number {
  const grid = BOARD_ROWS * size.tile + (BOARD_ROWS - 1) * size.gap;
  const top = (areaHeight - BOARD_AREA_PAD_BOTTOM - grid) / 2;
  return top + row * (size.tile + size.gap) + size.tile / 2;
}
