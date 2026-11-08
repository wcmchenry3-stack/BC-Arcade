/**
 * FreeCell's felt-table geometry (#3607): the shared felt-table helper
 * (`_shared/cards/tableLayout.ts`, #3606) set up for 8 columns, a top row of
 * free cells and foundations at 0.92 of the tableau card, and FreeCell's
 * tallest legal column. Pure.
 */

import {
  computeTableGeometry,
  TABLE_BOTTOM_BAND,
  type TableGeometry,
} from "../_shared/cards/tableLayout";

/** Tableau columns. */
export const FREECELL_COLUMNS = 8;
/** The free cells and foundations are drawn at this share of the tableau card's width. */
export const FREECELL_TOP_ROW_SCALE = 0.92;
/**
 * The tallest legal FreeCell column: the 7 cards dealt to columns 1 to 4, the
 * top one a King, with the Queen-to-Ace run built on it (6 + 13). Every card is
 * face up, so the column has no face-down part.
 */
export const FREECELL_MAX_COLUMN = 19;

/** Height of the scroll-button strip above the Large-cards board, in dp (#3347). */
export const SCROLL_BAR_HEIGHT = 48;
/**
 * Padding around the Large-cards board inside its horizontal scroller, so the
 * hint frames drawn just outside the first and last column are not clipped.
 */
export const SCROLL_PAD = 4;

export interface FreeCellGeometryInput {
  /** The felt's inner width and height (inside its rim), in dp. */
  readonly width: number;
  readonly height: number;
  /** The measured bottom band (the no-moves banner), at least `TABLE_BOTTOM_BAND`. */
  readonly bottomBand?: number;
  /**
   * Large cards (#3347): the fixed card width. The board is then wider than a
   * phone and scrolls sideways, inside a scroller whose padding (and, while the
   * board is wider than the felt, its button strip) comes off the height.
   */
  readonly largeCardWidth?: number;
}

/** Width of the 8-column board for a card width and gap. */
export function freeCellBoardWidth(cardWidth: number, gap: number): number {
  return FREECELL_COLUMNS * cardWidth + (FREECELL_COLUMNS - 1) * gap;
}

/**
 * Whether the Large-cards board is wider than the felt, so the scroll buttons
 * show. Read from the felt's width, not from a measurement of the scroller, so
 * the strip (and the height it takes) is known on the first frame.
 */
export function largeBoardOverflows(feltWidth: number, cardWidth: number, gap: number): boolean {
  return freeCellBoardWidth(cardWidth, gap) + 2 * SCROLL_PAD > feltWidth + 1;
}

/** Card size and overlap for a FreeCell felt of `width` x `height`. */
export function freeCellGeometry(input: FreeCellGeometryInput): TableGeometry {
  const { width, height, bottomBand = TABLE_BOTTOM_BAND, largeCardWidth } = input;
  const base = {
    width,
    columns: FREECELL_COLUMNS,
    bottomBand: Math.max(TABLE_BOTTOM_BAND, bottomBand),
    maxFaceDown: 0,
    maxFaceUp: FREECELL_MAX_COLUMN,
    topRowScale: FREECELL_TOP_ROW_SCALE,
  };
  if (largeCardWidth === undefined) return computeTableGeometry({ ...base, height });
  const probe = computeTableGeometry({ ...base, height, fixedCardWidth: largeCardWidth });
  const chrome =
    2 * SCROLL_PAD +
    (largeBoardOverflows(width, largeCardWidth, probe.gap) ? SCROLL_BAR_HEIGHT : 0);
  return computeTableGeometry({
    ...base,
    height: Math.max(0, height - chrome),
    fixedCardWidth: largeCardWidth,
  });
}
