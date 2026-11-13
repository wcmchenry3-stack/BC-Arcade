import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useTheme, type Colors } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import { SUDOKU_WASHES } from "../../theme/theme.sudoku";
import type { NoteDigit, SudokuCell as SudokuCellData } from "../../game/sudoku/types";
import { cellBackground, cellMetrics } from "./cellStyle";

interface Props {
  cell: SudokuCellData;
  row: number;
  col: number;
  /** Grid size (6 for mini, 9 for classic). */
  size: number;
  /** The 1-based number of the cell's box, left to right then top to bottom (for the label). */
  box?: number;
  /** The cell's width in points: digit and note sizes come from it. The default is a 9×9 board on a small phone. */
  cellPx?: number;
  /** The base surface the washes lie over. */
  surface?: string;
  selected: boolean;
  /** Non-selected cell that holds the same digit as the selected cell. */
  highlighted: boolean;
  /** Cell in the same row, column, or box as the selected cell. */
  peer: boolean;
  /** Legal but wrong digit, shown as a mistake when "Show mistakes" is on (#2943). */
  mistake?: boolean;
  /**
   * A cell that holds the same digit as a conflicting cell, in its row, column or box: the other
   * half of the clash. Drawn as a red ring (#3773).
   */
  clash?: boolean;
  /** Stable across renders (the screen's `useCallback`): the cell passes its own row and column. */
  onPress: (row: number, col: number) => void;
}

interface LabelInput {
  cell: SudokuCellData;
  row: number;
  col: number;
  box?: number;
  notes: readonly NoteDigit[];
  conflict: boolean;
  mistake: boolean;
  clash: boolean;
}

/**
 * The screen-reader label (#3773): row, column and value first (a short query still matches), then
 * given or entered, the box, the notes of an empty cell, and what is wrong, if anything.
 */
function cellLabel(t: TFunction<"sudoku">, i: LabelInput): string {
  const { cell } = i;
  const parts = [
    t("cell.label", {
      row: i.row + 1,
      col: i.col + 1,
      value: cell.value === 0 ? t("cell.empty") : String(cell.value),
    }),
  ];
  if (cell.value !== 0) parts.push(cell.given ? t("cell.given") : t("cell.entered"));
  if (i.box !== undefined) parts.push(t("cell.box", { box: i.box }));
  if (cell.value === 0 && cell.notes.size > 0) {
    parts.push(t("cell.notes", { notes: i.notes.filter((d) => cell.notes.has(d)).join(" ") }));
  }
  if (i.conflict) parts.push(t("cell.conflict"));
  else if (i.mistake) parts.push(t("cell.mistake"));
  if (i.clash) parts.push(t("cell.clash"));
  return parts.join(", ");
}

/**
 * A digit's colour. The selected cell is solid accent: `textOnAccent` / `errorOnAccent` are tuned
 * for text on it. Elsewhere a given is plain text, the player's own digit is `accentText`, and a
 * flagged one (conflict or mistake) is `errorText`.
 */
function digitColor(colors: Colors, given: boolean, selected: boolean, flagged: boolean): string {
  if (selected) return flagged ? colors.errorOnAccent : colors.textOnAccent;
  if (given) return colors.text;
  return flagged ? colors.errorText : colors.accentText;
}

function SudokuCellImpl({
  cell,
  row,
  col,
  size,
  box,
  cellPx = 32,
  surface,
  selected,
  highlighted,
  peer,
  mistake = false,
  clash = false,
  onPress,
}: Props) {
  const { t } = useTranslation("sudoku");
  const { colors, theme } = useTheme();
  const m = cellMetrics(cellPx);

  // A rule conflict (red digit, red wash, and a ring on the cells it clashes with) outranks a
  // mistake (red digit with an underline): a duplicate is the more specific fault.
  const conflict = cell.isError;
  const showMistake = mistake && !conflict;

  const background = cellBackground({
    base: surface ?? colors.surface,
    selectedFill: colors.accent,
    washes: SUDOKU_WASHES[theme],
    selected,
    peer,
    sameDigit: highlighted,
    conflict,
  });

  const valueColor = digitColor(colors, cell.given, selected, conflict || showMistake);

  const noteColor = selected ? colors.textOnAccent : colors.textMuted;

  // Notes sit in a 3-column grid regardless of variant: 3 rows for 9×9, 2 for 6×6.
  const noteDigits = useMemo(
    () => Array.from({ length: size }, (_, i) => (i + 1) as NoteDigit),
    [size]
  );
  const noteRows = Math.ceil(size / 3);

  const label = useMemo(
    () =>
      cellLabel(t, {
        cell,
        row,
        col,
        box,
        notes: noteDigits,
        conflict,
        mistake: showMistake,
        clash,
      }),
    [t, cell, row, col, box, noteDigits, conflict, showMistake, clash]
  );

  return (
    <Pressable
      onPress={() => onPress(row, col)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      testID={`sudoku-cell-${row}-${col}`}
      style={[styles.cell, { backgroundColor: background }]}
    >
      {cell.value !== 0 ? (
        <View>
          <Text
            allowFontScaling={false}
            style={[
              styles.value,
              { color: valueColor, fontSize: m.digit, lineHeight: m.digit + 2 },
            ]}
          >
            {cell.value}
          </Text>
          {showMistake ? (
            <View
              testID={`sudoku-cell-${row}-${col}-mistake`}
              style={[
                styles.mark,
                {
                  backgroundColor: selected ? colors.errorOnAccent : colors.error,
                  height: m.markThickness,
                  bottom: -m.markGap,
                },
              ]}
            />
          ) : null}
        </View>
      ) : cell.notes.size > 0 ? (
        <View style={styles.notesGrid}>
          {noteDigits.map((d) => (
            <View key={d} style={[styles.noteSlot, { height: `${100 / noteRows}%` }]}>
              <Text
                allowFontScaling={false}
                style={[
                  styles.note,
                  {
                    color: cell.notes.has(d) ? noteColor : "transparent",
                    fontSize: m.note,
                    lineHeight: m.note + 1,
                  },
                ]}
              >
                {d}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {clash ? (
        <View
          pointerEvents="none"
          testID={`sudoku-cell-${row}-${col}-clash`}
          style={[styles.ring, { borderColor: colors.error }]}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cell: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  value: {
    fontFamily: typography.heading,
    fontVariant: ["tabular-nums"],
    textAlign: "center",
    includeFontPadding: false,
  },
  // The underline of a mistake: it sits under the digit, inside the cell.
  mark: {
    position: "absolute",
    left: "8%",
    right: "8%",
    borderRadius: 2,
  },
  notesGrid: {
    width: "100%",
    height: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 1,
  },
  noteSlot: {
    width: "33.33%",
    alignItems: "center",
    justifyContent: "center",
  },
  note: {
    fontFamily: typography.label,
    textAlign: "center",
    includeFontPadding: false,
  },
  // The ring of a clashing cell: drawn over the cell's edge, never moves the digit.
  ring: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 2,
  },
});

/**
 * Memoised (#3773): a tap changes a handful of cells (the selection, its row, column and box, the
 * digit's twins); every other cell has the same props and skips its render and its label.
 */
const SudokuCell = React.memo(SudokuCellImpl);
export default SudokuCell;
