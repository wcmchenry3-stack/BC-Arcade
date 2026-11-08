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
/**
 * The face-up stripe the table aims for, in dp (docs/GAMEPLAY_STANDARDS.md: WCAG
 * 2.5.8's 24 px target): a covered card shows its rank, its pip and room to tap.
 * Only when the tallest column cannot otherwise fit the table does the stripe
 * shrink further, to `MIN_COVERED_STRIPE`.
 */
export const MIN_FACE_UP_STEP = 24;

/** The face-down step never compresses below this, in dp (it only has to show a sliver of back). */
export const MIN_FACE_DOWN_STEP = 8;

/**
 * The compressed face-up stripe the layout plans for, in dp: the height of the
 * card's rank in the corner (`decks/svgCardFace.tsx` draws it at 0.24 of the card
 * width, at least 10 dp, 2 dp from the top). That keeps the RANK readable. The
 * suit pip sits lower (its baseline is about 22 dp down on a 36 dp card), so it is
 * mostly hidden at this stripe, and on a deck whose rank is not suit-coloured
 * (Neon: a white rank) the colour is not shown either. A side-by-side corner index
 * for this state is a follow-up (#3622).
 * @internal Exported for tests only; no production caller (knip --production, #3126).
 */
export const MIN_COVERED_STRIPE = 18;

/**
 * Band reserved at the bottom of the felt, in dp: the selection label and the
 * Auto-Complete pill live in it, so neither covers a column's last cards. The
 * screen measures the band (it can wrap at large font scales) and passes the
 * larger of the two.
 */
export const TABLE_BOTTOM_BAND = 44;

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
  readonly bottomBand?: number;
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
  /** Band kept free below the tableau for the selection label and the Auto-Complete pill. */
  readonly bottomBand: number;
  /** Height of the tableau area: from the top of the tableau row down to the bottom band. */
  readonly tableauHeight: number;
  /**
   * How far the tallest legal column had to be compressed to fit, in order:
   * `"none"` (cards shrink first, the steps stay), `"faceDown"` (36 dp cards, the
   * face-down step shortened), `"faceUp"` (the face-up stripe below 24 dp, down
   * to `MIN_COVERED_STRIPE` where the felt allows).
   */
  readonly compression: "none" | "faceDown" | "faceUp";
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

/**
 * Height of a column: the first card's top to the last card's bottom.
 * @internal Exported for tests only; no production caller (knip --production, #3126).
 */
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
 * the columns allow, so that the tallest legal column (6 face-down + 13 face-up)
 * fits. When it does not, it is compressed in this order:
 *  1. the cards shrink (never under 36 dp wide) at a 24 dp face-up step;
 *  2. the face-down step shortens, down to 8 dp;
 *  3. the face-up step goes below 24 dp, to 18 dp (`MIN_COVERED_STRIPE`) at 375 x 667
 *     and up at font scale 1; a smaller felt (360 x 640 with 3-button navigation, a
 *     large font scale) gets the fitted step, which may be under 18.
 * The table never scrolls: that would fight the drag.
 */
export function computeTableGeometry(input: TableGeometryInput): TableGeometry {
  const {
    width,
    height,
    columns = TABLE_COLUMNS,
    gap = TABLE_GAP,
    padding = TABLE_PADDING,
    rowGap = TABLE_ROW_GAP,
    bottomBand = TABLE_BOTTOM_BAND,
    maxFaceDown = MAX_FACE_DOWN,
    maxFaceUp = MAX_FACE_UP,
  } = input;

  const widthLimit = Math.max(
    MIN_CARD_WIDTH,
    Math.floor((width - 2 * padding - (columns - 1) * gap) / columns)
  );
  const runSteps = Math.max(1, maxFaceUp - 1);

  const build = (
    cw: number,
    faceDownStep: number,
    compression: TableGeometry["compression"]
  ): TableGeometry => {
    const cardHeight = Math.round(cw * TABLE_CARD_ASPECT);
    const maxFaceUpStep = Math.floor(cardHeight * MAX_FACE_UP_STEP_RATIO);
    // The band sits above the felt's bottom padding, so the larger of the two is kept
    // clear (not both).
    const tableauHeight = Math.max(
      0,
      height - padding - cardHeight - rowGap - Math.max(padding, bottomBand)
    );
    const room = tableauHeight - cardHeight - maxFaceDown * faceDownStep;
    const fit = Math.floor(room / runSteps);
    return {
      cardWidth: cw,
      cardHeight,
      columns,
      gap,
      padding,
      rowGap,
      bottomBand,
      tableauHeight,
      compression,
      faceDownStep,
      maxFaceUpStep,
      minFaceUpStep: Math.min(maxFaceUpStep, Math.max(1, fit)),
      maxFaceDown,
      maxFaceUp,
    };
  };
  const defaultFaceDown = (cw: number) =>
    Math.round(Math.round(cw * TABLE_CARD_ASPECT) * FACE_DOWN_STEP_RATIO);

  // 1. Cards as wide as the columns allow, narrowing until a 24 dp step fits.
  for (let cw = widthLimit; cw >= MIN_CARD_WIDTH; cw--) {
    const g = build(cw, defaultFaceDown(cw), "none");
    if (g.minFaceUpStep >= Math.min(MIN_FACE_UP_STEP, g.maxFaceUpStep)) return g;
  }

  // 2. 36 dp cards: shorten the face-down step as far as keeps the 24 dp stripe.
  const narrow = build(MIN_CARD_WIDTH, defaultFaceDown(MIN_CARD_WIDTH), "none");
  const roomForRun = narrow.tableauHeight - narrow.cardHeight - runSteps * MIN_FACE_UP_STEP;
  const faceDown = maxFaceDown > 0 ? Math.floor(roomForRun / maxFaceDown) : narrow.faceDownStep;
  if (faceDown >= MIN_FACE_DOWN_STEP) {
    return build(MIN_CARD_WIDTH, Math.min(narrow.faceDownStep, faceDown), "faceDown");
  }

  // 3. Face-down at its floor; the face-up stripe takes whatever is left.
  return build(MIN_CARD_WIDTH, MIN_FACE_DOWN_STEP, "faceUp");
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
  // Never tighter than the tallest legal column needed, so no legal column overflows.
  return Math.min(geometry.maxFaceUpStep, Math.max(geometry.minFaceUpStep, step));
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
