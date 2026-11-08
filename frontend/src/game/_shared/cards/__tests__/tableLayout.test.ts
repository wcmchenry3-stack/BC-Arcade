import {
  FACE_DOWN_STEP_RATIO,
  MAX_FACE_UP_STEP_RATIO,
  MIN_FACE_UP_STEP,
  TABLE_BOTTOM_BAND,
  TABLE_FELT_MARGIN_BOTTOM,
  TABLE_FELT_MARGIN_TOP,
  columnHeight,
  computeTableGeometry,
  estimateFeltSize,
  faceUpStepFor,
} from "../tableLayout";

// The felt each phone leaves once the header (64 + top inset), the stat line (28),
// the margins (4 + 8), the tab bar and the felt's 1 dp rim are taken off the window.
const FELTS = [
  { name: "375x667", width: 375 - 12 - 2, height: 667 - 64 - 20 - 28 - 12 - 72 - 2 },
  { name: "390x844", width: 390 - 12 - 2, height: 844 - 64 - 47 - 28 - 12 - 106 - 2 },
  { name: "430x932", width: 430 - 12 - 2, height: 932 - 64 - 59 - 28 - 12 - 106 - 2 },
] as const;

describe("computeTableGeometry (#3606)", () => {
  it("cards are as wide as the 7 columns allow, with 4 dp gaps and 12 dp padding", () => {
    // A roomy felt: nothing needs to shrink.
    const g = computeTableGeometry({ width: 378, height: 900 });
    expect(g.gap).toBe(4);
    expect(g.padding).toBe(12);
    expect(g.cardWidth).toBe(Math.floor((378 - 24 - 6 * 4) / 7));
    // One more pixel of width would not fit.
    expect(7 * (g.cardWidth + 1) + 6 * 4 + 24).toBeGreaterThan(378);
    expect(g.cardHeight).toBe(Math.round(g.cardWidth * (74 / 52)));
  });

  it.each(FELTS)("$name: face-down cards step 0.2 of the card height", (felt) => {
    const g = computeTableGeometry(felt);
    expect(g.faceDownStep).toBe(Math.round(g.cardHeight * FACE_DOWN_STEP_RATIO));
  });

  it.each(FELTS)("$name: the face-up stripe is never under 24 dp", (felt) => {
    const g = computeTableGeometry(felt);
    expect(g.minFaceUpStep).toBeGreaterThanOrEqual(MIN_FACE_UP_STEP);
    expect(faceUpStepFor(g, [{ down: 6, up: 13 }])).toBeGreaterThanOrEqual(MIN_FACE_UP_STEP);
  });

  it.each(FELTS)(
    "$name: the tallest column fits, or the tableau reports that it scrolls",
    (felt) => {
      const g = computeTableGeometry(felt);
      const step = faceUpStepFor(g, [{ down: 6, up: 13 }]);
      const height = columnHeight(g.cardHeight, g.faceDownStep, step, { down: 6, up: 13 });
      expect(height).toBe(g.tallestColumnHeight);
      if (g.overflow) expect(height).toBeGreaterThan(g.tableauHeight);
      else expect(height).toBeLessThanOrEqual(g.tableauHeight);
    }
  );

  it.each(FELTS)("$name: the tableau stays above the bottom band", (felt) => {
    const g = computeTableGeometry(felt);
    expect(g.bottomBand).toBe(TABLE_BOTTOM_BAND);
    // Padding, the top row, the row gap, the tableau area, then the band.
    const tableauBottom = g.padding + g.cardHeight + g.rowGap + g.tableauHeight;
    expect(tableauBottom + g.bottomBand).toBeLessThanOrEqual(felt.height - g.padding);
  });

  it("a tall felt fits the tallest column without scrolling", () => {
    const g = computeTableGeometry({ width: 378, height: 900 });
    expect(g.overflow).toBe(false);
    expect(g.tallestColumnHeight).toBeLessThanOrEqual(g.tableauHeight);
  });

  it("shrinks the cards before it gives up on the 24 dp step", () => {
    const roomy = computeTableGeometry({ width: 378, height: 900 });
    // Short enough that the full-width cards cannot fit, but 36 dp ones can.
    const short = computeTableGeometry({ width: 378, height: 560 });
    expect(short.cardWidth).toBeLessThan(roomy.cardWidth);
    expect(short.cardWidth).toBeGreaterThanOrEqual(36);
    expect(short.overflow).toBe(false);
    expect(short.minFaceUpStep).toBeGreaterThanOrEqual(MIN_FACE_UP_STEP);
    expect(short.tallestColumnHeight).toBeLessThanOrEqual(short.tableauHeight);
  });

  it("a felt too short even for 36 dp cards keeps the 24 dp step and reports overflow", () => {
    const g = computeTableGeometry({ width: 378, height: 430 });
    expect(g.cardWidth).toBe(36);
    expect(g.overflow).toBe(true);
    expect(g.minFaceUpStep).toBe(MIN_FACE_UP_STEP);
    // A 13-card face-up run still steps 24 dp, not squeezed to fit.
    expect(faceUpStepFor(g, [{ down: 0, up: 13 }])).toBe(MIN_FACE_UP_STEP);
    expect(g.tallestColumnHeight).toBeGreaterThan(g.tableauHeight);
  });

  it("never draws cards narrower than 36 dp", () => {
    expect(computeTableGeometry({ width: 200, height: 300 }).cardWidth).toBe(36);
  });
});

describe("faceUpStepFor (#3606)", () => {
  const g = computeTableGeometry({ width: 378, height: 640 });

  it("is 0.72 of the card height while the columns are short", () => {
    const step = faceUpStepFor(g, [
      { down: 3, up: 2 },
      { down: 0, up: 4 },
    ]);
    expect(step).toBe(Math.floor(g.cardHeight * MAX_FACE_UP_STEP_RATIO));
  });

  it("tightens as a column grows, and every column then fits", () => {
    const columns = [
      { down: 4, up: 9 },
      { down: 1, up: 3 },
    ];
    const step = faceUpStepFor(g, columns);
    expect(step).toBeLessThan(g.maxFaceUpStep);
    for (const c of columns) {
      expect(columnHeight(g.cardHeight, g.faceDownStep, step, c)).toBeLessThanOrEqual(
        g.tableauHeight
      );
    }
  });

  it("is never tighter than 24 dp", () => {
    for (let down = 0; down <= 6; down++) {
      for (let up = 1; up <= 13; up++) {
        expect(faceUpStepFor(g, [{ down, up }])).toBeGreaterThanOrEqual(MIN_FACE_UP_STEP);
      }
    }
  });

  it("a board of empty and single-card columns uses the largest step", () => {
    expect(faceUpStepFor(g, [])).toBe(g.maxFaceUpStep);
    expect(faceUpStepFor(g, [{ down: 0, up: 1 }])).toBe(g.maxFaceUpStep);
  });
});

describe("columnHeight", () => {
  it("is zero for an empty column and one card high for a single card", () => {
    expect(columnHeight(60, 12, 40, { down: 0, up: 0 })).toBe(0);
    expect(columnHeight(60, 12, 40, { down: 0, up: 1 })).toBe(60);
  });

  it("adds each card's step but the last card's", () => {
    expect(columnHeight(60, 12, 40, { down: 2, up: 3 })).toBe(60 + 2 * 12 + 2 * 40);
  });
});

describe("estimateFeltSize", () => {
  it("is the window less the real chrome", () => {
    expect(
      estimateFeltSize({
        windowWidth: 390,
        windowHeight: 844,
        sideInsets: { left: 6, right: 6 },
        headerHeight: 111,
        statLineHeight: 28,
        bottomHeight: 106,
      })
    ).toEqual({
      width: 378,
      height: 844 - 111 - 28 - TABLE_FELT_MARGIN_TOP - TABLE_FELT_MARGIN_BOTTOM - 106,
    });
  });

  it("is never negative", () => {
    const size = estimateFeltSize({
      windowWidth: 10,
      windowHeight: 10,
      sideInsets: { left: 20, right: 20 },
      headerHeight: 100,
      statLineHeight: 28,
      bottomHeight: 100,
    });
    expect(size).toEqual({ width: 0, height: 0 });
  });
});
