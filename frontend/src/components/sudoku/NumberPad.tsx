import React, { useMemo } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import type { CellValue, Grid, Variant } from "../../game/sudoku/types";
import { variantConfig } from "../../game/sudoku/types";

interface Props {
  /** Used to compute which digits already have all instances placed. */
  grid: Grid;
  variant: Variant;
  notesMode: boolean;
  onDigit: (digit: CellValue) => void;
  /** Key height in points (at least 44; the screen shrinks it on a short phone). */
  keyHeight?: number;
  /** Gap between keys, in points. */
  gap?: number;
  /**
   * Shown in place of the digit keys (#2943) on a full-but-wrong grid: no empty
   * cell is left to type into, so the player fixes a cell with Hint, or with
   * Erase and then a digit (the keys come back once the grid isn't full).
   */
  message?: string;
}

/** A pressed key's scale and opacity (#3774). */
const KEY_PRESSED_SCALE = 0.96;
const KEY_PRESSED_OPACITY = 0.8;

function countValue(grid: Grid, digit: CellValue): number {
  let n = 0;
  for (const row of grid) for (const cell of row) if (cell.value === digit) n++;
  return n;
}

/**
 * The digit keys, in two centred rows (5 + 4 on a 9×9, 3 + 3 on a 6×6, #3773), each showing its
 * digit and how many of it remain. Erase, Notes, Hint and New Game are the action bar's.
 */
export default function NumberPad({
  grid,
  variant,
  notesMode,
  onDigit,
  keyHeight = 52,
  gap = 4,
  message,
}: Props) {
  const { t } = useTranslation("sudoku");
  const { colors } = useTheme();
  const { size } = variantConfig(variant);

  const digits = useMemo<readonly CellValue[]>(
    () => Array.from({ length: size }, (_, i) => (i + 1) as CellValue),
    [size]
  );

  const counts = useMemo<ReadonlyMap<CellValue, number>>(() => {
    const m = new Map<CellValue, number>();
    for (const d of digits) m.set(d, countValue(grid, d));
    return m;
  }, [grid, digits]);

  // 5 keys across; the second row's keys are as wide as the first's and centred. In percent of the
  // pad's width, so no layout pass is needed: half the empty keys' width, plus half a gap, each side.
  const firstRow = size === 9 ? 5 : 3;
  const rows = [digits.slice(0, firstRow), digits.slice(firstRow)];
  const sidePad = (n: number) => `${((5 - n) / 10) * 100}%` as const;

  if (message) {
    return (
      <View style={[styles.pad, { minHeight: 2 * keyHeight + gap }]}>
        <View
          testID="sudoku-full-wrong"
          accessibilityRole="alert"
          accessibilityLiveRegion={Platform.OS === "android" ? "polite" : undefined}
          style={[styles.message, { borderColor: colors.error }]}
        >
          <Text style={[styles.messageText, { color: colors.text }]}>{message}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.pad, { gap }]} testID="sudoku-keys">
      {rows.map((row, i) => (
        <View
          key={i}
          testID={`sudoku-keys-row-${i + 1}`}
          style={[styles.row, { gap, paddingHorizontal: row.length < 5 ? sidePad(row.length) : 0 }]}
        >
          {row.map((d) => {
            const remaining = Math.max(0, size - (counts.get(d) ?? 0));
            const disabled = remaining <= 0;
            return (
              <Pressable
                key={d}
                testID={`sudoku-digit-${d}`}
                onPress={() => onDigit(d)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={t("numberPad.digit", { digit: d, remaining })}
                accessibilityState={{ disabled }}
                style={({ pressed }) => [
                  styles.key,
                  // The pressed dip (#3774): press feedback, not motion, so Reduce Motion keeps it.
                  pressed && !disabled && styles.keyPressed,
                  {
                    height: keyHeight,
                    backgroundColor: colors.surfaceHigh,
                    // Notes on: the keys turn into dashed note keys, so the mode reads at a glance.
                    borderColor: notesMode ? colors.accentText : colors.border,
                    borderStyle: notesMode ? "dashed" : "solid",
                    borderWidth: notesMode ? 1.5 : 1,
                    opacity: disabled ? 0.32 : pressed ? KEY_PRESSED_OPACITY : 1,
                  },
                ]}
              >
                <Text
                  allowFontScaling={false}
                  style={[
                    styles.digit,
                    {
                      color: notesMode ? colors.accentText : colors.text,
                      fontSize: notesMode ? 20 : keyHeight < 52 ? 22 : 28,
                    },
                  ]}
                >
                  {d}
                </Text>
                <Text
                  allowFontScaling={false}
                  style={[styles.remaining, { color: colors.textMuted }]}
                >
                  {disabled ? " " : remaining}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pad: {
    alignSelf: "stretch",
  },
  row: {
    flexDirection: "row",
    justifyContent: "center",
  },
  key: {
    flex: 1,
    minWidth: 44,
    minHeight: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  // A key pressed in: a little smaller and dimmer, back as the finger lifts.
  keyPressed: {
    transform: [{ scale: KEY_PRESSED_SCALE }],
  },
  digit: {
    fontFamily: typography.heading,
    textAlign: "center",
    includeFontPadding: false,
  },
  remaining: {
    fontFamily: typography.label,
    fontSize: 10.5,
    lineHeight: 12,
    marginTop: 2,
    textAlign: "center",
    includeFontPadding: false,
  },
  message: {
    flex: 1,
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  messageText: {
    fontSize: 13,
    lineHeight: 17,
    textAlign: "center",
  },
});
