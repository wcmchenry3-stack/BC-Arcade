/**
 * Geometry of a felt card table (#3606; FreeCell reuses it in #3607): the card
 * size and the tableau's vertical overlap for a felt of a given size.
 *
 * Pure, like `game/blackjack/layout.ts`. The felt's size is the caller's
 * business (measured with `onLayout`, or the window less the screen chrome); the
 * helper only guarantees that the tallest legal column (6 face-down + 13
 * face-up) fits in it.
 *
 * Layout inside the felt: padding, the top row (stock / waste / foundations),
 * a row gap, the tableau, padding.
 */

/** Cards in a row of the tableau. */
export const TABLE_COLUMNS = 7;
/** Gap between neighbouring cards, in dp. */
export const TABLE_GAP = 4;
/** Padding between the felt's edge and the cards, in dp. */
export const TABLE_PADDING = 12;
/** Gap between the top row and the tableau, in dp. */
export const TABLE_ROW_GAP = 12;

/** Standard card aspect ratio (the shared natural 52 x 74 card). */
export const TABLE_CARD_ASPECT = 74 / 52;

/** A face-down card shows this fraction of the card height. */
export const FACE_DOWN_STEP_RATIO = 0.2;
/** A face-up card shows up to this fraction of the card height (the centre pip). */
export const MAX_FACE_UP_STEP_RATIO = 0.72;
/** Never tighter than this: the rank and suit in the corner stay readable and tappable. */
export const MIN_FACE_UP_STEP_RATIO = 0.25;

/** The tallest legal Klondike column: 6 face-down under a full King-to-Ace run. */
export const MAX_FACE_DOWN = 6;
export const MAX_FACE_UP = 13;

/** Narrowest card the table draws (docs/GAMEPLAY_STANDARDS.md: cardWidth >= 36). */
const MIN_CARD_WIDTH = 36;

export interface TableGeometryInput {
  /** The felt's width, in dp. */
  readonly width: number;
  /** The felt's height, in dp. */
  readonly height: number;
  readonly columns?: number;
  readonly gap?: number;
  readonly padding?: number;
  readonly rowGap?: number;
  readonly maxFaceDown?: number;
  readonly maxFaceUp?: number;
}

export interface TableGeometry {
  readonly cardWidth: number;
  readonly cardHeight: number;
  readonly columns: number;
  readonly gap: number;
  readonly padding: number;
  readonly rowGap: number;
  /** Height of the tableau area: from the top of the tableau row to the felt's inner bottom edge. */
  readonly tableauHeight: number;
  readonly faceDownStep: number;
  /** Largest face-up step, used while columns are short. */
  readonly maxFaceUpStep: number;
  /** Face-up step the tallest legal column needs; no legal column ever needs a tighter one. */
  readonly minFaceUpStep: number;
  readonly maxFaceDown: number;
  readonly maxFaceUp: number;
}

/** What a column is made of. */
export interface ColumnCounts {
  readonly down: number;
  readonly up: number;
}

/** Height of a column: the first card's top to the last card's bottom. */
export function columnHeight(
  cardHeight: number,
  faceDownStep: number,
  faceUpStep: number,
  counts: ColumnCounts
): number {
  if (counts.down + counts.up === 0) return 0;
  // Every card above the last adds its step; the last adds its own height.
  const downSteps = counts.up > 0 ? counts.down : Math.max(0, counts.down - 1);
  const upSteps = Math.max(0, counts.up - 1);
  return cardHeight + downSteps * faceDownStep + upSteps * faceUpStep;
}

/**
 * Card size and overlap limits for a felt of `width` x `height`: cards as wide as
 * the columns allow, narrowed only when even the tightest allowed step could not
 * fit the tallest legal column.
 */
export function computeTableGeometry(input: TableGeometryInput): TableGeometry {
  const {
    width,
    height,
    columns = TABLE_COLUMNS,
    gap = TABLE_GAP,
    padding = TABLE_PADDING,
    rowGap = TABLE_ROW_GAP,
    maxFaceDown = MAX_FACE_DOWN,
    maxFaceUp = MAX_FACE_UP,
  } = input;

  let cardWidth = Math.max(
    MIN_CARD_WIDTH,
    Math.floor((width - 2 * padding - (columns - 1) * gap) / columns)
  );

  const geometryFor = (cw: number): TableGeometry => {
    const cardHeight = Math.round(cw * TABLE_CARD_ASPECT);
    const faceDownStep = Math.round(cardHeight * FACE_DOWN_STEP_RATIO);
    const maxFaceUpStep = Math.floor(cardHeight * MAX_FACE_UP_STEP_RATIO);
    const tableauHeight = Math.max(0, height - 2 * padding - cardHeight - rowGap);
    // What the tallest column leaves for its face-up steps, after its last card
    // and its face-down stack.
    const room = tableauHeight - cardHeight - maxFaceDown * faceDownStep;
    const fit = maxFaceUp > 1 ? Math.floor(room / (maxFaceUp - 1)) : maxFaceUpStep;
    return {
      cardWidth: cw,
      cardHeight,
      columns,
      gap,
      padding,
      rowGap,
      tableauHeight,
      faceDownStep,
      maxFaceUpStep,
      minFaceUpStep: Math.max(1, Math.min(maxFaceUpStep, fit)),
      maxFaceDown,
      maxFaceUp,
    };
  };

  let geometry = geometryFor(cardWidth);
  // Too short for the tightest readable step: shrink the cards until it fits.
  while (
    cardWidth > MIN_CARD_WIDTH &&
    geometry.minFaceUpStep < Math.ceil(geometry.cardHeight * MIN_FACE_UP_STEP_RATIO)
  ) {
    cardWidth -= 1;
    geometry = geometryFor(cardWidth);
  }
  return geometry;
}

/**
 * The face-up step for a board: the largest step (up to the maximum) at which
 * every column in `columns` fits the tableau. One step for the whole board keeps
 * the columns looking alike; it only tightens once a column needs it.
 */
export function faceUpStepFor(geometry: TableGeometry, columns: readonly ColumnCounts[]): number {
  let step = geometry.maxFaceUpStep;
  for (const { down, up } of columns) {
    if (up <= 1) continue;
    const room = geometry.tableauHeight - geometry.cardHeight - down * geometry.faceDownStep;
    step = Math.min(step, Math.floor(room / (up - 1)));
  }
  return Math.max(1, step);
}

/** Space between the stat line and the felt, and between the felt and the tab bar, in dp. */
export const TABLE_FELT_MARGIN_TOP = 4;
export const TABLE_FELT_MARGIN_BOTTOM = 8;

export interface FeltSizeInput {
  readonly windowWidth: number;
  readonly windowHeight: number;
  /** Gutters left and right of the felt (the safe-area inset or the minimum gutter). */
  readonly sideInsets: { readonly left: number; readonly right: number };
  /** Everything above the stat line: the app header and the top inset. */
  readonly headerHeight: number;
  readonly statLineHeight: number;
  /** Everything below the felt's margin: the tab bar, or the bottom inset. */
  readonly bottomHeight: number;
}

/**
 * The felt's size before it has been measured: the window less the screen's real
 * chrome. The felt is `flex: 1` between the stat line and the tab bar, so this is
 * what `onLayout` reports, and the board never jumps when the measurement lands.
 */
export function estimateFeltSize(input: FeltSizeInput): { width: number; height: number } {
  const { windowWidth, windowHeight, sideInsets, headerHeight, statLineHeight, bottomHeight } =
    input;
  return {
    width: Math.max(0, windowWidth - sideInsets.left - sideInsets.right),
    height: Math.max(
      0,
      windowHeight -
        headerHeight -
        statLineHeight -
        TABLE_FELT_MARGIN_TOP -
        TABLE_FELT_MARGIN_BOTTOM -
        bottomHeight
    ),
  };
}
