/**
 * AnimatedTile — renders a single 2048 tile with three animations:
 *
 *  • Slide   — translates from prevRow/prevCol to row/col (100 ms, ease-out)
 *  • Pop     — scale pulse 1 → 1.15 → 1 when isMerge (150 ms)
 *  • Spawn   — scale from 0 → 1.1 → 1 when isNew (180 ms, 60 ms delay)
 *
 * Absolute positioning relative to the parent Grid container so React can
 * animate by tile identity rather than by grid slot.
 */

import React, { useEffect, useRef } from "react";
import { Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
  Easing,
} from "react-native-reanimated";
import { TileData } from "../../game/twenty48/types";
import { typography } from "../../theme/typography";
import { getTileFontSize, getTileVisual } from "./tileStyles";

function tilePos(index: number, tileSize: number, gap: number): number {
  return gap + index * (tileSize + gap);
}

interface AnimatedTileProps {
  tile: TileData;
  tileSize: number;
  gap: number;
}

export default function AnimatedTile({ tile, tileSize, gap }: AnimatedTileProps) {
  const { id, value, row, col, prevRow, prevCol, isNew, isMerge } = tile;
  const { t } = useTranslation("twenty48");
  const visual = getTileVisual(value);

  const targetTop = tilePos(row, tileSize, gap);
  const targetLeft = tilePos(col, tileSize, gap);

  const startTop = prevRow !== null ? tilePos(prevRow, tileSize, gap) : targetTop;
  const startLeft = prevCol !== null ? tilePos(prevCol, tileSize, gap) : targetLeft;

  const top = useSharedValue(startTop);
  const left = useSharedValue(startLeft);
  const scale = useSharedValue(isNew ? 0 : 1);

  useEffect(() => {
    // Slide animation — only if tile moved.
    if (startTop !== targetTop || startLeft !== targetLeft) {
      top.value = withTiming(targetTop, { duration: 100, easing: Easing.out(Easing.quad) });
      left.value = withTiming(targetLeft, { duration: 100, easing: Easing.out(Easing.quad) });
    }

    // Merge pop — brief scale pulse after slide completes.
    if (isMerge) {
      scale.value = withDelay(
        90,
        withSequence(
          withTiming(1.15, { duration: 75, easing: Easing.out(Easing.quad) }),
          withTiming(1, { duration: 75, easing: Easing.in(Easing.quad) })
        )
      );
    }

    // Spawn scale-in — delayed slightly so it appears after slide settles.
    if (isNew) {
      scale.value = withDelay(
        60,
        withSequence(
          withTiming(1.1, { duration: 100, easing: Easing.out(Easing.quad) }),
          withTiming(1, { duration: 80, easing: Easing.in(Easing.quad) })
        )
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, row, col, isNew, isMerge]); // shared values (top/left/scale) are stable refs

  // The board resized (the screen capped it to a short free height, #3688, or the window
  // changed): the shared values hold pixels from the old size, so put the tile on its new cell at
  // once. Not on mount, and not on a move (the effect above slides those).
  const sizedFor = useRef(tileSize);
  useEffect(() => {
    if (sizedFor.current === tileSize) return;
    sizedFor.current = tileSize;
    top.value = targetTop;
    left.value = targetLeft;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileSize, gap]); // only a size change; the position's own changes are the slide's

  const animStyle = useAnimatedStyle(() => ({
    top: top.value,
    left: left.value,
    transform: [{ scale: scale.value }],
  }));

  if (value === 0) {
    return (
      <Animated.View
        style={[styles.tile, { width: tileSize, height: tileSize }, animStyle]}
        accessibilityLabel={t("a11y.emptyCell")}
        accessibilityRole="image"
      />
    );
  }

  return (
    <Animated.View
      style={[styles.tile, { width: tileSize, height: tileSize }, visual.container, animStyle]}
      accessibilityLabel={String(value)}
      accessibilityRole="image"
    >
      <Text
        style={[styles.text, visual.text, { fontSize: getTileFontSize(value, tileSize) }]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  tile: {
    position: "absolute",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    fontFamily: typography.heading,
  },
});
