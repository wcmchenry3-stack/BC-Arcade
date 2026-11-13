// Tile must render at least this many logical pixels to be comfortably readable.
// Tunable — candidate for a future "larger tiles" accessibility preference.
export const MIN_READABLE_TILE_PX = 48;

/**
 * A layout whose tiles are narrower than this at fit opens zoomed in (#3612). Owner's call: 24
 * (not the story's 26), so on a 390-wide phone only the five widest layouts (Butterfly, Fish,
 * Spider, Snowflake, Double Pyramid, ~22 px) open zoomed; 26 would have caught 21 of 25.
 */
export const OPENING_ZOOM_TILE_PX = 24;

/** Whether a board this camera fits opens zoomed in on its top-left corner (#3612). */
export function opensZoomedIn(cameraScale: number, tileWidth: number): boolean {
  return cameraScale * tileWidth < OPENING_ZOOM_TILE_PX;
}

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
 * The board's max zoom, never below 1. #3611 drew the native canvas at this many times the
 * board's size and shrank it with a View transform; #3684 removed that (iOS stopped presenting
 * the oversized layer and aliased it). Production now draws the canvas at the board's size, and
 * this value only sets the face raster scale (`tileFaces.ts`) and, in test builds, the old
 * renderer (`renderDiag.ts`).
 */
export function boardResolution(cameraScale: number, tileWidth: number): number {
  return Math.max(1, computeZoomBounds(cameraScale, tileWidth).maxZoom);
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

/** A rectangle in board space (the board view's own, unzoomed coordinates). */
export interface BoardRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The zoom and offset that fit `rect` into the viewport (#3612): as large as fits, kept
 * between `minZoom` (the whole board) and `maxZoom` (readable tiles, the canvas's resolution),
 * centred on the rect, with the offset kept inside the pan bounds at that zoom. The board
 * view is centred in the viewport and scaled about its centre, so an offset of 0 centres the
 * board.
 */
export function fitRect(
  rect: BoardRect,
  boardWidth: number,
  boardHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  minZoom: number,
  maxZoom: number
): { scale: number; translateX: number; translateY: number } {
  "worklet";
  const fit = Math.min(
    viewportWidth / Math.max(1, rect.width),
    viewportHeight / Math.max(1, rect.height)
  );
  const scale = clamp(fit, minZoom, Math.max(minZoom, maxZoom));
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const { maxTranslateX, maxTranslateY } = computePanBounds(
    boardWidth,
    boardHeight,
    viewportWidth,
    viewportHeight,
    scale
  );
  return {
    scale,
    translateX: clamp(-scale * (cx - boardWidth / 2), -maxTranslateX, maxTranslateX),
    translateY: clamp(-scale * (cy - boardHeight / 2), -maxTranslateY, maxTranslateY),
  };
}

/**
 * The zoom and offset that show board point (x, y) at the viewport's centre at `scale`
 * (#3612, double-tap), the offset kept inside the pan bounds.
 */
export function zoomToPoint(
  x: number,
  y: number,
  scale: number,
  boardWidth: number,
  boardHeight: number,
  viewportWidth: number,
  viewportHeight: number
): { scale: number; translateX: number; translateY: number } {
  "worklet";
  const { maxTranslateX, maxTranslateY } = computePanBounds(
    boardWidth,
    boardHeight,
    viewportWidth,
    viewportHeight,
    scale
  );
  return {
    scale,
    translateX: clamp(-scale * (x - boardWidth / 2), -maxTranslateX, maxTranslateX),
    translateY: clamp(-scale * (y - boardHeight / 2), -maxTranslateY, maxTranslateY),
  };
}
