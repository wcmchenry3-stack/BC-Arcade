import {
  FACE_DOWN_STEP_RATIO,
  MAX_FACE_UP_STEP_RATIO,
  MIN_FACE_UP_STEP_RATIO,
  TABLE_FELT_MARGIN_BOTTOM,
  TABLE_FELT_MARGIN_TOP,
  columnHeight,
  computeTableGeometry,
  estimateFeltSize,
  faceUpStepFor,
} from "../tableLayout";

// The felt each phone leaves once the header (64 + top inset), the stat line (28),
// the margins (4 + 8) and the tab bar (72) are taken off the window.
const FELTS = [
  { name: "375x667", width: 375 - 12, height: 667 - 64 - 20 - 28 - 12 - 72 },
  { name: "390x844", width: 390 - 12, height: 844 - 64 - 47 - 28 - 12 - 106 },
  { name: "430x932", width: 430 - 12, height: 932 - 64 - 59 - 28 - 12 - 106 },
] as const;

describe("computeTableGeometry (#3606)", () => {
  it.each(FELTS)(
    "$name: cards as wide as 7 columns allow, with 4 dp gaps and 12 dp padding",
    (felt) => {
      const g = computeTableGeometry(felt);
      expect(g.gap).toBe(4);
      expect(g.padding).toBe(12);
      expect(g.cardWidth).toBe(Math.floor((felt.width - 24 - 6 * 4) / 7));
      // One more pixel of width would not fit.
      expect(7 * (g.cardWidth + 1) + 6 * 4 + 24).toBeGreaterThan(felt.width);
      expect(g.cardHeight).toBe(Math.round(g.cardWidth * (74 / 52)));
    }
  );

  it.each(FELTS)("$name: face-down cards step 0.2 of the card height", (felt) => {
    const g = computeTableGeometry(felt);
    expect(g.faceDownStep).toBe(Math.round(g.cardHeight * FACE_DOWN_STEP_RATIO));
  });

  it.each(FELTS)("$name: the tallest legal column (6 face-down + 13 face-up) fits", (felt) => {
    const g = computeTableGeometry(felt);
    const step = faceUpStepFor(g, [{ down: 6, up: 13 }]);
    const height = columnHeight(g.cardHeight, g.faceDownStep, step, { down: 6, up: 13 });
    expect(height).toBeLessThanOrEqual(g.tableauHeight);
    // The step it settled on is the one the geometry promised, and stays readable.
    expect(step).toBe(g.minFaceUpStep);
    expect(step).toBeGreaterThanOrEqual(Math.ceil(g.cardHeight * MIN_FACE_UP_STEP_RATIO));
  });

  it.each(FELTS)(
    "$name: the felt holds the padding, the top row and the tallest column",
    (felt) => {
      const g = computeTableGeometry(felt);
      const height = columnHeight(g.cardHeight, g.faceDownStep, g.minFaceUpStep, {
        down: 6,
        up: 13,
      });
      expect(g.padding + g.cardHeight + g.rowGap + height + g.padding).toBeLessThanOrEqual(
        felt.height
      );
    }
  );

  it("shrinks the cards when the felt is too short for readable steps", () => {
    const wide = computeTableGeometry({ width: 390, height: 900 });
    const short = computeTableGeometry({ width: 390, height: 430 });
    expect(short.cardWidth).toBeLessThan(wide.cardWidth);
    expect(short.minFaceUpStep).toBeGreaterThanOrEqual(
      Math.ceil(short.cardHeight * MIN_FACE_UP_STEP_RATIO)
    );
  });

  it("never draws cards narrower than 36 dp", () => {
    expect(computeTableGeometry({ width: 200, height: 300 }).cardWidth).toBe(36);
  });
});

describe("faceUpStepFor (#3606)", () => {
  // The shortest phone: the steps tighten soonest there.
  const g = computeTableGeometry(FELTS[0]);

  it("is 0.72 of the card height while the columns are short", () => {
    const step = faceUpStepFor(g, [
      { down: 3, up: 2 },
      { down: 0, up: 4 },
    ]);
    expect(step).toBe(Math.floor(g.cardHeight * MAX_FACE_UP_STEP_RATIO));
  });

  it("tightens as a column grows, and every column then fits", () => {
    const columns = [
      { down: 4, up: 8 },
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

  it("is never tighter than the tallest legal column needs", () => {
    for (let down = 0; down <= 6; down++) {
      for (let up = 1; up <= 13; up++) {
        expect(faceUpStepFor(g, [{ down, up }])).toBeGreaterThanOrEqual(g.minFaceUpStep);
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
