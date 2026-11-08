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

export type BcDeckId = "arcade" | "parlor" | "synthwave";

/** Ace pip size: Parlor draws a larger spade. */
export function acePipSize(deck: BcDeckId, suit: string): number {
  return deck === "parlor" && suit === "spades" ? 130 : 96;
}
