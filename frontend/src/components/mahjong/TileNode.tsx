/**
 * The native board's tiles (#2962, #3613): one memoised node per tile, and the match and win
 * effects drawn over them.
 *
 * A tile at rest is plain rects with fixed transforms; it re-renders only when its own look
 * changes. A tile in an animation (`TileMotion`) draws the same rects, at rest, inside a group
 * whose transform, opacity and glows follow the animation's progress on the UI thread
 * (`useDerivedValue`), so a running animation renders no React at all.
 */
import React, { memo } from "react";
import { BlurMask, Group, Image, Path, Rect, Skia } from "@shopify/react-native-skia";
import type { SkImage, Transforms3d } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";

import type { BoardCamera } from "../../game/mahjong/layout";
import type { SlotTile } from "../../game/mahjong/types";
import {
  burstSparks,
  cascadeSparks,
  matchTileLook,
  restLook,
  tileLook,
} from "../../game/mahjong/motion";
import type { MotionClock, Spark, TileMotion } from "../../game/mahjong/motion";
import type { MatchGhost, WinCascade } from "../../game/mahjong/useBoardMotion";
import { ART_INSET } from "./tileFaces";
import {
  MAHJONG_BORDER_NORMAL,
  MAHJONG_BORDER_SELECTED,
  MAHJONG_DEADLOCK_DIM,
  MAHJONG_FACE_LOADING,
  MAHJONG_GLOW_BG,
  MAHJONG_HINT_COLOR,
  MAHJONG_HINT_GLOW_BG,
  MAHJONG_LOCK_TINT,
  MAHJONG_SIDE_B,
  MAHJONG_SIDE_IVORY,
  MAHJONG_SIDE_R,
  MAHJONG_SPARK,
  MAHJONG_SUIT_COLOR as SUIT_COLOR,
  MAHJONG_SUIT_FALLBACK,
  MAHJONG_TILE_FACE,
  MAHJONG_TILE_FACE_LOCKED,
  MAHJONG_TILE_FACE_SELECTED,
  MAHJONG_TILE_SHADOW,
} from "../../theme/theme.mahjong";

/** Blur of the cast shadow (Skia sigma, board units). */
const SHADOW_BLUR = 3;
/** How much further the shadow falls under a lifted tile, in sides. */
const LIFT_SHADOW = 0.6;
/** Sparks per match burst. */
const BURST_SPARKS = 10;
/** Sparks in the win cascade. */
const CASCADE_SPARKS = 48;

type Num = number | SharedValue<number>;

/** The soft shadow the tile casts down-right onto the layer below (#3612). */
function shadowOffsetOf(camera: BoardCamera): number {
  return Math.round(camera.sideWidth * 1.3);
}

/** How far a selected tile lifts, up and right, in proportion to its size. */
function liftOffset(camera: BoardCamera): { x: number; y: number } {
  return {
    x: Math.round(camera.tileWidth * (4 / 44)),
    y: -Math.round(camera.tileHeight * (5 / 56)),
  };
}

// ---------------------------------------------------------------------------
// The rects of one tile
// ---------------------------------------------------------------------------

function TileFaceLayer({
  face,
  suit,
  x,
  y,
  w,
  h,
  opacity,
}: {
  face: SkImage | null;
  suit: string;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
}) {
  if (!face) {
    const fallbackColor = SUIT_COLOR[suit] ?? MAHJONG_SUIT_FALLBACK;
    return (
      <Rect
        x={x + 6}
        y={y + 8}
        width={w - 12}
        height={h - 16}
        color={fallbackColor}
        opacity={opacity}
      />
    );
  }
  // Full opacity even on locked tiles: the locked shade drawn over it darkens it (#3612).
  return <Image image={face} x={x} y={y} width={w} height={h} fit="fill" opacity={1} />;
}

interface TileRectsProps {
  tile: SlotTile;
  camera: BoardCamera;
  face: SkImage | null;
  isSelected: boolean;
  isFree: boolean;
  isHint: boolean;
  debugShowFree: boolean;
  /** Draw the selected lift into the rects (a tile at rest); an animated tile lifts by transform. */
  liftedRects: boolean;
  /** The cast shadow's extra offset under a lifted tile (static); see `shadowAt`. */
  shadowShift: number;
  /** An animated tile's shadow position, overriding the static one. */
  shadowAt?: { x: SharedValue<number>; y: SharedValue<number> };
  /** The selected glow's opacity; none when undefined. */
  glow?: Num;
  /** The hint glow's opacity; none when undefined. */
  hintGlow?: Num;
  /** The deadlock dim's opacity; none when undefined. */
  dim?: Num;
}

function TileRects({
  tile,
  camera,
  face,
  isSelected,
  isFree,
  isHint,
  debugShowFree,
  liftedRects,
  shadowShift,
  shadowAt,
  glow,
  hintGlow,
  dim,
}: TileRectsProps) {
  const { faceWidth, faceHeight, sideWidth } = camera;
  const at = camera.tileToScreen(tile.col, tile.row, tile.layer);
  const lift = liftedRects && isSelected ? liftOffset(camera) : { x: 0, y: 0 };
  const x = at.x + lift.x;
  const y = at.y + lift.y;
  // 2 px border on selected for visibility at small tile sizes.
  const borderInset = isSelected ? 2 : 1;
  const borderColor = isSelected
    ? MAHJONG_BORDER_SELECTED
    : isHint
      ? MAHJONG_HINT_COLOR
      : MAHJONG_BORDER_NORMAL;
  const faceColor = isSelected
    ? MAHJONG_TILE_FACE_SELECTED
    : isFree
      ? MAHJONG_TILE_FACE
      : MAHJONG_TILE_FACE_LOCKED;
  const shadowOffset = shadowOffsetOf(camera);
  // The ivory band of the side, next to the face; the rest of the side is bone.
  const ivory = Math.max(1, Math.round(sideWidth * 0.4));
  const ivoryInset = Math.round(sideWidth * 0.3);

  return (
    <>
      {/* Cast shadow */}
      <Rect
        x={shadowAt?.x ?? x + shadowOffset + shadowShift}
        y={shadowAt?.y ?? y + shadowOffset + shadowShift}
        width={faceWidth}
        height={faceHeight}
        color={MAHJONG_TILE_SHADOW}
      >
        <BlurMask blur={SHADOW_BLUR} style="normal" />
      </Rect>
      {/* Gold glow behind the selected tile */}
      {glow !== undefined && (
        <Rect
          x={x - 3}
          y={y - 3}
          width={faceWidth + 6}
          height={faceHeight + 6}
          color={MAHJONG_GLOW_BG}
          opacity={glow}
        />
      )}
      {/* Blue glow behind matching free tiles and the hint */}
      {hintGlow !== undefined && (
        <Rect
          x={x - 4}
          y={y - 4}
          width={faceWidth + 8}
          height={faceHeight + 8}
          color={MAHJONG_HINT_GLOW_BG}
          opacity={hintGlow}
        />
      )}
      {/* Right and bottom sides: bone, the corner, then the ivory band next to the face */}
      <Rect
        x={x + faceWidth}
        y={y + sideWidth}
        width={sideWidth}
        height={faceHeight}
        color={MAHJONG_SIDE_R}
      />
      <Rect
        x={x + sideWidth}
        y={y + faceHeight}
        width={faceWidth}
        height={sideWidth}
        color={MAHJONG_SIDE_B}
      />
      <Rect
        x={x + faceWidth}
        y={y + faceHeight}
        width={sideWidth}
        height={sideWidth}
        color={MAHJONG_SIDE_B}
      />
      <Rect
        x={x + faceWidth}
        y={y + ivoryInset}
        width={ivory}
        height={faceHeight}
        color={MAHJONG_SIDE_IVORY}
      />
      <Rect
        x={x + ivoryInset}
        y={y + faceHeight}
        width={faceWidth}
        height={ivory}
        color={MAHJONG_SIDE_IVORY}
      />
      {/* Border */}
      <Rect x={x} y={y} width={faceWidth} height={faceHeight} color={borderColor} />
      {/* Face */}
      <Rect
        x={x + borderInset}
        y={y + borderInset}
        width={faceWidth - 2 * borderInset}
        height={faceHeight - 2 * borderInset}
        color={faceColor}
      />
      {/* Face art */}
      <TileFaceLayer
        face={face}
        suit={tile.suit}
        x={x + ART_INSET}
        y={y + ART_INSET}
        w={faceWidth - 2 * ART_INSET}
        h={faceHeight - 2 * ART_INSET}
        opacity={isFree ? 1 : 0.35}
      />
      {/* Locked: a light warm shade over the face and art, never a wash-out (#3612) */}
      {!isFree && !isSelected && (
        <Rect
          x={x + borderInset}
          y={y + borderInset}
          width={faceWidth - 2 * borderInset}
          height={faceHeight - 2 * borderInset}
          color={MAHJONG_LOCK_TINT}
        />
      )}
      {/* Deadlock: the locked tiles dim briefly (#3613) */}
      {dim !== undefined && (
        <Rect
          x={x}
          y={y}
          width={faceWidth}
          height={faceHeight}
          color={MAHJONG_DEADLOCK_DIM}
          opacity={dim}
        />
      )}
      {/* Debug: green tint over free tiles when dev overlay is active */}
      {debugShowFree && isFree && (
        <Rect
          x={x + ART_INSET}
          y={y + ART_INSET}
          width={faceWidth - 2 * ART_INSET}
          height={faceHeight - 2 * ART_INSET}
          color={MAHJONG_FACE_LOADING}
          opacity={0.3}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// One tile
// ---------------------------------------------------------------------------

export interface TileNodeProps {
  tile: SlotTile;
  camera: BoardCamera;
  face: SkImage | null;
  isSelected: boolean;
  isFree: boolean;
  isHint: boolean;
  debugShowFree: boolean;
  /** Board space to canvas pixels (the canvas's `boardResolution`). */
  res: number;
  /** Its animations, when it is in any (#3613). */
  motion?: TileMotion;
}

/** `[scale res, then scale s about (cx, cy) after moving by (dx, dy)]`, as Skia transforms. */
function lookTransform(
  res: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  s: number
): Transforms3d {
  "worklet";
  return [
    { scale: res },
    { translateX: cx + dx },
    { translateY: cy + dy },
    { scale: s },
    { translateX: -cx },
    { translateY: -cy },
  ];
}

const RestTile = memo(function RestTile(props: Omit<TileNodeProps, "motion">) {
  const { tile, camera, isSelected, isHint, res } = props;
  const at = camera.tileToScreen(tile.col, tile.row, tile.layer);
  const cx = at.x + camera.faceWidth / 2;
  const cy = at.y + camera.faceHeight / 2;
  // The selected tile: lifted (in its rects), a little larger, its shadow further down.
  const look = restLook(isSelected);
  const transform = isSelected ? lookTransform(res, cx, cy, 0, 0, look.scale) : [{ scale: res }];
  return (
    <Group transform={transform}>
      <TileRects
        {...props}
        liftedRects
        shadowShift={isSelected ? camera.sideWidth * LIFT_SHADOW : 0}
        glow={isSelected ? 1 : undefined}
        hintGlow={isHint ? 1 : undefined}
      />
    </Group>
  );
});

/** A progress, or done when the channel is absent. */
function prog(c: MotionClock | undefined): number {
  "worklet";
  return c ? c.progress.value : 1;
}

const MovingTile = memo(function MovingTile(props: TileNodeProps & { motion: TileMotion }) {
  const { tile, camera, isSelected, isHint, res, motion: m } = props;
  const at = camera.tileToScreen(tile.col, tile.row, tile.layer);
  const cx = at.x + camera.faceWidth / 2;
  const cy = at.y + camera.faceHeight / 2;
  const { tileWidth: tw, tileHeight: th, sideWidth } = camera;
  const off = liftOffset(camera);
  const look = useDerivedValue(() =>
    tileLook(
      m,
      isSelected,
      {
        lift: prog(m.lift),
        shake: prog(m.shake),
        hint: prog(m.hint),
        deal: prog(m.deal),
        shuffle: prog(m.shuffle),
        dim: prog(m.dim),
      },
      tw,
      th
    )
  );
  const transform = useDerivedValue(() => {
    const l = look.value;
    return lookTransform(res, cx, cy, l.dx + l.lift * off.x, l.dy + l.lift * off.y, l.scale);
  });
  const opacity = useDerivedValue(() => look.value.alpha);
  const lift = useDerivedValue(() => look.value.lift);
  const shadow = shadowOffsetOf(camera);
  const shadowX = useDerivedValue(() => at.x + shadow + look.value.lift * sideWidth * LIFT_SHADOW);
  const shadowY = useDerivedValue(() => at.y + shadow + look.value.lift * sideWidth * LIFT_SHADOW);
  const hint = useDerivedValue(() => look.value.hintGlow);
  const dim = useDerivedValue(() => look.value.dim);
  return (
    <Group transform={transform} opacity={opacity}>
      <TileRects
        {...props}
        liftedRects={false}
        shadowShift={0}
        shadowAt={{ x: shadowX, y: shadowY }}
        glow={lift}
        hintGlow={m.hint ? hint : isHint ? 1 : undefined}
        dim={m.dim ? dim : undefined}
      />
    </Group>
  );
});

export const TileNode = memo(function TileNode({ motion, ...props }: TileNodeProps) {
  return motion ? <MovingTile {...props} motion={motion} /> : <RestTile {...props} />;
});

// ---------------------------------------------------------------------------
// A matched pair's flight and burst, and the win cascade
// ---------------------------------------------------------------------------

function sparksPath(sparks: readonly Spark[]) {
  "worklet";
  const builder = Skia.PathBuilder.Make();
  for (const s of sparks) builder.addCircle(s.x, s.y, s.r);
  return builder.detach();
}

function GhostTile({
  ghost,
  index,
  camera,
  face,
  res,
}: {
  ghost: MatchGhost;
  index: 0 | 1;
  camera: BoardCamera;
  face: SkImage | null;
  res: number;
}) {
  const tile = ghost.tiles[index];
  const other = ghost.tiles[index === 0 ? 1 : 0];
  const a = camera.tileToScreen(tile.col, tile.row, tile.layer);
  const b = camera.tileToScreen(other.col, other.row, other.layer);
  const meetX = (a.x + b.x) / 2;
  const meetY = (a.y + b.y) / 2;
  // The left one stays left, so they meet face to face.
  const side = a.x < b.x || (a.x === b.x && index === 0) ? -1 : 1;
  const { faceWidth: fw, faceHeight: fh } = camera;
  const p = ghost.clock.progress;
  const look = useDerivedValue(() => matchTileLook(p.value, a.x, a.y, meetX, meetY, side, fw));
  const transform = useDerivedValue(() => {
    const l = look.value;
    return lookTransform(res, a.x + fw / 2, a.y + fh / 2, l.x - a.x, l.y - a.y, l.scale);
  });
  const opacity = useDerivedValue(() => look.value.alpha);
  const glow = useDerivedValue(() => look.value.lift);
  return (
    <Group transform={transform} opacity={opacity}>
      <TileRects
        tile={tile}
        camera={camera}
        face={face}
        isSelected
        isFree
        isHint={false}
        debugShowFree={false}
        liftedRects={false}
        shadowShift={0}
        glow={glow}
      />
    </Group>
  );
}

export function MatchGhostNode({
  ghost,
  camera,
  faces,
  res,
}: {
  ghost: MatchGhost;
  camera: BoardCamera;
  faces: readonly (SkImage | null)[] | null;
  res: number;
}) {
  const [t1, t2] = ghost.tiles;
  const a = camera.tileToScreen(t1.col, t1.row, t1.layer);
  const b = camera.tileToScreen(t2.col, t2.row, t2.layer);
  const mx = (a.x + b.x + camera.faceWidth) / 2;
  const my = (a.y + b.y + camera.faceHeight) / 2;
  const reach = camera.faceWidth * 1.4;
  const p = ghost.clock.progress;
  const path = useDerivedValue(() => sparksPath(burstSparks(p.value, mx, my, reach, BURST_SPARKS)));
  return (
    <>
      <GhostTile
        ghost={ghost}
        index={0}
        camera={camera}
        face={faces?.[t1.faceId - 1] ?? null}
        res={res}
      />
      <GhostTile
        ghost={ghost}
        index={1}
        camera={camera}
        face={faces?.[t2.faceId - 1] ?? null}
        res={res}
      />
      <Group transform={[{ scale: res }]}>
        <Path path={path} color={MAHJONG_SPARK} />
      </Group>
    </>
  );
}

export function WinCascadeNode({
  cascade,
  camera,
  res,
}: {
  cascade: WinCascade;
  camera: BoardCamera;
  res: number;
}) {
  const { x, y, clock } = cascade;
  const { boardWidth: w, boardHeight: h } = camera;
  const p = clock.progress;
  const path = useDerivedValue(() =>
    sparksPath(cascadeSparks(p.value, x, y, w, h, CASCADE_SPARKS))
  );
  return (
    <Group transform={[{ scale: res }]}>
      <Path path={path} color={MAHJONG_SPARK} />
    </Group>
  );
}
