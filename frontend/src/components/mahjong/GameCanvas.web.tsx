/**
 * Mahjong Solitaire — web canvas (Expo Web / browser).
 *
 * Rendered via HTML Canvas 2D.
 * Metro uses this file automatically on the web platform.
 *
 * World→screen conversion is delegated to BoardCamera.tileToScreen().
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { freeTileIds, getMatchingFreeTileIds, hasFreePairs } from "../../game/mahjong/engine";
import type { MahjongState, SlotTile } from "../../game/mahjong/types";
import type { BoardMotion, MatchGhost } from "../../game/mahjong/useBoardMotion";
import {
  burstSparks,
  cascadeSparks,
  clamp01,
  matchTileLook,
  restLook,
  tileLook,
} from "../../game/mahjong/motion";
import type { MotionClock, Spark, TileLook } from "../../game/mahjong/motion";
import { loadTileAssets } from "./tileAssetLoader";
import { boardResolution } from "../../game/mahjong/zoom";
import {
  MAHJONG_BORDER_NORMAL,
  MAHJONG_BORDER_SELECTED,
  MAHJONG_BOARD_BG,
  MAHJONG_DEADLOCK_DIM,
  MAHJONG_FACE_LOADING,
  MAHJONG_GLOW_SHADOW,
  MAHJONG_HINT_COLOR,
  MAHJONG_HINT_GLOW_SHADOW,
  MAHJONG_SIDE_B,
  MAHJONG_SIDE_R,
  MAHJONG_SUIT_COLOR as SUIT_COLOR,
  MAHJONG_SUIT_FALLBACK,
  MAHJONG_TILE_FACE,
  MAHJONG_TILE_FACE_LOCKED,
  MAHJONG_TILE_FACE_SELECTED,
  MAHJONG_SHADOW_CASTER,
  MAHJONG_TILE_SHADOW,
  MAHJONG_SIDE_IVORY,
  MAHJONG_LOCK_TINT,
  MAHJONG_SPARK,
} from "../../theme/theme.mahjong";
import type { BoardCamera } from "../../game/mahjong/layout";

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const BG = MAHJONG_BOARD_BG;
const TILE_FACE = MAHJONG_TILE_FACE;
const TILE_FACE_SELECTED = MAHJONG_TILE_FACE_SELECTED;
const TILE_FACE_LOCKED = MAHJONG_TILE_FACE_LOCKED;
const BORDER_NORMAL = MAHJONG_BORDER_NORMAL;
const BORDER_SELECTED = MAHJONG_BORDER_SELECTED;
const BORDER_HINT = MAHJONG_HINT_COLOR;
const SIDE_R = MAHJONG_SIDE_R;
const SIDE_B = MAHJONG_SIDE_B;
/** How much further the shadow falls under a lifted tile, in sides (as native). */
const LIFT_SHADOW = 0.6;

// ---------------------------------------------------------------------------
// Felt texture
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Hit-testing
// ---------------------------------------------------------------------------

function hitTest(
  tiles: readonly SlotTile[],
  tapX: number,
  tapY: number,
  cam: BoardCamera
): number | null {
  const { faceWidth: fw, faceHeight: fh } = cam;
  const sorted = [...tiles].sort((a, b) => b.layer - a.layer);
  for (const tile of sorted) {
    const { x, y } = cam.tileToScreen(tile.col, tile.row, tile.layer);
    if (tapX >= x && tapX < x + fw && tapY >= y && tapY < y + fh) {
      return tile.id;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Canvas 2D drawing
// ---------------------------------------------------------------------------

/**
 * A tile's cast shadow and its sides (#3612, "classic" depth): the soft shadow falls down-right
 * onto the layer below; the sides are bone, with an ivory band next to the face. Drawn before
 * the outline and face, which cover the shadow's near edge.
 */
function drawTileBody(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  faceWidth: number,
  faceHeight: number,
  sideWidth: number,
  lift = 0
): void {
  // A lifted tile casts its shadow further (#3613).
  const shadowOffset = Math.round(sideWidth * 1.3) + lift * sideWidth * LIFT_SHADOW;
  ctx.shadowColor = MAHJONG_TILE_SHADOW;
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = shadowOffset;
  ctx.shadowOffsetY = shadowOffset;
  ctx.fillStyle = MAHJONG_SHADOW_CASTER;
  ctx.fillRect(x, y, faceWidth, faceHeight);
  ctx.shadowColor = "transparent";

  const ivory = Math.max(1, Math.round(sideWidth * 0.4));
  const ivoryInset = Math.round(sideWidth * 0.3);
  ctx.fillStyle = SIDE_R;
  ctx.fillRect(x + faceWidth, y + sideWidth, sideWidth, faceHeight);
  ctx.fillStyle = SIDE_B;
  ctx.fillRect(x + sideWidth, y + faceHeight, faceWidth, sideWidth);
  ctx.fillRect(x + faceWidth, y + faceHeight, sideWidth, sideWidth);
  ctx.fillStyle = MAHJONG_SIDE_IVORY;
  ctx.fillRect(x + faceWidth, y + ivoryInset, ivory, faceHeight);
  ctx.fillRect(x + ivoryInset, y + faceHeight, faceWidth, ivory);
}

/**
 * A tile's face art, or its suit-colour placeholder while the image loads. SVGs with
 * width="100%" have naturalWidth=0 even when loaded, so the check is for null (the image is
 * only set in onload). A locked tile keeps its art at full strength under a light warm shade
 * (#3612), as native does; only the placeholder is dimmed.
 */
function drawTileArt(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  suitColor: string,
  t: {
    x: number;
    y: number;
    faceWidth: number;
    faceHeight: number;
    inset: number;
    locked: boolean;
    dimPlaceholder: boolean;
  }
): void {
  if (img) {
    ctx.drawImage(img, t.x + 2, t.y + 2, t.faceWidth - 4, t.faceHeight - 4);
  } else {
    // Relative to the tile's own alpha (a tile fading in, #3613).
    const alpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha * (t.dimPlaceholder ? 0.35 : 1);
    ctx.fillStyle = suitColor;
    ctx.fillRect(t.x + 8, t.y + 10, t.faceWidth - 16, t.faceHeight - 20);
    ctx.globalAlpha = alpha;
  }
  if (t.locked) {
    ctx.fillStyle = MAHJONG_LOCK_TINT;
    ctx.fillRect(
      t.x + t.inset,
      t.y + t.inset,
      t.faceWidth - 2 * t.inset,
      t.faceHeight - 2 * t.inset
    );
  }
}

/** A clock's progress at `now` (web runs its own frames; native reads the shared value). */
function progressAt(c: MotionClock | undefined, now: number): number {
  return c ? clamp01((now - c.t0) / c.duration) : 1;
}

/** One tile at `look`: drawn at rest, moved and scaled about its centre. */
function drawTile(
  ctx: CanvasRenderingContext2D,
  tile: SlotTile,
  look: TileLook,
  img: HTMLImageElement | null,
  cam: BoardCamera,
  flags: { selected: boolean; free: boolean; hint: number; debugFree: boolean }
): void {
  const { tileWidth, tileHeight, faceWidth, faceHeight, sideWidth } = cam;
  const { x: rawX, y: rawY } = cam.tileToScreen(tile.col, tile.row, tile.layer);
  const x = Math.round(rawX);
  const y = Math.round(rawY);
  const liftX = Math.round(tileWidth * (4 / 44));
  const liftY = -Math.round(tileHeight * (5 / 56));
  const cx = x + faceWidth / 2;
  const cy = y + faceHeight / 2;

  ctx.save();
  ctx.globalAlpha = look.alpha;
  ctx.translate(cx + look.dx + look.lift * liftX, cy + look.dy + look.lift * liftY);
  ctx.scale(look.scale, look.scale);
  ctx.translate(-cx, -cy);

  // 2 px border on selected for visibility at small tile sizes.
  const borderInset = flags.selected ? 2 : 1;
  const borderColor = flags.selected
    ? BORDER_SELECTED
    : flags.hint > 0
      ? BORDER_HINT
      : BORDER_NORMAL;
  const faceColor = flags.selected ? TILE_FACE_SELECTED : flags.free ? TILE_FACE : TILE_FACE_LOCKED;
  const suitColor = SUIT_COLOR[tile.suit] ?? MAHJONG_SUIT_FALLBACK;

  drawTileBody(ctx, x, y, faceWidth, faceHeight, sideWidth, look.lift);

  // The selected tile glows warm as it lifts; the hint glows blue (and breathes, #3613).
  const glow = Math.max(look.lift, flags.hint);
  if (glow > 0) {
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.shadowColor = look.lift >= flags.hint ? MAHJONG_GLOW_SHADOW : MAHJONG_HINT_GLOW_SHADOW;
    ctx.shadowBlur = (look.lift >= flags.hint ? 10 : 8) * glow;
  }
  ctx.fillStyle = borderColor;
  ctx.fillRect(x, y, faceWidth, faceHeight);
  // Clear shadow before drawing face so inner fills stay crisp.
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  ctx.fillStyle = faceColor;
  ctx.fillRect(
    x + borderInset,
    y + borderInset,
    faceWidth - 2 * borderInset,
    faceHeight - 2 * borderInset
  );
  drawTileArt(ctx, img, suitColor, {
    x,
    y,
    faceWidth,
    faceHeight,
    inset: borderInset,
    locked: !flags.free && !flags.selected,
    dimPlaceholder: !flags.free,
  });
  // Deadlock: the locked tiles dim briefly (#3613).
  if (look.dim > 0) {
    ctx.globalAlpha = look.alpha * look.dim;
    ctx.fillStyle = MAHJONG_DEADLOCK_DIM;
    ctx.fillRect(x, y, faceWidth, faceHeight);
    ctx.globalAlpha = look.alpha;
  }
  // Debug: green tint over free tiles when dev overlay is active.
  if (flags.debugFree && flags.free) {
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = MAHJONG_FACE_LOADING;
    ctx.fillRect(x + 2, y + 2, faceWidth - 4, faceHeight - 4);
  }
  ctx.restore();
}

function drawSparks(ctx: CanvasRenderingContext2D, sparks: readonly Spark[]): void {
  ctx.fillStyle = MAHJONG_SPARK;
  for (const sp of sparks) {
    ctx.globalAlpha = sp.alpha;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** A matched pair flying together and bursting (#3613). */
function drawGhost(
  ctx: CanvasRenderingContext2D,
  ghost: MatchGhost,
  tileImages: readonly (HTMLImageElement | null)[],
  cam: BoardCamera,
  now: number
): void {
  const p = progressAt(ghost.clock, now);
  const [t1, t2] = ghost.tiles;
  const a = cam.tileToScreen(t1.col, t1.row, t1.layer);
  const b = cam.tileToScreen(t2.col, t2.row, t2.layer);
  const meetX = (a.x + b.x) / 2;
  const meetY = (a.y + b.y) / 2;
  [t1, t2].forEach((t, i) => {
    const at = i === 0 ? a : b;
    const other = i === 0 ? b : a;
    const side = at.x < other.x || (at.x === other.x && i === 0) ? -1 : 1;
    const m = matchTileLook(p, at.x, at.y, meetX, meetY, side, cam.faceWidth);
    const look: TileLook = {
      dx: m.x - at.x,
      dy: m.y - at.y,
      lift: 0,
      scale: m.scale,
      alpha: m.alpha,
      hintGlow: 0,
      dim: 0,
    };
    drawTile(ctx, t, look, tileImages[t.faceId - 1] ?? null, cam, {
      selected: true,
      free: true,
      hint: 0,
      debugFree: false,
    });
  });
  const mx = (a.x + b.x + cam.faceWidth) / 2;
  const my = (a.y + b.y + cam.faceHeight) / 2;
  drawSparks(ctx, burstSparks(p, mx, my, cam.faceWidth * 1.4, 10));
}

function drawBoard(
  ctx: CanvasRenderingContext2D,
  state: MahjongState,
  freeTiles: ReadonlySet<number>,
  matchingIds: ReadonlySet<number>,
  tileImages: readonly (HTMLImageElement | null)[],
  cam: BoardCamera,
  debugShowFree: boolean,
  motion: BoardMotion,
  now: number
): void {
  const { tileWidth, tileHeight, boardWidth, boardHeight } = cam;

  ctx.clearRect(0, 0, boardWidth, boardHeight);
  // Background: the plain felt colour, the same as the play area around the board (#3612:
  // the felt fills the area; a grain only here showed the canvas's edge).
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, boardWidth, boardHeight);

  const selectedId = state.selected?.id ?? null;
  // Draw tiles lowest layer → highest so higher layers appear on top.
  const sorted = [...state.tiles].sort((a, b) => a.layer - b.layer || a.row - b.row);
  for (const tile of sorted) {
    const selected = tile.id === selectedId;
    const m = motion.tiles.get(tile.id);
    const look = m
      ? tileLook(
          m,
          selected,
          {
            lift: progressAt(m.lift, now),
            shake: progressAt(m.shake, now),
            hint: progressAt(m.hint, now),
            deal: progressAt(m.deal, now),
            shuffle: progressAt(m.shuffle, now),
            dim: progressAt(m.dim, now),
          },
          tileWidth,
          tileHeight
        )
      : restLook(selected);
    const staticHint = matchingIds.has(tile.id) ? 1 : 0;
    drawTile(ctx, tile, look, tileImages[tile.faceId - 1] ?? null, cam, {
      selected,
      free: freeTiles.has(tile.id),
      hint: m?.hint ? look.hintGlow : staticHint,
      debugFree: debugShowFree,
    });
  }
  for (const g of motion.ghosts) drawGhost(ctx, g, tileImages, cam, now);
  if (motion.cascade) {
    const { clock, x, y } = motion.cascade;
    drawSparks(ctx, cascadeSparks(progressAt(clock, now), x, y, boardWidth, boardHeight, 48));
  }
}

/** Whether anything on the board is animating. */
function isMoving(motion: BoardMotion): boolean {
  return motion.tiles.size > 0 || motion.ghosts.length > 0 || motion.cascade !== null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  state: MahjongState;
  camera: BoardCamera;
  /** `freeTileIds(state.tiles)` from the screen (#2962); built here when absent. */
  freeIds?: ReadonlySet<number>;
  hintIds?: ReadonlySet<number>;
  debugShowFree?: boolean;
  /** The board's animations (#3613); none when absent. */
  motion?: BoardMotion;
  onTilePress: (tileId: number) => void;
}

const NO_MOTION: BoardMotion = { tiles: new Map(), ghosts: [], cascade: null };
const EMPTY_SET: ReadonlySet<number> = new Set();

export default function GameCanvas({
  state,
  camera,
  freeIds,
  hintIds = EMPTY_SET,
  debugShowFree = false,
  motion = NO_MOTION,
  onTilePress,
}: Props) {
  const { t } = useTranslation("mahjong");
  const { boardWidth, boardHeight } = camera;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tileImagesRef = useRef<(HTMLImageElement | null)[]>(Array(42).fill(null));
  const [imagesVersion, setImagesVersion] = useState(0);
  const [dpr, setDpr] = useState(() =>
    typeof window !== "undefined" ? (window.devicePixelRatio ?? 1) : 1
  );

  const freeTiles = useMemo(() => freeIds ?? freeTileIds(state.tiles), [freeIds, state.tiles]);

  const matchingIds = useMemo(
    () => getMatchingFreeTileIds(state, freeTiles),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.tiles, state.selected, freeTiles]
  );

  const allHintIds = useMemo(() => {
    if (hintIds.size === 0) return matchingIds;
    const merged = new Set(matchingIds);
    for (const id of hintIds) merged.add(id);
    return merged as ReadonlySet<number>;
  }, [matchingIds, hintIds]);

  const noFreePairs = useMemo(
    () => !state.isComplete && !hasFreePairs(state.tiles, freeTiles),
    [state.isComplete, state.tiles, freeTiles]
  );
  const showShuffleCTA = noFreePairs && state.shufflesLeft > 0;
  const gameActive = !state.isComplete && !state.isDeadlocked && !showShuffleCTA;

  // Reactive DPR — re-renders when the user moves the window between screens or
  // changes browser zoom. The query matches the current DPR; when it stops matching
  // (DPR changed), we update state which triggers a redraw via the deps array below.
  // Re-registering on [dpr] keeps the query in sync after each change.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(`(resolution: ${dpr}dppx)`);
    function handler() {
      setDpr(window.devicePixelRatio ?? 1);
    }
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [dpr]);

  // Load all 42 SVG tile images once on mount, reusing assets already
  // downloaded by the screen-level loadTileAssets() singleton.
  useEffect(() => {
    const images: (HTMLImageElement | null)[] = Array(42).fill(null);
    tileImagesRef.current = images;
    let cancelled = false;

    loadTileAssets().then((uris) => {
      if (cancelled) return;
      return Promise.all(
        uris.map((uri, i) => {
          if (!uri) return Promise.resolve();
          return new Promise<void>((resolve) => {
            const img = new window.Image();
            img.crossOrigin = "anonymous";
            img.src = uri;
            img.onload = () => {
              if (!cancelled) images[i] = img;
              resolve();
            };
            img.onerror = () => resolve();
          });
        })
      ).then(() => {
        if (!cancelled && images.some((img) => img !== null)) setImagesVersion((v) => v + 1);
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Redraw whenever state, tile images, layout, or DPR changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Backing buffer in physical pixels at max zoom (#3611), so neither DPI nor the
    // gesture layer's zoom (a CSS scale) stretches it. CSS size stays logical.
    const px = dpr * boardResolution(camera.scale, camera.tileWidth);
    const physW = Math.round(boardWidth * px);
    const physH = Math.round(boardHeight * px);
    canvas.style.width = `${boardWidth}px`;
    canvas.style.height = `${boardHeight}px`;
    if (canvas.width !== physW) canvas.width = physW;
    if (canvas.height !== physH) canvas.height = physH;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Map all drawing coordinates to physical pixels and use high-quality
    // filtering when scaling SVG art.
    ctx.setTransform(px, 0, 0, px, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const paint = () => {
      const drawT0 = performance.now();
      drawBoard(
        ctx,
        state,
        freeTiles,
        allHintIds,
        tileImagesRef.current,
        camera,
        debugShowFree,
        motion,
        drawT0
      );
      if (__DEV__ && !isMoving(motion)) {
        const elapsed = performance.now() - drawT0;
        if (elapsed > 2)
          console.warn(
            `[mahjong] slow drawBoard: ${elapsed.toFixed(1)}ms for ${state.tiles.length} tiles`
          );
      }
    };
    paint();
    // While something animates (#3613), redraw each frame; the motion ends by changing.
    if (!isMoving(motion) || typeof requestAnimationFrame === "undefined") return;
    let frame = requestAnimationFrame(function loop() {
      paint();
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    motion,
    state,
    freeTiles,
    allHintIds,
    imagesVersion,
    camera,
    boardWidth,
    boardHeight,
    debugShowFree,
    dpr,
  ]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!gameActive) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      // getBoundingClientRect reflects the parent's CSS scale transform, so
      // divide by the visual/native ratio to get canvas drawing coordinates.
      const scaleX = rect.width / camera.boardWidth;
      const scaleY = rect.height / camera.boardHeight;
      const tapX = (e.clientX - rect.left) / scaleX;
      const tapY = (e.clientY - rect.top) / scaleY;
      const tileId = hitTest(state.tiles, tapX, tapY, camera);
      if (tileId !== null) onTilePress(tileId);
    },
    [state.tiles, onTilePress, gameActive, camera]
  );

  return (
    <View style={{ width: boardWidth, height: boardHeight }}>
      <canvas
        ref={canvasRef}
        width={boardWidth}
        height={boardHeight}
        onClick={handleClick}
        style={{ display: "block", cursor: gameActive ? "pointer" : "default" }}
        aria-label={t("game.canvasLabel")}
        role="img"
      />
    </View>
  );
}
