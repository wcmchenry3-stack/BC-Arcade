import { computeGridShape } from "../gridGeometry";

describe("computeGridShape", () => {
  it("pins the current row-cap thresholds (single row ≤4, cap 3 for 5–6, cap 4 for 7+)", () => {
    expect(computeGridShape(1)).toEqual({ numCols: 1, numRows: 1, rowCounts: [1] });
    expect(computeGridShape(4)).toEqual({ numCols: 4, numRows: 1, rowCounts: [4] });
    expect(computeGridShape(5)).toEqual({ numCols: 3, numRows: 2, rowCounts: [3, 2] });
    expect(computeGridShape(6)).toEqual({ numCols: 3, numRows: 2, rowCounts: [3, 3] });
    expect(computeGridShape(7)).toEqual({ numCols: 4, numRows: 2, rowCounts: [4, 3] });
    // Regression #2426: 9 bottles used to render as [4, 4, 1] — a single bottle
    // stranded alone on its own row (level 11/12 in the real progression).
    // Rows must now differ by at most 1.
    expect(computeGridShape(9)).toEqual({ numCols: 3, numRows: 3, rowCounts: [3, 3, 3] });
  });

  it("returns an empty shape for zero bottles instead of NaN/-Infinity", () => {
    expect(computeGridShape(0)).toEqual({ numCols: 0, numRows: 0, rowCounts: [] });
  });

  it("is a pure function of bottle count — same input always yields the same shape", () => {
    for (let n = 1; n <= 30; n++) {
      expect(computeGridShape(n)).toEqual(computeGridShape(n));
    }
  });

  // Regression #2426: row sizes must never differ by more than 1 — the old
  // "fill full rows, dump the remainder in the last row" approach could leave
  // a nearly-empty final row (e.g. 9 bottles → 4+4+1).
  it("keeps row sizes within 1 of each other for every bottle count, 1–40", () => {
    for (let n = 1; n <= 40; n++) {
      const { rowCounts } = computeGridShape(n);
      const max = Math.max(...rowCounts);
      const min = Math.min(...rowCounts);
      expect(max - min).toBeLessThanOrEqual(1);
    }
  });

  // rowCounts must always sum back to the original bottle count.
  it("rowCounts always sums to the input bottle count, 1–40", () => {
    for (let n = 1; n <= 40; n++) {
      const { rowCounts } = computeGridShape(n);
      expect(rowCounts.reduce((a, b) => a + b, 0)).toBe(n);
    }
  });

  // Regression #2297: SortBoard invalidates its cached onLayout positions
  // whenever `state.bottles.length` changes (see the reset effect in
  // SortBoard.tsx and its regression test in SortBoard.test.tsx), rather than
  // doing a full shape comparison. That's only a correct (and non-wasteful)
  // invalidation key if EVERY bottle-count change actually changes the grid
  // shape for this app's real level progression — otherwise some transitions
  // would reset unnecessarily, and worse, a change to this formula could
  // silently introduce a bottle-count change that DOESN'T change shape,
  // which would need its own reset trigger that nothing here would exercise.
  //
  // Bottle counts across the real level progression (backend/sort/
  // generate_levels.py's LEVEL_SPECS) currently range from 4 (3 colors + 1
  // empty) to 16 (14 colors + 2 empty); 1–40 gives generous headroom for
  // future level additions.
  it("changes shape on every consecutive bottle-count step, 1–40 (regression #2297)", () => {
    for (let n = 2; n <= 40; n++) {
      const prev = computeGridShape(n - 1);
      const curr = computeGridShape(n);
      expect(curr).not.toEqual(prev);
    }
  });
});
