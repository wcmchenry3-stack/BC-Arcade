import React from "react";
import { PixelRatio, StyleSheet, View } from "react-native";
import { useTheme } from "../../theme/ThemeContext";
import type { Grid, Variant } from "../../game/sudoku/types";
import { variantConfig } from "../../game/sudoku/types";
import SudokuCell from "./SudokuCell";

interface Props {
  grid: Grid;
  selectedRow: number | null;
  selectedCol: number | null;
  variant: Variant;
  onCellPress: (row: number, col: number) => void;
}

export default function SudokuGrid({
  grid,
  selectedRow,
  selectedCol,
  variant,
  onCellPress,
}: Props) {
  const { colors, theme } = useTheme();
  const { size, boxRows, boxCols } = variantConfig(variant);
  const strongColor = theme === "dark" ? colors.textFilled : colors.text;

  // Digit of the currently-selected cell (0 = empty / nothing to match).
  const selectedValue =
    selectedRow !== null && selectedCol !== null
      ? (grid[selectedRow]?.[selectedCol]?.value ?? 0)
      : 0;

  const isPeer = (r: number, c: number): boolean => {
    if (selectedRow === null || selectedCol === null) return false;
    if (r === selectedRow && c === selectedCol) return false;
    return r === selectedRow || c === selectedCol;
  };

  return (
    <View
      accessibilityLabel="Sudoku board"
      style={[
        styles.grid,
        { borderWidth: 2, borderColor: strongColor, borderRadius: 4, overflow: "hidden" },
      ]}
    >
      {grid.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map((cell, c) => {
            const isBoxLeft = c % boxCols === 0;
            const isBoxTop = r % boxRows === 0;
            const isBoxRight = (c + 1) % boxCols === 0;
            const isBoxBottom = (r + 1) % boxRows === 0;
            const hairline = 1 / PixelRatio.get();
            return (
              <View
                key={`${r}-${c}`}
                style={{
                  flex: 1,
                  borderLeftWidth: c === 0 ? 0 : isBoxLeft ? 2 : hairline,
                  borderLeftColor: isBoxLeft ? strongColor : colors.border,
                  borderTopWidth: r === 0 ? 0 : isBoxTop ? 2 : hairline,
                  borderTopColor: isBoxTop ? strongColor : colors.border,
                  borderRightWidth: c === size - 1 ? 0 : isBoxRight ? 2 : hairline,
                  borderRightColor: isBoxRight ? strongColor : colors.border,
                  borderBottomWidth: r === size - 1 ? 0 : isBoxBottom ? 2 : hairline,
                  borderBottomColor: isBoxBottom ? strongColor : colors.border,
                }}
              >
                <SudokuCell
                  cell={cell}
                  row={r}
                  col={c}
                  size={size}
                  selected={r === selectedRow && c === selectedCol}
                  highlighted={
                    selectedValue !== 0 &&
                    cell.value === selectedValue &&
                    !(r === selectedRow && c === selectedCol)
                  }
                  peer={isPeer(r, c)}
                  onPress={() => onCellPress(r, c)}
                />
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    width: "100%",
    aspectRatio: 1,
    flexDirection: "column",
  },
  row: {
    flex: 1,
    flexDirection: "row",
  },
});
