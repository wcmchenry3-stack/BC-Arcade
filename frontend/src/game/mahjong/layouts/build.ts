/**
 * Shared builders for Mahjong layout definitions (#2968).
 *
 * Layouts are the single source of truth for board geometry: each
 * `layouts/<id>.ts` composes these helpers into a flat `Layout`, and
 * `registry.ts` validates every layout with `parseLayout` at module init.
 *
 * Coordinate system: tiles are 2 grid units wide and 1 unit tall, so adjacent
 * tiles in a row step by col ± 2. Stacked tiles share (col, row) and differ
 * only in layer.
 *
 * Slot ORDER is significant: the deal assigns tile faces to slots by index,
 * so every builder emits slots in a fixed, documented order (row-major unless
 * stated otherwise). Reordering builder calls changes every seeded deal.
 */

import type { Slot } from "../types";

export function slot(col: number, row: number, layer: number): Slot {
  return { col, row, layer };
}

/** Column positions `start, start + step, ...` up to and including `stop`. Default step 2 (one tile). */
export function cols(start: number, stop: number, step = 2): number[] {
  const out: number[] = [];
  for (let v = start; v <= stop; v += step) out.push(v);
  return out;
}

/** Row indices `start..stop` inclusive (step 1). */
export function rows(start: number, stop: number): number[] {
  return cols(start, stop, 1);
}

/** Every (col, row) pair on `layer`, row-major: all of `colList` for the first row, then the next row. */
export function grid(
  layer: number,
  colList: readonly number[],
  rowList: readonly number[]
): Slot[] {
  return rowList.flatMap((r) => colList.map((c) => slot(c, r, layer)));
}

/** One row of tiles on `layer`, in `colList` order. */
export function row(layer: number, r: number, colList: readonly number[]): Slot[] {
  return grid(layer, colList, [r]);
}

/** Filled rectangle on `layer`: cols `c0..c1` (step 2) × rows `r0..r1`, row-major. */
export function rect(layer: number, c0: number, c1: number, r0: number, r1: number): Slot[] {
  return grid(layer, cols(c0, c1), rows(r0, r1));
}
