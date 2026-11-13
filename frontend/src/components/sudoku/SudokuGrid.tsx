import React, { useMemo } from "react";
import { PixelRatio, Platform, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import type { Grid, Variant } from "../../game/sudoku/types";
import { variantConfig } from "../../game/sudoku/types";
import {
  unitCells,
  unitSweepDelayMs,
  waveDelayMs,
  type SudokuMotion,
} from "../../game/sudoku/motion";
import SudokuCell from "./SudokuCell";

interface Props {
  grid: Grid;
  selectedRow: number | null;
  selectedCol: number | null;
  variant: Variant;
  /** Solution string; with `showMistakes`, legal-but-wrong digits are coloured (#2943). */
  solution?: string;
  showMistakes?: boolean;
  /**
   * The board's width and height in points (#3773). The screen sizes it from the space left above
   * the controls; the digits and notes scale with it. Omitted, the board fills its parent's width.
   */
  boardSize?: number;
  /**
   * The last move's motion (#3774): where its digit landed, whether it was an error, the units it
   * completed. Only the cells it touches get props, so a move re-renders only those.
   */
  motion?: SudokuMotion | null;
  /** The solved wave is running (the beat before the result card). */
  wave?: boolean;
  /** Reduce Motion: no cell moves. */
  reduceMotion?: boolean;
  onCellPress: (row: number, col: number) => void;
}

/** The board's outer border (the thick box-border width). */
const BOARD_BORDER = 2;

export default function SudokuGrid({
  grid,
  selectedRow,
  selectedCol,
  variant,
  solution,
  showMistakes = false,
  boardSize,
  motion = null,
  wave = false,
  reduceMotion = false,
  onCellPress,
}: Props) {
  const { t } = useTranslation("sudoku");
  const { colors, theme } = useTheme();
  const { size, boxRows, boxCols } = variantConfig(variant);
  const strongColor = colors.boxBorder;
  // The board's base: cream cells sit on the raised cream in light, where `surface` is too close to
  // the page for a wash to read; dark keeps its `surface`.
  const surface = theme === "light" ? colors.surfaceHigh : colors.surface;

  // Digit of the currently-selected cell (0 = empty / nothing to match).
  const selectedValue =
    selectedRow !== null && selectedCol !== null
      ? (grid[selectedRow]?.[selectedCol]?.value ?? 0)
      : 0;

  const sameBox = (r: number, c: number, r2: number, c2: number): boolean =>
    Math.floor(r / boxRows) === Math.floor(r2 / boxRows) &&
    Math.floor(c / boxCols) === Math.floor(c2 / boxCols);

  // The selected cell's row, column and box.
  const isPeer = (r: number, c: number): boolean => {
    if (selectedRow === null || selectedCol === null) return false;
    if (r === selectedRow && c === selectedCol) return false;
    return r === selectedRow || c === selectedCol || sameBox(r, c, selectedRow, selectedCol);
  };

  // Cells that clash with a conflicting cell: the same digit in its row, column or box.
  const clashes = useMemo(() => {
    const out = new Set<number>();
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cell = grid[r]?.[c];
        if (!cell || !cell.isError || cell.value === 0) continue;
        for (let r2 = 0; r2 < size; r2++) {
          for (let c2 = 0; c2 < size; c2++) {
            if (r2 === r && c2 === c) continue;
            if (grid[r2]?.[c2]?.value !== cell.value) continue;
            if (r2 === r || c2 === c || sameBox(r, c, r2, c2)) out.add(r2 * size + c2);
          }
        }
      }
    }
    return out;
    // sameBox only reads the variant's box shape
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, size, boxRows, boxCols]);

  // When each cell of a completed unit starts to glow (a cell in two units takes the earlier).
  const sweepDelays = useMemo(() => {
    const out = new Map<number, number>();
    if (!motion) return out;
    for (const { unit, index } of motion.units) {
      const cells = unitCells(unit, index, variant);
      cells.forEach((cellIndex, i) => {
        const delay = unitSweepDelayMs(i, cells.length);
        const prev = out.get(cellIndex);
        if (prev === undefined || delay < prev) out.set(cellIndex, delay);
      });
    }
    return out;
  }, [motion, variant]);

  const cellPx = boardSize === undefined ? undefined : (boardSize - 2 * BOARD_BORDER) / size;
  const hairline = 1 / PixelRatio.get();

  return (
    <View
      accessibilityLabel={t("a11y.board")}
      // A grid on native; on web a `grid` role needs row and gridcell children (axe: aria-required-children),
      // which a View tree of buttons does not give, so it is a labelled group there.
      role={Platform.OS === "web" ? "group" : "grid"}
      testID="sudoku-board"
      style={[
        styles.grid,
        boardSize === undefined ? styles.fill : { width: boardSize, height: boardSize },
        {
          borderWidth: BOARD_BORDER,
          borderColor: strongColor,
          borderRadius: 4,
          overflow: "hidden",
        },
      ]}
    >
      {wave && !reduceMotion ? (
        // A mark for tests and tooling that the wave is running; it has no size and no role.
        <View pointerEvents="none" testID="sudoku-solved-wave" style={styles.waveMark} />
      ) : null}
      {grid.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map((cell, c) => {
            const isBoxLeft = c % boxCols === 0;
            const isBoxTop = r % boxRows === 0;
            const isBoxRight = (c + 1) % boxCols === 0;
            const isBoxBottom = (r + 1) % boxRows === 0;
            const isSelected = r === selectedRow && c === selectedCol;
            const idx = r * size + c;
            const sweepDelay = motion ? sweepDelays.get(idx) : undefined;
            return (
              <View
                key={`${r}-${c}`}
                style={{
                  flex: 1,
                  // Opaque base under the cell, so a translucent wash never lets a separator
                  // or the page show through.
                  backgroundColor: surface,
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
                  box={Math.floor(r / boxRows) * (size / boxCols) + Math.floor(c / boxCols) + 1}
                  cellPx={cellPx}
                  surface={surface}
                  selected={isSelected}
                  highlighted={selectedValue !== 0 && cell.value === selectedValue && !isSelected}
                  peer={isPeer(r, c)}
                  clash={clashes.has(idx)}
                  placeId={motion && motion.placed === idx ? motion.id : undefined}
                  errorId={motion && motion.error && motion.placed === idx ? motion.id : undefined}
                  blinkId={motion && motion.error && clashes.has(idx) ? motion.id : undefined}
                  sweepId={sweepDelay === undefined ? undefined : motion?.id}
                  sweepDelay={sweepDelay}
                  waveDelay={wave ? waveDelayMs(r, c, size) : undefined}
                  reduceMotion={reduceMotion}
                  mistake={
                    showMistakes &&
                    solution !== undefined &&
                    !cell.given &&
                    cell.value !== 0 &&
                    cell.value !== solution.charCodeAt(r * size + c) - 48
                  }
                  onPress={onCellPress}
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
    flexDirection: "column",
  },
  fill: {
    width: "100%",
    aspectRatio: 1,
  },
  row: {
    flex: 1,
    flexDirection: "row",
  },
  waveMark: {
    position: "absolute",
    width: 0,
    height: 0,
  },
});
