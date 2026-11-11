/**
 * Mahjong's mini-map (#3612): while the board is zoomed in past the fitted view, a small
 * overview in the board's top-right corner shows the remaining tiles and the part of the board
 * on screen. Tapping it centres the view there.
 *
 * Cost: the tiles are plain rects, laid out once per board change (a match), not per frame.
 * The view window follows the camera's shared values in an animated style, on the UI thread,
 * so panning and zooming do no JS work here.
 */
import React, { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import type { BoardCamera } from "../../game/mahjong/layout";
import type { SlotTile } from "../../game/mahjong/types";
import { clamp } from "../../game/mahjong/zoom";
import {
  MAHJONG_MINIMAP_BG,
  MAHJONG_MINIMAP_TILE,
  MAHJONG_MINIMAP_WINDOW,
} from "../../theme/theme.mahjong";

/** The mini-map's width; its height follows the board's aspect. */
export const MINIMAP_W = 96;

export interface MahjongMiniMapProps {
  readonly tiles: readonly SlotTile[];
  readonly camera: BoardCamera;
  /** The live camera (useBoardZoomPan's `view`). */
  readonly view: {
    readonly zoomScale: SharedValue<number>;
    readonly translateX: SharedValue<number>;
    readonly translateY: SharedValue<number>;
  };
  /** Centre the view on board point (x, y). */
  readonly onPanTo: (x: number, y: number) => void;
}

/** The remaining tiles as small rects, re-rendered only when the tiles change. */
const MiniTiles = memo(function MiniTiles({
  tiles,
  camera,
  k,
}: {
  tiles: readonly SlotTile[];
  camera: BoardCamera;
  k: number;
}) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {tiles.map((t) => {
        const { x, y } = camera.tileToScreen(t.col, t.row, t.layer);
        return (
          <View
            key={t.id}
            style={[
              styles.tile,
              {
                left: x * k,
                top: y * k,
                width: Math.max(1, camera.faceWidth * k - 0.5),
                height: Math.max(1, camera.faceHeight * k - 0.5),
              },
            ]}
          />
        );
      })}
    </View>
  );
});

/**
 * Where a press landed in the map: native gives `locationX/Y`; on web a click carries the
 * browser's `offsetX/Y` instead (the tiles and window ignore pointers, so it is the map's).
 */
function tapPoint(e: object): { x: number; y: number } | null {
  const n = e as { locationX?: number; locationY?: number; offsetX?: number; offsetY?: number };
  const x = n.locationX ?? n.offsetX;
  const y = n.locationY ?? n.offsetY;
  return typeof x === "number" && typeof y === "number" ? { x, y } : null;
}

export default function MahjongMiniMap({ tiles, camera, view, onPanTo }: MahjongMiniMapProps) {
  const { t } = useTranslation("mahjong");
  const { boardWidth: bw, boardHeight: bh, viewportWidth: vw, viewportHeight: vh } = camera;
  const k = MINIMAP_W / bw;
  const height = bh * k;

  // The part of the board on screen: the viewport, mapped back through the camera.
  const windowStyle = useAnimatedStyle(() => {
    const s = view.zoomScale.value;
    const w = Math.min(bw, vw / s);
    const h = Math.min(bh, vh / s);
    const cx = bw / 2 - view.translateX.value / s;
    const cy = bh / 2 - view.translateY.value / s;
    return {
      left: clamp(cx - w / 2, 0, bw - w) * k,
      top: clamp(cy - h / 2, 0, bh - h) * k,
      width: w * k,
      height: h * k,
    };
  });

  return (
    <Pressable
      style={[styles.map, { width: MINIMAP_W, height }]}
      onPress={(e) => {
        const at = tapPoint(e.nativeEvent);
        if (at) onPanTo(at.x / k, at.y / k);
      }}
      accessibilityRole="button"
      accessibilityLabel={t("minimap.label")}
      testID="mahjong-minimap"
    >
      <MiniTiles tiles={tiles} camera={camera} k={k} />
      <Animated.View
        pointerEvents="none"
        style={[styles.window, windowStyle]}
        testID="mahjong-minimap-window"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  map: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: MAHJONG_MINIMAP_BG,
    borderRadius: 6,
    overflow: "hidden",
  },
  tile: {
    position: "absolute",
    backgroundColor: MAHJONG_MINIMAP_TILE,
  },
  window: {
    position: "absolute",
    borderWidth: 1.5,
    borderColor: MAHJONG_MINIMAP_WINDOW,
    borderRadius: 2,
  },
});
