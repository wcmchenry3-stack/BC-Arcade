import {
  calculateBlackjackLayout,
  calculateCardOverlap,
  COMPACT_HEIGHT_BREAKPOINT,
} from "../layout";

const BREAKPOINT = COMPACT_HEIGHT_BREAKPOINT;

describe("calculateBlackjackLayout", () => {
  describe("compact threshold", () => {
    it("is NOT compact at exactly the breakpoint", () => {
      const { compact } = calculateBlackjackLayout({
        availableWidth: 390,
        availableHeight: BREAKPOINT,
      });
      expect(compact).toBe(false);
    });

    it("IS compact one point below the breakpoint", () => {
      const { compact } = calculateBlackjackLayout({
        availableWidth: 390,
        availableHeight: BREAKPOINT - 1,
      });
      expect(compact).toBe(true);
    });
  });

  describe("normal layout (iPhone 14 Pro — large viewport)", () => {
    // iPhone 14 Pro: 430×932, header+safe-area roughly 120 → ~812 available
    const layout = calculateBlackjackLayout({ availableWidth: 430, availableHeight: 812 });

    it("is not compact", () => expect(layout.compact).toBe(false));

    it("player card uses normal size (68×96)", () => {
      expect(layout.playerCardWidth).toBe(68);
      expect(layout.playerCardHeight).toBe(96);
    });

    it("dealer card uses normal size (52×72)", () => {
      expect(layout.dealerCardWidth).toBe(52);
      expect(layout.dealerCardHeight).toBe(72);
    });

    it("split card is smaller than player card", () => {
      expect(layout.splitCardWidth).toBeLessThan(layout.playerCardWidth);
      expect(layout.splitCardHeight).toBeLessThan(layout.playerCardHeight);
    });

    it("buttons use normal size (80px)", () => {
      expect(layout.buttonSize).toBe(80);
      expect(layout.buttonRadius).toBe(40);
    });

    it("button icon uses normal size (28px)", () => {
      expect(layout.buttonIconSize).toBe(28);
    });
  });

  describe("compact layout (Galaxy Fold landscape — short viewport)", () => {
    // Galaxy Fold unfolded landscape: ~844×390 → very little vertical room
    const layout = calculateBlackjackLayout({ availableWidth: 844, availableHeight: 390 });

    it("is compact", () => expect(layout.compact).toBe(true));

    it("player card uses compact size (48×68)", () => {
      expect(layout.playerCardWidth).toBe(48);
      expect(layout.playerCardHeight).toBe(68);
    });

    it("dealer card uses compact size (40×56)", () => {
      expect(layout.dealerCardWidth).toBe(40);
      expect(layout.dealerCardHeight).toBe(56);
    });

    it("buttons use compact size (62px)", () => {
      expect(layout.buttonSize).toBe(62);
      expect(layout.buttonRadius).toBe(31);
    });

    it("button icon uses compact size (22px)", () => {
      expect(layout.buttonIconSize).toBe(22);
    });

    it("table gap is reduced in compact mode", () => {
      expect(layout.tableGap).toBe(4);
    });
  });

  describe("minimum card width guarantee (≥ 36px)", () => {
    it("player card meets minimum on very short viewport", () => {
      const { playerCardWidth } = calculateBlackjackLayout({
        availableWidth: 320,
        availableHeight: 200,
      });
      expect(playerCardWidth).toBeGreaterThanOrEqual(36);
    });

    it("dealer card meets minimum on very short viewport", () => {
      const { dealerCardWidth } = calculateBlackjackLayout({
        availableWidth: 320,
        availableHeight: 200,
      });
      expect(dealerCardWidth).toBeGreaterThanOrEqual(36);
    });

    it("split card meets minimum on very short viewport", () => {
      const { splitCardWidth } = calculateBlackjackLayout({
        availableWidth: 320,
        availableHeight: 200,
      });
      expect(splitCardWidth).toBeGreaterThanOrEqual(36);
    });
  });

  describe("split card sizing", () => {
    it("non-compact split card matches compact player card width (48px) for side-by-side fit", () => {
      const layout = calculateBlackjackLayout({ availableWidth: 390, availableHeight: 812 });
      expect(layout.splitCardWidth).toBe(48);
    });

    it("compact split card is smaller than compact player card", () => {
      const layout = calculateBlackjackLayout({ availableWidth: 390, availableHeight: 400 });
      expect(layout.splitCardWidth).toBeLessThan(layout.playerCardWidth);
    });

    it("compact split card height is 51 (Math.round(36 * 1.414))", () => {
      const layout = calculateBlackjackLayout({ availableWidth: 390, availableHeight: 400 });
      expect(layout.splitCardHeight).toBe(51);
    });

    it("non-compact split card height is 68 (Math.round(48 * 1.414))", () => {
      const layout = calculateBlackjackLayout({ availableWidth: 390, availableHeight: 812 });
      expect(layout.splitCardHeight).toBe(68);
    });
  });

  describe("hand display properties", () => {
    it("normal handGap is 8", () => {
      const layout = calculateBlackjackLayout({ availableWidth: 390, availableHeight: 812 });
      expect(layout.handGap).toBe(8);
    });

    it("compact handGap is 2", () => {
      const layout = calculateBlackjackLayout({ availableWidth: 390, availableHeight: 400 });
      expect(layout.handGap).toBe(2);
    });

    it("normal handLabelFontSize is 13", () => {
      const layout = calculateBlackjackLayout({ availableWidth: 390, availableHeight: 812 });
      expect(layout.handLabelFontSize).toBe(13);
    });

    it("compact handLabelFontSize is 11", () => {
      const layout = calculateBlackjackLayout({ availableWidth: 390, availableHeight: 400 });
      expect(layout.handLabelFontSize).toBe(11);
    });

    it("normal scorePillFontSize is 32", () => {
      const layout = calculateBlackjackLayout({ availableWidth: 390, availableHeight: 812 });
      expect(layout.scorePillFontSize).toBe(32);
    });

    it("compact scorePillFontSize is 22", () => {
      const layout = calculateBlackjackLayout({ availableWidth: 390, availableHeight: 400 });
      expect(layout.scorePillFontSize).toBe(22);
    });
  });

  describe("spacing tokens sourced from layout", () => {
    const normal = calculateBlackjackLayout({ availableWidth: 390, availableHeight: 812 });
    const compact = calculateBlackjackLayout({ availableWidth: 390, availableHeight: 400 });

    it("normal handsRowGap is 8", () => expect(normal.handsRowGap).toBe(8));
    it("compact handsRowGap is 6", () => expect(compact.handsRowGap).toBe(6));
    it("normal splitHandPadding is 6", () => expect(normal.splitHandPadding).toBe(6));
    it("compact splitHandPadding is 4", () => expect(compact.splitHandPadding).toBe(4));
    it("normal controlsPaddingBottom is 32", () => expect(normal.controlsPaddingBottom).toBe(32));
    it("compact controlsPaddingBottom is 12", () => expect(compact.controlsPaddingBottom).toBe(12));
    it("normal controlsGap is 16", () => expect(normal.controlsGap).toBe(16));
    it("compact controlsGap is 8", () => expect(compact.controlsGap).toBe(8));
  });
});

describe("calculateCardOverlap", () => {
  it("does not overlap when the hand fits", () => {
    expect(calculateCardOverlap(3, 68, 340)).toBe(0);
    expect(calculateCardOverlap(1, 68, 10)).toBe(0);
    expect(calculateCardOverlap(0, 68, 340)).toBe(0);
  });

  it("keeps a visible strip when the row is narrower than a card", () => {
    expect(calculateCardOverlap(5, 36, 20)).toBe(-32);
    expect(calculateCardOverlap(5, 36, Number.NaN)).toBe(0);
  });

  it.each([6, 7, 11])("fits %i cards in the row at normal and compact sizes", (n: number) => {
    const sizes: [number, number][] = [
      [68, 340],
      [48, 340],
      [52, 340],
      [48, 140],
      [36, 140],
    ];
    for (const [cw, w] of sizes) {
      const m = calculateCardOverlap(n, cw, w);
      expect(cw + (n - 1) * (cw + m)).toBeLessThanOrEqual(w);
      expect(cw + m).toBeGreaterThan(0);
    }
  });
});

describe("split row width by hand count", () => {
  // Total horizontal space the split hands occupy: each hand's card row plus its
  // padding and 2px border, plus the gaps between hands.
  function occupied(width: number, height: number, handCount: number) {
    const l = calculateBlackjackLayout({
      availableWidth: width,
      availableHeight: height,
      handCount,
    });
    const perHand = l.splitHandRowWidth + 2 * (l.splitHandPadding + 2);
    return { l, total: perHand * handCount + l.handsRowGap * (handCount - 1) };
  }

  it.each([
    [390, 800],
    [390, 600],
    [320, 600],
  ])("3 and 4 hands fit inside the window at %ipt wide / %ipt high", (w, h) => {
    for (const n of [2, 3, 4]) {
      expect(occupied(w, h, n).total).toBeLessThanOrEqual(w);
    }
  });

  it("shrinks each hand row as the hand count grows", () => {
    const w2 = occupied(390, 800, 2).l.splitHandRowWidth;
    const w3 = occupied(390, 800, 3).l.splitHandRowWidth;
    const w4 = occupied(390, 800, 4).l.splitHandRowWidth;
    expect(w3).toBeLessThan(w2);
    expect(w4).toBeLessThan(w3);
  });

  it("keeps 4 narrow hands wider than a split card so cards still render", () => {
    const { l } = occupied(320, 600, 4);
    expect(l.splitHandRowWidth).toBeGreaterThanOrEqual(l.splitCardWidth);
  });

  it("treats a missing or sub-2 hand count as 2", () => {
    const base = calculateBlackjackLayout({ availableWidth: 390, availableHeight: 800 });
    const one = calculateBlackjackLayout({
      availableWidth: 390,
      availableHeight: 800,
      handCount: 1,
    });
    expect(one.splitHandRowWidth).toBe(base.splitHandRowWidth);
  });
});

describe("hand row widths", () => {
  it("scale with availableWidth and split rows are narrower", () => {
    const wide = calculateBlackjackLayout({ availableWidth: 430, availableHeight: 800 });
    const narrow = calculateBlackjackLayout({ availableWidth: 320, availableHeight: 800 });
    expect(wide.handRowWidth).toBeGreaterThan(narrow.handRowWidth);
    expect(wide.splitHandRowWidth).toBeLessThan(wide.handRowWidth / 2);
  });
});
