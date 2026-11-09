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

/** Distinct CSS strings kept before the cache starts over (fading alphas add a few per frame). */
const CSS_CACHE_MAX = 1024;
const cssCache = new Map<PackedColor, string>();

/**
 * A packed colour as a CSS `rgba()` string — for the 2D-context (web) replay only. #3597: each
 * distinct colour is formatted once and kept, so replaying the same ops builds no new strings.
 */
export function cssColor(c: PackedColor): string {
  let css = cssCache.get(c);
  if (css === undefined) {
    const a = Math.round(alphaOf(c) * 1000) / 1000;
    css = `rgba(${(c >>> 16) & 255},${(c >>> 8) & 255},${c & 255},${a})`;
    if (cssCache.size >= CSS_CACHE_MAX) cssCache.clear();
    cssCache.set(c, css);
  }
  return css;
}

/** A 0xRRGGBB colour as a fully opaque packed 0xFFRRGGBB. */
export function opaque(rgb: number): PackedColor {
  return (0xff000000 | (rgb & 0xffffff)) >>> 0;
}

/** Parse a `#rrggbb` string (the theme's form) to 0xRRGGBB. */
export function rgbFromHex(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

/** A 0xRRGGBB colour as a `#rrggbb` string — for the 2D-context (web) canvas. */
export function cssHex(rgb: number): string {
  return `#${(rgb & 0xffffff).toString(16).padStart(6, "0")}`;
}

/** A 0xRRGGBB colour with an alpha in 0–1 as a CSS `rgba()` string — web canvas, alpha kept as is. */
export function cssRgba(rgb: number, alpha: number): string {
  return `rgba(${(rgb >>> 16) & 255},${(rgb >>> 8) & 255},${rgb & 255},${alpha})`;
}
