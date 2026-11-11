/**
 * The lid and the danger state on the Cascade board (#3694). Skia elements, drawn inside the
 * board's scaled `Group` (world units), from the pure mappings in `game/cascade/lidVisuals.ts`:
 *
 *   - `LidLine`: the solid lid across the bin, reddening as the count runs;
 *   - `OverLidWash`: a red wash and outline on a piece over the lid while the count runs;
 *   - `Spawner`: the queue's current piece above the lid inside a clock ring that drains
 *     clockwise with `dangerRatio`; a dashed, faded ghost while a drop is not allowed.
 *
 * No animation of its own: the board re-renders every frame with the engine's state, so the ring
 * follows `dangerRatio` frame by frame. Motion polish is #3701.
 */
import React from "react";
import {
  BlurMask,
  Circle,
  DashPathEffect,
  Group,
  Image as SkiaImage,
  Line as SkiaLine,
  Path,
} from "@shopify/react-native-skia";
import type { SkImage } from "@shopify/react-native-skia";
import type { CascadeLidPalette } from "../../theme/theme.cascade";
import {
  GHOST_FILL_OPACITY,
  GHOST_OUTLINE_OPACITY,
  LID_LINE,
  OVER_LID_OUTLINE_OPACITY,
  OVER_LID_OUTLINE_WIDTH,
  RING_TRACK_OPACITY,
  SPAWNER,
  lidColor,
  overLidWash,
  ringArcPath,
  ringState,
  spawnerPieceRadius,
} from "../../game/cascade/lidVisuals";

export function LidLine({
  dangerRatio,
  palette,
}: {
  dangerRatio: number;
  palette: CascadeLidPalette;
}) {
  return (
    <SkiaLine
      p1={{ x: LID_LINE.x1, y: LID_LINE.y }}
      p2={{ x: LID_LINE.x2, y: LID_LINE.y }}
      color={lidColor(dangerRatio, palette)}
      strokeWidth={LID_LINE.strokeWidth}
      strokeCap="round"
    />
  );
}

export function OverLidWash({
  x,
  y,
  radius,
  dangerRatio,
  palette,
}: {
  x: number;
  y: number;
  radius: number;
  dangerRatio: number;
  palette: CascadeLidPalette;
}) {
  const wash = overLidWash({ y }, radius, dangerRatio);
  if (!wash) return null;
  return (
    <Group>
      <Circle cx={x} cy={y} r={radius} color={palette.danger} opacity={wash.opacity} />
      <Circle
        cx={x}
        cy={y}
        r={radius - OVER_LID_OUTLINE_WIDTH / 2}
        color={palette.danger}
        opacity={OVER_LID_OUTLINE_OPACITY}
        style="stroke"
        strokeWidth={OVER_LID_OUTLINE_WIDTH}
      />
    </Group>
  );
}

export function Spawner({
  dangerRatio,
  canDrop,
  palette,
  piece,
}: {
  dangerRatio: number;
  canDrop: boolean;
  palette: CascadeLidPalette;
  /**
   * The queue's current piece: its physics radius, sprite (null until decoded) and colour.
   * `imageScale` is the sprite's half-size per unit of radius (baked sprites carry padding; the
   * board sizes them the same way).
   */
  piece: { radius: number; image: SkImage | null; imageScale: number; color: string } | null;
}) {
  const { cx, cy, ringRadius, ringWidth } = SPAWNER;
  const ring = ringState(dangerRatio, palette);
  const r = piece ? spawnerPieceRadius(piece.radius) : SPAWNER.maxPieceRadius;
  const pieceOpacity = canDrop ? 1 : GHOST_FILL_OPACITY;
  const half = piece ? r * piece.imageScale : r;

  return (
    <Group>
      {piece &&
        (piece.image ? (
          <SkiaImage
            image={piece.image}
            x={cx - half}
            y={cy - half}
            width={half * 2}
            height={half * 2}
            fit="contain"
            opacity={pieceOpacity}
          />
        ) : (
          <Circle cx={cx} cy={cy} r={r} color={piece.color} opacity={pieceOpacity} />
        ))}
      {!canDrop && (
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          color={palette.ink}
          opacity={GHOST_OUTLINE_OPACITY}
          style="stroke"
          strokeWidth={2}
        >
          <DashPathEffect intervals={[4, 4]} />
        </Circle>
      )}
      {/* The ring: a faint track, then what is left of the countdown on top. */}
      <Circle
        cx={cx}
        cy={cy}
        r={ringRadius}
        color={palette.ink}
        opacity={RING_TRACK_OPACITY}
        style="stroke"
        strokeWidth={ringWidth}
      />
      {ring.remaining >= 1 ? (
        <Circle
          cx={cx}
          cy={cy}
          r={ringRadius}
          color={ring.color}
          style="stroke"
          strokeWidth={ringWidth}
        />
      ) : ring.remaining > 0 ? (
        <Path
          path={ringArcPath(cx, cy, ringRadius, ring.sweepDeg)}
          color={ring.color}
          style="stroke"
          strokeWidth={ringWidth}
          strokeCap="round"
        >
          {ring.glow && <BlurMask blur={4} style="solid" />}
        </Path>
      ) : null}
    </Group>
  );
}
