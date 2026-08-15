import { computeGridShape } from "../gridGeometry";

describe("computeGridShape", () => {
  it("pins the current col-count thresholds (single row ≤4, 3 cols for 5–6, 4 cols for 7+)", () => {
    expect(computeGridShape(1)).toEqual({ numCols: 1, numRows: 1, lastRowCount: 1 });
    expect(computeGridShape(4)).toEqual({ numCols: 4, numRows: 1, lastRowCount: 4 });
    expect(computeGridShape(5)).toEqual({ numCols: 3, numRows: 2, lastRowCount: 2 });
    expect(computeGridShape(6)).toEqual({ numCols: 3, numRows: 2, lastRowCount: 3 });
    expect(computeGridShape(7)).toEqual({ numCols: 4, numRows: 2, lastRowCount: 3 });
    expect(computeGridShape(9)).toEqual({ numCols: 4, numRows: 3, lastRowCount: 1 });
  });

  it("is a pure function of bottle count — same input always yields the same shape", () => {
    for (let n = 1; n <= 30; n++) {
      expect(computeGridShape(n)).toEqual(computeGridShape(n));
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
