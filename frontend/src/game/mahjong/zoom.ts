// Tile must render at least this many logical pixels to be comfortably readable.
// Tunable — candidate for a future "larger tiles" accessibility preference.
export const MIN_READABLE_TILE_PX = 48;

// Always allow at least this multiplier above minZoom so zoom-in is available
// even on large screens where tiles already exceed MIN_READABLE_TILE_PX.
export const MIN_ZOOM_HEADROOM = 1.5;

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

/**
 * Compute the maximum allowed pan translation for each axis at a given zoom level.
 *
 * At minZoom the board fits the viewport exactly, so both bounds are 0.
 * At higher zoom levels the board overflows the viewport; the board edge may
 * travel at most halfExcess pixels from center before it crosses the viewport
 * edge and the black background becomes visible.
 */
export function computePanBounds(
  boardWidth: number,
  boardHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  scale: number
): { maxTranslateX: number; maxTranslateY: number } {
  "worklet";
  return {
    maxTranslateX: Math.max(0, (boardWidth * scale - viewportWidth) / 2),
    maxTranslateY: Math.max(0, (boardHeight * scale - viewportHeight) / 2),
  };
}

export function clamp(value: number, min: number, max: number): number {
  "worklet";
  return Math.min(Math.max(value, min), max);
}
