import React, { useMemo } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import type { CellValue, Grid, Variant } from "../../game/sudoku/types";
import { variantConfig } from "../../game/sudoku/types";

interface Props {
  /** Used to compute which digits already have all instances placed. */
  grid: Grid;
  variant: Variant;
  notesMode: boolean;
  onDigit: (digit: CellValue) => void;
  onErase: () => void;
  onToggleNotes: () => void;
  onHint: () => void;
  /**
   * Shown in place of the digit row (#2943) on a full-but-wrong grid: no empty
   * cell is left to type into, so the player fixes a cell with Hint, or with
   * Erase and then a digit (the row comes back once the grid isn't full).
   */
  message?: string;
}

function countValue(grid: Grid, digit: CellValue): number {
  let n = 0;
  for (const row of grid) for (const cell of row) if (cell.value === digit) n++;
  return n;
}

export default function NumberPad({
  grid,
  variant,
  notesMode,
  onDigit,
  onErase,
  onToggleNotes,
  onHint,
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

  return (
    <View style={styles.pad}>
      {message ? (
        <View
          testID="sudoku-full-wrong"
          accessibilityRole="alert"
          accessibilityLiveRegion={Platform.OS === "android" ? "polite" : undefined}
          style={[styles.message, { maxWidth: 360, borderColor: colors.error }]}
        >
          <Text style={[styles.messageText, { color: colors.text }]}>{message}</Text>
        </View>
      ) : (
        <View style={[styles.digitRow, { maxWidth: 360 }]}>
          {digits.map((d) => {
            const placed = counts.get(d) ?? 0;
            const remaining = size - placed;
            const disabled = remaining <= 0;
            return (
              <Pressable
                key={d}
                testID={`sudoku-digit-${d}`}
                onPress={() => onDigit(d)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={t("numberPad.digit", {
                  digit: d,
                  defaultValue: `Enter digit ${d}`,
                })}
                accessibilityState={{ disabled }}
                style={[
                  styles.digitBtn,
                  {
                    backgroundColor: colors.surfaceHigh,
                    borderColor: colors.border,
                    opacity: disabled ? 0.35 : 1,
                  },
                ]}
              >
                <Text style={[styles.digitText, { color: colors.text }]}>{d}</Text>
                <Text style={[styles.remainingText, { color: colors.textMuted }]}>{remaining}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      <View style={styles.toolRow}>
        <Pressable
          onPress={onErase}
          accessibilityRole="button"
          accessibilityLabel={t("numberPad.erase", { defaultValue: "Erase cell" })}
          style={[styles.toolBtn, { borderColor: colors.accent }]}
        >
          <Text style={[styles.toolText, { color: colors.accent }]}>
            {t("numberPad.eraseShort", { defaultValue: "Erase" })}
          </Text>
        </Pressable>
        <Pressable
          onPress={onToggleNotes}
          accessibilityRole="button"
          accessibilityLabel={t("numberPad.toggleNotes", {
            defaultValue: "Toggle pencil marks",
          })}
          accessibilityState={{ selected: notesMode }}
          style={[
            styles.toolBtn,
            {
              borderColor: colors.accent,
              backgroundColor: notesMode ? colors.accent : "transparent",
            },
          ]}
        >
          <Text
            style={[styles.toolText, { color: notesMode ? colors.textOnAccent : colors.accent }]}
          >
            {t("numberPad.notes", { defaultValue: "Notes" })}
          </Text>
        </Pressable>
        <Pressable
          testID="sudoku-hint"
          onPress={onHint}
          accessibilityRole="button"
          accessibilityLabel={t("action.hint", { defaultValue: "Hint" })}
          style={[styles.toolBtn, { borderColor: colors.accent }]}
        >
          <Text style={[styles.toolText, { color: colors.accent }]}>
            {t("action.hint", { defaultValue: "Hint" })}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: {
    alignItems: "center",
    gap: 12,
    width: "100%",
  },
  digitRow: {
    flexDirection: "row",
    gap: 4,
    width: "100%",
  },
  digitBtn: {
    flex: 1,
    aspectRatio: 0.85,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  digitText: {
    fontSize: 20,
    fontWeight: "700",
    fontFamily: "SpaceGrotesk",
    textAlign: "center",
  },
  remainingText: {
    fontSize: 9,
    fontWeight: "600",
    textAlign: "center",
  },
  // About the digit row's footprint (a digit button is 0.85 as wide as tall);
  // the text wraps freely and is small enough for the longest locale.
  message: {
    width: "100%",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  messageText: {
    fontSize: 12,
    lineHeight: 15,
    textAlign: "center",
  },
  toolRow: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
  },
  toolBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  toolText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
});
