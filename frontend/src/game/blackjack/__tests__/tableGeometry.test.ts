/**
 * One-table layout (#3580): the corner index of every card stays readable and
 * nothing overlaps or leaves the felt, at the three phone sizes the owner
 * approved the layout at, the smallest phone (320×568) and in landscape
 * (667×375, 844×390, 932×430). Felt sizes come from `estimateFeltSize`, the
 * same chrome terms the screen lays out (header, HUD strip, dock, tab bar and
 * GameShell's bottom padding); 320×568 and 375×667 match the felt measured in
 * the web build's screenshots (216 / 315 high).
 */
import * as fs from "fs";
import * as path from "path";
import {
  ACTIVE_ROW_SHARE,
  DOCK_BUTTON_HEIGHT,
  DOCK_CHIP_SIZE,
  DOCK_GAP,
  DOCK_HEIGHT,
  DOCK_PADDING_BOTTOM,
  DOCK_PADDING_TOP,
  FANS_SUMMARY_MIN_BAND_HEIGHT,
  FANS_SUMMARY_MIN_BAND_WIDTH,
  feltBannerNetOnly,
  MIN_ROW_H,
  ROW_LABEL_CONTENT_HEIGHT,
  ROW_LABEL_WIDTH,
  splitResultLabel,
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
  tableGeometryForTurn,
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
  { name: "375×667 (iPhone SE)", width: 375, height: 667, insetTop: 0, insetBottom: 0 },
  { name: "390×844 (iPhone 14)", width: 390, height: 844, insetTop: 47, insetBottom: 34 },
  { name: "430×932 (iPhone 14 Pro Max)", width: 430, height: 932, insetTop: 59, insetBottom: 34 },
];
const SMALLEST: Phone = {
  name: "320×568 (iPhone SE 1st gen)",
  width: 320,
  height: 568,
  insetTop: 0,
  insetBottom: 0,
};

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
    screenHeight: phone.height,
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

  it("the dock's height is its content: 48dp chips, the gap, the buttons and the padding", () => {
    expect(DOCK_CHIP_SIZE).toBeGreaterThanOrEqual(48);
    expect(DOCK_HEIGHT).toBe(
      DOCK_PADDING_TOP + DOCK_CHIP_SIZE + DOCK_GAP + DOCK_BUTTON_HEIGHT + DOCK_PADDING_BOTTOM
    );
  });

  it("felt sizes match the measured web build at 320×568 and 375×667", () => {
    // Re-measured with GameShell's single bottom padding (#3624): the felt gained the
    // 39 px GameShell used to reserve a second time for the tab bar.
    expect(felt(SMALLEST).height).toBe(255);
    expect(felt(PHONES[0]!).height).toBe(354);
  });

  it("shows the result in the result and victory phases only", () => {
    expect(showsResult("result")).toBe(true);
    expect(showsResult("victory")).toBe(true);
    expect(showsResult("player")).toBe(false);
    expect(showsResult("betting")).toBe(false);
  });
});

describe.each([...PHONES, SMALLEST])("betting at $name", (phone) => {
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
  ])("%i-hand split rows (or the grid on a short felt) with %i cards each", (hands, cards) => {
    for (let active = 0; active < hands; active++) {
      const g = geometry(phone, {
        dealerCards: 2,
        handCards: same(hands, cards),
        activeHandIndex: active,
        showResult: false,
      });
      expect(["rows", "grid"]).toContain(g.mode);
      expectSound(g);
      if (g.mode === "grid") continue;
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

  it.each([3, 4])("%i-hand split of 5 cards in the result state", (hands) => {
    const g = geometry(phone, {
      dealerCards: 6,
      handCards: same(hands, 5),
      activeHandIndex: null,
      showResult: true,
    });
    expect(["rows", "grid"]).toContain(g.mode);
    expectSound(g);
    expect(g.result!.height).toBe(ROWS_RESULT_BANNER_HEIGHT);
    expect(g.result!.y + g.result!.height).toBeLessThanOrEqual(g.hands[0]!.box.y);
  });

  // Review round 2, V2: a row holds its label, total and payout (the payout
  // sits beside the total), so nothing in the label column is cut off.
  it.each([3, 4])("%i-hand rows are tall enough for their label column", (hands) => {
    for (const showResult of [false, true]) {
      const g = geometry(phone, {
        dealerCards: 3,
        handCards: same(hands, 5),
        activeHandIndex: showResult ? null : 0,
        showResult,
      });
      if (g.mode !== "rows") continue;
      for (const h of g.hands) {
        expect(h.box.height).toBeGreaterThanOrEqual(MIN_ROW_H);
        expect(h.label.height).toBeGreaterThanOrEqual(ROW_LABEL_CONTENT_HEIGHT);
      }
    }
  });

  // Review round 2, V1: a portrait phone never draws the table side by side.
  it("never uses the wide arrangement in portrait", () => {
    for (const hands of [[2], [6], [3, 3], [5, 5], [3, 3, 3], [5, 5, 5, 5], [7, 7, 7, 7]]) {
      for (const showResult of [false, true]) {
        const g = geometry(phone, {
          dealerCards: showResult ? 6 : 2,
          handCards: hands,
          activeHandIndex: showResult ? null : 0,
          showResult,
        });
        expect(g.mode).not.toBe("wide");
        expectSound(g);
      }
    }
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

// #3720: the split rows jumped down 46 px as the summary strip mounted. While the dealer plays the
// result's band is kept free already, so the strip appearing moves no hand.
describe("the dealer's turn keeps the result's band free", () => {
  it.each([
    [375, 667],
    [390, 844],
    [430, 932],
  ])("%i×%i: 2, 3 and 4 hands stay where they are when the result shows", (w, h) => {
    const felt = estimateFeltSize({
      screenWidth: w,
      screenHeight: h,
      insetTop: 0,
      insetBottom: 0,
      headerHeight: HEADER,
    });
    for (const n of [2, 3, 4]) {
      const input: TableGeometryInput = {
        feltWidth: felt.width,
        feltHeight: felt.height,
        screenWidth: w,
        screenHeight: h,
        dealerCards: 5,
        handCards: Array.from({ length: n }, () => 3),
        // Every hand played: none is the hand to play.
        activeHandIndex: n,
        showResult: false,
      };
      const turn = tableGeometryForTurn(input, true);
      const result = computeTableGeometry({ ...input, showResult: true });
      expect(turn.dealer.collapsed).toBe(false);
      expect(turn.result).toBeNull();
      expect(turn.hands).toEqual(result.hands);
      expect(turn.dealer).toEqual(result.dealer);
    }
  });

  it("on the smallest phone, where the dealer would collapse, the dealer's cards keep their room", () => {
    const felt = estimateFeltSize({
      screenWidth: 320,
      screenHeight: 568,
      insetTop: 0,
      insetBottom: 0,
      headerHeight: HEADER,
    });
    const input: TableGeometryInput = {
      feltWidth: felt.width,
      feltHeight: felt.height,
      screenWidth: 320,
      screenHeight: 568,
      dealerCards: 5,
      handCards: [3, 3, 3],
      activeHandIndex: 3,
      showResult: false,
    };
    expect(computeTableGeometry({ ...input, showResult: true }).dealer.collapsed).toBe(true);
    expect(tableGeometryForTurn(input, true)).toEqual(computeTableGeometry(input));
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
  it("too short for rows: a 2×2 grid of fans, never below the minimum card", () => {
    for (const cards of [5, 6, 7]) {
      for (const showResult of [false, true]) {
        const g = geometry(SMALLEST, {
          dealerCards: 6,
          handCards: same(4, cards),
          activeHandIndex: showResult ? null : 2,
          showResult,
        });
        expect(g.mode).toBe("grid");
        for (const h of g.hands) expect(h.fan.cardWidth).toBeGreaterThanOrEqual(MIN_CARD_WIDTH);
        expectSound(g);
        // While playing the dealer's up card still shows.
        if (!showResult) expect(g.dealer.collapsed).toBe(false);
      }
    }
  });
});

// Landscape on phones goes away with the portrait lock (#3603); the wide
// arrangement stays a best-effort fallback for a landscape window, checked here
// on a short landscape felt with room for it.
describe("the wide arrangement (landscape window, short felt)", () => {
  const wide = (hands: number[], showResult: boolean) =>
    computeTableGeometry({
      feltWidth: 828,
      feltHeight: 160,
      screenWidth: 844,
      screenHeight: 390,
      dealerCards: showResult ? 5 : 2,
      handCards: hands,
      activeHandIndex: showResult ? null : 0,
      showResult,
    });

  it("is used only when the window is landscape and the felt too short to stack", () => {
    expect(160).toBeLessThan(minStackedHeight(1));
    expect(wide([3], false).mode).toBe("wide");
    const portrait = computeTableGeometry({
      feltWidth: 828,
      feltHeight: 160,
      screenWidth: 390,
      screenHeight: 844,
      dealerCards: 2,
      handCards: [3],
      activeHandIndex: 0,
      showResult: false,
    });
    expect(portrait.mode).not.toBe("wide");
  });

  it.each([
    ["single", [2]],
    ["single, 6 cards", [6]],
    ["2-hand", [3, 3]],
    ["4-hand", [3, 3, 3, 3]],
  ])("%s: readable, nothing above the felt, the result clear of every hand", (_name, hands) => {
    for (const showResult of [false, true]) {
      const g = wide(hands, showResult);
      expect(g.mode).toBe("wide");
      expectSound(g);
    }
  });
});

// #3771: a 2-hand split's label at the result read "HA…" at 390×844. The label is one line (the
// name, the total, the tag and the payout), and in English that is 197 px against labels of 140
// to 195. Measured in the app's fonts (web build, Space Grotesk / Manrope): the widest English
// line with no name and the payout as a signed number ("21*", "PUSH", "-25").
const EN_COMPACT_RESULT_LINE = 105;

describe.each([SMALLEST, ...PHONES])("a split hand's label at the result at $name", (phone) => {
  it.each([2, 3, 4])("%i hands: nothing in it is cut off; the cards keep their size", (n) => {
    const at = (showResult: boolean) =>
      geometry(phone, {
        dealerCards: 3,
        handCards: same(n, 3),
        activeHandIndex: showResult ? null : 0,
        showResult,
      });
    const g = at(true);
    for (const h of g.hands) {
      const label = splitResultLabel(g.mode);
      if (g.mode === "rows") {
        // A row's label is a column: the name and total, over the tag and payout (#3782).
        expect(label).toEqual({ column: true, named: true, totalBesideName: true });
        expect(h.label.width).toBe(ROW_LABEL_WIDTH);
        expect(h.label.height).toBeGreaterThanOrEqual(ROW_LABEL_CONTENT_HEIGHT);
        continue;
      }
      // One line: the name gives way to the result, the payout is a signed number, and it fits.
      expect(label).toEqual({ column: false, named: false, totalBesideName: false });
      expect(h.label.width).toBeGreaterThanOrEqual(EN_COMPACT_RESULT_LINE);
    }
    // The label keeps its height, so no card is smaller than in play.
    if (g.mode === "fans") {
      const play = at(false);
      g.hands.forEach((h, i) => {
        expect(h.label.height).toBe(play.hands[i]!.label.height);
        expect(h.fan.cardWidth).toBe(play.hands[i]!.fan.cardWidth);
      });
    }
  });
});

describe("splitResultLabel", () => {
  it("keeps the name only in a row's label; every split payout is a signed number", () => {
    expect(splitResultLabel("rows")).toEqual({ column: true, named: true, totalBesideName: true });
    // Owner decision (#3779): never in words, at any width. The worded Russian line on a doubled
    // high-roller hand ("-400 фишек") is 196 px, wider than the 430 fan label (195).
    for (const mode of ["single", "fans", "grid", "wide"] as const) {
      expect(splitResultLabel(mode)).toEqual({
        column: false,
        named: false,
        totalBesideName: false,
      });
    }
  });
});

// #3771 known gap: the wide arrangement (a landscape fallback; phones are locked to portrait,
// #3603) gives 3–4 hands labels narrower than the compact line. Pinned so a change shows here.
describe("a split hand's label in the wide arrangement (landscape fallback)", () => {
  it.each([
    [568, 320, [129.6, 96, 76]],
    [667, 375, [143.39, 120, 94.4]],
  ])("%i×%i: nameless and compact at the result; label widths pinned", (w, h, widths) => {
    [2, 3, 4].forEach((n, k) => {
      const g = computeTableGeometry({
        feltWidth: w - 18,
        feltHeight: 160,
        screenWidth: w,
        screenHeight: h,
        dealerCards: 3,
        handCards: same(n, 3),
        activeHandIndex: null,
        showResult: true,
      });
      expect(g.mode).toBe("wide");
      expect(splitResultLabel(g.mode)).toEqual({
        column: false,
        named: false,
        totalBesideName: false,
      });
      for (const hand of g.hands) expect(hand.label.width).toBeCloseTo(widths[k]!, 1);
      // The known gap, from the geometry itself: which hand counts get a label narrower than the
      // compact line (3–4 hands at 568×320, 4 hands at 667×375; 2 hands always fit).
      expect(g.hands[0]!.label.width < EN_COMPACT_RESULT_LINE).toBe(
        n === 4 || (n === 3 && w === 568)
      );
    });
  });
});

// #3782: a split hand's result line in every locale, with a 3-digit payout (a doubled 200 bet at
// the top table shows -400). Measured in the app's fonts (web build: Space Grotesk tag and total,
// Manrope name, the system font payout), as #3771 measured, for these exact strings, with the
// total pill sized for a soft total ("21*") and a 3-digit payout. The widths are pinned by hand:
// a changed tag or hand name fails the coverage test below until it is measured again and the
// numbers here updated; the tests do not measure text themselves.
// - oneLine: total + tag + payout, one line (fans, the grid): the 320 px phone's labels are 140.
// - nameAndTotal / tagAndPayout: a row's two lines at the result, in its 100 px column.
// Before #3782 Russian's "Проигрыш" made the one-line label 158 px (cut off at 320 px) and a
// row's one line (total + tag + payout) was 116 px in English and 158 in Russian.
const MEASURED_RESULT_LINES: Record<
  string,
  { hand: string; tags: string[]; oneLine: number; nameAndTotal: number; tagAndPayout: number }
> = {
  ar: {
    hand: "اليد",
    tags: ["فوز", "تعادل", "خسارة"],
    oneLine: 117,
    nameAndTotal: 70,
    tagAndPayout: 71,
  },
  de: {
    hand: "Hand",
    tags: ["Gewinn", "Remis", "Verlust"],
    oneLine: 136,
    nameAndTotal: 90,
    tagAndPayout: 90,
  },
  en: {
    hand: "Hand",
    tags: ["Win", "Push", "Lose"],
    oneLine: 116,
    nameAndTotal: 90,
    tagAndPayout: 70,
  },
  es: {
    hand: "Mano",
    tags: ["Gana", "Empate", "Pierde"],
    oneLine: 127,
    nameAndTotal: 92,
    tagAndPayout: 80,
  },
  "fr-CA": {
    hand: "Main",
    tags: ["Gagné", "Égalité", "Perdu"],
    oneLine: 127,
    nameAndTotal: 87,
    tagAndPayout: 81,
  },
  he: {
    hand: "יד",
    tags: ["ניצחון", "תיקו", "הפסד"],
    oneLine: 118,
    nameAndTotal: 67,
    tagAndPayout: 72,
  },
  hi: {
    hand: "हाथ",
    tags: ["जीत", "बराबरी", "हार"],
    oneLine: 108,
    nameAndTotal: 73,
    tagAndPayout: 62,
  },
  ja: {
    hand: "ハンド",
    tags: ["勝ち", "引き分け", "負け"],
    oneLine: 113,
    nameAndTotal: 91,
    tagAndPayout: 67,
  },
  ko: { hand: "핸드", tags: ["승", "무", "패"], oneLine: 102, nameAndTotal: 80, tagAndPayout: 56 },
  nl: {
    hand: "Hand",
    tags: ["Winst", "Gelijk", "Verlies"],
    oneLine: 132,
    nameAndTotal: 90,
    tagAndPayout: 86,
  },
  pt: {
    hand: "Mão",
    tags: ["Vitória", "Empate", "Derrota"],
    oneLine: 138,
    nameAndTotal: 83,
    tagAndPayout: 91,
  },
  ru: {
    hand: "Рука",
    tags: ["Победа", "Ничья", "Минус"],
    oneLine: 139,
    nameAndTotal: 88,
    tagAndPayout: 93,
  },
  zh: { hand: "手牌", tags: ["赢", "平", "输"], oneLine: 102, nameAndTotal: 80, tagAndPayout: 56 },
};
const widest = (k: "oneLine" | "nameAndTotal" | "tagAndPayout") =>
  Math.max(...Object.values(MEASURED_RESULT_LINES).map((m) => m[k]));
/** A row's two lines at the result: the total pill (21 px), the gap (3), the tag (16, CJK). */
const ROW_RESULT_CONTENT_HEIGHT = 21 + 3 + 16;

describe("the split result lines measured in every locale (#3782)", () => {
  const dir = path.join(__dirname, "../../../i18n/locales");
  const locales = fs.readdirSync(dir).filter((d) => !d.startsWith("_") && !d.endsWith(".json"));

  it("covers every locale's current tags and hand name (re-measure when one changes)", () => {
    expect(Object.keys(MEASURED_RESULT_LINES).sort()).toEqual([...locales].sort());
    for (const l of locales) {
      const j = JSON.parse(fs.readFileSync(path.join(dir, l, "blackjack.json"), "utf8"));
      expect({
        l,
        hand: j["hand.playerHand"],
        tags: [j["tag.win"], j["tag.push"], j["tag.lose"]],
      }).toEqual({
        l,
        hand: `${MEASURED_RESULT_LINES[l]!.hand} {{number}}`,
        tags: MEASURED_RESULT_LINES[l]!.tags,
      });
    }
  });

  it("the widest are Russian (one line, row line 2) and Spanish (row line 1)", () => {
    expect(widest("oneLine")).toBe(139);
    expect(widest("nameAndTotal")).toBe(92);
    expect(widest("tagAndPayout")).toBe(93);
  });

  it("a row's single line (total + tag + payout) would not fit its column even in English", () => {
    expect(MEASURED_RESULT_LINES.en!.oneLine).toBeGreaterThan(ROW_LABEL_WIDTH);
  });
});

describe.each([SMALLEST, ...PHONES])(
  "every locale's result line fits at $name (#3782)",
  (phone) => {
    it.each([2, 3, 4])("%i hands, a 3-digit payout: no label narrower than its line", (n) => {
      for (const cards of [2, 3, 5]) {
        const g = geometry(phone, {
          dealerCards: 3,
          handCards: same(n, cards),
          activeHandIndex: null,
          showResult: true,
        });
        for (const h of g.hands) {
          const label = splitResultLabel(g.mode);
          if (label.totalBesideName) {
            expect(h.label.width).toBeGreaterThanOrEqual(widest("nameAndTotal"));
            expect(h.label.width).toBeGreaterThanOrEqual(widest("tagAndPayout"));
            expect(h.label.height).toBeGreaterThanOrEqual(ROW_RESULT_CONTENT_HEIGHT);
            expect(ROW_LABEL_CONTENT_HEIGHT).toBeGreaterThanOrEqual(ROW_RESULT_CONTENT_HEIGHT);
          } else {
            expect(h.label.width).toBeGreaterThanOrEqual(widest("oneLine"));
          }
        }
      }
    });
  }
);

// #3784: a 2-hand split's felt banner, the summary beside the net payout ("Won: 1 · Push: 1
// +25 chips", 19 px and 14 px bold in a pill with 16 px padding), in every locale. Measured in the
// web build's fonts (the system font) for these exact strings, as #3781 measured; pinned by hand,
// so a changed string fails the coverage test until it is measured again.
// - usual: "Won: 1 · Push: 1" and "+25 chips", the beginner table's line.
// - widest: over every summary and net a 2-hand split can show (bets up to 200, either hand
//   doubled): de and nl "Gewonnen: 1 · Verloren: 1  Unverändert"/"Ongewijzigd", ru "Победы: 1 ·
//   Проигрыши: 1  +200 фишек".
// - net: the net-only pill (15 px bold), its widest net ("Sem mudança" in pt).
const MEASURED_FANS_BANNER: Record<
  string,
  { strings: string; usual: number; widest: number; net: number }
> = {
  ar: {
    strings:
      "فوز: {{count}} | خسارة: {{count}} | تعادل: {{count}} | +{{amount}} رقائق | {{amount}} رقائق | لا تغيير",
    usual: 232,
    widest: 266,
    net: 114,
  },
  de: {
    strings:
      "Gewonnen: {{count}} | Verloren: {{count}} | Remis: {{count}} | +{{amount}} Chips | {{amount}} Chips | Unverändert",
    usual: 324,
    widest: 363,
    net: 126,
  },
  en: {
    strings:
      "Won: {{count}} | Lost: {{count}} | Push: {{count}} | +{{amount}} chips | {{amount}} chips | No change",
    usual: 254,
    widest: 265,
    net: 119,
  },
  es: {
    strings:
      "Ganadas: {{count}} | Perdidas: {{count}} | Empates: {{count}} | +{{amount}} fichas | {{amount}} fichas | Sin cambio",
    usual: 333,
    widest: 344,
    net: 124,
  },
  "fr-CA": {
    strings:
      "Gagnées\u00a0: {{count}} | Perdues\u00a0: {{count}} | Égalités\u00a0: {{count}} | +{{amount}} jetons | {{amount}} jetons | Mise rendue",
    usual: 335,
    widest: 350,
    net: 125,
  },
  he: {
    strings:
      "ניצחונות: {{count}} | הפסדים: {{count}} | תיקו: {{count}} | +{{amount}} שבבים | {{amount}} שבבים | אין שינוי",
    usual: 281,
    widest: 322,
    net: 125,
  },
  hi: {
    strings:
      "जीते: {{count}} | हारे: {{count}} | बराबरी: {{count}} | +{{amount}} चिप्स | {{amount}} चिप्स | बदलाव नहीं",
    usual: 225,
    widest: 236,
    net: 105,
  },
  ja: {
    strings:
      "勝ち: {{count}} | 負け: {{count}} | 引き分け: {{count}} | +{{amount}} チップ | {{amount}} チップ | 変化なし",
    usual: 287,
    widest: 297,
    net: 125,
  },
  ko: {
    strings:
      "승: {{count}} | 패: {{count}} | 무: {{count}} | +{{amount}} 칩 | {{amount}} 칩 | 변동 없음",
    usual: 180,
    widest: 195,
    net: 98,
  },
  nl: {
    strings:
      "Gewonnen: {{count}} | Verloren: {{count}} | Gelijk: {{count}} | +{{amount}} chips | {{amount}} chips | Ongewijzigd",
    usual: 317,
    widest: 363,
    net: 126,
  },
  pt: {
    strings:
      "Vitórias: {{count}} | Derrotas: {{count}} | Empates: {{count}} | +{{amount}} fichas | {{amount}} fichas | Sem mudança",
    usual: 324,
    widest: 348,
    net: 139,
  },
  ru: {
    strings:
      "Победы: {{count}} | Проигрыши: {{count}} | Ничьи: {{count}} | +{{amount}} фишек | {{amount}} фишек | Возврат",
    usual: 314,
    widest: 377,
    net: 130,
  },
  zh: {
    strings:
      "赢: {{count}} | 输: {{count}} | 平: {{count}} | +{{amount}} 筹码 | {{amount}} 筹码 | 无变化",
    usual: 194,
    widest: 205,
    net: 109,
  },
};
/** The banner's height with its detail line: 55 px in ja, ko and zh (51 in English, 52 in he). */
const FULL_BANNER_HEIGHT = 55;
/** The net-only banner with its detail line: 49 px in ja, ko and zh (47 in English). */
const NET_ONLY_BANNER_HEIGHT = 49;
const fansBanner = (k: "usual" | "widest" | "net") =>
  Math.max(...Object.values(MEASURED_FANS_BANNER).map((m) => m[k]));
const wider = (k: "usual" | "widest", band: number) =>
  Object.entries(MEASURED_FANS_BANNER)
    .filter(([, m]) => m[k] > band)
    .map(([l]) => l)
    .sort();

describe("a 2-hand split's felt banner measured in every locale (#3784)", () => {
  const dir = path.join(__dirname, "../../../i18n/locales");
  const locales = fs.readdirSync(dir).filter((d) => !d.startsWith("_") && !d.endsWith(".json"));
  const KEYS = [
    "result.splitWon",
    "result.splitLost",
    "result.splitPush",
    "payout.positive",
    "payout.negative",
    "payout.zero",
  ];

  it("covers every locale's current summary and payout strings (re-measure when one changes)", () => {
    expect(Object.keys(MEASURED_FANS_BANNER).sort()).toEqual([...locales].sort());
    for (const l of locales) {
      const j = JSON.parse(fs.readFileSync(path.join(dir, l, "blackjack.json"), "utf8"));
      expect({ l, strings: KEYS.map((k) => j[k]).join(" | ") }).toEqual({
        l,
        strings: MEASURED_FANS_BANNER[l]!.strings,
      });
    }
  });

  it("the widest: fr-CA's usual line, ru's widest, pt's net; the CJK banners the tallest", () => {
    expect(fansBanner("usual")).toBe(MEASURED_FANS_BANNER["fr-CA"]!.usual);
    expect(fansBanner("widest")).toBe(MEASURED_FANS_BANNER.ru!.widest);
    expect(fansBanner("net")).toBe(MEASURED_FANS_BANNER.pt!.net);
    expect(FANS_SUMMARY_MIN_BAND_HEIGHT).toBeGreaterThan(FULL_BANNER_HEIGHT);
    expect(NET_ONLY_BANNER_HEIGHT).toBeLessThanOrEqual(RESULT_BANNER_HEIGHT);
  });
});

const PHONE_360: Phone = { name: "360×640", width: 360, height: 640, insetTop: 0, insetBottom: 0 };
const fansAtResult = (phone: Phone, cards: number) =>
  geometry(phone, {
    dealerCards: 3,
    handCards: [cards, 2],
    activeHandIndex: null,
    showResult: true,
  });

describe.each([
  { phone: SMALLEST, overflowing: ["de", "es", "fr-CA", "he", "ja", "nl", "pt", "ru"] },
  { phone: PHONE_360, overflowing: ["de", "es", "fr-CA", "nl", "pt"] },
])(
  "a 2-hand split's banner at $phone.name shows the net alone (#3784)",
  ({ phone, overflowing }) => {
    it.each([2, 3, 5])("hands of %i cards: inside the band in every locale", (cards) => {
      const g = fansAtResult(phone, cards);
      expect(g.mode).toBe("fans");
      const band = g.result!;
      expect(feltBannerNetOnly(g, 2)).toBe(true);
      // The summary and payout would spill past the band in these locales (#3784's bug).
      expect(wider("usual", band.width)).toEqual(overflowing);
      // The net alone fits in every locale, the detail line inside the band.
      expect(fansBanner("net")).toBeLessThanOrEqual(band.width);
      expect(NET_ONLY_BANNER_HEIGHT).toBeLessThanOrEqual(band.height);
    });
  }
);

it("at 320×568 the 2-hand band is too short for the summary banner in ja, ko and zh (#3784)", () => {
  const band = fansAtResult(SMALLEST, 2).result!;
  expect(band.height).toBeLessThan(FULL_BANNER_HEIGHT);
});

describe.each(PHONES)("a 2-hand split's banner at $name keeps the summary (#3784)", (phone) => {
  it.each([2, 3, 5])("hands of %i cards: unchanged, every usual line inside the felt", (cards) => {
    const g = fansAtResult(phone, cards);
    expect(g.mode).toBe("fans");
    const band = g.result!;
    expect(feltBannerNetOnly(g, 2)).toBe(false);
    expect(band.height).toBeGreaterThanOrEqual(FULL_BANNER_HEIGHT);
    expect(fansBanner("usual")).toBeLessThanOrEqual(g.feltWidth);
  });

  // Known gap (#3784, reported): a high-stakes line is wider than the band below a 430 phone.
  it("known gap: the locales whose widest line is wider than the band", () => {
    const band = fansAtResult(phone, 2).result!;
    const expected: Record<number, string[]> = {
      375: ["de", "es", "fr-CA", "nl", "pt", "ru"],
      390: ["de", "fr-CA", "nl", "pt", "ru"],
      430: [],
    };
    expect(wider("widest", band.width)).toEqual(expected[phone.width]);
  });
});

describe("feltBannerNetOnly", () => {
  const band = (width: number, height: number): Rect => ({ x: 14, y: 100, width, height });

  it("every 3–4 hand split shows the net alone (#3781), in any arrangement", () => {
    for (const mode of ["rows", "grid", "wide"] as const) {
      expect(feltBannerNetOnly({ mode, result: band(384, 40) }, 3)).toBe(true);
      expect(feltBannerNetOnly({ mode, result: band(384, 40) }, 4)).toBe(true);
    }
  });

  it("2 hands: the net alone below the band's width or height for the summary", () => {
    const W = FANS_SUMMARY_MIN_BAND_WIDTH;
    const H = FANS_SUMMARY_MIN_BAND_HEIGHT;
    expect(feltBannerNetOnly({ mode: "fans", result: band(W - 0.5, H) }, 2)).toBe(true);
    expect(feltBannerNetOnly({ mode: "fans", result: band(W, H - 0.5) }, 2)).toBe(true);
    expect(feltBannerNetOnly({ mode: "fans", result: band(W, H) }, 2)).toBe(false);
  });

  it("one hand, a 2-hand wide arrangement or no band: the usual banner", () => {
    expect(feltBannerNetOnly({ mode: "single", result: band(200, 40) }, 1)).toBe(false);
    expect(feltBannerNetOnly({ mode: "wide", result: band(150, 40) }, 2)).toBe(false);
    expect(feltBannerNetOnly({ mode: "fans", result: null }, 2)).toBe(false);
  });
});
