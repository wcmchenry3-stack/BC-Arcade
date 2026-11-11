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
 *
 * Motion (#3613): `motion` (useBoardMotion) names the tiles in an animation; only those
 * become animated nodes, whose transforms follow the animation on the UI thread. Matched
 * pairs and the win cascade are drawn over the board.
 */

import React, { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Canvas, Fill } from "@shopify/react-native-skia";
import { useTranslation } from "react-i18next";
import { freeTileIds, getMatchingFreeTileIds, hasFreePairs } from "../../game/mahjong/engine";
import type { MahjongState, SlotTile } from "../../game/mahjong/types";
import type { BoardMotion } from "../../game/mahjong/useBoardMotion";
import { useTileFaces } from "./tileFaces";
import { MatchGhostNode, TileNode, WinCascadeNode } from "./TileNode";
import { boardResolution } from "../../game/mahjong/zoom";
import { MAHJONG_BOARD_BG } from "../../theme/theme.mahjong";
import type { BoardCamera } from "../../game/mahjong/layout";

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
  const { faceWidth, faceHeight, boardWidth, boardHeight } = camera;
  // Drawn at max-zoom resolution and shown scaled down, so zooming in never stretches it.
  const res = boardResolution(camera.scale, camera.tileWidth);
  const faces = useTileFaces(faceWidth, faceHeight, res);

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
      {/* Drawn at `res` times the board's size, centred on it and scaled (about its centre)
          down onto it: the gesture layer's zoom then shrinks a sharp bitmap, never stretches. */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          width: boardWidth * res,
          height: boardHeight * res,
          left: (boardWidth - boardWidth * res) / 2,
          top: (boardHeight - boardHeight * res) / 2,
          transform: [{ scale: 1 / res }],
        }}
      >
        <Canvas
          style={{ width: boardWidth * res, height: boardHeight * res }}
          accessibilityLabel={t("game.canvasLabel")}
          accessibilityRole="none"
        >
          <Fill color={MAHJONG_BOARD_BG} />
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
              res={res}
              motion={motion.tiles.get(tile.id)}
            />
          ))}
          {/* Matched pairs fly together and burst over the board; the win cascade over all. */}
          {motion.ghosts.map((g) => (
            <MatchGhostNode key={g.key} ghost={g} camera={camera} faces={faces} res={res} />
          ))}
          {motion.cascade && <WinCascadeNode cascade={motion.cascade} camera={camera} res={res} />}
        </Canvas>
      </View>

      {/* Touch capture layer — disabled during overlays */}
      {gameActive && (
        <Pressable style={StyleSheet.absoluteFill} onPress={handleTap} accessibilityRole="none" />
      )}
    </View>
  );
}
