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
// One-table layout (#3580): fanned hands on a felt, split fans, rows and a
// wide (landscape / short felt) arrangement.
//
// Pure geometry for the one Blackjack table screen. Everything is measured in
// the felt's own coordinates (0,0 = its top-left corner). The screen measures
// the felt (onLayout) and memoises `computeTableGeometry` on its inputs, so
// none of this runs on the animation path. Cards are positioned absolutely
// from these numbers, which is what lets the card motion of #3581 move a card
// from one place to the next.
//
// Every arrangement budgets height as well as width: nothing lands at a
// negative y, the result band never overlaps a hand, and no player card is
// narrower than MIN_CARD_WIDTH.
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
/** The active split row is this much taller than the other rows (when there is room). */
export const ACTIVE_ROW_SHARE = 1.35;

/** Felt padding and the heights of the labels and the result banner. */
export const FELT_PAD_X = 14;
const FELT_TOP = 8;
const FELT_BOTTOM = 10;
const LABEL_H = 22;
const ZONE_GAP = 6;
const BOX_PAD = 4;
/** Vertical padding inside a split row around its cards. */
const ROW_PAD = 2;
/** Left column of a split row (hand number, total, bet). */
export const ROW_LABEL_WIDTH = 72;
/** Height kept free for the result banner (outcome, payout and one detail line). */
export const RESULT_BANNER_HEIGHT = 60;
/** The rows layout keeps a one-line banner: each hand's own result is in its row. */
export const ROWS_RESULT_BANNER_HEIGHT = 40;
/** The wide arrangement's result column: this wide when there is room, never narrower than the minimum. */
export const WIDE_RESULT_WIDTH = 150;
export const WIDE_RESULT_MIN_WIDTH = 100;
/** Betting: the strip at the felt's foot (Table Rules toggle, Run Stats link) and the limits line. */
export const FELT_FOOTER_HEIGHT = 36;
const LIMITS_H = 24;

/** Chrome around the felt, for estimating its size before the first onLayout. */
export const HUD_STRIP_HEIGHT = 46;
/** The dock keeps this height in every phase, so the felt never resizes between them. */
export const DOCK_HEIGHT = 112;
export const TAB_BAR_ESTIMATE = 58;

export type SplitMode = "single" | "fans" | "rows";
/** How the table is drawn: by hand count, or "wide" (side by side) on a short felt. */
export type TableMode = SplitMode | "wide";

/** True in the phases whose felt shows the round's result (the result and the run's goal). */
export function showsResult(phase: string | null | undefined): boolean {
  return phase === "result" || phase === "victory";
}

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
  mode: TableMode;
  /**
   * Dealer label and fan. `labelBeside`: the label is on the left (rows).
   * `collapsed`: no room for the dealer's cards (a 4-hand split's result on
   * the smallest phones): only the label and total show, beside the result.
   */
  dealer: { label: Rect; fan: FanGeometry; labelBeside: boolean; collapsed: boolean };
  hands: HandGeometry[];
  /** The band kept free for the result banner; null when no result shows. */
  result: Rect | null;
  /** The betting spot and the table-limits line, when no cards are on the table. */
  betSpot: Rect | null;
  limits: Rect | null;
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

type GeometryBase = Pick<TableGeometry, "feltWidth" | "feltHeight" | "cardCap">;

/** Space kept between the dealer and the hands for the result (single and fans), in every phase. */
const RESULT_SPACE = RESULT_BANNER_HEIGHT + 2 * ZONE_GAP;
/** Label block above a hand: single fan, and a split fan inside its box. */
const SINGLE_LABEL_BLOCK = LABEL_H + 2;
const FAN_LABEL_BLOCK = LABEL_H + BOX_PAD + 2;
/** Smallest split row: a MIN_CARD_WIDTH card and its padding. */
const MIN_ROW_H = cardH(MIN_CARD_WIDTH) + 2 * ROW_PAD;

function minRowsHeight(n: number): number {
  return n * MIN_ROW_H + (n - 1) * ZONE_GAP;
}

/**
 * The felt height the stacked (portrait) arrangement needs at the smallest
 * card size. A shorter felt uses the wide arrangement instead.
 */
export function minStackedHeight(handCount: number): number {
  const minCard = cardH(MIN_CARD_WIDTH);
  const mode = splitModeFor(handCount);
  if (mode === "rows") {
    // Playing: the dealer's cards above the rows. (The result fits in the same
    // height: the dealer then collapses beside the banner.)
    return FELT_TOP + minCard + ZONE_GAP + minRowsHeight(handCount) + FELT_BOTTOM;
  }
  const dealer = FELT_TOP + LABEL_H + minCard;
  const player =
    mode === "single"
      ? SINGLE_LABEL_BLOCK + minCard + FELT_BOTTOM
      : FAN_LABEL_BLOCK + minCard + BOX_PAD + FELT_BOTTOM;
  return dealer + RESULT_SPACE + player;
}

/**
 * The whole table: dealer at the top, the player's hand(s) low near the dock,
 * the result band between them; on a short felt (landscape) the dealer, the
 * result and the hands side by side. Hands never overlap each other, the
 * dealer or the result band, and every card shows its corner index.
 */
export function computeTableGeometry(input: TableGeometryInput): TableGeometry {
  const { feltWidth, feltHeight, screenWidth, handCards } = input;
  const base: GeometryBase = { feltWidth, feltHeight, cardCap: cardCapFor(screenWidth) };
  const n = handCards.length;
  if (n === 0) return bettingGeometry(input, base);
  if (feltHeight < minStackedHeight(n)) return wideGeometry(input, base);
  if (splitModeFor(n) === "rows") return rowsGeometry(input, base);
  return stackedGeometry(input, base);
}

function bettingGeometry(input: TableGeometryInput, base: GeometryBase): TableGeometry {
  const { feltWidth, feltHeight, dealerCards } = input;
  const innerW = Math.max(0, feltWidth - 2 * FELT_PAD_X);
  const centreX = feltWidth / 2;
  const top = FELT_TOP;
  const avail = Math.max(0, feltHeight - FELT_FOOTER_HEIGHT - top);
  let betSpot: Rect;
  let limits: Rect;
  if (avail >= 150) {
    // Tall felt: the spot, the limits line under it.
    const d = Math.floor(Math.min(148, (avail - LIMITS_H) * 0.85, innerW * 0.6));
    const y = top + (avail - LIMITS_H - d) / 2;
    betSpot = { x: centreX - d / 2, y, width: d, height: d };
    limits = { x: FELT_PAD_X, y: y + d + 4, width: innerW, height: LIMITS_H };
  } else {
    // Short felt (landscape): the limits line beside the spot.
    const d = Math.floor(Math.max(0, Math.min(148, avail - 4, innerW * 0.4)));
    const y = top + (avail - d) / 2;
    const x = centreX - d - 8;
    betSpot = { x, y, width: d, height: d };
    const lx = centreX + 8;
    limits = {
      x: lx,
      y: y + d / 2 - LIMITS_H / 2,
      width: Math.max(0, FELT_PAD_X + innerW - lx),
      height: LIMITS_H,
    };
  }
  return {
    ...base,
    mode: "single",
    dealer: {
      label: { x: FELT_PAD_X, y: FELT_TOP, width: innerW, height: LABEL_H },
      fan: fanAt(centreX, FELT_TOP + LABEL_H, dealerCards, MIN_CARD_WIDTH, FAN_REVEAL),
      labelBeside: false,
      collapsed: false,
    },
    hands: [],
    result: null,
    betSpot,
    limits,
  };
}

/** One hand or two split fans: hands low, the dealer on top, the result between. */
function stackedGeometry(input: TableGeometryInput, base: GeometryBase): TableGeometry {
  const { feltWidth, feltHeight, dealerCards, handCards, showResult } = input;
  const { cardCap } = base;
  const innerW = Math.max(0, feltWidth - 2 * FELT_PAD_X);
  const centreX = feltWidth / 2;
  const bottom = feltHeight - FELT_BOTTOM;
  const single = handCards.length === 1;
  const minCard = cardH(MIN_CARD_WIDTH);
  // The dealer at its smallest and the result space are kept, whatever the phase,
  // so the hands do not move when the result arrives.
  const dealerFanY = FELT_TOP + LABEL_H;
  const labelBlock = single ? SINGLE_LABEL_BLOCK : FAN_LABEL_BLOCK;
  const playerMaxH =
    bottom - (single ? 0 : BOX_PAD) - labelBlock - (dealerFanY + minCard + RESULT_SPACE);
  const heightCap = Math.floor(playerMaxH / CARD_RATIO);

  const hands: HandGeometry[] = [];
  let handsTop: number;
  if (single) {
    const cards = handCards[0] ?? 0;
    const w = Math.max(
      MIN_CARD_WIDTH,
      Math.min(heightCap, fitCardWidth(Math.max(2, cards), innerW, cardCap, FAN_REVEAL))
    );
    const fanY = bottom - cardH(w);
    const labelY = fanY - SINGLE_LABEL_BLOCK;
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
      Math.min(heightCap, fitCardWidth(maxCards, colW - 2 * BOX_PAD - 4, cardCap, SPLIT_FAN_REVEAL))
    );
    const fanY = bottom - BOX_PAD - cardH(w);
    const boxY = fanY - FAN_LABEL_BLOCK;
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

  const dealerW = Math.max(
    MIN_CARD_WIDTH,
    Math.min(
      Math.floor(cardCap * DEALER_CARD_SHARE),
      fitCardWidth(Math.max(2, dealerCards), innerW, cardCap, FAN_REVEAL),
      Math.floor((handsTop - RESULT_SPACE - dealerFanY) / CARD_RATIO)
    )
  );
  const dealerFan = centredFan(centreX, dealerFanY, dealerCards, dealerW, FAN_REVEAL);
  const dealerBottom = dealerFanY + dealerFan.cardHeight;
  return {
    ...base,
    mode: single ? "single" : "fans",
    dealer: {
      label: { x: FELT_PAD_X, y: FELT_TOP, width: innerW, height: LABEL_H },
      fan: dealerFan,
      labelBeside: false,
      collapsed: false,
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
    limits: null,
  };
}

/** 3–4 split hands: the dealer and every hand as full-width rows, label on the left. */
function rowsGeometry(input: TableGeometryInput, base: GeometryBase): TableGeometry {
  const { feltWidth, feltHeight, handCards, showResult, dealerCards } = input;
  const { cardCap } = base;
  const innerW = Math.max(0, feltWidth - 2 * FELT_PAD_X);
  const bottom = feltHeight - FELT_BOTTOM;
  const n = handCards.length;
  const active =
    !showResult && input.activeHandIndex !== null && input.activeHandIndex < n
      ? input.activeHandIndex
      : null;
  const fanX = FELT_PAD_X + ROW_LABEL_WIDTH + BOX_PAD;
  const fanAvailW = Math.max(0, FELT_PAD_X + innerW - BOX_PAD - fanX);

  // The rows come first: never below MIN_CARD_WIDTH. The dealer yields to them.
  const rowsMin = minRowsHeight(n);
  const activeExtra = active !== null ? Math.ceil(MIN_ROW_H * (ACTIVE_ROW_SHARE - 1)) : 0;
  const resultSpace = showResult ? ROWS_RESULT_BANNER_HEIGHT + ZONE_GAP : 0;
  const avail = bottom - FELT_TOP - ZONE_GAP - resultSpace;
  const preferred = Math.min(
    Math.floor(cardCap * DEALER_CARD_SHARE),
    fitCardWidth(Math.max(2, dealerCards), fanAvailW, cardCap, FAN_REVEAL)
  );
  let dealerW = Math.min(preferred, Math.floor((avail - rowsMin - activeExtra) / CARD_RATIO));
  if (dealerW < MIN_CARD_WIDTH) {
    dealerW = Math.min(preferred, Math.floor((avail - rowsMin) / CARD_RATIO));
  }
  // With the result showing and no room left, the dealer's cards give way: its
  // label and total sit beside the banner (the banner says what it drew).
  const collapsed = showResult && dealerW < MIN_CARD_WIDTH;
  if (!collapsed) dealerW = Math.max(MIN_CARD_WIDTH, dealerW);

  let dealer: TableGeometry["dealer"];
  let result: Rect | null;
  let rowsTop: number;
  if (collapsed) {
    dealer = {
      label: {
        x: FELT_PAD_X,
        y: FELT_TOP,
        width: ROW_LABEL_WIDTH,
        height: ROWS_RESULT_BANNER_HEIGHT,
      },
      fan: fanAt(fanX, FELT_TOP, 0, 0, FAN_REVEAL),
      labelBeside: true,
      collapsed: true,
    };
    result = {
      x: fanX,
      y: FELT_TOP,
      width: Math.max(0, FELT_PAD_X + innerW - fanX),
      height: ROWS_RESULT_BANNER_HEIGHT,
    };
    rowsTop = FELT_TOP + ROWS_RESULT_BANNER_HEIGHT + ZONE_GAP;
  } else {
    const fan = fanAt(fanX, FELT_TOP, dealerCards, dealerW, FAN_REVEAL);
    const dealerBottom = FELT_TOP + fan.cardHeight;
    dealer = {
      label: { x: FELT_PAD_X, y: FELT_TOP, width: ROW_LABEL_WIDTH, height: fan.cardHeight },
      fan,
      labelBeside: true,
      collapsed: false,
    };
    result = showResult
      ? {
          x: FELT_PAD_X,
          y: dealerBottom + ZONE_GAP,
          width: innerW,
          height: ROWS_RESULT_BANNER_HEIGHT,
        }
      : null;
    rowsTop = dealerBottom + ZONE_GAP + resultSpace;
  }

  const rowsAvail = Math.max(0, bottom - rowsTop);
  const heights: number[] = [];
  if (active !== null) {
    const unit = (rowsAvail - (n - 1) * ZONE_GAP) / (n - 1 + ACTIVE_ROW_SHARE);
    for (let i = 0; i < n; i++) {
      if (unit >= MIN_ROW_H)
        heights.push(Math.floor(i === active ? unit * ACTIVE_ROW_SHARE : unit));
      else
        heights.push(
          i === active
            ? Math.max(MIN_ROW_H, Math.floor(rowsAvail - (n - 1) * (MIN_ROW_H + ZONE_GAP)))
            : MIN_ROW_H
        );
    }
  } else {
    const unit = Math.max(MIN_ROW_H, Math.floor((rowsAvail - (n - 1) * ZONE_GAP) / n));
    for (let i = 0; i < n; i++) heights.push(unit);
  }

  const hands: HandGeometry[] = [];
  let y = rowsTop;
  handCards.forEach((cards, i) => {
    const rowH = heights[i]!;
    const w = Math.max(
      MIN_CARD_WIDTH,
      Math.min(
        Math.floor(cardCap),
        Math.floor((rowH - 2 * ROW_PAD) / CARD_RATIO),
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

  return { ...base, mode: "rows", dealer, hands, result, betSpot: null, limits: null };
}

/**
 * A short felt (landscape): columns side by side, left to right: the dealer,
 * the result, then each hand, each column a label over its fan. The result
 * column is kept in every phase so nothing moves when the result arrives.
 */
function wideGeometry(input: TableGeometryInput, base: GeometryBase): TableGeometry {
  const { feltWidth, feltHeight, dealerCards, handCards, showResult } = input;
  const { cardCap } = base;
  const innerW = Math.max(0, feltWidth - 2 * FELT_PAD_X);
  const bottom = feltHeight - FELT_BOTTOM;
  const n = handCards.length;
  const reveal = n > 1 ? SPLIT_FAN_REVEAL : FAN_REVEAL;
  const dealerCount = Math.max(2, dealerCards);
  const counts = handCards.map((c) => Math.max(2, c));
  const gap = 8;
  const fanTop = FELT_TOP + LABEL_H + 2;
  const heightCap = Math.floor((bottom - fanTop) / CARD_RATIO);

  // Width of every column but the result's, at card width w.
  const need = (w: number) =>
    fanWidth(dealerCount, w, FAN_REVEAL) +
    2 * BOX_PAD +
    counts.reduce((sum, c) => sum + fanWidth(c, w, reveal) + 2 * BOX_PAD, 0) +
    gap * (n + 1);
  let w = MIN_CARD_WIDTH;
  for (let c = Math.floor(Math.min(cardCap, heightCap)); c >= MIN_CARD_WIDTH; c--) {
    if (need(c) + WIDE_RESULT_MIN_WIDTH <= innerW) {
      w = c;
      break;
    }
  }
  // The result column takes up to its full width; any spare is shared out equally.
  const resultW = Math.max(WIDE_RESULT_MIN_WIDTH, Math.min(WIDE_RESULT_WIDTH, innerW - need(w)));
  const spare = Math.max(0, innerW - need(w) - resultW) / (n + 2);
  let x = FELT_PAD_X;
  const column = (fanW: number) => {
    const width = fanW + 2 * BOX_PAD + spare;
    const rect = { x, y: FELT_TOP, width, height: bottom - FELT_TOP };
    x += width + gap;
    return rect;
  };

  const dealerCol = column(fanWidth(dealerCount, w, FAN_REVEAL));
  const dealerFan = centredFan(
    dealerCol.x + dealerCol.width / 2,
    fanTop,
    dealerCards,
    w,
    FAN_REVEAL
  );
  const resultCol = column(resultW - 2 * BOX_PAD);
  const hands: HandGeometry[] = handCards.map((cards, i) => {
    const col = column(fanWidth(counts[i]!, w, reveal));
    return {
      box: col,
      label: { x: col.x, y: FELT_TOP, width: col.width, height: LABEL_H },
      fan: centredFan(col.x + col.width / 2, fanTop, cards, w, reveal),
    };
  });

  return {
    ...base,
    mode: "wide",
    dealer: {
      label: { x: dealerCol.x, y: FELT_TOP, width: dealerCol.width, height: LABEL_H },
      fan: dealerFan,
      labelBeside: false,
      collapsed: false,
    },
    hands,
    result: showResult ? resultCol : null,
    betSpot: null,
    limits: null,
  };
}

export interface FeltSizeInput {
  screenWidth: number;
  screenHeight: number;
  insetTop: number;
  insetBottom: number;
  /** Header height (APP_HEADER_HEIGHT), passed in so this module needs no component import. */
  headerHeight: number;
}

/**
 * The felt's size from the screen size and the chrome around it: header, HUD
 * strip, dock and tab bar. The screen uses its measured size once laid out;
 * this is the first frame's estimate and what the layout tests run against.
 */
export function estimateFeltSize(input: FeltSizeInput): { width: number; height: number } {
  const height =
    input.screenHeight -
    input.insetTop -
    input.headerHeight -
    HUD_STRIP_HEIGHT -
    DOCK_HEIGHT -
    (TAB_BAR_ESTIMATE + input.insetBottom);
  return { width: Math.max(0, input.screenWidth - 16), height: Math.max(0, height) };
}
