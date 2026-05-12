import { createContext, useContext } from "react";
import { useWindowDimensions } from "react-native";

const MIN_CARD_W = 28; // ~half a finger-width minimum tap target

// default avoids 0×0 renders outside a Provider
const DEFAULT_CARD_WIDTH = 52;
const DEFAULT_CARD_HEIGHT = 74;

export interface CardSizeContextValue {
  readonly cardWidth: number;
  readonly cardHeight: number;
}

export const CardSizeContext = createContext<CardSizeContextValue>({
  cardWidth: DEFAULT_CARD_WIDTH,
  cardHeight: DEFAULT_CARD_HEIGHT,
});

export function useCardSize(): CardSizeContextValue {
  return useContext(CardSizeContext);
}

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

export function useResponsiveCardSize(
  naturalWidth: number,
  naturalHeight: number,
  columns: number,
  gap: number,
  horizontalPadding = 0
): CardSizeContextValue {
  const { width: availableWidth } = useWindowDimensions();
  return computeCardSize(
    availableWidth,
    naturalWidth,
    naturalHeight,
    columns,
    gap,
    horizontalPadding
  );
}
