/**
 * Sudoku board washes (#3773): the translucent tints laid over a cell's base surface to mark the
 * selected cell's row, column and 3x3 box (`peer`), every cell with the selected digit (`same`),
 * and a cell whose digit breaks a rule (`conflict`). Per theme, because a wash must show on the
 * dark surface and on the cream one alike. The teal is the accent (the light accent is the lighter
 * teal, so the wash stays light enough for the entered digit's `accentText` to keep 4.5:1 on it);
 * the red is `error`. A cell paints one wash, never two stacked: that is what keeps the digit
 * colours above their contrast (`cellBackground` picks conflict, then same digit, then peer).
 *
 * `components/sudoku/__tests__/boardContrast.test.ts` composites each over the board surfaces and
 * checks the digit colours still reach their contrast. Matches the design-tokens policy skip
 * pattern `theme\.[^./]+\.[jt]sx?$`.
 */

export interface SudokuWashes {
  /** The selected cell's row, column and box. */
  readonly peer: string;
  /** Every other cell holding the selected cell's digit; stronger than `peer`, which it replaces. */
  readonly same: string;
  /** A cell whose digit duplicates one in its row, column or box. */
  readonly conflict: string;
}

export const SUDOKU_WASHES = {
  dark: {
    peer: "rgba(143,245,255,0.11)",
    same: "rgba(143,245,255,0.22)",
    conflict: "rgba(255,113,108,0.16)",
  },
  light: {
    peer: "rgba(27,197,212,0.15)",
    same: "rgba(27,197,212,0.30)",
    conflict: "rgba(217,74,66,0.14)",
  },
} as const satisfies Record<"dark" | "light", SudokuWashes>;
