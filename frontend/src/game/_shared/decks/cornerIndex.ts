/**
 * Corner index geometry (#3622): the stacked index every deck draws (rank, suit under it)
 * and the compact one a covered card in a compressed tableau column draws instead (the suit
 * beside the rank, on one line, inside the card's visible stripe).
 *
 * Pure numbers, no React: the tableau column picks which index a card gets from its real
 * stripe (`compactIndexFor`), and the deck faces lay the compact index out from these.
 */

/**
 * The face-up stripe the felt table aims for, in dp (`tableLayout.ts` `MIN_FACE_UP_STEP`).
 * At or above it a covered card keeps today's stacked index: only a compressed column goes
 * under it.
 */
const FULL_STRIPE = 24;

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
 * The visible stripe under which a covered card's stacked index loses its suit: the suit
 * pip's baseline plus 2 dp, capped at the 24 dp full stripe, so an uncompressed column (a
 * stripe of 24 dp or more) always keeps today's look.
 */
export function compactIndexThreshold(cardWidth: number): number {
  return Math.min(FULL_STRIPE, stackedCornerIndex(cardWidth).suitBaseline + 2);
}

/**
 * The `compactIndex` a tableau card gets: its visible stripe, in dp, when that stripe is too
 * short for the stacked index (a covered face-up card in a compressed column); otherwise
 * undefined (the top card, a face-down card, an uncompressed column).
 */
export function compactIndexFor(stripe: number | undefined, cardWidth: number): number | undefined {
  if (stripe === undefined || stripe <= 0) return undefined;
  return stripe < compactIndexThreshold(cardWidth) ? stripe : undefined;
}

/** Smallest compact font: on a 1-3 dp fit-floor stripe nothing fits, the index is clipped. */
const COMPACT_MIN_FONT = 6;
/** Advance of a bold rank character, as a share of the font size (a conservative estimate). */
const RANK_ADVANCE = 0.72;
/** Descent of the suit glyph under its baseline, as a share of the font size. */
const GLYPH_DESCENT = 0.2;

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
