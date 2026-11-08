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
import { loadTileAssets } from "./tileAssetLoader";
import { boardResolution } from "../../game/mahjong/zoom";
import {
  MAHJONG_BORDER_NORMAL,
  MAHJONG_BORDER_SELECTED,
  MAHJONG_BOARD_BG,
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
  sideWidth: number
): void {
  const shadowOffset = Math.round(sideWidth * 1.3);
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
    ctx.globalAlpha = t.dimPlaceholder ? 0.35 : 1;
    ctx.fillStyle = suitColor;
    ctx.fillRect(t.x + 8, t.y + 10, t.faceWidth - 16, t.faceHeight - 20);
    ctx.globalAlpha = 1;
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

function drawBoard(
  ctx: CanvasRenderingContext2D,
  state: MahjongState,
  freeTiles: ReadonlySet<number>,
  matchingIds: ReadonlySet<number>,
  tileImages: readonly (HTMLImageElement | null)[],
  cam: BoardCamera,
  debugShowFree: boolean
): void {
  const { tileWidth, tileHeight, faceWidth, faceHeight, sideWidth, boardWidth, boardHeight } = cam;

  ctx.clearRect(0, 0, boardWidth, boardHeight);

  // Background: the plain felt colour, the same as the play area around the board (#3612:
  // the felt fills the area; a grain only here showed the canvas's edge).
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, boardWidth, boardHeight);

  const selectedId = state.selected?.id ?? null;

  // Draw tiles lowest layer → highest so higher layers appear on top.
  const sorted = [...state.tiles].sort((a, b) => a.layer - b.layer || a.row - b.row);

  for (const tile of sorted) {
    ctx.save();

    const { x: rawX, y: rawY } = cam.tileToScreen(tile.col, tile.row, tile.layer);
    const x = Math.round(rawX);
    const y = Math.round(rawY);
    const isSelected = tile.id === selectedId;
    const isFree = freeTiles.has(tile.id);
    const isHint = matchingIds.has(tile.id);

    // Lift selected tile upward/outward — scale with tile size.
    const liftX = isSelected ? Math.round(tileWidth * (4 / 44)) : 0;
    const liftY = isSelected ? -Math.round(tileHeight * (5 / 56)) : 0;
    // 2 px border on selected for visibility at small tile sizes.
    const borderInset = isSelected ? 2 : 1;

    const borderColor = isSelected ? BORDER_SELECTED : isHint ? BORDER_HINT : BORDER_NORMAL;
    const faceColor = isSelected ? TILE_FACE_SELECTED : isFree ? TILE_FACE : TILE_FACE_LOCKED;
    const suitColor = SUIT_COLOR[tile.suit] ?? MAHJONG_SUIT_FALLBACK;

    drawTileBody(ctx, x + liftX, y + liftY, faceWidth, faceHeight, sideWidth);

    // Selected and hinted tiles glow around their outline.
    if (isSelected || isHint) {
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.shadowColor = isSelected ? MAHJONG_GLOW_SHADOW : MAHJONG_HINT_GLOW_SHADOW;
      ctx.shadowBlur = isSelected ? 10 : 8;
    }

    // Border
    ctx.fillStyle = borderColor;
    ctx.fillRect(x + liftX, y + liftY, faceWidth, faceHeight);

    // Clear shadow before drawing face so inner fills stay crisp.
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // Face
    ctx.fillStyle = faceColor;
    ctx.fillRect(
      x + borderInset + liftX,
      y + borderInset + liftY,
      faceWidth - 2 * borderInset,
      faceHeight - 2 * borderInset
    );

    drawTileArt(ctx, tileImages[tile.faceId - 1] ?? null, suitColor, {
      x: x + liftX,
      y: y + liftY,
      faceWidth,
      faceHeight,
      inset: borderInset,
      locked: !isFree && !isSelected,
      dimPlaceholder: !isFree,
    });

    // Debug: green tint over free tiles when dev overlay is active.
    if (debugShowFree && isFree) {
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = MAHJONG_FACE_LOADING;
      ctx.fillRect(x + 2 + liftX, y + 2 + liftY, faceWidth - 4, faceHeight - 4);
    }

    ctx.restore();
  }
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
  onTilePress: (tileId: number) => void;
}

const EMPTY_SET: ReadonlySet<number> = new Set();

export default function GameCanvas({
  state,
  camera,
  freeIds,
  hintIds = EMPTY_SET,
  debugShowFree = false,
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

    const drawT0 = __DEV__ ? performance.now() : 0;
    drawBoard(ctx, state, freeTiles, allHintIds, tileImagesRef.current, camera, debugShowFree);
    if (__DEV__) {
      const elapsed = performance.now() - drawT0;

      if (elapsed > 2)
        console.warn(
          `[mahjong] slow drawBoard: ${elapsed.toFixed(1)}ms for ${state.tiles.length} tiles`
        );
    }
  }, [
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
