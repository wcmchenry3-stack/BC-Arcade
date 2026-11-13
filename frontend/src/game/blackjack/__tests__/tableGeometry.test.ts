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
  MIN_ROW_H,
  ROW_LABEL_CONTENT_HEIGHT,
  ROW_LABEL_WIDTH,
  WORDED_PAYOUT_MIN_LABEL_WIDTH,
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
// to 195. These widths are measured in the app's fonts (web build, Space Grotesk / Manrope): the
// widest line with no name, its payout in words ("+25 chips", "No change") or as a number.
const EN_RESULT_LINE = { worded: 146, compact: 105 };
// Russian is the widest of the 13 locales.
const WIDEST_RESULT_LINE = { worded: 188 };

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
      const label = splitResultLabel(g.mode, h.label.width);
      if (g.mode === "rows") {
        // A row's label is a column: the name and total, over the tag and payout (#3782).
        expect(label).toEqual({ named: true, compactPayout: true, totalBesideName: true });
        expect(h.label.width).toBe(ROW_LABEL_WIDTH);
        expect(h.label.height).toBeGreaterThanOrEqual(ROW_LABEL_CONTENT_HEIGHT);
        continue;
      }
      // One line: the name gives way to the result, and the line fits.
      expect(label.named).toBe(false);
      const line = label.compactPayout ? EN_RESULT_LINE.compact : EN_RESULT_LINE.worded;
      expect(h.label.width).toBeGreaterThanOrEqual(line);
      // In words only where every locale's line fits.
      if (!label.compactPayout) {
        expect(h.label.width).toBeGreaterThanOrEqual(WIDEST_RESULT_LINE.worded);
      }
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
  it("keeps the name only in a row's label; words the payout only on a wide one-line label", () => {
    expect(splitResultLabel("rows", ROW_LABEL_WIDTH)).toEqual({
      named: true,
      compactPayout: true,
      totalBesideName: true,
    });
    expect(splitResultLabel("grid", 400)).toEqual({
      named: false,
      compactPayout: true,
      totalBesideName: false,
    });
    for (const mode of ["fans", "wide"] as const) {
      expect(splitResultLabel(mode, WORDED_PAYOUT_MIN_LABEL_WIDTH - 1)).toEqual({
        named: false,
        compactPayout: true,
        totalBesideName: false,
      });
      expect(splitResultLabel(mode, WORDED_PAYOUT_MIN_LABEL_WIDTH)).toEqual({
        named: false,
        compactPayout: false,
        totalBesideName: false,
      });
    }
  });
});

// #3782: a split hand's result line in every locale, with a 3-digit payout (a doubled 200 bet at
// the top table shows -400). Measured in the app's fonts (web build: Space Grotesk tag and total,
// Manrope name, the system font payout), as #3771 measured, for these exact strings; a changed
// tag or hand name fails here until it is measured again.
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
          const label = splitResultLabel(g.mode, h.label.width);
          if (label.totalBesideName) {
            expect(h.label.width).toBeGreaterThanOrEqual(widest("nameAndTotal"));
            expect(h.label.width).toBeGreaterThanOrEqual(widest("tagAndPayout"));
            expect(h.label.height).toBeGreaterThanOrEqual(ROW_RESULT_CONTENT_HEIGHT);
            expect(ROW_LABEL_CONTENT_HEIGHT).toBeGreaterThanOrEqual(ROW_RESULT_CONTENT_HEIGHT);
          } else {
            expect(label.compactPayout || h.label.width >= WORDED_PAYOUT_MIN_LABEL_WIDTH).toBe(
              true
            );
            expect(h.label.width).toBeGreaterThanOrEqual(widest("oneLine"));
          }
        }
      }
    });
  }
);
