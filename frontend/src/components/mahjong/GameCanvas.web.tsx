/**
 * Mahjong Solitaire — web canvas (Expo Web / browser).
 *
 * Rendered via HTML Canvas 2D.
 * Metro uses this file automatically on the web platform.
 *
 * World→screen conversion is delegated to BoardCamera.tileToScreen().
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Asset } from "expo-asset";
import { useTranslation } from "react-i18next";
import { getMatchingFreeTileIds, hasFreePairs, isFreeTile } from "../../game/mahjong/engine";
import type { MahjongState, SlotTile } from "../../game/mahjong/types";
import { TILE_REQUIRES } from "./tileAssets";
import {
  MAHJONG_BOARD_BG,
  MAHJONG_GLOW_SHADOW,
  MAHJONG_HINT_GLOW_SHADOW,
  MAHJONG_TILE_FACE_SELECTED,
} from "../../theme/theme.constants";
import type { BoardCamera } from "../../game/mahjong/layout";

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const BG = MAHJONG_BOARD_BG;
const TILE_FACE = "#f5f0e8";
const TILE_FACE_SELECTED = MAHJONG_TILE_FACE_SELECTED;
const TILE_FACE_LOCKED = "#d0c8b8";
const BORDER_NORMAL = "#8b7355";
const BORDER_SELECTED = "#ffd700";
const BORDER_HINT = "#5dbcd2";
const SIDE_R = "#a89070";
const SIDE_B = "#987860";

const SUIT_COLOR: Record<string, string> = {
  characters: "#cc0000",
  circles: "#006633",
  bamboos: "#003322",
  winds: "#334455",
  dragons: "#880011",
  flowers: "#aa2299",
  seasons: "#0044aa",
};

// ---------------------------------------------------------------------------
// Felt texture
// ---------------------------------------------------------------------------

/**
 * Generates a 64×64 random-noise canvas pattern that simulates felt grain.
 * Drawn at ~7% opacity over the board background. Generated once per session
 * and cached by the caller — never called on every frame.
 */
function makeFeltPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  try {
    const size = 64;
    const offscreen = document.createElement("canvas");
    offscreen.width = size;
    offscreen.height = size;
    const oc = offscreen.getContext("2d");
    if (!oc) return null;
    const id = oc.createImageData(size, size);
    for (let i = 0; i < id.data.length; i += 4) {
      const v = Math.floor(Math.random() * 30);
      id.data[i] = v;
      id.data[i + 1] = v;
      id.data[i + 2] = v;
      id.data[i + 3] = 18; // ~7% opacity
    }
    oc.putImageData(id, 0, 0);
    return ctx.createPattern(offscreen, "repeat");
  } catch {
    return null;
  }
}

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

function drawBoard(
  ctx: CanvasRenderingContext2D,
  state: MahjongState,
  freeTiles: ReadonlySet<number>,
  matchingIds: ReadonlySet<number>,
  tileImages: readonly (HTMLImageElement | null)[],
  cam: BoardCamera,
  feltPattern: CanvasPattern | null,
  debugShowFree: boolean
): void {
  const { tileWidth, tileHeight, faceWidth, faceHeight, sideWidth, boardWidth, boardHeight } = cam;

  ctx.clearRect(0, 0, boardWidth, boardHeight);

  // Background — solid colour then subtle felt-grain overlay.
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, boardWidth, boardHeight);
  if (feltPattern) {
    ctx.fillStyle = feltPattern;
    ctx.fillRect(0, 0, boardWidth, boardHeight);
  }

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
    const suitColor = SUIT_COLOR[tile.suit] ?? "#888888";

    // Right 3-D side
    ctx.fillStyle = SIDE_R;
    ctx.fillRect(x + faceWidth + liftX, y + sideWidth + liftY, sideWidth, faceHeight);

    // Bottom 3-D side
    ctx.fillStyle = SIDE_B;
    ctx.fillRect(x + sideWidth + liftX, y + faceHeight + liftY, faceWidth, sideWidth);

    // Shadow/glow on the border rect: selected → gold glow + drop shadow,
    // hint → blue glow + drop shadow, normal → soft feathered drop shadow.
    ctx.shadowOffsetX = sideWidth + 2;
    ctx.shadowOffsetY = sideWidth + 2;
    if (isSelected) {
      ctx.shadowColor = MAHJONG_GLOW_SHADOW;
      ctx.shadowBlur = 10;
    } else if (isHint) {
      ctx.shadowColor = MAHJONG_HINT_GLOW_SHADOW;
      ctx.shadowBlur = 8;
    } else {
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 5;
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

    // SVG face art — fall back to suit-color rect while image is loading.
    // SVGs with width="100%" have naturalWidth=0 even when loaded; check for
    // null instead (images[i] is only set in onload, so non-null means ready).
    const img = tileImages[tile.faceId - 1];
    ctx.globalAlpha = isFree ? 1 : 0.35;
    if (img !== null) {
      ctx.drawImage(img, x + 2 + liftX, y + 2 + liftY, faceWidth - 4, faceHeight - 4);
    } else {
      ctx.fillStyle = suitColor;
      ctx.fillRect(x + 8 + liftX, y + 10 + liftY, faceWidth - 16, faceHeight - 20);
    }

    // Debug: green tint over free tiles when dev overlay is active.
    if (debugShowFree && isFree) {
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = "#00cc44";
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
  hintIds?: ReadonlySet<number>;
  debugShowFree?: boolean;
  onTilePress: (tileId: number) => void;
  onShufflePress: () => void;
  onNewGamePress: () => void;
}

const EMPTY_SET: ReadonlySet<number> = new Set();

export default function GameCanvas({
  state,
  camera,
  hintIds = EMPTY_SET,
  debugShowFree = false,
  onTilePress,
  onShufflePress,
  onNewGamePress,
}: Props) {
  const { t } = useTranslation("mahjong");
  const { boardWidth, boardHeight } = camera;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tileImagesRef = useRef<(HTMLImageElement | null)[]>(Array(42).fill(null));
  const feltPatternRef = useRef<CanvasPattern | null>(null);
  const [imagesVersion, setImagesVersion] = useState(0);

  const freeTiles = useMemo(() => {
    const s = new Set<number>();
    for (const tile of state.tiles) {
      if (isFreeTile(tile, state.tiles)) s.add(tile.id);
    }
    return s;
  }, [state.tiles]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const matchingIds = useMemo(() => getMatchingFreeTileIds(state), [state.tiles, state.selected]);

  const allHintIds = useMemo(() => {
    if (hintIds.size === 0) return matchingIds;
    const merged = new Set(matchingIds);
    for (const id of hintIds) merged.add(id);
    return merged as ReadonlySet<number>;
  }, [matchingIds, hintIds]);

  const noFreePairs = useMemo(
    () => !state.isComplete && !hasFreePairs(state.tiles),
    [state.isComplete, state.tiles]
  );
  const showShuffleCTA = noFreePairs && state.shufflesLeft > 0;
  const gameActive = !state.isComplete && !state.isDeadlocked && !showShuffleCTA;

  const [showDeadlockOverlay, setShowDeadlockOverlay] = useState(false);
  useEffect(() => {
    if (!state.isDeadlocked) {
      setShowDeadlockOverlay(false);
      return;
    }
    const timer = setTimeout(() => setShowDeadlockOverlay(true), 500);
    return () => clearTimeout(timer);
  }, [state.isDeadlocked]);

  // Reset felt pattern on unmount so a remount regenerates it against the new context.
  useEffect(
    () => () => {
      feltPatternRef.current = null;
    },
    []
  );

  // Load all 42 SVG tile images once on mount.
  useEffect(() => {
    const images: (HTMLImageElement | null)[] = Array(42).fill(null);
    tileImagesRef.current = images;
    let cancelled = false;

    (async () => {
      await Promise.all(
        (TILE_REQUIRES as number[]).map(async (src, i) => {
          try {
            const asset = Asset.fromModule(src);
            await asset.downloadAsync();
            const uri = asset.localUri ?? asset.uri;
            if (!uri || cancelled) return;
            await new Promise<void>((resolve) => {
              const img = new window.Image();
              img.crossOrigin = "anonymous";
              img.src = uri;
              img.onload = () => {
                if (!cancelled) images[i] = img;
                resolve();
              };
              img.onerror = () => resolve();
            });
          } catch {
            // SVG failed to load — suit-color fallback stays
          }
        })
      );
      if (!cancelled && images.some((img) => img !== null)) setImagesVersion((v) => v + 1);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Redraw whenever state, tile images, or layout changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Scale the backing buffer to physical pixels so the canvas is crisp on
    // high-DPI / Retina screens. CSS display size stays at logical pixels.
    const dpr = window.devicePixelRatio ?? 1;
    const physW = Math.round(boardWidth * dpr);
    const physH = Math.round(boardHeight * dpr);
    canvas.style.width = `${boardWidth}px`;
    canvas.style.height = `${boardHeight}px`;
    if (canvas.width !== physW) canvas.width = physW;
    if (canvas.height !== physH) canvas.height = physH;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Map all drawing coordinates to physical pixels and use high-quality
    // filtering when scaling SVG art.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Generate the felt-grain pattern once; reuse on every subsequent draw.
    if (!feltPatternRef.current) {
      feltPatternRef.current = makeFeltPattern(ctx);
    }

    drawBoard(
      ctx,
      state,
      freeTiles,
      allHintIds,
      tileImagesRef.current,
      camera,
      feltPatternRef.current,
      debugShowFree
    );
  }, [state, freeTiles, allHintIds, imagesVersion, camera, debugShowFree]);

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

      {/* Shuffle CTA overlay */}
      {showShuffleCTA && (
        <View style={[styles.overlay, styles.noMovesOverlay]}>
          <Text style={styles.overlayTitle}>{t("overlay.noMoves")}</Text>
          <Text style={styles.overlayDetail}>{t("overlay.noMovesDetail")}</Text>
          <Pressable
            style={styles.btn}
            onPress={onShufflePress}
            accessibilityLabel={t("action.shuffleLabel")}
          >
            <Text style={styles.btnText}>
              {t("overlay.shuffleButton")} ({state.shufflesLeft})
            </Text>
          </Pressable>
        </View>
      )}

      {/* Deadlock overlay — shown after shake animation completes */}
      {showDeadlockOverlay && (
        <View style={[styles.overlay, styles.noMovesOverlay]}>
          <Text style={styles.overlayTitle}>{t("overlay.deadlocked")}</Text>
          <Text style={styles.overlayDetail}>{t("overlay.deadlockedDetail")}</Text>
          <Pressable
            style={styles.btn}
            onPress={onNewGamePress}
            accessibilityLabel={t("action.newGameLabel")}
          >
            <Text style={styles.btnText}>{t("overlay.newGameButton")}</Text>
          </Pressable>
        </View>
      )}

      {/* Win overlay */}
      {state.isComplete && (
        <View style={[styles.overlay, styles.winOverlay]}>
          <Text style={styles.winTitle}>{t("overlay.youWon")}</Text>
          <Text style={styles.overlayDetail}>
            {t("overlay.youWonDetail", { count: state.pairsRemoved })}
          </Text>
          <Text style={styles.winScore}>{t("score.display", { score: state.score })}</Text>
          <Pressable
            style={styles.btn}
            onPress={onNewGamePress}
            accessibilityLabel={t("action.newGameLabel")}
          >
            <Text style={styles.btnText}>{t("overlay.newGameButton")}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  noMovesOverlay: {
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  winOverlay: {
    backgroundColor: "rgba(0,20,0,0.82)",
  },
  overlayTitle: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 8,
  },
  overlayDetail: {
    color: "#cccccc",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 16,
  },
  winTitle: {
    color: "#ffd700",
    fontSize: 30,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 8,
  },
  winScore: {
    color: "#ffffff",
    fontSize: 18,
    textAlign: "center",
    marginBottom: 20,
    fontVariant: ["tabular-nums"],
  },
  btn: {
    backgroundColor: "#2a7a2a",
    paddingVertical: 10,
    paddingHorizontal: 28,
    borderRadius: 6,
    marginTop: 4,
  },
  btnText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "bold",
    textAlign: "center",
  },
});
