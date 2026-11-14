/**
 * Corner index geometry (#3622): the stacked index every deck draws (rank, suit under it)
 * and the compact one a covered card in a compressed tableau column draws instead (the suit
 * beside the rank, on one line, inside the card's visible stripe).
 *
 * Pure numbers, no React: the tableau column picks which index a card gets from its real
 * stripe (`compactIndexFor`), and the deck faces lay the compact index out from these.
 */

/** Smallest compact font, in dp. */
const COMPACT_MIN_FONT = 6;
/** Advance of a bold rank character, as a share of the font size (a conservative estimate). */
const RANK_ADVANCE = 0.72;
/** Descent of the suit glyph under its baseline, as a share of the font size. */
const GLYPH_DESCENT = 0.2;

/**
 * The visible stripe under which a covered card draws the compact index, in dp: the 24 dp
 * full stripe the felt table aims for (`tableLayout.ts` `MIN_FACE_UP_STEP`). Every card width
 * the table draws puts the stacked suit's baseline + 2 at 24 dp or lower down the card (at
 * least 10 + 8 + 4 + 2), so this one constant is the whole threshold: an uncompressed column
 * (a stripe of 24 dp or more) always keeps today's look.
 */
export const COMPACT_INDEX_THRESHOLD = 24;

/**
 * The shortest stripe the compact index is drawn in, in dp: the smallest compact font with its
 * descent, plus its 2 dp top margin (6 x 1.2 + 2 = 9.2, rounded up to 10, where the Minimal
 * row's 8 dp line and its 2 dp of border and margin fit too). Below it (a few-dp stripe on the
 * short-window fit floor) nothing fits either way, and the card keeps its stacked index rather
 * than a row that overflows the stripe.
 */
export const MIN_COMPACT_STRIPE = Math.ceil(COMPACT_MIN_FONT * (1 + GLYPH_DESCENT) + 2);

/** The stacked corner index of the SVG decks (Classic, Neon): font sizes and baselines, in dp. */
export function stackedCornerIndex(width: number): {
  readonly rankFontSize: number;
  readonly suitFontSize: number;
  readonly rankBaseline: number;
  readonly suitBaseline: number;
} {
  const rankFontSize = Math.max(10, Math.round(width * 0.24));
  const suitFontSize = Math.max(8, Math.round(width * 0.18));
  return {
    rankFontSize,
    suitFontSize,
    rankBaseline: rankFontSize + 2,
    suitBaseline: rankFontSize + suitFontSize + 4,
  };
}

/**
 * The `compactIndex` a tableau card gets: its visible stripe, in dp, when that stripe is under
 * `COMPACT_INDEX_THRESHOLD` and at least `MIN_COMPACT_STRIPE` (a covered face-up card in a
 * compressed column); otherwise undefined (the top card, a face-down card, an uncompressed
 * column, a fit-floor stripe too short for any index).
 */
export function compactIndexFor(stripe: number | undefined): number | undefined {
  if (stripe === undefined || stripe < MIN_COMPACT_STRIPE) return undefined;
  return stripe < COMPACT_INDEX_THRESHOLD ? stripe : undefined;
}

export interface CompactCornerLayout {
  readonly rankX: number;
  readonly suitX: number;
  /** Rank and suit share one baseline. */
  readonly baseline: number;
  readonly fontSize: number;
  /** The lowest point the index reaches (the suit glyph's descent), in dp. */
  readonly bottom: number;
  /** Where the suit glyph ends on the right, in dp. */
  readonly right: number;
}

/**
 * The compact corner index of the SVG decks (Classic, Neon), in dp: the rank at the stacked
 * index's x, the suit right of it at the same size, on one baseline, shrunk only if the stripe
 * is too short for the stacked rank's size.
 */
export function compactSvgCornerLayout(
  width: number,
  stripe: number,
  rankLength: number
): CompactCornerLayout {
  const { rankFontSize } = stackedCornerIndex(width);
  // The index ends at baseline + descent = 2 + (1 + GLYPH_DESCENT) * fontSize.
  const fit = Math.floor((stripe - 2) / (1 + GLYPH_DESCENT));
  const fontSize = Math.max(COMPACT_MIN_FONT, Math.min(rankFontSize, fit));
  const baseline = fontSize + 2;
  const rankX = 5;
  const suitX = rankX + rankLength * fontSize * RANK_ADVANCE + 2;
  return {
    rankX,
    suitX,
    baseline,
    fontSize,
    bottom: baseline + fontSize * GLYPH_DESCENT,
    right: suitX + fontSize,
  };
}

/**
 * The Minimal deck's compact index (a React Native text row in the top-left corner), in dp:
 * the row sits 1 dp inside the card's 1 dp border, one line of `lineHeight`.
 */
export function compactMinimalLayout(stripe: number): {
  readonly top: number;
  readonly left: number;
  readonly fontSize: number;
  readonly lineHeight: number;
  /** The row's bottom edge, from the card's top, in dp. */
  readonly bottom: number;
} {
  const border = 1;
  const top = 1;
  /** The Minimal rank's own size (16 dp); the compact index is never larger. */
  const fullFont = 16;
  const lineHeight = Math.max(COMPACT_MIN_FONT + 2, Math.min(fullFont + 2, stripe - 3));
  const fontSize = lineHeight - 2;
  return { top, left: 4, fontSize, lineHeight, bottom: border + top + lineHeight };
}
