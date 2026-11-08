// Below this available content height the layout collapses to compact variants.
// Mirrors the old screen-level constant but lives here so every consumer uses
// the same threshold without re-importing from the screen.
export const COMPACT_HEIGHT_BREAKPOINT = 660;

// Standard playing-card aspect ratio (≈ √2). Used only for split card height.
const CARD_ASPECT = 1.414;

// Visual margin kept free on each side of the window. The table area itself has
// no horizontal padding, so this only stops cards touching the screen edge.
const TABLE_PADDING_H = 16;
// Smallest strip of an overlapped card that stays visible, even when the row is
// narrower than a single card (very narrow windows).
const MIN_VISIBLE_STRIP = 4;
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
  if (count <= 1 || !Number.isFinite(availableWidth)) return 0;
  const step = Math.max(MIN_VISIBLE_STRIP, (availableWidth - cardWidth) / (count - 1));
  return Math.min(0, Math.floor(step - cardWidth));
}

export interface BlackjackLayoutInput {
  availableWidth?: number;
  availableHeight: number;
  /** Simultaneous player hands (split). The engine allows up to 4; minimum 2. */
  handCount?: number;
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
  const { availableHeight, availableWidth = DEFAULT_AVAILABLE_WIDTH, handCount = 2 } = input;
  const splitHands = Math.max(2, Math.floor(handCount) || 2);
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
  // Split hands share the row equally; each has padding plus a 2px active border.
  const splitHandRowWidth = Math.max(
    0,
    Math.floor(
      (availableWidth - 2 * TABLE_PADDING_H - handsRowGap * (splitHands - 1)) / splitHands
    ) -
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

// ===========================================================================
// One-table layout (#3580): fanned hands on a felt, split fans and rows.
//
// Pure geometry for the one Blackjack table screen. Everything is measured in
// the felt's own coordinates (0,0 = its top-left corner). The screen measures
// the felt (onLayout) and memoises `computeTableGeometry` on its inputs, so
// none of this runs on the animation path. Cards are positioned absolutely
// from these numbers, which is what lets the card motion of #3581 move a card
// from one place to the next.
// ===========================================================================

/** Card height / width. */
export const CARD_RATIO = 1.4;
/** Largest card width on any phone, and the share of the screen width it may take. */
export const MAX_CARD_WIDTH = 78;
export const CARD_WIDTH_SCREEN_SHARE = 0.2;
/** Dealer cards are a little smaller than the player's. */
export const DEALER_CARD_SHARE = 0.86;
/** Fraction of a card's width each covered card shows: a hand, 2-hand split fans, split rows. */
export const FAN_REVEAL = 0.34;
export const SPLIT_FAN_REVEAL = 0.3;
export const ROW_REVEAL = 0.42;
/**
 * A covered card always shows at least this much (px) and this share of its
 * width, so its corner index (rank + suit, drawn 5px in from the left edge at
 * 0.24 × the card width) stays readable.
 */
export const MIN_INDEX_STRIP = 14;
export const MIN_INDEX_STRIP_SHARE = 0.3;
/** Narrowest card drawn: below this the corner index no longer fits on the card. */
export const MIN_CARD_WIDTH = 30;
/** The active split row is this much taller than the other rows. */
export const ACTIVE_ROW_SHARE = 1.35;

/** Felt padding and the heights of the labels and the result banner. */
export const FELT_PAD_X = 14;
const FELT_TOP = 8;
const FELT_BOTTOM = 10;
const LABEL_H = 22;
const ZONE_GAP = 6;
const BOX_PAD = 4;
/** Left column of a split row (hand number, total, bet). */
export const ROW_LABEL_WIDTH = 72;
/** Height kept free for the result banner (outcome, payout and one detail line). */
export const RESULT_BANNER_HEIGHT = 60;
/** The rows layout keeps a one-line banner: each hand's own result is in its row. */
export const ROWS_RESULT_BANNER_HEIGHT = 40;

/** Chrome around the felt, for estimating its size before the first onLayout. */
export const HUD_STRIP_HEIGHT = 46;
export const DOCK_HEIGHT_BETTING = 112;
export const DOCK_HEIGHT_PLAYING = 62;
export const TAB_BAR_ESTIMATE = 58;

export type SplitMode = "single" | "fans" | "rows";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A fanned hand: cards left to right, each `step` px after the previous one. */
export interface FanGeometry {
  x: number;
  y: number;
  cardWidth: number;
  cardHeight: number;
  step: number;
  count: number;
  /** Width of the whole fan (first card's left edge to the last card's right edge). */
  width: number;
}

export interface HandGeometry {
  /** The hand's box (highlight / dim area). */
  box: Rect;
  /** Where the hand's label (number, total pill, bet) goes. */
  label: Rect;
  fan: FanGeometry;
}

export interface TableGeometry {
  feltWidth: number;
  feltHeight: number;
  cardCap: number;
  mode: SplitMode;
  /** Dealer label and fan; `labelBeside` in the rows layout (label on the left, like the rows). */
  dealer: { label: Rect; fan: FanGeometry; labelBeside: boolean };
  hands: HandGeometry[];
  /** The band kept free for the result banner, between the dealer and the hands; null when no result shows. */
  result: Rect | null;
  /** The betting spot, when no cards are on the table. */
  betSpot: Rect | null;
}

export interface TableGeometryInput {
  feltWidth: number;
  feltHeight: number;
  /** Window width: caps the card size per phone. */
  screenWidth: number;
  dealerCards: number;
  /** Card count of each player hand ([] before the deal). */
  handCards: readonly number[];
  /** The hand being played, or null when none is (result, betting). */
  activeHandIndex: number | null;
  showResult: boolean;
}

/** The largest card width on a phone of this width. */
export function cardCapFor(screenWidth: number): number {
  return Math.min(MAX_CARD_WIDTH, screenWidth * CARD_WIDTH_SCREEN_SHARE);
}

/** How far apart two fanned cards are: their reveal, never less than the readable strip. */
export function fanStep(cardWidth: number, reveal: number): number {
  return Math.max(cardWidth * reveal, MIN_INDEX_STRIP, cardWidth * MIN_INDEX_STRIP_SHARE);
}

/** Width of a fan of `count` cards. */
export function fanWidth(count: number, cardWidth: number, reveal: number): number {
  if (count <= 0) return 0;
  return cardWidth + (count - 1) * fanStep(cardWidth, reveal);
}

/**
 * The largest whole card width, at most `cap`, at which `count` cards fan into
 * `available` px with every corner index showing.
 */
export function fitCardWidth(
  count: number,
  available: number,
  cap: number,
  reveal: number
): number {
  const n = Math.max(1, Math.floor(count));
  const avail = Math.max(0, available);
  if (n === 1) return Math.floor(Math.min(cap, avail));
  const atReveal = Math.min(cap, avail / (1 + (n - 1) * reveal));
  if (atReveal * reveal >= MIN_INDEX_STRIP) return Math.floor(atReveal);
  // Too small for the reveal to show the index: cards step by the minimum strip.
  return Math.floor(Math.max(0, Math.min(cap, avail - (n - 1) * MIN_INDEX_STRIP)));
}

/** 1 hand: one fan; 2 hands: fans side by side; 3–4 hands: one row per hand. */
export function splitModeFor(handCount: number): SplitMode {
  if (handCount <= 1) return "single";
  return handCount === 2 ? "fans" : "rows";
}

const cardH = (w: number) => Math.round(w * CARD_RATIO);

function fanAt(
  x: number,
  y: number,
  count: number,
  cardWidth: number,
  reveal: number
): FanGeometry {
  return {
    x,
    y,
    cardWidth,
    cardHeight: cardH(cardWidth),
    step: fanStep(cardWidth, reveal),
    count,
    width: fanWidth(count, cardWidth, reveal),
  };
}

function centredFan(
  centreX: number,
  y: number,
  count: number,
  cardWidth: number,
  reveal: number
): FanGeometry {
  return fanAt(centreX - fanWidth(count, cardWidth, reveal) / 2, y, count, cardWidth, reveal);
}

type GeometryBase = Pick<TableGeometry, "feltWidth" | "feltHeight" | "cardCap" | "mode">;

/**
 * The whole table: dealer at the top, the player's hand(s) low near the dock,
 * the result band between them. Hands never overlap each other, the dealer or
 * the result band, and every card shows its corner index.
 */
export function computeTableGeometry(input: TableGeometryInput): TableGeometry {
  const { feltWidth, feltHeight, screenWidth, dealerCards, handCards, showResult } = input;
  const cardCap = cardCapFor(screenWidth);
  const innerW = Math.max(0, feltWidth - 2 * FELT_PAD_X);
  const centreX = feltWidth / 2;
  const handCount = handCards.length;
  const mode = splitModeFor(handCount);
  // Sized for at least two cards, so the hand does not shrink as it is dealt.
  const dealerCount = Math.max(2, dealerCards);
  const bottom = feltHeight - FELT_BOTTOM;
  const base: GeometryBase = { feltWidth, feltHeight, cardCap, mode };

  if (handCount === 0) {
    const diameter = Math.floor(Math.min(148, feltHeight * 0.42, innerW * 0.6));
    const dealerW = Math.floor(cardCap * DEALER_CARD_SHARE);
    return {
      ...base,
      dealer: {
        label: { x: FELT_PAD_X, y: FELT_TOP, width: innerW, height: LABEL_H },
        fan: centredFan(centreX, FELT_TOP + LABEL_H, dealerCards, dealerW, FAN_REVEAL),
        labelBeside: false,
      },
      hands: [],
      result: null,
      betSpot: {
        x: centreX - diameter / 2,
        y: feltHeight * 0.45 - diameter / 2,
        width: diameter,
        height: diameter,
      },
    };
  }

  if (mode === "rows") return rowsGeometry(input, base, innerW, dealerCount, bottom);

  // --- single hand or two fans: hands low, dealer on top, result between ---
  const hands: HandGeometry[] = [];
  let handsTop: number;
  if (mode === "single") {
    const cards = handCards[0] ?? 0;
    const w = Math.max(
      MIN_CARD_WIDTH,
      fitCardWidth(Math.max(2, cards), innerW, cardCap, FAN_REVEAL)
    );
    const fanY = bottom - cardH(w);
    const labelY = fanY - LABEL_H - 2;
    hands.push({
      box: { x: FELT_PAD_X, y: labelY, width: innerW, height: bottom - labelY },
      label: { x: FELT_PAD_X, y: labelY, width: innerW, height: LABEL_H },
      fan: centredFan(centreX, fanY, cards, w, FAN_REVEAL),
    });
    handsTop = labelY;
  } else {
    const sideGap = 8;
    const colW = (feltWidth - 2 * sideGap - ZONE_GAP) / 2;
    const maxCards = Math.max(2, ...handCards);
    const w = Math.max(
      MIN_CARD_WIDTH,
      fitCardWidth(maxCards, colW - 2 * BOX_PAD - 4, cardCap, SPLIT_FAN_REVEAL)
    );
    const fanY = bottom - BOX_PAD - cardH(w);
    const boxY = fanY - LABEL_H - BOX_PAD - 2;
    handCards.forEach((cards, i) => {
      const colX = sideGap + i * (colW + ZONE_GAP);
      hands.push({
        box: { x: colX, y: boxY, width: colW, height: bottom - boxY },
        label: { x: colX, y: boxY + 2, width: colW, height: LABEL_H },
        fan: centredFan(colX + colW / 2, fanY, cards, w, SPLIT_FAN_REVEAL),
      });
    });
    handsTop = boxY;
  }

  const dealerFanY = FELT_TOP + LABEL_H;
  const resultSpace = showResult ? RESULT_BANNER_HEIGHT + 2 * ZONE_GAP : ZONE_GAP;
  const dealerW = Math.max(
    MIN_CARD_WIDTH,
    Math.min(
      Math.floor(cardCap * DEALER_CARD_SHARE),
      fitCardWidth(dealerCount, innerW, cardCap, FAN_REVEAL),
      Math.floor((handsTop - resultSpace - dealerFanY) / CARD_RATIO)
    )
  );
  const dealerFan = centredFan(centreX, dealerFanY, dealerCards, dealerW, FAN_REVEAL);
  const dealerBottom = dealerFanY + dealerFan.cardHeight;
  return {
    ...base,
    dealer: {
      label: { x: FELT_PAD_X, y: FELT_TOP, width: innerW, height: LABEL_H },
      fan: dealerFan,
      labelBeside: false,
    },
    hands,
    result: showResult
      ? {
          x: FELT_PAD_X,
          y: dealerBottom + ZONE_GAP,
          width: innerW,
          height: Math.max(0, handsTop - ZONE_GAP - (dealerBottom + ZONE_GAP)),
        }
      : null,
    betSpot: null,
  };
}

/** 3–4 split hands: the dealer and every hand as full-width rows, label on the left. */
function rowsGeometry(
  input: TableGeometryInput,
  base: GeometryBase,
  innerW: number,
  dealerCount: number,
  bottom: number
): TableGeometry {
  const { handCards, showResult, dealerCards } = input;
  const { cardCap } = base;
  const n = handCards.length;
  const active =
    !showResult && input.activeHandIndex !== null && input.activeHandIndex < n
      ? input.activeHandIndex
      : null;
  const fanX = FELT_PAD_X + ROW_LABEL_WIDTH + BOX_PAD;
  const fanAvailW = Math.max(0, FELT_PAD_X + innerW - BOX_PAD - fanX);

  // Every row at least tall enough for a card whose index shows at the row reveal.
  const minRowCard = Math.max(MIN_CARD_WIDTH, Math.ceil(MIN_INDEX_STRIP / ROW_REVEAL));
  const minRowH = cardH(minRowCard) + 2 * BOX_PAD;
  const minRowsH =
    active !== null
      ? minRowH * (n - 1) + Math.ceil(minRowH * ACTIVE_ROW_SHARE) + (n - 1) * ZONE_GAP
      : minRowH * n + (n - 1) * ZONE_GAP;
  const resultSpace = showResult ? ROWS_RESULT_BANNER_HEIGHT + ZONE_GAP : 0;

  // The dealer gets what the rows leave, up to its usual size.
  const dealerBudget = bottom - FELT_TOP - ZONE_GAP - resultSpace - minRowsH;
  const dealerW = Math.max(
    MIN_CARD_WIDTH,
    Math.min(
      Math.floor(cardCap * DEALER_CARD_SHARE),
      fitCardWidth(dealerCount, fanAvailW, cardCap, FAN_REVEAL),
      Math.floor(dealerBudget / CARD_RATIO)
    )
  );
  const dealerFan = fanAt(fanX, FELT_TOP, dealerCards, dealerW, FAN_REVEAL);
  const dealerBottom = FELT_TOP + dealerFan.cardHeight;

  const resultY = dealerBottom + ZONE_GAP;
  const rowsTop = resultY + resultSpace;
  const rowsAvail = Math.max(0, bottom - rowsTop);
  const unit =
    active !== null
      ? (rowsAvail - (n - 1) * ZONE_GAP) / (n - 1 + ACTIVE_ROW_SHARE)
      : (rowsAvail - (n - 1) * ZONE_GAP) / n;

  const hands: HandGeometry[] = [];
  let y = rowsTop;
  handCards.forEach((cards, i) => {
    const rowH = Math.floor(i === active ? unit * ACTIVE_ROW_SHARE : unit);
    const w = Math.max(
      0,
      Math.min(
        Math.floor(cardCap),
        Math.floor((rowH - 2 * BOX_PAD) / CARD_RATIO),
        fitCardWidth(Math.max(2, cards), fanAvailW, cardCap, ROW_REVEAL)
      )
    );
    hands.push({
      box: { x: FELT_PAD_X - 6, y, width: innerW + 12, height: rowH },
      label: { x: FELT_PAD_X, y, width: ROW_LABEL_WIDTH, height: rowH },
      fan: fanAt(fanX, y + (rowH - cardH(w)) / 2, cards, w, ROW_REVEAL),
    });
    y += rowH + ZONE_GAP;
  });

  return {
    ...base,
    dealer: {
      label: { x: FELT_PAD_X, y: FELT_TOP, width: ROW_LABEL_WIDTH, height: dealerFan.cardHeight },
      fan: dealerFan,
      labelBeside: true,
    },
    hands,
    result: showResult
      ? { x: FELT_PAD_X, y: resultY, width: innerW, height: ROWS_RESULT_BANNER_HEIGHT }
      : null,
    betSpot: null,
  };
}

export interface FeltSizeInput {
  screenWidth: number;
  screenHeight: number;
  insetTop: number;
  insetBottom: number;
  /** Header height (APP_HEADER_HEIGHT), passed in so this module needs no component import. */
  headerHeight: number;
  /** The dock is taller while it holds the chip tray (betting and result). */
  dockHasChipTray: boolean;
}

/**
 * The felt's size from the screen size and the chrome around it: header, HUD
 * strip, dock and tab bar. The screen uses its measured size once laid out;
 * this is the first frame's estimate and what the layout tests run against.
 */
export function estimateFeltSize(input: FeltSizeInput): { width: number; height: number } {
  const dock = input.dockHasChipTray ? DOCK_HEIGHT_BETTING : DOCK_HEIGHT_PLAYING;
  const height =
    input.screenHeight -
    input.insetTop -
    input.headerHeight -
    HUD_STRIP_HEIGHT -
    dock -
    (TAB_BAR_ESTIMATE + input.insetBottom);
  return { width: Math.max(0, input.screenWidth - 16), height: Math.max(0, height) };
}
