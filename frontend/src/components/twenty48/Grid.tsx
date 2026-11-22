import React, { useEffect, useState } from "react";
import { View, StyleSheet, Platform, useWindowDimensions } from "react-native";
import { useTranslation } from "react-i18next";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
  cancelAnimation,
} from "react-native-reanimated";
import { useTheme } from "../../theme/ThemeContext";
import {
  TWENTY48_BOARD_SHADOW_COLOR,
  TWENTY48_BOARD_SHADOW_CSS,
} from "../../theme/theme.constants";
import { TWENTY48_DIM, TWENTY48_SLOT } from "../../theme/theme.twenty48";
import { TileData } from "../../game/twenty48/types";
import {
  GAME_OVER_DIM_AT_MS,
  GAME_OVER_DIM_MS,
  GAME_OVER_DIM_OPACITY,
  GAME_OVER_SHAKE_MS,
  GAME_OVER_SHAKE_PX,
} from "../../game/twenty48/motion";
import { useReduceMotion } from "../shared/useReduceMotion";
import AnimatedTile, { MergeGhost } from "./AnimatedTile";
import type { Beat } from "./useTwenty48Beat";

const GRID_SIZE = 4;
const GAP = 8;
const MAX_BOARD = 360;
/** The shake is this many equal steps: left, right, left, right, a half step back, rest. */
const SHAKE_STEPS = 6;

interface GridProps {
  tiles: TileData[];
  /** The most the board may take (width and height): the free height the screen measured (#3688). */
  maxSize?: number;
  /** The end-of-game beat playing: a stuck board dims and shakes (the win's is on its 2048 tile). */
  beat?: Beat;
  /** No moves left: a board the game-over beat dimmed stays dim under the card (#3725). */
  stuck?: boolean;
}

// Large drop shadow: native properties + web boxShadow via inline style.
const BOARD_SHADOW =
  Platform.OS === "web"
    ? ({ boxShadow: TWENTY48_BOARD_SHADOW_CSS } as object)
    : ({
        shadowColor: TWENTY48_BOARD_SHADOW_COLOR,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.5,
        shadowRadius: 24,
        elevation: 24,
      } as object);

export default function Grid({ tiles, maxSize, beat = null, stuck = false }: GridProps) {
  const { t } = useTranslation("twenty48");
  const { width } = useWindowDimensions();
  const { colors, theme } = useTheme();
  const reduceMotion = useReduceMotion();
  // Whether this move's merges slide (#3689): decided when the move lands, and cancelled for good
  // if Reduce Motion turns on, so turning it off again never replays a finished merge (#3725
  // review). Kept as state derived during render, the pattern React documents for it.
  const [ghostMove, setGhostMove] = useState({ tiles, animate: !reduceMotion });
  if (ghostMove.tiles !== tiles) {
    setGhostMove({ tiles, animate: !reduceMotion });
  } else if (ghostMove.animate && reduceMotion) {
    setGhostMove({ tiles, animate: false });
  }
  const showGhosts = !reduceMotion && (ghostMove.tiles === tiles ? ghostMove.animate : true);
  const boardWidth = Math.min(width - 32, MAX_BOARD, maxSize ?? Infinity);
  const tileSize = (boardWidth - GAP * (GRID_SIZE + 1)) / GRID_SIZE;

  // The game-over beat (#3689): after the last tile has settled, the stuck board dims and gives
  // a small shake. The dim stays while the board is stuck, so the board doesn't flash back to full
  // brightness between the beat ending and the card's scrim fading in (#3725). Both go on a New
  // Game, or when Reduce Motion turns on. A restored game over never played the beat: no dim.
  const dim = useSharedValue(0);
  const shake = useSharedValue(0);
  const gameOverBeat = beat === "gameOver" && !reduceMotion;
  const [dimHeld, setDimHeld] = useState(false);
  if (gameOverBeat && !dimHeld) {
    setDimHeld(true);
  } else if (dimHeld && !gameOverBeat && (!stuck || reduceMotion)) {
    setDimHeld(false);
  }
  const showDim = gameOverBeat || dimHeld;
  useEffect(() => {
    if (!showDim) {
      cancelAnimation(dim);
      cancelAnimation(shake);
      dim.value = 0;
      shake.value = 0;
      return;
    }
    if (!gameOverBeat) return; // the beat is over: the board stays dimmed where it ended
    const step = GAME_OVER_SHAKE_MS / SHAKE_STEPS;
    const px = GAME_OVER_SHAKE_PX;
    dim.value = withDelay(
      GAME_OVER_DIM_AT_MS,
      withTiming(GAME_OVER_DIM_OPACITY, { duration: GAME_OVER_DIM_MS })
    );
    shake.value = withDelay(
      GAME_OVER_DIM_AT_MS,
      withSequence(
        withTiming(-px, { duration: step }),
        withTiming(px, { duration: step }),
        withTiming(-px, { duration: step }),
        withTiming(px, { duration: step }),
        withTiming(-px / 2, { duration: step }),
        withTiming(0, { duration: step })
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDim, gameOverBeat]); // shared values are stable refs
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.value }));

  // Render empty slot backgrounds so the grid looks filled even with no tiles.
  const occupiedCells = new Set(tiles.map((t) => `${t.row}-${t.col}`));
  const slots = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const top = GAP + r * (tileSize + GAP);
      const left = GAP + c * (tileSize + GAP);
      const isEmpty = !occupiedCells.has(`${r}-${c}`);
      slots.push(
        <View
          key={`slot-${r}-${c}`}
          style={[
            styles.slot,
            {
              width: tileSize,
              height: tileSize,
              top,
              left,
              backgroundColor: TWENTY48_SLOT[theme],
            },
          ]}
          accessibilityRole={isEmpty ? "image" : undefined}
          accessibilityLabel={isEmpty ? t("a11y.emptyCell") : undefined}
        />
      );
    }
  }

  return (
    <Animated.View
      style={[
        styles.grid,
        { width: boardWidth, height: boardWidth, backgroundColor: colors.surface },
        BOARD_SHADOW,
        shakeStyle,
      ]}
      accessible={true}
      accessibilityLabel={t("a11y.board")}
    >
      {slots}
      {/* The two tiles of each merge slide into it (#3689); not under Reduce Motion. */}
      {showGhosts &&
        tiles.flatMap((tile) =>
          (tile.mergedFrom ?? []).map((source) => (
            <MergeGhost
              key={`ghost-${tile.id}-${source.id}`}
              tile={tile}
              source={source}
              tileSize={tileSize}
              gap={GAP}
            />
          ))
        )}
      {tiles.map((tile) => (
        <AnimatedTile
          key={tile.id}
          tile={tile}
          tileSize={tileSize}
          gap={GAP}
          reduceMotion={reduceMotion}
        />
      ))}
      {showDim && (
        <Animated.View
          testID="twenty48-dim"
          style={[styles.dim, { backgroundColor: TWENTY48_DIM }, dimStyle]}
        />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  grid: {
    borderRadius: 32,
    position: "relative",
  },
  slot: {
    position: "absolute",
    borderRadius: 8,
  },
  dim: {
    ...StyleSheet.absoluteFill,
    borderRadius: 32,
    pointerEvents: "none",
  },
});
