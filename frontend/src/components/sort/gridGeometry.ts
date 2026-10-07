/**
 * Pure grid-shape math for the Bottle Sort board (extracted from SortBoard so
 * it has a single source of truth and can be unit-tested directly — see
 * gridGeometry.test.ts, in particular the #2297 and #2426 regression coverage).
 */

export interface GridShape {
  /** Longest row — i.e. max(rowCounts). Drives horizontal bottle sizing. */
  readonly numCols: number;
  readonly numRows: number;
  /** Bottle count for each row, read directly by SortBoard to group bottles
   * into explicit row containers (see #2426 — relying on flexWrap to infer
   * row breaks from a computed bottle width let actual on-device wrapping
   * diverge from this shape). Sizes differ by at most 1 across rows: the
   * remainder from an uneven division is spread one-per-row across the
   * first `numBottles % numRows` rows rather than dumped into the last row. */
  readonly rowCounts: readonly number[];
}

/**
 * Chooses a row count from the same per-row cap as before (single row for
 * ≤4 bottles; cap of 3 for 5–6; cap of 4 for 7+), then evenly spreads the
 * bottle count across that many rows instead of filling full rows first and
 * leaving whatever's left in a short final row.
 * Depends ONLY on bottle count — see gridGeometry.test.ts for why that
 * matters (SortBoard resets its cached layout positions whenever bottle
 * count changes; this function being a pure function of count alone is what
 * makes that reset key both correct and sufficient).
 */
export function computeGridShape(numBottles: number): GridShape {
  if (numBottles <= 0) return { numCols: 0, numRows: 0, rowCounts: [] };
  const maxColsCap = numBottles <= 4 ? numBottles : numBottles <= 6 ? 3 : 4;
  const numRows = Math.ceil(numBottles / maxColsCap);
  const base = Math.floor(numBottles / numRows);
  const remainder = numBottles % numRows;
  const rowCounts = Array.from({ length: numRows }, (_, i) => base + (i < remainder ? 1 : 0));
  const numCols = Math.max(...rowCounts);
  return { numCols, numRows, rowCounts };
}

/** Default space between neighbouring bottles, in both directions. */
export const BOTTLE_GAP = 12;
/** Lowest height a bottle is shrunk to when vertical space runs out. */
export const MIN_BOTTLE_HEIGHT = 60;
/**
 * Minimum size of a bottle's tap area (#2207). RN layout units are points on
 * iOS and dp on Android, so 48 meets both the iOS 44pt and the Android 48dp
 * guidance (and WCAG 2.5.8's 24px floor).
 */
export const MIN_TOUCH_TARGET = 48;

export interface BoardLayout extends GridShape {
  /** Visual size of one bottle. */
  readonly bottleW: number;
  readonly bottleH: number;
  /**
   * Width of one bottle's cell. The bottle is centered in it and the cell is
   * the bottle's whole tap area, so cells tile each row without overlapping.
   * slotW - bottleW is the visual gap between neighbouring bottles.
   */
  readonly slotW: number;
  /** Space between bottle rows. */
  readonly rowGap: number;
  /** The bottle's left edge within its cell: (slotW - bottleW) / 2. */
  readonly bottleInsetX: number;
  /**
   * hitSlop for the bottle's touchable. It widens the tap area to the cell's
   * edges and never past them, so neighbouring targets can't overlap and the
   * area stays inside its parent view (Android drops touches outside it).
   */
  readonly hitSlop: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  };
}

/**
 * Sizes the board for `numBottles` bottles in a content box of
 * contentW × contentH (the board's area inside its padding).
 *
 * Bottles keep their aspect ratio and scale to fit the height first, then the
 * width. Each bottle then gets a cell at least MIN_TOUCH_TARGET wide whenever
 * the row's width allows it, so dense levels (the 16-bottle 4×4 grid) keep
 * full-size tap areas even where the bottles themselves are narrow (#2207).
 * Bottles are always far taller than MIN_TOUCH_TARGET (see the tests), so no
 * vertical slop is needed.
 */
export function computeBoardLayout(
  numBottles: number,
  contentW: number,
  contentH: number,
  bottle: { readonly width: number; readonly height: number }
): BoardLayout {
  const shape = computeGridShape(numBottles);
  const { numCols, numRows } = shape;
  const rowGap = BOTTLE_GAP;
  if (numCols === 0) {
    return {
      ...shape,
      bottleW: 0,
      bottleH: 0,
      slotW: 0,
      rowGap,
      bottleInsetX: 0,
      hitSlop: { left: 0, right: 0, top: 0, bottom: 0 },
    };
  }
  const aspect = bottle.width / bottle.height;

  const maxBottleH = Math.max(MIN_BOTTLE_HEIGHT, (contentH - rowGap * (numRows - 1)) / numRows);
  const bottleHFromHeight = Math.min(bottle.height, maxBottleH);

  // The widest a cell may be without the row overflowing the content width.
  // A bottle always keeps at least the default gap to its neighbours.
  const maxSlotW = Math.max(0, contentW / numCols);
  const bottleW = Math.max(0, Math.min(bottleHFromHeight * aspect, maxSlotW - BOTTLE_GAP));
  const bottleH = bottleW / aspect;

  const slotW = Math.min(maxSlotW, Math.max(bottleW + BOTTLE_GAP, MIN_TOUCH_TARGET));
  const bottleInsetX = (slotW - bottleW) / 2;
  return {
    ...shape,
    bottleW,
    bottleH,
    slotW,
    rowGap,
    bottleInsetX,
    hitSlop: { left: bottleInsetX, right: bottleInsetX, top: 0, bottom: 0 },
  };
}
