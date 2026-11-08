/**
 * One-table layout (#3580): the corner index of every card stays readable and
 * nothing overlaps or leaves the felt, at the three phone sizes the owner
 * approved the layout at, the smallest supported phone (320×568) and in
 * landscape (667×375, 844×390, 932×430).
 */
import {
  ACTIVE_ROW_SHARE,
  cardCapFor,
  computeTableGeometry,
  estimateFeltSize,
  FAN_REVEAL,
  FELT_FOOTER_HEIGHT,
  fanWidth,
  fitCardWidth,
  minStackedHeight,
  MIN_CARD_WIDTH,
  MIN_INDEX_STRIP,
  MIN_INDEX_STRIP_SHARE,
  RESULT_BANNER_HEIGHT,
  ROWS_RESULT_BANNER_HEIGHT,
  showsResult,
  splitModeFor,
  type FanGeometry,
  type Rect,
  type TableGeometry,
  type TableGeometryInput,
} from "../layout";

/** The header height AppHeader uses (APP_HEADER_HEIGHT). */
const HEADER = 64;

interface Phone {
  name: string;
  width: number;
  height: number;
  insetTop: number;
  insetBottom: number;
}

const PHONES: Phone[] = [
  { name: "375×667 (iPhone SE)", width: 375, height: 667, insetTop: 20, insetBottom: 0 },
  { name: "390×844 (iPhone 14)", width: 390, height: 844, insetTop: 47, insetBottom: 34 },
  { name: "430×932 (iPhone 14 Pro Max)", width: 430, height: 932, insetTop: 59, insetBottom: 34 },
];
const SMALLEST: Phone = {
  name: "320×568 (iPhone SE 1st gen)",
  width: 320,
  height: 568,
  insetTop: 20,
  insetBottom: 0,
};
const LANDSCAPE: Phone[] = [
  { name: "667×375 landscape", width: 667, height: 375, insetTop: 0, insetBottom: 0 },
  { name: "844×390 landscape", width: 844, height: 390, insetTop: 0, insetBottom: 21 },
  { name: "932×430 landscape", width: 932, height: 430, insetTop: 0, insetBottom: 21 },
];

function felt(phone: Phone) {
  return estimateFeltSize({
    screenWidth: phone.width,
    screenHeight: phone.height,
    insetTop: phone.insetTop,
    insetBottom: phone.insetBottom,
    headerHeight: HEADER,
  });
}

function geometry(
  phone: Phone,
  opts: Omit<TableGeometryInput, "feltWidth" | "feltHeight" | "screenWidth">
): TableGeometry {
  const f = felt(phone);
  return computeTableGeometry({
    ...opts,
    feltWidth: f.width,
    feltHeight: f.height,
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

function expectInside(r: Rect, g: TableGeometry) {
  expect(r.x).toBeGreaterThanOrEqual(0);
  expect(r.y).toBeGreaterThanOrEqual(0);
  expect(r.x + r.width).toBeLessThanOrEqual(g.feltWidth + 0.001);
  expect(r.y + r.height).toBeLessThanOrEqual(g.feltHeight + 0.001);
}

/** Every card's visible strip shows its corner index; the fan fits on the felt. */
function expectReadable(fan: FanGeometry, g: TableGeometry) {
  if (fan.count === 0) return;
  expect(fan.cardWidth).toBeGreaterThanOrEqual(MIN_CARD_WIDTH);
  if (fan.count > 1) {
    expect(fan.step).toBeGreaterThanOrEqual(MIN_INDEX_STRIP);
    expect(fan.step).toBeGreaterThanOrEqual(fan.cardWidth * MIN_INDEX_STRIP_SHARE);
  }
  expectInside(fanRect(fan), g);
}

/** Every hand and the dealer readable; nothing overlaps: hands, labels, dealer, result. */
function expectSound(g: TableGeometry) {
  if (!g.dealer.collapsed) expectReadable(g.dealer.fan, g);
  for (const h of g.hands) {
    expectReadable(h.fan, g);
    expectInside(h.label, g);
  }
  expectInside(g.dealer.label, g);
  const dealer = g.dealer.collapsed ? g.dealer.label : fanRect(g.dealer.fan);
  const hands = g.hands.map((h) => fanRect(h.fan));
  const labels = g.hands.map((h) => h.label);
  for (let i = 0; i < hands.length; i++) {
    expect(overlaps(hands[i]!, dealer)).toBe(false);
    expect(overlaps(labels[i]!, dealer)).toBe(false);
    for (let j = i + 1; j < hands.length; j++) {
      expect(overlaps(hands[i]!, hands[j]!)).toBe(false);
      expect(overlaps(g.hands[i]!.box, g.hands[j]!.box)).toBe(false);
    }
  }
  if (g.result) {
    expectInside(g.result, g);
    expect(overlaps(g.result, dealer)).toBe(false);
    expect(overlaps(g.result, g.dealer.label)).toBe(false);
    for (const r of [...hands, ...labels]) expect(overlaps(g.result, r)).toBe(false);
  }
}

const same = (n: number, cards: number) => Array.from({ length: n }, () => cards);

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

  it("shows the result in the result and victory phases only", () => {
    expect(showsResult("result")).toBe(true);
    expect(showsResult("victory")).toBe(true);
    expect(showsResult("player")).toBe(false);
    expect(showsResult("betting")).toBe(false);
  });
});

describe.each([...PHONES, ...LANDSCAPE, SMALLEST])("betting at $name", (phone) => {
  it("the bet spot and the limits line sit on the felt, clear of each other and the footer", () => {
    const g = geometry(phone, {
      dealerCards: 0,
      handCards: [],
      activeHandIndex: null,
      showResult: false,
    });
    expect(g.hands).toHaveLength(0);
    const spot = g.betSpot!;
    const limits = g.limits!;
    expectInside(spot, g);
    expectInside(limits, g);
    expect(overlaps(spot, limits)).toBe(false);
    // The collapsed Table Rules toggle lives in the footer: nothing above may reach it.
    const footerTop = g.feltHeight - FELT_FOOTER_HEIGHT;
    expect(spot.y + spot.height).toBeLessThanOrEqual(footerTop);
    expect(limits.y + limits.height).toBeLessThanOrEqual(footerTop);
  });
});

describe.each([...PHONES, SMALLEST])("table geometry at $name", (phone) => {
  it("a 6-card player hand (playing) is readable", () => {
    const g = geometry(phone, {
      dealerCards: 2,
      handCards: [6],
      activeHandIndex: 0,
      showResult: false,
    });
    expect(g.mode).toBe("single");
    expectSound(g);
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
      expectSound(g);
      expect(g.result!.height).toBeGreaterThanOrEqual(RESULT_BANNER_HEIGHT);
      // Between the dealer and the player, never covering either.
      expect(g.result!.y).toBeGreaterThanOrEqual(g.dealer.fan.y + g.dealer.fan.cardHeight);
      expect(g.result!.y + g.result!.height).toBeLessThanOrEqual(g.hands[0]!.label.y);
    }
  );

  it("the hand does not move when the result arrives", () => {
    const play = geometry(phone, {
      dealerCards: 2,
      handCards: [3],
      activeHandIndex: 0,
      showResult: false,
    });
    const result = geometry(phone, {
      dealerCards: 2,
      handCards: [3],
      activeHandIndex: null,
      showResult: true,
    });
    expect(result.hands[0]!.fan).toEqual(play.hands[0]!.fan);
    expect(result.dealer.fan).toEqual(play.dealer.fan);
  });

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
      expectSound(g);
      if (showResult) expect(g.result!.height).toBeGreaterThanOrEqual(RESULT_BANNER_HEIGHT);
    }
  });

  it.each([
    [3, 2],
    [3, 5],
    [4, 3],
    [4, 5],
    [4, 6],
  ])("%i-hand split rows with %i cards each", (hands, cards) => {
    for (let active = 0; active < hands; active++) {
      const g = geometry(phone, {
        dealerCards: 2,
        handCards: same(hands, cards),
        activeHandIndex: active,
        showResult: false,
      });
      expect(g.mode).toBe("rows");
      expectSound(g);
      // Full-width rows, one per hand; the active one at least as large, its cards too.
      const activeRow = g.hands[active]!;
      for (const [i, h] of g.hands.entries()) {
        expect(h.box.width).toBeGreaterThan(g.feltWidth * 0.9);
        if (i !== active) {
          expect(activeRow.box.height).toBeGreaterThanOrEqual(h.box.height);
          expect(activeRow.fan.cardWidth).toBeGreaterThanOrEqual(h.fan.cardWidth);
        }
        // Rows stack top to bottom in hand order.
        if (i > 0) expect(h.box.y).toBeGreaterThan(g.hands[i - 1]!.box.y);
      }
    }
  });

  it.each([3, 4])("%i-hand split rows of 5 cards in the result state", (hands) => {
    const g = geometry(phone, {
      dealerCards: 6,
      handCards: same(hands, 5),
      activeHandIndex: null,
      showResult: true,
    });
    expect(g.mode).toBe("rows");
    expectSound(g);
    expect(g.result!.height).toBe(ROWS_RESULT_BANNER_HEIGHT);
    expect(g.result!.y + g.result!.height).toBeLessThanOrEqual(g.hands[0]!.box.y);
  });

  it("a 6-card dealer hand beside 4 split rows is readable", () => {
    const g = geometry(phone, {
      dealerCards: 6,
      handCards: [3, 3, 3, 3],
      activeHandIndex: 3,
      showResult: false,
    });
    expectSound(g);
  });
});

describe("rows on the roomier phones", () => {
  it.each(PHONES)("the active row is the larger one at $name", (phone) => {
    const g = geometry(phone, {
      dealerCards: 2,
      handCards: [5, 5, 5, 5],
      activeHandIndex: 1,
      showResult: false,
    });
    expect(g.hands[1]!.box.height).toBeGreaterThanOrEqual(
      Math.floor(g.hands[0]!.box.height * ACTIVE_ROW_SHARE) - 1
    );
  });

  it.each(PHONES)("the dealer keeps its cards in a 4-hand result at $name", (phone) => {
    const g = geometry(phone, {
      dealerCards: 6,
      handCards: [5, 5, 5, 5],
      activeHandIndex: null,
      showResult: true,
    });
    expect(g.dealer.collapsed).toBe(false);
  });
});

describe("the smallest phone (320×568), 4 hands of 5+ cards", () => {
  it("rows never go below the minimum card; the dealer yields to them", () => {
    for (const cards of [5, 6, 7]) {
      for (const showResult of [false, true]) {
        const g = geometry(SMALLEST, {
          dealerCards: 6,
          handCards: same(4, cards),
          activeHandIndex: showResult ? null : 2,
          showResult,
        });
        expect(g.mode).toBe("rows");
        for (const h of g.hands) expect(h.fan.cardWidth).toBeGreaterThanOrEqual(MIN_CARD_WIDTH);
        expectSound(g);
        // While playing the dealer's up card still shows.
        if (!showResult) expect(g.dealer.collapsed).toBe(false);
      }
    }
  });
});

describe.each(LANDSCAPE)("landscape at $name", (phone) => {
  it("the felt is too short to stack, so the table is drawn side by side", () => {
    expect(felt(phone).height).toBeLessThan(minStackedHeight(1));
  });

  it.each([
    ["single", [2]],
    ["single, 6 cards", [6]],
    ["2-hand", [3, 3]],
    ["2-hand, 5 cards", [5, 5]],
    ["4-hand", [3, 3, 3, 3]],
    ["4-hand, 5 cards", [5, 5, 5, 5]],
  ])("%s: readable, nothing above the felt, the result clear of every hand", (_name, hands) => {
    for (const showResult of [false, true]) {
      const g = geometry(phone, {
        dealerCards: showResult ? 5 : 2,
        handCards: hands,
        activeHandIndex: showResult ? null : 0,
        showResult,
      });
      expect(g.mode).toBe("wide");
      expectSound(g);
      if (showResult) expect(g.result!.height).toBeGreaterThan(0);
    }
  });
});
