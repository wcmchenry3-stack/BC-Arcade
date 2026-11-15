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

/** The parts of a press event's `nativeEvent` that locate it inside the board. */
export interface BoardPressPoint {
  locationX?: number;
  offsetX?: number;
}

/**
 * A press on the board as a drop x in world units, kept between the walls, or null when the
 * press has no usable x. iOS and Android report `locationX`. react-native-web's mouse and touch
 * presses do not, so the web reads the DOM `offsetX` instead (the board canvas, the press's only
 * child, fills the pressable). Without it the drop x was NaN, which broke the physics world and
 * no piece ever fell on the web.
 */
export function tapToWorldX(point: BoardPressPoint, scale: number): number | null {
  const px = Number.isFinite(point.locationX) ? point.locationX : point.offsetX;
  if (px === undefined || !Number.isFinite(px) || !(scale > 0)) return null;
  return Math.max(WALL_THICKNESS, Math.min(WORLD_WIDTH - WALL_THICKNESS, px / scale));
}
