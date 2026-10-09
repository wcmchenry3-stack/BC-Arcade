/**
 * Mahjong Solitaire — native canvas (iOS / Android).
 *
 * Rendered via @shopify/react-native-skia.
 * Metro automatically uses GameCanvas.web.tsx on the web platform.
 *
 * World→screen conversion is delegated to BoardCamera.tileToScreen().
 * Rendering order: layer ASC so higher layers appear on top.
 * Hit-testing: topmost tile (highest layer) at touch point wins.
 *
 * Per tap (#2962): the face art is a cached bitmap per face size (`tileFaces.ts`), each tile is
 * a memoised `TileNode` that re-renders only when its own look changes, the free set comes
 * from the screen (or is built once per board here), and the paint and hit-test orders are
 * sorted once per board.
 */

import React, { memo, useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Canvas, Fill, Group, Image, Rect } from "@shopify/react-native-skia";
import type { SkImage } from "@shopify/react-native-skia";
import { useTranslation } from "react-i18next";
import { freeTileIds, getMatchingFreeTileIds, hasFreePairs } from "../../game/mahjong/engine";
import type { MahjongState, SlotTile } from "../../game/mahjong/types";
import { ART_INSET, useTileFaces } from "./tileFaces";
import {
  MAHJONG_BORDER_NORMAL,
  MAHJONG_BORDER_SELECTED,
  MAHJONG_BOARD_BG,
  MAHJONG_FACE_LOADING,
  MAHJONG_GLOW_BG,
  MAHJONG_HINT_COLOR,
  MAHJONG_HINT_GLOW_BG,
  MAHJONG_SIDE_B,
  MAHJONG_SIDE_R,
  MAHJONG_SUIT_COLOR as SUIT_COLOR,
  MAHJONG_SUIT_FALLBACK,
  MAHJONG_TILE_FACE,
  MAHJONG_TILE_FACE_LOCKED,
  MAHJONG_TILE_FACE_SELECTED,
  MAHJONG_TILE_SHADOW,
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
const SHADOW = MAHJONG_TILE_SHADOW;

// ---------------------------------------------------------------------------
// Face art — the face's cached bitmap, or a suit-colour placeholder until it
// loads (or if it failed), so the tile face is never silently blank.
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
  // Full opacity even on locked tiles: the <ImageSVG> this replaced ignored its opacity
  // (Skia draws an SVG without the paint), so native has always shown locked art undimmed.
  // Web dims it to 35 %; unifying the two is a design decision (docs/games/mahjong.md).
  return <Image image={face} x={x} y={y} width={w} height={h} fit="fill" opacity={1} />;
}

// ---------------------------------------------------------------------------
// One tile — memoised, so a tap re-renders only the tiles whose look changed
// (the selection, its matches, tiles a match freed), not the whole board.
// ---------------------------------------------------------------------------

interface TileNodeProps {
  tile: SlotTile;
  camera: BoardCamera;
  face: SkImage | null;
  isSelected: boolean;
  isFree: boolean;
  isHint: boolean;
  debugShowFree: boolean;
}

const TileNode = memo(function TileNode({
  tile,
  camera,
  face,
  isSelected,
  isFree,
  isHint,
  debugShowFree,
}: TileNodeProps) {
  const { tileWidth, tileHeight, faceWidth, faceHeight, sideWidth } = camera;
  const { x, y } = camera.tileToScreen(tile.col, tile.row, tile.layer);

  // Lift selected tile upward/outward — scale with tile size.
  const liftX = isSelected ? Math.round(tileWidth * (4 / 44)) : 0;
  const liftY = isSelected ? -Math.round(tileHeight * (5 / 56)) : 0;
  // 2 px border on selected for visibility at small tile sizes.
  const borderInset = isSelected ? 2 : 1;

  const borderColor = isSelected ? BORDER_SELECTED : isHint ? BORDER_HINT : BORDER_NORMAL;
  const faceColor = isSelected ? TILE_FACE_SELECTED : isFree ? TILE_FACE : TILE_FACE_LOCKED;

  return (
    <Group>
      {/* Drop shadow */}
      <Rect
        x={x + sideWidth + 2 + liftX}
        y={y + sideWidth + 2 + liftY}
        width={faceWidth}
        height={faceHeight}
        color={SHADOW}
      />
      {/* Gold glow behind selected tile */}
      {isSelected && (
        <Rect
          x={x + liftX - 3}
          y={y + liftY - 3}
          width={faceWidth + 6}
          height={faceHeight + 6}
          color={MAHJONG_GLOW_BG}
        />
      )}
      {/* Blue glow behind matching free tiles */}
      {isHint && (
        <Rect
          x={x - 4}
          y={y - 4}
          width={faceWidth + 8}
          height={faceHeight + 8}
          color={MAHJONG_HINT_GLOW_BG}
        />
      )}
      {/* Right 3-D side */}
      <Rect
        x={x + faceWidth + liftX}
        y={y + sideWidth + liftY}
        width={sideWidth}
        height={faceHeight}
        color={SIDE_R}
      />
      {/* Bottom 3-D side */}
      <Rect
        x={x + sideWidth + liftX}
        y={y + faceHeight + liftY}
        width={faceWidth}
        height={sideWidth}
        color={SIDE_B}
      />
      {/* Border */}
      <Rect x={x + liftX} y={y + liftY} width={faceWidth} height={faceHeight} color={borderColor} />
      {/* Face */}
      <Rect
        x={x + borderInset + liftX}
        y={y + borderInset + liftY}
        width={faceWidth - 2 * borderInset}
        height={faceHeight - 2 * borderInset}
        color={faceColor}
      />
      {/* Face art */}
      <TileFaceLayer
        face={face}
        suit={tile.suit}
        x={x + ART_INSET + liftX}
        y={y + ART_INSET + liftY}
        w={faceWidth - 2 * ART_INSET}
        h={faceHeight - 2 * ART_INSET}
        opacity={isFree ? 1 : 0.35}
      />
      {/* Debug: green tint over free tiles when dev overlay is active */}
      {debugShowFree && isFree && (
        <Rect
          x={x + ART_INSET + liftX}
          y={y + ART_INSET + liftY}
          width={faceWidth - 2 * ART_INSET}
          height={faceHeight - 2 * ART_INSET}
          color={MAHJONG_FACE_LOADING}
          opacity={0.3}
        />
      )}
    </Group>
  );
});

// ---------------------------------------------------------------------------
// Hit-testing
// ---------------------------------------------------------------------------

/** `byLayerDesc` is the board sorted highest layer first, so the topmost tile wins. */
function hitTest(
  byLayerDesc: readonly SlotTile[],
  tapX: number,
  tapY: number,
  cam: BoardCamera
): number | null {
  const { faceWidth: fw, faceHeight: fh } = cam;
  for (const tile of byLayerDesc) {
    const { x, y } = cam.tileToScreen(tile.col, tile.row, tile.layer);
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
  camera: BoardCamera;
  /** `freeTileIds(state.tiles)` from the screen, which computes it once per board; built here when absent. */
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
  const { faceWidth, faceHeight, boardWidth, boardHeight } = camera;
  const faces = useTileFaces(faceWidth, faceHeight);

  const freeTiles = useMemo(() => freeIds ?? freeTileIds(state.tiles), [freeIds, state.tiles]);

  const matchingIds = useMemo(
    () => getMatchingFreeTileIds(state, freeTiles),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.tiles, state.selected, freeTiles]
  );

  const noFreePairs = useMemo(
    () => !state.isComplete && !hasFreePairs(state.tiles, freeTiles),
    [state.isComplete, state.tiles, freeTiles]
  );
  const showShuffleCTA = noFreePairs && state.shufflesLeft > 0;

  // Both orders once per board: paint (layer, then row) and hit-test (highest layer first).
  const { paintOrder, hitOrder } = useMemo(
    () => ({
      paintOrder: [...state.tiles].sort((a, b) => a.layer - b.layer || a.row - b.row),
      hitOrder: [...state.tiles].sort((a, b) => b.layer - a.layer),
    }),
    [state.tiles]
  );

  const selectedId = state.selected?.id ?? null;
  const gameActive = !state.isComplete && !state.isDeadlocked && !showShuffleCTA;

  function handleTap(e: { nativeEvent: { locationX: number; locationY: number } }) {
    if (!gameActive) return;
    const { locationX, locationY } = e.nativeEvent;
    const tileId = hitTest(hitOrder, locationX, locationY, camera);
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
        {paintOrder.map((tile) => (
          <TileNode
            key={tile.id}
            tile={tile}
            camera={camera}
            face={faces?.[tile.faceId - 1] ?? null}
            isSelected={tile.id === selectedId}
            isFree={freeTiles.has(tile.id)}
            isHint={matchingIds.has(tile.id) || hintIds.has(tile.id)}
            debugShowFree={debugShowFree}
          />
        ))}
      </Canvas>

      {/* Touch capture layer — disabled during overlays */}
      {gameActive && (
        <Pressable style={StyleSheet.absoluteFill} onPress={handleTap} accessibilityRole="none" />
      )}
    </View>
  );
}
