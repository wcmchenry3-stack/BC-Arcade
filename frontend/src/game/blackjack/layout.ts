// ===========================================================================
// One-table layout (#3580): fanned hands on a felt, split fans, rows, a 2×2
// grid (3–4 hands on a felt too short for rows) and a wide arrangement (a
// landscape window only; a portrait phone always stacks).
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
/** Left column of a split row: hand number over the total pill with the bet or payout beside it. */
export const ROW_LABEL_WIDTH = 100;
/** Height of a row label's content: the hand name (one line) over the total pill and payout. */
export const ROW_LABEL_CONTENT_HEIGHT = 40;
/** Height kept free for the result banner (outcome and payout, then one detail line). */
export const RESULT_BANNER_HEIGHT = 52;
/** Gap above and below the result banner. */
const RESULT_GAP = 4;
/** Grid (3–4 hands on a short felt): label line and padding of each cell. */
const GRID_LABEL_H = 20;
const GRID_PAD = 3;
/** The rows layout keeps a one-line banner: each hand's own result is in its row. */
export const ROWS_RESULT_BANNER_HEIGHT = 40;
/** The wide arrangement's result column: this wide when there is room, never narrower than the minimum. */
export const WIDE_RESULT_WIDTH = 150;
export const WIDE_RESULT_MIN_WIDTH = 100;
/** Betting: the strip at the felt's foot (Table Rules toggle, Run Stats link) and the limits line. */
export const FELT_FOOTER_HEIGHT = 36;
const LIMITS_H = 24;

/** Chrome around the felt, for estimating its size before the first onLayout. */
/** The run strip (HudSidebar and its padding). */
export const HUD_STRIP_HEIGHT = 53;
/** The dock's parts: chips (a 48dp touch target), the gap, the buttons and the padding. */
export const DOCK_CHIP_SIZE = 48;
export const DOCK_GAP = 8;
export const DOCK_BUTTON_HEIGHT = 50;
export const DOCK_PADDING_TOP = 8;
export const DOCK_PADDING_BOTTOM = 4;
/** The dock keeps this height in every phase, so the felt never resizes between them. */
export const DOCK_HEIGHT =
  DOCK_PADDING_TOP + DOCK_CHIP_SIZE + DOCK_GAP + DOCK_BUTTON_HEIGHT + DOCK_PADDING_BOTTOM;
/**
 * The tab bar without its bottom padding (BottomTabBar: tabs and top padding), 68 tall in the
 * web build with its 8 px minimum bottom padding (#3624).
 */
export const TAB_BAR_BASE = 60;
/** The felt's border, inside which its children are positioned. */
export const FELT_BORDER = 1;

export type SplitMode = "single" | "fans" | "rows";
/** How the table is drawn: by hand count, or "wide" (side by side) on a short felt. */
export type TableMode = SplitMode | "grid" | "wide";

/** How a hand's label is drawn, and what a split hand's label shows once its result is in. */
export interface SplitResultLabel {
  /** A column (a row's label): the name on its own line over the total. Else one line. */
  column: boolean;
  /** The split hand's name ("Hand 1") is drawn at the result; its accessibility label always says it. */
  named: boolean;
  /** A split hand's payout as a signed number ("+25", "-400", "0"), never in words ("+25 chips"). */
  compactPayout: boolean;
}

/**
 * A hand's label (#3771). A row's label is a column (the name on its own line over the total, tag
 * and payout), so it keeps its name at the result. Every other label (2-hand fans, the grid, the
 * wide arrangement) is one line, too narrow on a phone for the name, the total, the tag and the
 * payout together (the name was cut to "HA…"): at the result the name gives way to the result.
 * No hand is outlined at the result (only the hand being played is): each hand is known by its
 * place, its label over its own cards. Every split hand's payout is a signed number (owner
 * decision, #3779): in words the widest locale's line (Russian, "-400 фишек" on a doubled
 * high-roller hand) is 196 px, wider than the widest fan label (195, at 430). The label keeps its
 * height, so no card shrinks for it.
 *
 * Known gap: the wide arrangement (a landscape window, a fallback: phones are locked to portrait,
 * #3603) gives 3–4 hands labels of about 96 / 76 px (568×320) and 120 / 94 px (667×375), so
 * the ~105 px compact line can still be cut with 3–4 hands at 568×320 and 4 hands at 667×375.
 */
export function splitResultLabel(mode: TableMode): SplitResultLabel {
  const column = mode === "rows";
  return { column, named: column, compactPayout: true };
}

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
  /**
   * Window height. A portrait window (taller than wide) never uses the wide
   * arrangement; omitted, the window is taken as portrait.
   */
  screenHeight?: number;
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
const RESULT_SPACE = RESULT_BANNER_HEIGHT + 2 * RESULT_GAP;
/** Label block above a hand: single fan, and a split fan inside its box. */
const SINGLE_LABEL_BLOCK = LABEL_H + 2;
const FAN_LABEL_BLOCK = LABEL_H + BOX_PAD + 2;
/** Smallest split row: a MIN_CARD_WIDTH card, or the label column's content, and padding. */
export const MIN_ROW_H = Math.max(cardH(MIN_CARD_WIDTH), ROW_LABEL_CONTENT_HEIGHT) + 2 * ROW_PAD;
/** Smallest grid cell: its label line over a MIN_CARD_WIDTH card. */
const MIN_GRID_CELL_H = GRID_LABEL_H + 2 + cardH(MIN_CARD_WIDTH) + 2 * GRID_PAD;

function minRowsHeight(n: number): number {
  return n * MIN_ROW_H + (n - 1) * ZONE_GAP;
}

/**
 * The felt height the stacked arrangement (single, fans, rows) needs at the
 * smallest card size. A shorter portrait felt uses the grid (3–4 hands); a
 * shorter landscape one the wide arrangement.
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
 * The table while a round's result is still to show (the dealer's turn, #3581): with
 * `reserveResult`, the result's band is already kept free, so its banner appearing moves no hand
 * (#3720: the split rows jumped 46 px as the summary strip mounted). The band is left empty
 * (`result` null) until the result shows. Not kept when keeping it would leave the dealer no room
 * for its cards (the smallest phones, where the dealer collapses beside the result): the dealer's
 * draws must show.
 */
export function tableGeometryForTurn(
  input: TableGeometryInput,
  reserveResult: boolean
): TableGeometry {
  if (input.showResult || !reserveResult) return computeTableGeometry(input);
  const kept = computeTableGeometry({ ...input, showResult: true });
  return kept.dealer.collapsed ? computeTableGeometry(input) : { ...kept, result: null };
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
  const portrait = input.screenHeight === undefined || input.screenHeight >= screenWidth;
  const fits = feltHeight >= minStackedHeight(n);
  // Side by side only in a landscape window; a portrait phone always stacks.
  if (!fits && !portrait) return wideGeometry(input, base);
  if (splitModeFor(n) !== "rows") return stackedGeometry(input, base);
  return fits ? rowsGeometry(input, base) : gridGeometry(input, base);
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
          y: dealerBottom + RESULT_GAP,
          width: innerW,
          height: Math.max(0, handsTop - RESULT_GAP - (dealerBottom + RESULT_GAP)),
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

  const {
    dealer,
    result,
    top: rowsTop,
  } = dealerAndResult(collapsed, dealerW, dealerCards, fanX, innerW, showResult);

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

/** 3–4 split hands on a felt too short for rows: two fans per line (a 2×2 grid), label over each fan. */
function gridGeometry(input: TableGeometryInput, base: GeometryBase): TableGeometry {
  const { feltWidth, feltHeight, handCards, showResult, dealerCards } = input;
  const { cardCap } = base;
  const innerW = Math.max(0, feltWidth - 2 * FELT_PAD_X);
  const bottom = feltHeight - FELT_BOTTOM;
  const n = handCards.length;
  const lines = Math.ceil(n / 2);
  const sideGap = 8;
  const colW = (feltWidth - 2 * sideGap - ZONE_GAP) / 2;
  const fanX = FELT_PAD_X + ROW_LABEL_WIDTH + BOX_PAD;
  const fanAvailW = Math.max(0, FELT_PAD_X + innerW - BOX_PAD - fanX);
  const gridMin = lines * MIN_GRID_CELL_H + (lines - 1) * ZONE_GAP;
  const resultSpace = showResult ? ROWS_RESULT_BANNER_HEIGHT + ZONE_GAP : 0;

  // The dealer as a row (label on the left), yielding to the grid; with the
  // result showing and no room, it collapses beside the banner (as in rows).
  const preferred = Math.min(
    Math.floor(cardCap * DEALER_CARD_SHARE),
    fitCardWidth(Math.max(2, dealerCards), fanAvailW, cardCap, FAN_REVEAL)
  );
  let dealerW = Math.min(
    preferred,
    Math.floor((bottom - FELT_TOP - ZONE_GAP - resultSpace - gridMin) / CARD_RATIO)
  );
  const collapsed = showResult && dealerW < MIN_CARD_WIDTH;
  if (!collapsed) dealerW = Math.max(MIN_CARD_WIDTH, dealerW);
  const { dealer, result, top } = dealerAndResult(
    collapsed,
    dealerW,
    dealerCards,
    fanX,
    innerW,
    showResult
  );

  const cellH = Math.max(
    MIN_GRID_CELL_H,
    Math.floor((bottom - top - (lines - 1) * ZONE_GAP) / lines)
  );
  const maxCards = Math.max(2, ...handCards);
  const w = Math.max(
    MIN_CARD_WIDTH,
    Math.min(
      Math.floor(cardCap),
      Math.floor((cellH - GRID_LABEL_H - 2 - 2 * GRID_PAD) / CARD_RATIO),
      fitCardWidth(maxCards, colW - 2 * GRID_PAD - 4, cardCap, SPLIT_FAN_REVEAL)
    )
  );
  const hands: HandGeometry[] = handCards.map((cards, i) => {
    const colX = sideGap + (i % 2) * (colW + ZONE_GAP);
    const y = top + Math.floor(i / 2) * (cellH + ZONE_GAP);
    const fanY = y + cellH - GRID_PAD - cardH(w);
    return {
      box: { x: colX, y, width: colW, height: cellH },
      label: { x: colX, y: y + 1, width: colW, height: GRID_LABEL_H },
      fan: centredFan(colX + colW / 2, fanY, cards, w, SPLIT_FAN_REVEAL),
    };
  });
  return { ...base, mode: "grid", dealer, hands, result, betSpot: null, limits: null };
}

/** The dealer drawn as a row (label left), and the result band: under it, or beside a collapsed dealer. */
function dealerAndResult(
  collapsed: boolean,
  dealerW: number,
  dealerCards: number,
  fanX: number,
  innerW: number,
  showResult: boolean
): { dealer: TableGeometry["dealer"]; result: Rect | null; top: number } {
  if (collapsed) {
    return {
      dealer: {
        label: {
          x: FELT_PAD_X,
          y: FELT_TOP,
          width: ROW_LABEL_WIDTH,
          height: ROWS_RESULT_BANNER_HEIGHT,
        },
        fan: fanAt(fanX, FELT_TOP, 0, 0, FAN_REVEAL),
        labelBeside: true,
        collapsed: true,
      },
      result: {
        x: fanX,
        y: FELT_TOP,
        width: Math.max(0, FELT_PAD_X + innerW - fanX),
        height: ROWS_RESULT_BANNER_HEIGHT,
      },
      top: FELT_TOP + ROWS_RESULT_BANNER_HEIGHT + ZONE_GAP,
    };
  }
  const fan = fanAt(fanX, FELT_TOP, dealerCards, dealerW, FAN_REVEAL);
  const dealerBottom = FELT_TOP + fan.cardHeight;
  return {
    dealer: {
      label: { x: FELT_PAD_X, y: FELT_TOP, width: ROW_LABEL_WIDTH, height: fan.cardHeight },
      fan,
      labelBeside: true,
      collapsed: false,
    },
    result: showResult
      ? {
          x: FELT_PAD_X,
          y: dealerBottom + ZONE_GAP,
          width: innerW,
          height: ROWS_RESULT_BANNER_HEIGHT,
        }
      : null,
    top: dealerBottom + ZONE_GAP + (showResult ? ROWS_RESULT_BANNER_HEIGHT + ZONE_GAP : 0),
  };
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

/** The table screen's gap under the dock: its GameShell `paddingBottom` (#3624). */
export const TABLE_BOTTOM_GAP = 8;

/**
 * The felt's size from the window size and the chrome around it, the same
 * terms the screen lays out: the header and top inset, the HUD strip, the
 * dock, the tab bar (in normal flow below the scene) and the screen's gap
 * above it (GameShell's bottom padding, which no longer adds the tab bar's
 * height again, #3624). The screen uses its measured size once laid out; this
 * is its first frame and what the layout tests run against. The size is
 * inside the felt's border.
 */
export function estimateFeltSize(input: FeltSizeInput): { width: number; height: number } {
  // react-navigation's tab bar height is its own guess (our custom bar doesn't report one).
  const tabBar = TAB_BAR_BASE + (input.insetBottom || 8); // BottomTabBar: `insets.bottom || 8`
  const height =
    input.screenHeight -
    input.insetTop -
    input.headerHeight -
    HUD_STRIP_HEIGHT -
    DOCK_HEIGHT -
    tabBar -
    TABLE_BOTTOM_GAP -
    2 * FELT_BORDER;
  return {
    width: Math.max(0, input.screenWidth - 16 - 2 * FELT_BORDER),
    height: Math.max(0, height),
  };
}
