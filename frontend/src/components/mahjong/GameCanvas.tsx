/**
 * Mahjong Solitaire — native canvas (iOS / Android).
 *
 * Rendered via @shopify/react-native-skia.
 * Metro automatically uses GameCanvas.web.tsx on the web platform.
 *
 * Tile geometry (grid → pixels):
 *   pixel_x = padX + (col / 2) * tileWidth + layer * layerDx
 *   pixel_y = padY + row * tileHeight − layer * layerDy
 *
 * Rendering order: layer ASC so higher layers appear on top.
 * Hit-testing: topmost tile (highest layer) at touch point wins.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Canvas, Fill, Group, ImageSVG, Rect, useSVG } from "@shopify/react-native-skia";
import { useTranslation } from "react-i18next";
import { hasFreePairs, isFreeTile, tilesMatch } from "../../game/mahjong/engine";
import type { MahjongState, SlotTile } from "../../game/mahjong/types";
import { TILE_REQUIRES } from "./tileAssets";
import { MAHJONG_TILE_FACE_SELECTED, MAHJONG_GLOW_BG } from "../../theme/theme.constants";
import type { MahjongLayout } from "../../game/mahjong/layout";

// ---------------------------------------------------------------------------
// Geometry helpers — accept layout so they stay pure functions
// ---------------------------------------------------------------------------

function tileX(col: number, layer: number, l: MahjongLayout): number {
  return l.padX + (col / 2) * l.tileWidth + layer * l.layerDx;
}
function tileY(row: number, layer: number, l: MahjongLayout): number {
  return l.padY + row * l.tileHeight - layer * l.layerDy;
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const BG = "#1a3a1a";
const TILE_FACE = "#f5f0e8";
const TILE_FACE_SELECTED = MAHJONG_TILE_FACE_SELECTED;
const TILE_FACE_LOCKED = "#d0c8b8";
const BORDER_NORMAL = "#8b7355";
const BORDER_SELECTED = "#ffd700";
const BORDER_HINT = "#5dbcd2";
const SIDE_R = "#a89070";
const SIDE_B = "#987860";
const SHADOW = "rgba(0,0,0,0.35)";

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
// SVG preloader — must live OUTSIDE the Skia Canvas reconciler so React's
// standard scheduler propagates async useSVG state updates correctly.
// 42 explicit calls (hooks rules: fixed count, no conditionals).
// ---------------------------------------------------------------------------

type TileSVG = ReturnType<typeof useSVG>;

function useAllTileSVGs(): ReadonlyArray<TileSVG> {
  const s00 = useSVG(TILE_REQUIRES[0]);
  const s01 = useSVG(TILE_REQUIRES[1]);
  const s02 = useSVG(TILE_REQUIRES[2]);
  const s03 = useSVG(TILE_REQUIRES[3]);
  const s04 = useSVG(TILE_REQUIRES[4]);
  const s05 = useSVG(TILE_REQUIRES[5]);
  const s06 = useSVG(TILE_REQUIRES[6]);
  const s07 = useSVG(TILE_REQUIRES[7]);
  const s08 = useSVG(TILE_REQUIRES[8]);
  const s09 = useSVG(TILE_REQUIRES[9]);
  const s10 = useSVG(TILE_REQUIRES[10]);
  const s11 = useSVG(TILE_REQUIRES[11]);
  const s12 = useSVG(TILE_REQUIRES[12]);
  const s13 = useSVG(TILE_REQUIRES[13]);
  const s14 = useSVG(TILE_REQUIRES[14]);
  const s15 = useSVG(TILE_REQUIRES[15]);
  const s16 = useSVG(TILE_REQUIRES[16]);
  const s17 = useSVG(TILE_REQUIRES[17]);
  const s18 = useSVG(TILE_REQUIRES[18]);
  const s19 = useSVG(TILE_REQUIRES[19]);
  const s20 = useSVG(TILE_REQUIRES[20]);
  const s21 = useSVG(TILE_REQUIRES[21]);
  const s22 = useSVG(TILE_REQUIRES[22]);
  const s23 = useSVG(TILE_REQUIRES[23]);
  const s24 = useSVG(TILE_REQUIRES[24]);
  const s25 = useSVG(TILE_REQUIRES[25]);
  const s26 = useSVG(TILE_REQUIRES[26]);
  const s27 = useSVG(TILE_REQUIRES[27]);
  const s28 = useSVG(TILE_REQUIRES[28]);
  const s29 = useSVG(TILE_REQUIRES[29]);
  const s30 = useSVG(TILE_REQUIRES[30]);
  const s31 = useSVG(TILE_REQUIRES[31]);
  const s32 = useSVG(TILE_REQUIRES[32]);
  const s33 = useSVG(TILE_REQUIRES[33]);
  const s34 = useSVG(TILE_REQUIRES[34]);
  const s35 = useSVG(TILE_REQUIRES[35]);
  const s36 = useSVG(TILE_REQUIRES[36]);
  const s37 = useSVG(TILE_REQUIRES[37]);
  const s38 = useSVG(TILE_REQUIRES[38]);
  const s39 = useSVG(TILE_REQUIRES[39]);
  const s40 = useSVG(TILE_REQUIRES[40]);
  const s41 = useSVG(TILE_REQUIRES[41]);
  return [
    s00,
    s01,
    s02,
    s03,
    s04,
    s05,
    s06,
    s07,
    s08,
    s09,
    s10,
    s11,
    s12,
    s13,
    s14,
    s15,
    s16,
    s17,
    s18,
    s19,
    s20,
    s21,
    s22,
    s23,
    s24,
    s25,
    s26,
    s27,
    s28,
    s29,
    s30,
    s31,
    s32,
    s33,
    s34,
    s35,
    s36,
    s37,
    s38,
    s39,
    s40,
    s41,
  ];
}

// ---------------------------------------------------------------------------
// SVG face art — receives the pre-loaded SkSVG object as a prop so the
// component can be rendered safely inside the Skia Canvas tree.
// ---------------------------------------------------------------------------

function TileFaceLayer({
  svg,
  suit,
  x,
  y,
  w,
  h,
  opacity,
}: {
  svg: TileSVG;
  suit: string;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
}) {
  if (!svg) {
    // SVG not yet loaded or failed to parse — render a suit-color placeholder
    // so the tile face is never silently blank.
    const fallbackColor = SUIT_COLOR[suit] ?? "#888888";
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
  return <ImageSVG svg={svg} x={x} y={y} width={w} height={h} opacity={opacity} />;
}

// ---------------------------------------------------------------------------
// Hit-testing
// ---------------------------------------------------------------------------

function hitTest(
  tiles: readonly SlotTile[],
  tapX: number,
  tapY: number,
  l: MahjongLayout
): number | null {
  const fw = l.tileWidth - l.sideWidth;
  const fh = l.tileHeight - l.sideWidth;
  // Iterate from highest layer down so the topmost tile wins.
  const sorted = [...tiles].sort((a, b) => b.layer - a.layer);
  for (const tile of sorted) {
    const x = tileX(tile.col, tile.layer, l);
    const y = tileY(tile.row, tile.layer, l);
    if (tapX >= x && tapX < x + fw && tapY >= y && tapY < y + fh) {
      return tile.id;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  state: MahjongState;
  layout: MahjongLayout;
  onTilePress: (tileId: number) => void;
  onShufflePress: () => void;
  onNewGamePress: () => void;
}

export default function GameCanvas({
  state,
  layout,
  onTilePress,
  onShufflePress,
  onNewGamePress,
}: Props) {
  const { t } = useTranslation("mahjong");
  const tileSvgs = useAllTileSVGs();
  const { tileWidth, tileHeight, sideWidth, boardWidth, boardHeight } = layout;

  const freeTiles = useMemo(() => {
    const s = new Set<number>();
    for (const tile of state.tiles) {
      if (isFreeTile(tile, state.tiles)) s.add(tile.id);
    }
    return s;
  }, [state.tiles]);

  const noFreePairs = useMemo(
    () => !state.isComplete && !hasFreePairs(state.tiles),
    [state.isComplete, state.tiles]
  );
  const showShuffleCTA = noFreePairs && state.shufflesLeft > 0;

  const [showDeadlockOverlay, setShowDeadlockOverlay] = useState(false);
  useEffect(() => {
    if (!state.isDeadlocked) {
      setShowDeadlockOverlay(false);
      return;
    }
    const timer = setTimeout(() => setShowDeadlockOverlay(true), 500);
    return () => clearTimeout(timer);
  }, [state.isDeadlocked]);

  const sortedTiles = useMemo(
    () => [...state.tiles].sort((a, b) => a.layer - b.layer || a.row - b.row),
    [state.tiles]
  );

  const selectedId = state.selected?.id ?? null;
  const hasSelection = selectedId !== null;
  const gameActive = !state.isComplete && !state.isDeadlocked && !showShuffleCTA;

  function handleTap(e: { nativeEvent: { locationX: number; locationY: number } }) {
    if (!gameActive) return;
    const { locationX, locationY } = e.nativeEvent;
    const tileId = hitTest(state.tiles, locationX, locationY, layout);
    if (tileId !== null) onTilePress(tileId);
  }

  return (
    <View style={{ width: boardWidth, height: boardHeight }}>
      <Canvas
        style={{ width: boardWidth, height: boardHeight }}
        accessibilityLabel={t("game.canvasLabel")}
        accessibilityRole="none"
      >
        <Fill color={BG} />
        {sortedTiles.map((tile) => {
          const x = tileX(tile.col, tile.layer, layout);
          const y = tileY(tile.row, tile.layer, layout);
          const isSelected = tile.id === selectedId;
          const isFree = freeTiles.has(tile.id);
          const fw = tileWidth - sideWidth;
          const fh = tileHeight - sideWidth;

          // Lift selected tile upward/outward — scale with tile size.
          const liftX = isSelected ? Math.round(tileWidth * (4 / 44)) : 0;
          const liftY = isSelected ? -Math.round(tileHeight * (5 / 56)) : 0;
          // 2 px border on selected for visibility at small tile sizes.
          const borderInset = isSelected ? 2 : 1;

          // Hints only on tiles that actually match the selection.
          const isHint =
            isFree && hasSelection && state.selected !== null && tilesMatch(tile, state.selected);
          const borderColor = isSelected ? BORDER_SELECTED : isHint ? BORDER_HINT : BORDER_NORMAL;
          const faceColor = isSelected ? TILE_FACE_SELECTED : isFree ? TILE_FACE : TILE_FACE_LOCKED;

          return (
            <Group key={tile.id}>
              {/* Drop shadow */}
              <Rect
                x={x + sideWidth + 2 + liftX}
                y={y + sideWidth + 2 + liftY}
                width={fw}
                height={fh}
                color={SHADOW}
              />
              {/* Gold glow behind selected tile */}
              {isSelected && (
                <Rect
                  x={x + liftX - 3}
                  y={y + liftY - 3}
                  width={fw + 6}
                  height={fh + 6}
                  color={MAHJONG_GLOW_BG}
                />
              )}
              {/* Right 3-D side */}
              <Rect
                x={x + fw + liftX}
                y={y + sideWidth + liftY}
                width={sideWidth}
                height={fh}
                color={SIDE_R}
              />
              {/* Bottom 3-D side */}
              <Rect
                x={x + sideWidth + liftX}
                y={y + fh + liftY}
                width={fw}
                height={sideWidth}
                color={SIDE_B}
              />
              {/* Border */}
              <Rect x={x + liftX} y={y + liftY} width={fw} height={fh} color={borderColor} />
              {/* Face */}
              <Rect
                x={x + borderInset + liftX}
                y={y + borderInset + liftY}
                width={fw - 2 * borderInset}
                height={fh - 2 * borderInset}
                color={faceColor}
              />
              {/* SVG face art */}
              <TileFaceLayer
                svg={tileSvgs[tile.faceId - 1] ?? null}
                suit={tile.suit}
                x={x + 2 + liftX}
                y={y + 2 + liftY}
                w={fw - 4}
                h={fh - 4}
                opacity={isFree ? 1 : 0.35}
              />
            </Group>
          );
        })}
      </Canvas>

      {/* Touch capture layer — disabled during overlays */}
      {gameActive && (
        <Pressable style={StyleSheet.absoluteFill} onPress={handleTap} accessibilityRole="none" />
      )}

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
