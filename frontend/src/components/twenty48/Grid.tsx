import React from "react";
import { View, StyleSheet, Platform, useWindowDimensions } from "react-native";
import { useTheme } from "../../theme/ThemeContext";
import {
  TWENTY48_BOARD_SHADOW_COLOR,
  TWENTY48_BOARD_SHADOW_CSS,
} from "../../theme/theme.constants";
import { TileData } from "../../game/twenty48/types";
import AnimatedTile from "./AnimatedTile";

const GRID_SIZE = 4;
const GAP = 8;
const MAX_BOARD = 360;

interface GridProps {
  tiles: TileData[];
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

export default function Grid({ tiles }: GridProps) {
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  const boardWidth = Math.min(width - 32, MAX_BOARD);
  const tileSize = (boardWidth - GAP * (GRID_SIZE + 1)) / GRID_SIZE;

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
              backgroundColor: colors.surfaceAlt,
              borderColor: colors.border,
            },
          ]}
          accessibilityRole={isEmpty ? "image" : undefined}
          accessibilityLabel={isEmpty ? "empty" : undefined}
        />
      );
    }
  }

  return (
    <View
      style={[
        styles.grid,
        { width: boardWidth, height: boardWidth, backgroundColor: colors.surface },
        BOARD_SHADOW,
      ]}
      accessible={true}
      accessibilityLabel="Game board"
    >
      {slots}
      {tiles.map((tile) => (
        <AnimatedTile key={tile.id} tile={tile} tileSize={tileSize} gap={GAP} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    borderRadius: 32,
    position: "relative",
  },
  slot: {
    position: "absolute",
    borderRadius: 6,
    borderWidth: 1,
  },
});
