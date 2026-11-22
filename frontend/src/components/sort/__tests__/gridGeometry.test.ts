import {
  BOARD_HORIZONTAL_PAD,
  BOARD_VERTICAL_PADDING,
  BOTTLE_GAP,
  BOTTLE_GAP_RATIO,
  MAX_BOTTLE_SCALE,
  SORT_ACTION_BAR_H,
  computeBoardLayout,
  computeGridShape,
  MIN_BOTTLE_HEIGHT,
  MIN_TOUCH_TARGET,
  type BoardLayout,
} from "../gridGeometry";
import { DEFAULT_BOTTLE_HEIGHT, DEFAULT_BOTTLE_WIDTH } from "../BottleView";

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
  // Bottle counts across the real level progression
  // (the level catalog's specs) currently range from 4 (3 colors + 1
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

// ---------------------------------------------------------------------------
// #2207 — tap-target size on dense levels
// ---------------------------------------------------------------------------

describe("computeBoardLayout (#2207)", () => {
  const BOTTLE = { width: DEFAULT_BOTTLE_WIDTH, height: DEFAULT_BOTTLE_HEIGHT };
  // Bottle counts across the catalog's level specs:
  // 3 colours + 1 empty (4) up to 14 colours + 2 empties (16).
  const LEVEL_BOTTLE_COUNTS = Array.from({ length: 13 }, (_, i) => i + 4);
  // Board content boxes (window width minus SortScreen's 2×16 padding, and a
  // range of board heights), from the smallest supported phones (320 wide:
  // iPhone SE 1st gen, small Androids) up to large phones.
  const CONTENT_WIDTHS = [288, 328, 343, 358, 382, 398];
  const CONTENT_HEIGHTS = [280, 360, 440, 520, 640];

  function eachBoard(fn: (l: BoardLayout, where: string, w: number, h: number) => void) {
    for (const n of LEVEL_BOTTLE_COUNTS) {
      for (const w of CONTENT_WIDTHS) {
        for (const h of CONTENT_HEIGHTS) {
          fn(computeBoardLayout(n, w, h, BOTTLE), `${n} bottles in ${w}×${h}`, w, h);
        }
      }
    }
  }

  it("gives every bottle a tap area of at least 48 that never overlaps a neighbour's", () => {
    eachBoard((l, where, w) => {
      // Width: the bottle plus its hitSlop fills exactly its own cell.
      const tapW = l.hitSlop.left + l.bottleW + l.hitSlop.right;
      expect({ where, tapW }).toEqual({ where, tapW: expect.closeTo(l.slotW, 6) });
      expect({ where, ok: tapW >= MIN_TOUCH_TARGET }).toEqual({ where, ok: true });
      // Height: the bottle itself is tall enough; no vertical slop needed.
      expect({ where, ok: l.bottleH >= MIN_TOUCH_TARGET }).toEqual({ where, ok: true });
      expect([l.hitSlop.top, l.hitSlop.bottom]).toEqual([0, 0]);
      // Cells tile a row, so the widest row never overflows the board.
      expect({ where, ok: l.numCols * l.slotW <= w + 1e-9 }).toEqual({ where, ok: true });
      // Bottles keep at least the default visual gap between them.
      expect({ where, ok: l.slotW - l.bottleW >= BOTTLE_GAP - 1e-9 }).toEqual({ where, ok: true });
    });
  });

  it("fits the grid's height to the board whenever the 60pt bottle floor allows", () => {
    eachBoard((l, where, _w, h) => {
      if (h < l.numRows * MIN_BOTTLE_HEIGHT + (l.numRows - 1) * l.rowGap) return;
      const gridH = l.numRows * l.bottleH + (l.numRows - 1) * l.rowGap;
      expect({ where, ok: gridH <= h + 1e-9 }).toEqual({ where, ok: true });
    });
  });

  it("keeps the 16-bottle 4×4 grid inside a small phone's board", () => {
    // 320pt-wide phone; a ~400pt-tall board once header, HUD and toggle are out.
    const l = computeBoardLayout(16, 288, 400, BOTTLE);
    expect(l.rowCounts).toEqual([4, 4, 4, 4]);
    // Height-limited: (400 - 3×ROW_GAP) / 4 = 94 tall, so ~31.3 wide. That width
    // used to be the whole tap area; now each bottle's cell is 48 wide.
    expect(l.bottleH).toBeCloseTo(94, 6);
    expect(l.bottleW).toBeCloseTo(94 / 3, 6);
    expect(l.slotW).toBe(MIN_TOUCH_TARGET);
    expect(l.hitSlop.left).toBeCloseTo((48 - 94 / 3) / 2, 6);
    expect(l.hitSlop.right).toBe(l.hitSlop.left);
    expect(l.bottleInsetX).toBe(l.hitSlop.left);
    expect(4 * l.slotW).toBeLessThanOrEqual(288);
    expect(4 * l.bottleH + 3 * l.rowGap).toBeCloseTo(400, 6);
  });

  it("scales bottles up on a roomy board, to at most twice the default, gap growing with them (#3658)", () => {
    const l = computeBoardLayout(4, 718, 480, BOTTLE);
    expect(l.bottleW).toBe(DEFAULT_BOTTLE_WIDTH * MAX_BOTTLE_SCALE);
    expect(l.bottleH).toBe(DEFAULT_BOTTLE_HEIGHT * MAX_BOTTLE_SCALE);
    expect(l.slotW - l.bottleW).toBeCloseTo(l.bottleW * BOTTLE_GAP_RATIO, 6);
    expect(l.hitSlop.left).toBeCloseTo((l.slotW - l.bottleW) / 2, 6);
    expect(l.hitSlop.top + l.hitSlop.bottom).toBe(0);
  });

  // #3658 — the board on real phones. The board container's height is derived, not typed in:
  //   before = the measured container (639 on a 390x844 iPhone, in a browser at 390x844),
  //   now    = before + the 31pt Colorblind row that is gone - the action bar.
  // The smaller phones' "before" containers are the 390x844 one minus the screen-height and
  // safe-area differences (estimated: 390x844 has a 47pt top and 34pt bottom inset, 375x667 has
  // 20 and 0, 360x640 has about 24 and 0), so they are an estimate, not a device measurement.
  const COLORBLIND_ROW_H = 31;
  const BOARD_BEFORE_390 = 639;
  const PHONES = [
    { name: "390x844", w: 390, boardBefore: BOARD_BEFORE_390 },
    { name: "375x667", w: 375, boardBefore: BOARD_BEFORE_390 - (844 - 667) + (47 - 20) + 34 },
    { name: "360x640", w: 360, boardBefore: BOARD_BEFORE_390 - (844 - 640) + (47 - 24) + 34 },
  ] as const;
  // The sizing before this change: bottle capped at the default, 16pt padding, 12pt row gap.
  function widthBefore(n: number, w: number, boardBefore: number): number {
    const { numRows, numCols } = computeGridShape(n);
    const contentH = boardBefore - 2 * 16;
    const hFromH = Math.min(
      DEFAULT_BOTTLE_HEIGHT,
      Math.max(60, (contentH - 12 * (numRows - 1)) / numRows)
    );
    return Math.min(hFromH / 3, (w - BOARD_HORIZONTAL_PAD) / numCols - BOTTLE_GAP);
  }
  const contentHNow = (boardBefore: number) =>
    boardBefore + COLORBLIND_ROW_H - SORT_ACTION_BAR_H - 2 * BOARD_VERTICAL_PADDING;

  describe.each(PHONES)("$name phone: never smaller than before (#3658)", (phone) => {
    it.each([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])("%i bottles", (n) => {
      const l = computeBoardLayout(
        n,
        phone.w - BOARD_HORIZONTAL_PAD,
        contentHNow(phone.boardBefore),
        BOTTLE
      );
      // Rounding only.
      expect(l.bottleW).toBeGreaterThanOrEqual(widthBefore(n, phone.w, phone.boardBefore) - 0.01);
    });
  });

  describe("390x844 phone (#3658)", () => {
    const CONTENT_W = 390 - BOARD_HORIZONTAL_PAD;
    const CONTENT_H = contentHNow(BOARD_BEFORE_390);
    // Measured before this change at the old 639pt board (16pt padding, 12pt row gap).
    const BEFORE = { 4: [52, 156], 8: [52, 156], 12: [52, 156], 16: [47.6, 142.8] } as const;
    const layout = (n: number) => computeBoardLayout(n, CONTENT_W, CONTENT_H, BOTTLE);

    it.each([4, 8, 12, 16] as const)("%i bottles are at least as big as before", (n) => {
      const l = layout(n);
      // The 16-bottle "before" is the measured 47.6 x 142.8, rounded to 1 decimal.
      expect(l.bottleW).toBeGreaterThanOrEqual(BEFORE[n][0] - 0.05);
      expect(l.bottleH).toBeGreaterThanOrEqual(BEFORE[n][1] - 0.05);
      expect(l.bottleW).toBeGreaterThanOrEqual(widthBefore(n, 390, BOARD_BEFORE_390) - 0.01);
    });

    it.each([4, 8, 12, 16] as const)(
      "%i bottles keep the 1:3 shape, fit the board and keep a full tap cell",
      (n) => {
        const l = layout(n);
        expect(l.bottleH / l.bottleW).toBeCloseTo(3, 6);
        expect(l.numCols * l.slotW).toBeLessThanOrEqual(CONTENT_W + 1e-9);
        expect(l.numRows * l.bottleH + (l.numRows - 1) * l.rowGap).toBeLessThanOrEqual(
          CONTENT_H + 1e-9
        );
        expect(l.slotW).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
        expect(l.hitSlop.left + l.bottleW + l.hitSlop.right).toBeCloseTo(l.slotW, 6);
        expect(l.slotW - l.bottleW).toBeGreaterThanOrEqual(BOTTLE_GAP - 1e-9);
      }
    );

    it("pins the sizes recorded in docs/games/sort.md", () => {
      const sizes = [4, 8, 12, 16].map((n) => {
        const l = layout(n);
        return [n, +l.bottleW.toFixed(1), +l.bottleH.toFixed(1), +l.slotW.toFixed(1)];
      });
      expect(sizes).toEqual([
        [4, 77.5, 232.5, 89.5],
        [8, 77.5, 232.5, 89.5],
        [12, 64.9, 194.7, 77.9],
        [16, 48, 144, 60],
      ]);
    });

    it("never draws a 4-bottle level wider than the board", () => {
      const l = layout(4);
      expect(l.numCols * l.slotW).toBeLessThanOrEqual(CONTENT_W);
    });
  });

  it("returns an empty layout for zero bottles instead of NaN", () => {
    const l = computeBoardLayout(0, 343, 480, BOTTLE);
    expect([l.bottleW, l.bottleH, l.slotW, l.bottleInsetX]).toEqual([0, 0, 0, 0]);
  });
});
