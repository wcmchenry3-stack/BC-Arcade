import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { PremiumLevelNotice } from "./PremiumLevelNotice";

export interface DifficultyOption<T extends string> {
  value: T;
  label: string;
  /** A second, smaller line under the label. */
  description?: string;
  /** A premium level: shown with a lock; a tap explains it instead of picking it. */
  locked?: boolean;
  /** Gives the option a full-width row of its own. */
  fullWidth?: boolean;
}

export interface DifficultyPickerProps<T extends string> {
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
 * Sudoku, Yacht and Hearts pickers. Premium levels show a lock; tapping one
 * opens the "part of BC Arcade Premium" notice and leaves the value as it was.
 */
export function DifficultyPicker<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  testID,
}: DifficultyPickerProps<T>) {
  const { t } = useTranslation("common");
  const { colors } = useTheme();
  const [noticeVisible, setNoticeVisible] = useState(false);

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
              const textColor = selected ? colors.textOnAccent : colors.text;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => (option.locked ? setNoticeVisible(true) : onChange(option.value))}
                  accessibilityRole="radio"
                  accessibilityLabel={
                    option.locked
                      ? t("premiumLevel.lockedLabel", { level: option.label })
                      : option.label
                  }
                  accessibilityState={{ checked: selected }}
                  aria-checked={selected}
                  testID={testID ? `${testID}-${option.value}` : undefined}
                  style={[
                    styles.option,
                    { backgroundColor: selected ? colors.accent : colors.surface },
                    option.locked && styles.locked,
                  ]}
                >
                  <Text style={[styles.label, { color: textColor }]}>
                    {option.locked ? `🔒 ${option.label}` : option.label}
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
      <PremiumLevelNotice
        visible={noticeVisible}
        onClose={() => setNoticeVisible(false)}
        testID={testID ? `${testID}-premium` : undefined}
      />
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
    opacity: 0.6,
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
