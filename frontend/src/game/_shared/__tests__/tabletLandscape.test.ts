/**
 * Landscape layout guards for the windows phones no longer have (#3648): phones are locked to
 * portrait (#3603), but an iPad (all four orientations), an Android tablet (target SDK 36 ignores
 * the lock from 600 dp), split-screen and a short web window can still be wide. These pin what
 * the pure layout functions produce at those sizes today, so a change to the landscape-only
 * paths (Blackjack's wide arrangement, the felt table's fit floor, Hearts' landscape table)
 * shows here. They pin current output; no layout was changed by #3648.
 *
 * Felts come from each game's `estimateFeltSize`, with the chrome a tablet has: the header (64),
 * a top inset of 24, and the tab bar (60 plus the bottom inset, or 8 when there is none).
 */
import {
  computeTableGeometry as blackjack,
  estimateFeltSize as blackjackFelt,
} from "../../blackjack/layout";
import { freeCellGeometry } from "../../freecell/layout";
import { computeFallbackGeometry } from "../../hearts/layout";
import { computeTableGeometry as cards, estimateFeltSize as cardsFelt } from "../cards/tableLayout";

interface Win {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly insetBottom: number;
}

const IPAD: Win[] = [
  { name: "iPad 1024x768", width: 1024, height: 768, insetBottom: 20 },
  { name: "iPad 1180x820", width: 1180, height: 820, insetBottom: 20 },
  { name: "iPad 1194x834", width: 1194, height: 834, insetBottom: 20 },
  { name: "iPad 1366x1024", width: 1366, height: 1024, insetBottom: 20 },
];
const TOP = 24;

const cardsFeltOf = (w: Win, top = TOP) => {
  const f = cardsFelt({
    windowWidth: w.width,
    windowHeight: w.height,
    sideInsets: { left: 6, right: 6 },
    headerHeight: 64 + top,
    statLineHeight: 28,
    bottomHeight: 60 + (w.insetBottom || 8) + 16,
  });
  return { width: f.width - 2, height: f.height - 2 };
};

const blackjackOf = (w: Win, hands: number[], top = TOP, showResult = false) => {
  const f = blackjackFelt({
    screenWidth: w.width,
    screenHeight: w.height,
    insetTop: top,
    insetBottom: w.insetBottom,
    headerHeight: 64,
  });
  return blackjack({
    feltWidth: f.width,
    feltHeight: f.height,
    screenWidth: w.width,
    screenHeight: w.height,
    dealerCards: showResult ? 3 : 2,
    handCards: hands,
    activeHandIndex: showResult ? null : 0,
    showResult,
  });
};

describe("a tablet in landscape (iPad sizes)", () => {
  it.each([
    // name, Solitaire card width, FreeCell card width
    ["iPad 1024x768", 40, 36],
    ["iPad 1180x820", 52, 36],
    ["iPad 1194x834", 55, 40],
    ["iPad 1366x1024", 96, 109],
  ])("%s: the felt table keeps full cards, never the fit floor", (name, solitaire, freecell) => {
    const w = IPAD.find((x) => x.name === name)!;
    const felt = cardsFeltOf(w);
    const s = cards(felt);
    const f = freeCellGeometry(felt);
    expect(s.cardWidth).toBe(solitaire);
    expect(f.cardWidth).toBe(freecell);
    expect(s.cardWidth).toBeGreaterThanOrEqual(36);
    expect(f.cardWidth).toBeGreaterThanOrEqual(36);
    expect(s.minFaceUpStep).toBeGreaterThanOrEqual(24);
    expect(f.minFaceUpStep).toBeGreaterThanOrEqual(20);
  });

  it.each([
    // name, 4-hand card width
    ["iPad 1024x768", 59],
    ["iPad 1180x820", 70],
    ["iPad 1194x834", 74],
    ["iPad 1366x1024", 78],
  ])("%s: Blackjack stacks (never the wide arrangement) at 1, 2 and 4 hands", (name, four) => {
    const w = IPAD.find((x) => x.name === name)!;
    const one = blackjackOf(w, [2]);
    const two = blackjackOf(w, [3, 3]);
    const quad = blackjackOf(w, [3, 3, 3, 3]);
    expect([one.mode, two.mode, quad.mode]).toEqual(["single", "fans", "rows"]);
    expect(one.hands[0]!.fan.cardWidth).toBe(78);
    expect(quad.hands[0]!.fan.cardWidth).toBe(four);
  });

  it.each(IPAD.map((w) => [w.name, w] as const))(
    "%s: Hearts uses its landscape table with full-size hand and trick cards",
    (_name, w) => {
      const g = computeFallbackGeometry({ width: w.width, height: w.height });
      expect(g.mode).toBe("landscape");
      expect(g.hand.cardW).toBe(64);
      expect(g.trick.cardW).toBe(66);
    }
  );
});

describe("a short window (the old phone-landscape heights, a short web window)", () => {
  const web400: Win = { name: "web 1280x400", width: 1280, height: 400, insetBottom: 0 };
  const web300: Win = { name: "web 1280x300", width: 1280, height: 300, insetBottom: 0 };

  it("1280x400: Solitaire is under 36 dp (the fit floor's range), FreeCell stays at 36 dp", () => {
    const felt = cardsFeltOf(web400, 0);
    expect(cards(felt).cardWidth).toBe(29);
    expect(freeCellGeometry(felt).cardWidth).toBe(36);
  });

  it("1280x300: both games reach the 12 dp fit floor", () => {
    const felt = cardsFeltOf(web300, 0);
    expect(cards(felt).cardWidth).toBe(12);
    expect(freeCellGeometry(felt).cardWidth).toBe(12);
  });

  it("1280x400: Blackjack goes wide at every hand count", () => {
    for (const hands of [[2], [3, 3], [3, 3, 3, 3]]) {
      expect(blackjackOf(web400, hands, 0).mode).toBe("wide");
    }
    expect(blackjackOf(web400, [2], 0).hands[0]!.fan.cardWidth).toBe(32);
  });

  it("1280x400: a split hand's wide label stays above the compact result line (105 dp)", () => {
    for (const n of [2, 3, 4]) {
      const g = blackjackOf(web400, Array(n).fill(3), 0, true);
      expect(g.mode).toBe("wide");
      for (const h of g.hands) expect(h.label.width).toBeGreaterThan(105);
    }
  });

  it("a 900x600 Android tablet: 4 hands go wide with full 78 dp cards, 2 hands stack", () => {
    const w: Win = { name: "Android 900x600", width: 900, height: 600, insetBottom: 0 };
    const quad = blackjackOf(w, [3, 3, 3, 3]);
    expect(quad.mode).toBe("wide");
    expect(quad.hands[0]!.fan.cardWidth).toBe(78);
    expect(blackjackOf(w, [3, 3]).mode).toBe("fans");
  });

  it("1280x400: Hearts is still landscape, at its smallest cards", () => {
    const g = computeFallbackGeometry({ width: 1280, height: 400 });
    expect(g.mode).toBe("landscape");
    expect(g.hand.cardW).toBe(44);
    expect(g.trick.cardW).toBe(40);
  });
});

describe("split-screen on an iPad (full height, narrow)", () => {
  it("stays portrait-shaped: Hearts is portrait and Blackjack stacks", () => {
    const w: Win = { name: "split 507x768", width: 507, height: 768, insetBottom: 20 };
    expect(computeFallbackGeometry({ width: w.width, height: w.height }).mode).toBe("portrait");
    expect(blackjackOf(w, [3, 3, 3, 3]).mode).toBe("rows");
    expect(cards(cardsFeltOf(w)).cardWidth).toBe(40);
  });
});
