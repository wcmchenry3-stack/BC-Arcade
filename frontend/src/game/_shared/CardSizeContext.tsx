import { createContext, useContext } from "react";

/**
 * Readable minimum card width (docs/GAMEPLAY_STANDARDS.md: `cardWidth ≥ 36px`,
 * #2220). Only binds below the narrowest supported phones (iOS 16.4+ is
 * 375 pt wide): FreeCell's 8 columns (334 px natural board + 24 px padding)
 * reach it under ~325 dp, Solitaire's 7 under ~301 dp. There a board a few px
 * wider than the content area spills into the screen's side padding rather
 * than shrinking cards past legibility.
 */
export const MIN_CARD_W = 36;

/**
 * Natural (unscaled) playing-card size, in dp (#2983). The single source for
 * every 52 x 74 card: PlayingCard's defaults, the Hearts hand, Solitaire's
 * natural board and this context's out-of-Provider default.
 */
export const CARD_NATURAL_W = 52;
export const CARD_NATURAL_H = 74;

export interface CardSizeContextValue {
  readonly cardWidth: number;
  readonly cardHeight: number;
}

// default avoids 0×0 renders outside a Provider
export const CardSizeContext = createContext<CardSizeContextValue>({
  cardWidth: CARD_NATURAL_W,
  cardHeight: CARD_NATURAL_H,
});

export function useCardSize(): CardSizeContextValue {
  return useContext(CardSizeContext);
}

/**
 * A card size fitted to a width. The card games now size their cards from the felt
 * (`_shared/cards/tableLayout.ts`, #3606 / #3607).
 * @internal Exported for tests only; no production caller (knip --production, #3126).
 */
export function computeCardSize(
  availableWidth: number,
  naturalWidth: number,
  naturalHeight: number,
  columns: number,
  gap: number,
  horizontalPadding = 0
): CardSizeContextValue {
  const effectiveWidth = availableWidth - horizontalPadding;
  const naturalBoardWidth = columns * naturalWidth + (columns - 1) * gap;
  const scale = Math.max(
    MIN_CARD_W / naturalWidth,
    Math.min(1, effectiveWidth / naturalBoardWidth)
  );
  return {
    cardWidth: Math.round(naturalWidth * scale),
    cardHeight: Math.round(naturalHeight * scale),
  };
}
