/**
 * #2963: display-list colours as packed `0xAARRGGBB` numbers.
 *
 * `Skia.Color` takes a number as-is (no CSS parsing), so `buildFrame` emits numbers and the
 * UI-thread replay never parses a colour string. Alpha is stored as a byte, so a computed alpha
 * lands on the nearest 1/255 — finer than the 0.001 steps the old `rgba(…, a.toFixed(3))`
 * strings used to quantise to, as far as the eye can tell.
 */

/** 0xAARRGGBB. */
export type PackedColor = number;

/** Pack a 0xRRGGBB colour with an alpha in 0–1 (clamped, like CSS) into 0xAARRGGBB. */
export function withAlpha(rgb: number, alpha: number): PackedColor {
  const a = alpha <= 0 ? 0 : alpha >= 1 ? 255 : Math.round(alpha * 255);
  return ((a << 24) | (rgb & 0xffffff)) >>> 0;
}

/** The 0–1 alpha of a packed colour. */
export function alphaOf(c: PackedColor): number {
  return ((c >>> 24) & 255) / 255;
}

/** A packed colour as a CSS `rgba()` string — for the 2D-context (web) replay only. */
export function cssColor(c: PackedColor): string {
  const a = Math.round(alphaOf(c) * 1000) / 1000;
  return `rgba(${(c >>> 16) & 255},${(c >>> 8) & 255},${c & 255},${a})`;
}
