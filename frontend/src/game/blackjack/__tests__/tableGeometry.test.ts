/**
 * One-table layout (#3580): the corner index of every card stays readable and
 * nothing overlaps, at the three phone sizes the owner approved the layout at.
 */
import {
  ACTIVE_ROW_SHARE,
  cardCapFor,
  computeTableGeometry,
  estimateFeltSize,
  fanWidth,
  fitCardWidth,
  FAN_REVEAL,
  MIN_CARD_WIDTH,
  MIN_INDEX_STRIP,
  MIN_INDEX_STRIP_SHARE,
  RESULT_BANNER_HEIGHT,
  ROWS_RESULT_BANNER_HEIGHT,
  splitModeFor,
  type FanGeometry,
  type Rect,
  type TableGeometry,
  type TableGeometryInput,
} from "../layout";

/** The header height AppHeader uses (APP_HEADER_HEIGHT). */
const HEADER = 64;

const PHONES = [
  { name: "375×667 (iPhone SE)", width: 375, height: 667, insetTop: 20, insetBottom: 0 },
  { name: "390×844 (iPhone 14)", width: 390, height: 844, insetTop: 47, insetBottom: 34 },
  { name: "430×932 (iPhone 14 Pro Max)", width: 430, height: 932, insetTop: 59, insetBottom: 34 },
] as const;

type Phone = (typeof PHONES)[number];

function geometry(
  phone: Phone,
  opts: Omit<TableGeometryInput, "feltWidth" | "feltHeight" | "screenWidth">
): TableGeometry {
  // The chip tray is in the dock while betting and after the result.
  const felt = estimateFeltSize({
    screenWidth: phone.width,
    screenHeight: phone.height,
    insetTop: phone.insetTop,
    insetBottom: phone.insetBottom,
    headerHeight: HEADER,
    dockHasChipTray: opts.showResult || opts.handCards.length === 0,
  });
  return computeTableGeometry({
    ...opts,
    feltWidth: felt.width,
    feltHeight: felt.height,
    screenWidth: phone.width,
  });
}

const fanRect = (f: FanGeometry): Rect => ({
  x: f.x,
  y: f.y,
  width: f.width,
  height: f.cardHeight,
});

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Every card's visible strip shows its corner index; the fan fits on the felt. */
function expectReadable(fan: FanGeometry, g: TableGeometry) {
  if (fan.count === 0) return;
  expect(fan.cardWidth).toBeGreaterThanOrEqual(MIN_CARD_WIDTH);
  if (fan.count > 1) {
    expect(fan.step).toBeGreaterThanOrEqual(MIN_INDEX_STRIP);
    expect(fan.step).toBeGreaterThanOrEqual(fan.cardWidth * MIN_INDEX_STRIP_SHARE);
  }
  expect(fan.x).toBeGreaterThanOrEqual(0);
  expect(fan.y).toBeGreaterThanOrEqual(0);
  expect(fan.x + fan.width).toBeLessThanOrEqual(g.feltWidth);
  expect(fan.y + fan.cardHeight).toBeLessThanOrEqual(g.feltHeight);
}

/** Nothing overlaps: hands, the dealer and the result band. */
function expectNoOverlap(g: TableGeometry) {
  const dealer = fanRect(g.dealer.fan);
  const hands = g.hands.map((h) => fanRect(h.fan));
  const labels = g.hands.map((h) => h.label);
  for (let i = 0; i < hands.length; i++) {
    expect(overlaps(hands[i]!, dealer)).toBe(false);
    for (let j = i + 1; j < hands.length; j++) {
      expect(overlaps(hands[i]!, hands[j]!)).toBe(false);
      expect(overlaps(g.hands[i]!.box, g.hands[j]!.box)).toBe(false);
    }
  }
  if (g.result) {
    expect(overlaps(g.result, dealer)).toBe(false);
    for (const r of [...hands, ...labels]) expect(overlaps(g.result, r)).toBe(false);
    expect(g.result.y + g.result.height).toBeLessThanOrEqual(g.feltHeight);
  }
}

describe("fan helpers", () => {
  it("caps the card per phone at 78 or a fifth of the screen", () => {
    expect(cardCapFor(375)).toBe(75);
    expect(cardCapFor(390)).toBe(78);
    expect(cardCapFor(430)).toBe(78);
  });

  it("fits n cards into the width at the 0.34 reveal", () => {
    const w = fitCardWidth(6, 331, 75, FAN_REVEAL);
    expect(w).toBe(75); // 6 cards at the cap fit 331px
    expect(fanWidth(6, w, FAN_REVEAL)).toBeLessThanOrEqual(331);
    const narrow = fitCardWidth(8, 200, 75, FAN_REVEAL);
    expect(fanWidth(8, narrow, FAN_REVEAL)).toBeLessThanOrEqual(200);
  });

  it("steps by the readable strip when the reveal would hide the index", () => {
    const w = fitCardWidth(6, 100, 75, FAN_REVEAL);
    expect(fanWidth(6, w, FAN_REVEAL)).toBeLessThanOrEqual(100);
    expect(w * FAN_REVEAL).toBeLessThan(MIN_INDEX_STRIP);
  });

  it("chooses the split layout by hand count", () => {
    expect(splitModeFor(0)).toBe("single");
    expect(splitModeFor(1)).toBe("single");
    expect(splitModeFor(2)).toBe("fans");
    expect(splitModeFor(3)).toBe("rows");
    expect(splitModeFor(4)).toBe("rows");
  });
});

describe.each(PHONES)("table geometry at $name", (phone) => {
  it("betting: the bet spot sits on the felt with no hands", () => {
    const g = geometry(phone, {
      dealerCards: 0,
      handCards: [],
      activeHandIndex: null,
      showResult: false,
    });
    expect(g.hands).toHaveLength(0);
    expect(g.betSpot).not.toBeNull();
    expect(g.betSpot!.y).toBeGreaterThanOrEqual(0);
    expect(g.betSpot!.y + g.betSpot!.height).toBeLessThanOrEqual(g.feltHeight);
  });

  it("a 6-card player hand (playing) is readable", () => {
    const g = geometry(phone, {
      dealerCards: 2,
      handCards: [6],
      activeHandIndex: 0,
      showResult: false,
    });
    expect(g.mode).toBe("single");
    expectReadable(g.hands[0]!.fan, g);
    expectReadable(g.dealer.fan, g);
    expectNoOverlap(g);
  });

  it.each([
    [6, 6],
    [6, 2],
    [2, 6],
    [5, 3],
  ])(
    "result with %i dealer and %i player cards: readable, result band between the hands",
    (dealer, player) => {
      const g = geometry(phone, {
        dealerCards: dealer,
        handCards: [player],
        activeHandIndex: null,
        showResult: true,
      });
      expectReadable(g.dealer.fan, g);
      expectReadable(g.hands[0]!.fan, g);
      expectNoOverlap(g);
      expect(g.result!.height).toBeGreaterThanOrEqual(RESULT_BANNER_HEIGHT);
      // Between the dealer and the player, never covering either.
      expect(g.result!.y).toBeGreaterThanOrEqual(g.dealer.fan.y + g.dealer.fan.cardHeight);
      expect(g.result!.y + g.result!.height).toBeLessThanOrEqual(g.hands[0]!.label.y);
    }
  );

  it.each([2, 3, 4, 5])("2-hand split fans with %i cards each", (cards) => {
    for (const showResult of [false, true]) {
      const g = geometry(phone, {
        dealerCards: showResult ? 5 : 2,
        handCards: [cards, cards],
        activeHandIndex: showResult ? null : 1,
        showResult,
      });
      expect(g.mode).toBe("fans");
      // Side by side, kept low: both fans on one line, in the lower part of the felt.
      expect(g.hands[0]!.fan.y).toBe(g.hands[1]!.fan.y);
      expect(g.hands[0]!.fan.x + g.hands[0]!.fan.width).toBeLessThanOrEqual(g.hands[1]!.fan.x);
      expect(g.hands[0]!.fan.y).toBeGreaterThan(g.feltHeight / 2);
      for (const h of g.hands) expectReadable(h.fan, g);
      expectReadable(g.dealer.fan, g);
      expectNoOverlap(g);
      if (showResult) expect(g.result!.height).toBeGreaterThanOrEqual(RESULT_BANNER_HEIGHT);
    }
  });

  it.each([
    [3, 2],
    [3, 5],
    [4, 3],
    [4, 5],
  ])("%i-hand split rows with %i cards each", (hands, cards) => {
    for (let active = 0; active < hands; active++) {
      const g = geometry(phone, {
        dealerCards: 2,
        handCards: Array.from({ length: hands }, () => cards),
        activeHandIndex: active,
        showResult: false,
      });
      expect(g.mode).toBe("rows");
      for (const h of g.hands) expectReadable(h.fan, g);
      expectReadable(g.dealer.fan, g);
      expectNoOverlap(g);
      // Full-width rows, one per hand; the active one larger.
      const active_ = g.hands[active]!;
      for (const [i, h] of g.hands.entries()) {
        expect(h.box.width).toBeGreaterThan(g.feltWidth * 0.9);
        if (i !== active) {
          expect(active_.box.height).toBeGreaterThanOrEqual(
            Math.floor(h.box.height * ACTIVE_ROW_SHARE) - 1
          );
          expect(active_.fan.cardWidth).toBeGreaterThanOrEqual(h.fan.cardWidth);
        }
        // Rows stack top to bottom in hand order.
        if (i > 0) expect(h.box.y).toBeGreaterThan(g.hands[i - 1]!.box.y);
      }
    }
  });

  it.each([3, 4])("%i-hand split rows of 5 cards in the result state", (hands) => {
    const g = geometry(phone, {
      dealerCards: 6,
      handCards: Array.from({ length: hands }, () => 5),
      activeHandIndex: null,
      showResult: true,
    });
    for (const h of g.hands) expectReadable(h.fan, g);
    expectReadable(g.dealer.fan, g);
    expectNoOverlap(g);
    expect(g.result!.height).toBe(ROWS_RESULT_BANNER_HEIGHT);
    expect(g.result!.y).toBeGreaterThanOrEqual(g.dealer.fan.y + g.dealer.fan.cardHeight);
    expect(g.result!.y + g.result!.height).toBeLessThanOrEqual(g.hands[0]!.box.y);
  });

  it("a 6-card dealer hand beside 4 split rows is readable", () => {
    const g = geometry(phone, {
      dealerCards: 6,
      handCards: [3, 3, 3, 3],
      activeHandIndex: 3,
      showResult: false,
    });
    expectReadable(g.dealer.fan, g);
    expectNoOverlap(g);
  });
});
