// Tile must render at least this many logical pixels to be comfortably readable.
// Tunable — candidate for a future "larger tiles" accessibility preference.
export const MIN_READABLE_TILE_PX = 48;

// Always allow at least this multiplier above minZoom so zoom-in is available
// even on large screens where tiles already exceed MIN_READABLE_TILE_PX.
export const MIN_ZOOM_HEADROOM = 1.5;

// Resistance factor for rubber-band overshoot past zoom limits (0 = rigid, 1 = no resistance).
export const RUBBER_FACTOR = 0.3;

/**
 * Compute the [minZoom, maxZoom] bounds for the board gesture layer.
 *
 * minZoom = cameraScale (fit-to-screen — full board always visible).
 * maxZoom = whichever is larger:
 *   - cameraScale × MIN_ZOOM_HEADROOM (always allow some zoom-in)
 *   - MIN_READABLE_TILE_PX / tileWidth (tiles reach 48px at max zoom)
 */
export function computeZoomBounds(
  cameraScale: number,
  tileWidth: number
): { minZoom: number; maxZoom: number } {
  const minZoom = cameraScale;
  const maxZoom = Math.max(cameraScale * MIN_ZOOM_HEADROOM, MIN_READABLE_TILE_PX / tileWidth);
  return { minZoom, maxZoom };
}

export function clamp(value: number, min: number, max: number): number {
  "worklet";
  return Math.min(Math.max(value, min), max);
}

export function rubberClamp(value: number, min: number, max: number): number {
  "worklet";
  if (value < min) return min + (value - min) * RUBBER_FACTOR;
  if (value > max) return max + (value - max) * RUBBER_FACTOR;
  return value;
}
