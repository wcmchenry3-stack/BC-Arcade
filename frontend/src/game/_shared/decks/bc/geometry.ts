/**
 * Shared geometry of the in-house Arcade, Parlor and Synthwave decks (#3577), ported from the
 * approved mockup. Everything is drawn in a 250 x 350 card box; the SVG viewBox scales it to
 * whatever size PlayingCard asks for. No colours here (see `BC_DECK_ART` in theme.cards.ts).
 */

export const CARD_W = 250;
export const CARD_H = 350;

/** Synthwave draws solid pips below this card width: thin lines vanish when small. */
export const OUTLINE_MIN_WIDTH = 48;

/** Pip positions for A-10, as fractions of the pip field ([x, y]; x .3-.7, y .2-.8). */
export const LAYOUT: Readonly<Record<number, ReadonlyArray<readonly [number, number]>>> = {
  1: [[0.5, 0.5]],
  2: [
    [0.5, 0.2],
    [0.5, 0.8],
  ],
  3: [
    [0.5, 0.2],
    [0.5, 0.5],
    [0.5, 0.8],
  ],
  4: [
    [0.3, 0.2],
    [0.7, 0.2],
    [0.3, 0.8],
    [0.7, 0.8],
  ],
  5: [
    [0.3, 0.2],
    [0.7, 0.2],
    [0.5, 0.5],
    [0.3, 0.8],
    [0.7, 0.8],
  ],
  6: [
    [0.3, 0.2],
    [0.7, 0.2],
    [0.3, 0.5],
    [0.7, 0.5],
    [0.3, 0.8],
    [0.7, 0.8],
  ],
  7: [
    [0.3, 0.2],
    [0.7, 0.2],
    [0.5, 0.35],
    [0.3, 0.5],
    [0.7, 0.5],
    [0.3, 0.8],
    [0.7, 0.8],
  ],
  8: [
    [0.3, 0.2],
    [0.7, 0.2],
    [0.5, 0.35],
    [0.3, 0.5],
    [0.7, 0.5],
    [0.5, 0.65],
    [0.3, 0.8],
    [0.7, 0.8],
  ],
  9: [
    [0.3, 0.2],
    [0.7, 0.2],
    [0.3, 0.4],
    [0.7, 0.4],
    [0.5, 0.5],
    [0.3, 0.6],
    [0.7, 0.6],
    [0.3, 0.8],
    [0.7, 0.8],
  ],
  10: [
    [0.3, 0.2],
    [0.7, 0.2],
    [0.5, 0.3],
    [0.3, 0.4],
    [0.7, 0.4],
    [0.3, 0.6],
    [0.7, 0.6],
    [0.5, 0.7],
    [0.3, 0.8],
    [0.7, 0.8],
  ],
};

export interface PipSpot {
  readonly cx: number;
  readonly cy: number;
  /** Lower-half pips are drawn upside down. */
  readonly flip: boolean;
}

const X0 = 86;
const X1 = 164;
const Y0 = 62;
const Y1 = 288;

/** Where the pips of a number card (2-10) sit in the 250 x 350 box. */
export function pipSpots(rank: number): PipSpot[] {
  return (LAYOUT[rank] ?? []).map(([px, py]) => ({
    cx: X0 + (X1 - X0) * ((px - 0.3) / 0.4),
    cy: Y0 + (Y1 - Y0) * ((py - 0.2) / 0.6),
    flip: py > 0.5,
  }));
}

/** Size of a number-card pip, and of the corner suit. */
export const PIP_SIZE = 42;
export const CORNER_SUIT_SIZE = 32;

/**
 * Corner index: rank text and suit under it, centred on x 31 (32 for two characters).
 * React Native SVG has no `textLength`, so "10" is set smaller (40) instead of the mockup's
 * 46 squeezed to 50 wide.
 */
export const CORNER = {
  suitX: 31,
  suitY: 88,
  textY: 60,
  one: { x: 31, fontSize: 56 },
  two: { x: 32, fontSize: 40 },
} as const;

/** The court frame and its half-figure box. */
export const COURT = { x: 62, y: 40, w: 126, h: 270, halfW: 150, halfH: 118 } as const;

/**
 * Whether the stacked corner index (rank, suit under it) fits a visible stripe of `stripe` dp
 * on a card `height` dp tall. These decks draw a big, tight index (the suit ends 104 units
 * down, 15 dp on a 51 dp card), so it usually does: the compact index is drawn only when it
 * does not, because beside the rank the suit would reach the top pips and the court frame.
 */
export function bcStackedIndexFits(height: number, stripe: number): boolean {
  return ((CORNER.suitY + CORNER_SUIT_SIZE / 2) * height) / CARD_H <= stripe;
}

/**
 * Where the art starts, in card units: the court frame's top (J/Q/K) and the first pip's top
 * (2-10; the ace's pip and Arcade's ring sit far lower). A compact index above it never
 * covers the art that shows in a short stripe.
 */
const ART_TOP = Math.min(COURT.y, Y0 - PIP_SIZE / 2);
/** Clear space kept between the compact index and the art, in card units. */
const ART_PADDING = 4;
/** Cap top of the compact index, in card units: under the edge and Parlor/Synthwave's inner rule. */
const COMPACT_CAP_TOP = 12;
/** Cap height of the corner rank as a share of its font size. */
const CAP_HEIGHT = 0.72;
/** Room kept under the compact index (half above `bottom`), in card units. */
const COMPACT_BOTTOM_ROOM = 6;
/** Advance of a corner rank character as a share of its font size (a conservative estimate). */
const RANK_ADVANCE = 0.7;
/** Gap between the compact rank and its suit, in card units. */
const COMPACT_GAP = 6;
/** Smallest compact rank, in card units (only a stripe far under the 10 dp floor needs it). */
const COMPACT_MIN_FONT = 12;

export interface BcCompactCorner {
  /** Rank text: centred on `rankX` (text-anchor middle), on `baseline`. */
  readonly rankX: number;
  readonly baseline: number;
  readonly fontSize: number;
  /** The suit pip, centred on (suitX, suitY), `suitSize` tall. */
  readonly suitX: number;
  readonly suitY: number;
  readonly suitSize: number;
  /** The index's top, lowest and right-most points, in card units. */
  readonly top: number;
  readonly bottom: number;
  readonly right: number;
}

/**
 * The compact corner index (#3622): the rank and, beside it, the suit pip at the rank's cap
 * height, on a card `height` dp tall with a visible stripe of `stripe` dp. The whole row sits
 * inside the stripe AND above the art (`ART_TOP` less `ART_PADDING`): in a short stripe the
 * top pips and the court frame show, and the row must not cover them. The rank's size is
 * capped by both.
 */
export function bcCompactCorner(
  height: number,
  stripe: number,
  rankLength: number
): BcCompactCorner {
  const c = rankLength > 1 ? CORNER.two : CORNER.one;
  const stripeUnits = (stripe * CARD_H) / height;
  const floor = Math.min(stripeUnits, ART_TOP - ART_PADDING) - COMPACT_BOTTOM_ROOM / 2;
  const fit = (floor - COMPACT_CAP_TOP) / CAP_HEIGHT;
  const fontSize = Math.max(COMPACT_MIN_FONT, Math.min(c.fontSize, fit));
  const cap = CAP_HEIGHT * fontSize;
  const baseline = COMPACT_CAP_TOP + cap;
  const suitSize = cap;
  const rankRight = c.x + (rankLength * fontSize * RANK_ADVANCE) / 2;
  const suitX = rankRight + COMPACT_GAP + suitSize / 2;
  return {
    rankX: c.x,
    baseline,
    fontSize,
    suitX,
    suitY: baseline - cap / 2,
    suitSize,
    top: COMPACT_CAP_TOP,
    bottom: baseline + COMPACT_BOTTOM_ROOM / 2,
    right: suitX + suitSize / 2,
  };
}

export type BcDeckId = "arcade" | "parlor" | "synthwave";

/** Ace pip size: Parlor draws a larger spade. */
export function acePipSize(deck: BcDeckId, suit: string): number {
  return deck === "parlor" && suit === "spades" ? 130 : 96;
}

/**
 * The card's outer edge (the `border` prop: normal, selection or hint colour). It is inset by
 * half its width so the viewBox does not clip it; 6 units is 1.25 px on a 52 px card.
 */
export const EDGE_WIDTH = 6;
export const EDGE_INSET = EDGE_WIDTH / 2;

/** PlayingCard's scrim and hint frame use a 6 px corner; backs match it at any card width. */
export const SCRIM_RADIUS_PX = 6;

/** Court panel and clip corner radius per deck (the clip matches the frame). */
export const COURT_RADIUS: Record<BcDeckId, number> = { arcade: 10, parlor: 4, synthwave: 14 };
