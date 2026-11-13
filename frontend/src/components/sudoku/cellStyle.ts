/**
 * Sudoku cell styling that is pure, so a test can check the contrast of what ships (#3773): the
 * background a cell paints from its base surface and the washes laid over it, and the sizes of its
 * digit and notes, which scale with the cell.
 */

type Rgba = readonly [number, number, number, number];

/** `#rrggbb` or `rgba(r,g,b,a)` (the only forms the theme uses for a surface or a wash). */
export function parseColor(color: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(color);
  if (!m) throw new Error(`Unsupported colour: ${color}`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
}

const toHex = (n: number) => Math.round(n).toString(16).padStart(2, "0");

/** The opaque colour the washes make over `base`, first wash lowest. */
export function composite(base: string, ...washes: readonly string[]): string {
  let [r, g, b] = parseColor(base);
  for (const wash of washes) {
    const [wr, wg, wb, a] = parseColor(wash);
    r = a * wr + (1 - a) * r;
    g = a * wg + (1 - a) * g;
    b = a * wb + (1 - a) * b;
  }
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export interface CellBackgroundInput {
  readonly base: string;
  /** The solid fill of the selected cell (the theme accent). */
  readonly selectedFill: string;
  readonly washes: { readonly peer: string; readonly same: string; readonly conflict: string };
  readonly selected: boolean;
  readonly peer: boolean;
  readonly sameDigit: boolean;
  readonly conflict: boolean;
}

/**
 * What a cell paints behind its digit: solid for the selected cell, else one wash over the base,
 * the strongest that applies (conflict, then the selected digit, then row/column/box). One wash,
 * not a stack, so the digit colours keep their contrast (theme.sudoku.ts).
 */
export function cellBackground(i: CellBackgroundInput): string {
  if (i.selected) return i.selectedFill;
  if (i.conflict) return composite(i.base, i.washes.conflict);
  if (i.sameDigit) return composite(i.base, i.washes.same);
  if (i.peer) return composite(i.base, i.washes.peer);
  return i.base;
}

/** Digit and note sizes for a cell `cellPx` wide: the digit fills ~60%, a note is a third of the cell. */
export function cellMetrics(cellPx: number) {
  const digit = Math.max(12, Math.round(cellPx * 0.6));
  const note = Math.max(7, Math.round(cellPx * 0.26 * 10) / 10);
  return {
    digit,
    note,
    /** The underline under a wrong digit. */
    markThickness: Math.max(2, Math.round(cellPx * 0.07)),
    markGap: Math.round(cellPx * 0.06),
  };
}

/** The smallest board drawn; below it the play area scrolls rather than shrink the board further. */
export const MIN_BOARD = 120;

export interface BoardFit {
  readonly size: number;
  /** False when even the smallest board does not fit: the caller scrolls the area instead. */
  readonly fits: boolean;
}

/**
 * The board's side in points: as wide as the area and as tall as the height left under the HUD
 * allow, never more than that space (so it cannot overlap the HUD or the header). Under
 * `MIN_BOARD` it stays at `MIN_BOARD`, with `fits: false`.
 */
export function boardFit(areaW: number, areaH: number, hudH: number): BoardFit {
  const space = Math.floor(Math.min(areaW, areaH - hudH));
  return space >= MIN_BOARD ? { size: space, fits: true } : { size: MIN_BOARD, fits: false };
}
