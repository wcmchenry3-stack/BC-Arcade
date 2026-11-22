/**
 * Cascade layout (#3693, #2229): how the fixed physics world (`WORLD_WIDTH` x `WORLD_HEIGHT`,
 * constants.ts) is scaled into the space the screen measured for the board.
 *
 * Pure and headless, like `game/mahjong/layout.ts`: the screen measures the board area
 * (`onLayout`) and calls `calculateCascadeLayout` with it, then draws, hit-tests and places
 * merge bursts from the result. The physics never sees the scale; it always runs in world units.
 */
import { WALL_THICKNESS, WORLD_HEIGHT, WORLD_WIDTH } from "./constants";

export interface CascadeLayoutInput {
  /** The measured width of the board area, in px (0 before the first layout). */
  readonly containerWidth: number;
  /** The measured height of the board area, in px (0 before the first layout). */
  readonly containerHeight: number;
}

export interface CascadeLayout {
  /** px per world unit: the world fitted whole inside the area. 0 until the area is measured. */
  readonly scale: number;
  /** The drawn board's size in px (`WORLD_* x scale`). */
  readonly boardWidth: number;
  readonly boardHeight: number;
  /** Left edge of the board in the area (it is centred horizontally). */
  readonly offsetX: number;
  /**
   * Top edge of the board in the area. The world is bottom-anchored (`areaH - boardHeight`), so
   * the bin's floor is the bottom of the area and any spare height sits above the bin.
   */
  readonly offsetY: number;
}

export function calculateCascadeLayout({
  containerWidth,
  containerHeight,
}: CascadeLayoutInput): CascadeLayout {
  const scale =
    containerWidth > 0 && containerHeight > 0
      ? Math.min(containerWidth / WORLD_WIDTH, containerHeight / WORLD_HEIGHT)
      : 0;
  return {
    scale,
    boardWidth: WORLD_WIDTH * scale,
    boardHeight: WORLD_HEIGHT * scale,
    offsetX: (containerWidth - WORLD_WIDTH * scale) / 2,
    offsetY: containerHeight - WORLD_HEIGHT * scale,
  };
}

/**
 * A point on the board (px from the board view's left edge) as a drop x in world units, kept
 * between the walls, or null when it has no usable x or the board has no size yet. A worklet: the
 * aim gesture (#3928) calls it on the UI thread. #3922's rule stands: a non-finite x never becomes
 * a drop (a NaN x broke the physics world and no piece fell on the web). Since #3928 the x comes
 * from react-native-gesture-handler's event, which reports it on iOS, Android and web alike (the
 * old Pressable path needed the DOM `offsetX` on web).
 */
export function boardPxToWorldX(px: number | undefined, scale: number): number | null {
  "worklet";
  if (px === undefined || !Number.isFinite(px) || !(scale > 0)) return null;
  return Math.max(WALL_THICKNESS, Math.min(WORLD_WIDTH - WALL_THICKNESS, px / scale));
}
