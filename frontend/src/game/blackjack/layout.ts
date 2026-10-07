// Below this available content height the layout collapses to compact variants.
// Mirrors the old screen-level constant but lives here so every consumer uses
// the same threshold without re-importing from the screen.
export const COMPACT_HEIGHT_BREAKPOINT = 660;

// Standard playing-card aspect ratio (≈ √2). Used only for split card height.
const CARD_ASPECT = 1.414;

// Horizontal padding applied by the table screen on each side (see BlackjackTableScreen).
const TABLE_PADDING_H = 16;
// Fallback when the caller does not know the window width (small phone).
const DEFAULT_AVAILABLE_WIDTH = 360;
// Slack for the fan rotation of the first two player cards and split-hand borders.
const HAND_WIDTH_SLACK = 8;

/**
 * Left margin to apply to every card after the first so a hand of `count`
 * cards fits on ONE row inside `availableWidth`. Returns 0 while the cards
 * fit side by side; otherwise a negative margin that overlaps the cards.
 * The first card keeps its position and the last card is always fully
 * visible (it sits on top and ends exactly at the right edge).
 */
export function calculateCardOverlap(
  count: number,
  cardWidth: number,
  availableWidth: number
): number {
  if (count <= 1 || availableWidth <= cardWidth) return 0;
  const step = (availableWidth - cardWidth) / (count - 1);
  return Math.min(0, Math.floor(step - cardWidth));
}

export interface BlackjackLayoutInput {
  availableWidth?: number;
  availableHeight: number;
}

export interface BlackjackLayout {
  compact: boolean;

  // Main player and dealer hand card sizes
  playerCardWidth: number;
  playerCardHeight: number;
  dealerCardWidth: number;
  dealerCardHeight: number;
  // Split hands appear side-by-side and always use smaller cards
  splitCardWidth: number;
  splitCardHeight: number;
  // Width available to a single hand's row of cards (cards overlap to fit it)
  handRowWidth: number;
  splitHandRowWidth: number;

  // Action button cluster
  buttonSize: number;
  buttonRadius: number;
  buttonIconSize: number;
  clusterGap: number;
  clusterPaddingH: number;
  clusterPaddingV: number;

  // Table container spacing
  tableGap: number;
  tablePaddingV: number;

  // Hand display
  handGap: number;
  handLabelFontSize: number;
  scorePillFontSize: number;

  // Split hand row
  handsRowGap: number;
  splitHandPadding: number;

  // Controls area
  controlsPaddingBottom: number;
  controlsGap: number;
}

export function calculateBlackjackLayout(input: BlackjackLayoutInput): BlackjackLayout {
  const { availableHeight, availableWidth = DEFAULT_AVAILABLE_WIDTH } = input;
  const compact = availableHeight < COMPACT_HEIGHT_BREAKPOINT;

  // Card dimensions — preserve exact existing pixel values for normal/compact,
  // and introduce a distinct smaller size for split hands in compact mode.
  const playerCardWidth = compact ? 48 : 68;
  const playerCardHeight = compact ? 68 : 96;
  const dealerCardWidth = compact ? 40 : 52;
  const dealerCardHeight = compact ? 56 : 72;
  // Split: non-compact matches existing compact-player size (48×68);
  // compact reduces further while keeping the 36px minimum.
  const splitCardWidth = compact ? 36 : 48;
  const splitCardHeight = Math.round(splitCardWidth * CARD_ASPECT);

  const buttonSize = compact ? 62 : 80;
  const handsRowGap = compact ? 6 : 8;
  const splitHandPadding = compact ? 4 : 6;
  const handRowWidth = Math.max(0, availableWidth - 2 * TABLE_PADDING_H - HAND_WIDTH_SLACK);
  // Two split hands share the row; each has padding plus a 2px active border.
  const splitHandRowWidth = Math.max(
    0,
    Math.floor((availableWidth - 2 * TABLE_PADDING_H - handsRowGap) / 2) -
      2 * (splitHandPadding + 2) -
      HAND_WIDTH_SLACK
  );

  return {
    compact,
    playerCardWidth,
    playerCardHeight,
    dealerCardWidth,
    dealerCardHeight,
    splitCardWidth,
    splitCardHeight,
    handRowWidth,
    splitHandRowWidth,
    buttonSize,
    buttonRadius: buttonSize / 2,
    buttonIconSize: compact ? 22 : 28,
    clusterGap: compact ? 6 : 8,
    clusterPaddingH: compact ? 8 : 12,
    clusterPaddingV: compact ? 6 : 10,
    tableGap: compact ? 4 : 8,
    tablePaddingV: compact ? 4 : 8,
    handGap: compact ? 2 : 8,
    handLabelFontSize: compact ? 11 : 13,
    scorePillFontSize: compact ? 22 : 32,
    handsRowGap,
    splitHandPadding,
    controlsPaddingBottom: compact ? 12 : 32,
    controlsGap: compact ? 8 : 16,
  };
}
