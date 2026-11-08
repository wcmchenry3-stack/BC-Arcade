import {
  CORNER_INDEX_FLOOR,
  FACE_DOWN_STEP_RATIO,
  MAX_FACE_UP_STEP_RATIO,
  MIN_FACE_DOWN_STEP,
  MIN_FACE_UP_STEP,
  TABLE_BOTTOM_BAND,
  TABLE_FELT_MARGIN_BOTTOM,
  TABLE_FELT_MARGIN_TOP,
  columnHeight,
  computeTableGeometry,
  cornerIndexHeight,
  estimateFeltSize,
  faceUpStepFor,
} from "../tableLayout";

/**
 * The felt a portrait phone leaves once the header (64 + the top inset), the stat
 * line (28), the margins (4 + 8), the tab bar and the felt's 1 dp rim are taken off
 * the window. The 360x640 row is the smallest phone the layout must fit at the
 * corner-index floor.
 */
function feltOf(width: number, height: number, topInset: number, tabBar: number) {
  return {
    width: width - 12 - 2,
    height: height - (64 + topInset) - 28 - 12 - tabBar - 2,
  };
}
const FELTS = [
  { name: "360x640", ...feltOf(360, 640, 24, 72) },
  { name: "375x667", ...feltOf(375, 667, 20, 72) },
  { name: "390x844", ...feltOf(390, 844, 47, 106) },
  { name: "430x932", ...feltOf(430, 932, 59, 106) },
] as const;

const tallest = { down: 6, up: 13 };

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
    expect(g.compression).toBe("none");
  });

  it.each(FELTS)("$name: the tallest column fits the tableau area", (felt) => {
    const g = computeTableGeometry(felt);
    const step = faceUpStepFor(g, [tallest]);
    expect(columnHeight(g.cardHeight, g.faceDownStep, step, tallest)).toBeLessThanOrEqual(
      g.tableauHeight
    );
  });

  it.each(FELTS)("$name: the face-up stripe is never under the corner index", (felt) => {
    const g = computeTableGeometry(felt);
    expect(g.cornerIndexHeight).toBeGreaterThanOrEqual(CORNER_INDEX_FLOOR);
    expect(faceUpStepFor(g, [tallest])).toBeGreaterThanOrEqual(g.cornerIndexHeight);
  });

  it("pins the outcome per phone", () => {
    const by = Object.fromEntries(FELTS.map((f) => [f.name, computeTableGeometry(f)]));
    // 375x667: the tallest column only fits compressed: 36 dp cards, 8 dp face-down
    // steps, and a face-up stripe under 24 dp but at least the corner index.
    expect(by["375x667"]).toMatchObject({ compression: "faceUp", cardWidth: 36, faceDownStep: 8 });
    const s375 = faceUpStepFor(by["375x667"]!, [tallest]);
    expect(s375).toBeLessThan(MIN_FACE_UP_STEP);
    expect(s375).toBeGreaterThanOrEqual(CORNER_INDEX_FLOOR);
    // 390x844 and 430x932: the cards shrink a little, nothing else; a 24 dp step or better.
    for (const name of ["390x844", "430x932"]) {
      expect(by[name]!.compression).toBe("none");
      expect(faceUpStepFor(by[name]!, [tallest])).toBeGreaterThanOrEqual(MIN_FACE_UP_STEP);
    }
    // The smallest supported phone sits exactly on the floor.
    expect(faceUpStepFor(by["360x640"]!, [tallest])).toBeGreaterThanOrEqual(CORNER_INDEX_FLOOR);
  });

  it.each(FELTS)("$name: the tableau bottom is the band's top, below the padding", (felt) => {
    const g = computeTableGeometry(felt);
    expect(g.bottomBand).toBe(TABLE_BOTTOM_BAND);
    // Padding, the top row, the row gap, the tableau area, then the band.
    const tableauBottom = g.padding + g.cardHeight + g.rowGap + g.tableauHeight;
    expect(tableauBottom).toBe(felt.height - g.bottomBand);
  });

  it("the padding below the tableau is not counted on top of the band", () => {
    const small = computeTableGeometry({ width: 378, height: 600, bottomBand: 8 });
    // A band smaller than the padding: the padding alone is kept clear.
    expect(small.padding + small.cardHeight + small.rowGap + small.tableauHeight).toBe(600 - 12);
  });

  it("shrinks the cards before it touches any step", () => {
    const roomy = computeTableGeometry({ width: 378, height: 900 });
    const shorter = computeTableGeometry({ width: 378, height: 540 });
    expect(shorter.cardWidth).toBeLessThan(roomy.cardWidth);
    expect(shorter.cardWidth).toBeGreaterThanOrEqual(36);
    expect(shorter.compression).toBe("none");
    expect(shorter.faceDownStep).toBe(Math.round(shorter.cardHeight * FACE_DOWN_STEP_RATIO));
    expect(shorter.minFaceUpStep).toBeGreaterThanOrEqual(MIN_FACE_UP_STEP);
  });

  it("then shortens the face-down step, keeping the 24 dp stripe", () => {
    // 36 dp cards with room for a 24 dp run and face-down steps between 8 dp and 10 dp.
    const g = computeTableGeometry({ width: 378, height: 508 });
    expect(g.cardWidth).toBe(36);
    expect(g.compression).toBe("faceDown");
    expect(g.faceDownStep).toBeGreaterThanOrEqual(MIN_FACE_DOWN_STEP);
    expect(g.faceDownStep).toBeLessThan(Math.round(g.cardHeight * FACE_DOWN_STEP_RATIO));
    expect(g.minFaceUpStep).toBeGreaterThanOrEqual(MIN_FACE_UP_STEP);
  });

  it("only then lets the face-up stripe go under 24 dp", () => {
    const g = computeTableGeometry({ width: 378, height: 440 });
    expect(g.compression).toBe("faceUp");
    expect(g.cardWidth).toBe(36);
    expect(g.faceDownStep).toBe(MIN_FACE_DOWN_STEP);
    expect(g.minFaceUpStep).toBeLessThan(MIN_FACE_UP_STEP);
  });

  it("a felt below the supported phones returns the fitted step even under the corner index", () => {
    // Documented limit: under ~360x640 the tallest column fits only with a stripe
    // narrower than the corner index (and never scrolls).
    const g = computeTableGeometry({ width: 346, height: 380 });
    const step = faceUpStepFor(g, [tallest]);
    expect(step).toBeLessThan(g.cornerIndexHeight);
    expect(step).toBeGreaterThanOrEqual(1);
    expect(columnHeight(g.cardHeight, g.faceDownStep, step, tallest)).toBeLessThanOrEqual(
      g.tableauHeight
    );
  });

  it("never draws cards narrower than 36 dp", () => {
    expect(computeTableGeometry({ width: 200, height: 300 }).cardWidth).toBe(36);
  });
});

describe("cornerIndexHeight", () => {
  it("covers the rank and most of the pip, and is never under 18 dp", () => {
    for (const w of [36, 40, 46, 52, 60]) {
      const rank = Math.max(10, Math.round(w * 0.24));
      expect(cornerIndexHeight(w)).toBeGreaterThanOrEqual(rank + 2);
      expect(cornerIndexHeight(w)).toBeGreaterThanOrEqual(CORNER_INDEX_FLOOR);
    }
    expect(cornerIndexHeight(80)).toBeGreaterThan(cornerIndexHeight(36));
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
      { down: 6, up: 13 },
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
