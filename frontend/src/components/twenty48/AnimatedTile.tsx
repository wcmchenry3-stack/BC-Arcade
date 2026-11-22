/**
 * AnimatedTile — renders a single 2048 tile. Every time is in `game/twenty48/motion.ts`.
 *
 *  • Slide   — translates from prevRow/prevCol to row/col (ease-out)
 *  • Merge   — the two tiles a merge was made from (`MergeGhost`, one per `mergedFrom`) slide into
 *              the destination; as they meet, the merged tile appears and pops (the 2048 tile
 *              with a bigger pop and a glow). A tile with no `mergedFrom` (a save from before it)
 *              just pops where it is.
 *  • Spawn   — scales in from a small tile while it fades in, starting while the slide finishes
 *
 * Under Reduce Motion nothing animates: the tile is on its cell, at full size, at once. It is
 * read live: turning it on mid-move snaps every tile to rest.
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
  cancelAnimation,
  Easing,
} from "react-native-reanimated";
import { MergeSource, TileData } from "../../game/twenty48/types";
import {
  MERGE_POP_DOWN_MS,
  MERGE_POP_SCALE,
  MERGE_POP_UP_MS,
  SLIDE_MS,
  SPAWN_AT_MS,
  SPAWN_DOWN_MS,
  SPAWN_FROM_SCALE,
  SPAWN_SCALE,
  SPAWN_UP_MS,
  WIN_GLOW_MS,
  WIN_POP_DOWN_MS,
  WIN_POP_SCALE,
  WIN_POP_UP_MS,
  WIN_TILE_VALUE,
} from "../../game/twenty48/motion";
import { TWENTY48_TOP_TILE_GLOW } from "../../theme/theme.twenty48";
import { typography } from "../../theme/typography";
import { getTileFontSize, getTileVisual } from "./tileStyles";

function tilePos(index: number, tileSize: number, gap: number): number {
  return gap + index * (tileSize + gap);
}

/** How far the win glow reaches past the tile's edge, as a share of the tile. */
const GLOW_REACH = 0.12;
/** The glow's brightest point, and the share of `WIN_GLOW_MS` it takes to get there. */
const GLOW_PEAK = 0.7;
const GLOW_RISE_SHARE = 0.25;

interface AnimatedTileProps {
  tile: TileData;
  tileSize: number;
  gap: number;
  /** Reduce Motion, read live by the Grid. */
  reduceMotion?: boolean;
}

export default function AnimatedTile({
  tile,
  tileSize,
  gap,
  reduceMotion = false,
}: AnimatedTileProps) {
  const { id, value, row, col, prevRow, prevCol, isNew, isMerge, mergedFrom } = tile;
  const { t } = useTranslation("twenty48");
  const visual = getTileVisual(value);

  const targetTop = tilePos(row, tileSize, gap);
  const targetLeft = tilePos(col, tileSize, gap);

  const slides = !reduceMotion && prevRow !== null && prevCol !== null;
  const startTop = slides && prevRow !== null ? tilePos(prevRow, tileSize, gap) : targetTop;
  const startLeft = slides && prevCol !== null ? tilePos(prevCol, tileSize, gap) : targetLeft;
  // A merged tile waits, unseen, for its two sources to meet; a spawned one waits for its moment.
  const waits = !reduceMotion && ((isMerge && !!mergedFrom?.length) || isNew);
  const isWin = isMerge && value === WIN_TILE_VALUE;

  const top = useSharedValue(startTop);
  const left = useSharedValue(startLeft);
  const scale = useSharedValue(!reduceMotion && isNew ? SPAWN_FROM_SCALE : 1);
  const opacity = useSharedValue(waits ? 0 : 1);
  const glow = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(top);
      cancelAnimation(left);
      cancelAnimation(scale);
      cancelAnimation(opacity);
      cancelAnimation(glow);
      top.value = targetTop;
      left.value = targetLeft;
      scale.value = 1;
      opacity.value = 1;
      glow.value = 0;
      return;
    }

    // Slide animation — only if tile moved.
    if (startTop !== targetTop || startLeft !== targetLeft) {
      top.value = withTiming(targetTop, { duration: SLIDE_MS, easing: Easing.out(Easing.quad) });
      left.value = withTiming(targetLeft, { duration: SLIDE_MS, easing: Easing.out(Easing.quad) });
    }

    // Merge — the tile appears as its sources meet, with a pop (bigger, with a glow, for 2048).
    if (isMerge) {
      const up = isWin ? WIN_POP_SCALE : MERGE_POP_SCALE;
      const upMs = isWin ? WIN_POP_UP_MS : MERGE_POP_UP_MS;
      const downMs = isWin ? WIN_POP_DOWN_MS : MERGE_POP_DOWN_MS;
      if (mergedFrom?.length) {
        opacity.value = withDelay(SLIDE_MS, withTiming(1, { duration: 1 }));
      }
      scale.value = withDelay(
        SLIDE_MS,
        withSequence(
          withTiming(up, { duration: upMs, easing: Easing.out(Easing.quad) }),
          withTiming(1, { duration: downMs, easing: Easing.in(Easing.quad) })
        )
      );
      if (isWin) {
        glow.value = withDelay(
          SLIDE_MS,
          withSequence(
            withTiming(GLOW_PEAK, { duration: WIN_GLOW_MS * GLOW_RISE_SHARE }),
            withTiming(0, { duration: WIN_GLOW_MS * (1 - GLOW_RISE_SHARE) })
          )
        );
      }
    }

    // Spawn — the new tile grows in, starting while the slide is still finishing.
    if (isNew) {
      opacity.value = withDelay(SPAWN_AT_MS, withTiming(1, { duration: 1 }));
      scale.value = withDelay(
        SPAWN_AT_MS,
        withSequence(
          withTiming(SPAWN_SCALE, { duration: SPAWN_UP_MS, easing: Easing.out(Easing.quad) }),
          withTiming(1, { duration: SPAWN_DOWN_MS, easing: Easing.in(Easing.quad) })
        )
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, row, col, isNew, isMerge]); // shared values are stable refs; Reduce Motion is read live below

  // Reduce Motion turned on mid-move (docs/ACCESSIBILITY.md section 3): stop everything where it
  // is going and show the tile at rest. Turning it off again changes nothing (no replay).
  useEffect(() => {
    if (!reduceMotion) return;
    cancelAnimation(top);
    cancelAnimation(left);
    cancelAnimation(scale);
    cancelAnimation(opacity);
    cancelAnimation(glow);
    top.value = targetTop;
    left.value = targetLeft;
    scale.value = 1;
    opacity.value = 1;
    glow.value = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

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
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  if (value === 0) {
    return (
      <Animated.View
        style={[styles.tile, { width: tileSize, height: tileSize }, animStyle]}
        accessibilityLabel={t("a11y.emptyCell")}
        accessibilityRole="image"
      />
    );
  }

  const reach = Math.round(tileSize * GLOW_REACH);
  return (
    <Animated.View
      style={[styles.tile, { width: tileSize, height: tileSize }, visual.container, animStyle]}
      accessibilityLabel={String(value)}
      accessibilityRole="image"
    >
      {isWin && !reduceMotion && (
        <Animated.View
          testID="twenty48-win-glow"
          style={[
            styles.glow,
            { top: -reach, left: -reach, right: -reach, bottom: -reach },
            glowStyle,
          ]}
        />
      )}
      <Text
        style={[styles.text, visual.text, { fontSize: getTileFontSize(value, tileSize) }]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </Animated.View>
  );
}

interface MergeGhostProps {
  /** The merged tile the source slides into. */
  tile: TileData;
  source: MergeSource;
  tileSize: number;
  gap: number;
}

/**
 * One of the two tiles a merge was made from: it slides from its cell into the merged tile's, and
 * is gone as they meet (the merged tile appears then). Only for the look; nothing reads it.
 */
export function MergeGhost({ tile, source, tileSize, gap }: MergeGhostProps) {
  const half = tile.value / 2;
  const visual = getTileVisual(half);
  const targetTop = tilePos(tile.row, tileSize, gap);
  const targetLeft = tilePos(tile.col, tileSize, gap);
  const top = useSharedValue(tilePos(source.row, tileSize, gap));
  const left = useSharedValue(tilePos(source.col, tileSize, gap));
  const opacity = useSharedValue(1);

  useEffect(() => {
    top.value = withTiming(targetTop, { duration: SLIDE_MS, easing: Easing.out(Easing.quad) });
    left.value = withTiming(targetLeft, { duration: SLIDE_MS, easing: Easing.out(Easing.quad) });
    opacity.value = withDelay(SLIDE_MS, withTiming(0, { duration: 1 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // one slide, from mount

  const animStyle = useAnimatedStyle(() => ({
    top: top.value,
    left: left.value,
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      testID={`twenty48-ghost-${tile.id}-${source.id}`}
      aria-hidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.tile, { width: tileSize, height: tileSize }, visual.container, animStyle]}
    >
      <Text
        style={[styles.text, visual.text, { fontSize: getTileFontSize(half, tileSize) }]}
        numberOfLines={1}
      >
        {half}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  tile: {
    pointerEvents: "none",
    position: "absolute",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    fontFamily: typography.heading,
  },
  glow: {
    pointerEvents: "none",
    position: "absolute",
    borderRadius: 16,
    backgroundColor: TWENTY48_TOP_TILE_GLOW,
  },
});
