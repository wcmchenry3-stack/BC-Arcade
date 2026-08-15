import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import type { NoteDigit, SudokuCell as SudokuCellData } from "../../game/sudoku/types";

interface Props {
  cell: SudokuCellData;
  row: number;
  col: number;
  /** Grid size (6 for mini, 9 for classic). */
  size: number;
  selected: boolean;
  /** Non-selected cell that holds the same digit as the selected cell. */
  highlighted: boolean;
  /** Cell in the same row, column, or box as the selected cell. */
  peer: boolean;
  onPress: () => void;
}

export default function SudokuCell({
  cell,
  row,
  col,
  size,
  selected,
  highlighted,
  peer,
  onPress,
}: Props) {
  const { t } = useTranslation("sudoku");
  const { colors } = useTheme();

  // Notes occupy a 3-column grid regardless of variant; rows vary (3 for 9×9, 2 for 6×6).
  const noteDigits = Array.from({ length: size }, (_, i) => (i + 1) as NoteDigit);

  const background = selected
    ? colors.accent + "AA"
    : highlighted
      ? colors.accent + "55"
      : peer
        ? colors.accent + "22"
        : colors.surface;

  // The selected cell's background is the accent color blended over the
  // surface (`background` above), which composites to a mid-tone teal close
  // in luminance to `textMuted` (dark theme) and to `accent` itself (both
  // themes) — notes and values rendered in those colors become nearly
  // invisible (as low as ~1:1 contrast). `textOnAccent`/`errorOnAccent` are
  // tuned for text sitting on the accent color and stay legible (>4.5:1) when
  // the cell is selected.
  const valueColor = selected
    ? cell.isError
      ? colors.errorOnAccent
      : colors.textOnAccent
    : cell.given
      ? colors.text
      : cell.isError
        ? colors.error
        : colors.accent;

  const noteColor = selected ? colors.textOnAccent : colors.textMuted;

  const label = t("cell.label", {
    row: row + 1,
    col: col + 1,
    value: cell.value === 0 ? t("cell.empty") : String(cell.value),
    defaultValue: `Cell row ${row + 1}, column ${col + 1}, ${cell.value === 0 ? "empty" : cell.value}`,
  });

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={[styles.cell, { backgroundColor: background }]}
    >
      {cell.value !== 0 ? (
        <Text style={[styles.value, { color: valueColor, fontWeight: cell.given ? "700" : "600" }]}>
          {cell.value}
        </Text>
      ) : cell.notes.size > 0 ? (
        <View style={styles.notesGrid}>
          {noteDigits.map((d) => (
            <Text
              key={d}
              style={[styles.note, { color: cell.notes.has(d) ? noteColor : "transparent" }]}
            >
              {d}
            </Text>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cell: {
    flex: 1,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  value: {
    fontSize: 18,
    fontVariantNumeric: "tabular-nums",
    lineHeight: 18,
  },
  notesGrid: {
    width: "100%",
    height: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    padding: 2,
  },
  note: {
    width: "33.33%",
    textAlign: "center",
    fontSize: 9,
    lineHeight: 11,
  },
});
