import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../theme/ThemeContext";
import { PREMIUM_LEVEL_OPACITY, usePremiumLevels } from "./usePremiumLevels";

export interface DifficultyOption<T extends string> {
  value: T;
  label: string;
  /** A second, smaller line under the label. */
  description?: string;
  /** Gives the option a full-width row of its own. */
  fullWidth?: boolean;
}

export interface DifficultyPickerProps<T extends string> {
  /** The game whose premium levels (`entitlements/premiumLevels.ts`) are locked. */
  gameKey: string;
  options: readonly DifficultyOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Screen-reader name of the radio group. */
  accessibilityLabel: string;
  /** Options get `${testID}-${value}`; the premium notice gets `${testID}-premium`. */
  testID?: string;
}

/** Splits options into rows: runs of ordinary options, and each full-width one alone. */
function toRows<T extends string>(options: readonly DifficultyOption<T>[]) {
  const rows: DifficultyOption<T>[][] = [];
  let run: DifficultyOption<T>[] = [];
  for (const option of options) {
    if (option.fullWidth) {
      if (run.length > 0) rows.push(run);
      rows.push([option]);
      run = [];
    } else {
      run.push(option);
    }
  }
  if (run.length > 0) rows.push(run);
  return rows;
}

/**
 * Segmented radio group for a game's difficulty (#1129), shared by the
 * Sudoku, Yacht and Hearts pickers. The game's premium levels show a lock;
 * tapping one opens the "part of BC Arcade Premium" notice and leaves the
 * value as it was.
 */
export function DifficultyPicker<T extends string>({
  gameKey,
  options,
  value,
  onChange,
  accessibilityLabel,
  testID,
}: DifficultyPickerProps<T>) {
  const { colors } = useTheme();
  const premium = usePremiumLevels(gameKey, testID ? `${testID}-premium` : undefined);

  return (
    <>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={accessibilityLabel}
        style={[styles.group, { borderColor: colors.border }]}
      >
        {toRows(options).map((row, rowIndex) => (
          <View
            key={row[0]!.value}
            style={[
              styles.row,
              rowIndex > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
            ]}
          >
            {row.map((option) => {
              const selected = option.value === value;
              const locked = premium.isLocked(option.value);
              const textColor = selected ? colors.textOnAccent : colors.text;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => (locked ? premium.explain() : onChange(option.value))}
                  accessibilityRole="radio"
                  accessibilityLabel={locked ? premium.lockedLabel(option.label) : option.label}
                  accessibilityState={{ checked: selected }}
                  aria-checked={selected}
                  testID={testID ? `${testID}-${option.value}` : undefined}
                  style={[
                    styles.option,
                    { backgroundColor: selected ? colors.accent : colors.surface },
                    locked && styles.locked,
                  ]}
                >
                  <Text style={[styles.label, { color: textColor }]}>
                    {locked ? premium.lockedText(option.label) : option.label}
                  </Text>
                  {option.description !== undefined && (
                    <Text
                      style={[
                        styles.description,
                        { color: selected ? colors.textOnAccent : colors.textMuted },
                      ]}
                    >
                      {option.description}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
      {premium.notice}
    </>
  );
}

const styles = StyleSheet.create({
  group: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 8,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
  },
  option: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  locked: {
    opacity: PREMIUM_LEVEL_OPACITY,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
  },
  description: {
    fontSize: 11,
    textAlign: "center",
  },
});
