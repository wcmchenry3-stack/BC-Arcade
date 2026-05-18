import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import type { Difficulty } from "../../game/sudoku/types";
import { DIFFICULTIES } from "../../game/sudoku/types";

interface Props {
  value: Difficulty;
  onChange: (d: Difficulty) => void;
}

export default function DifficultySelector({ value, onChange }: Props) {
  const { t } = useTranslation("sudoku");
  const { colors } = useTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t("difficulty.groupLabel", {
        defaultValue: "Difficulty",
      })}
      style={[styles.row, { borderColor: colors.border }]}
    >
      {DIFFICULTIES.map((d) => {
        const selected = d === value;
        return (
          <Pressable
            key={d}
            onPress={() => onChange(d)}
            accessibilityRole="radio"
            accessibilityLabel={t(`difficulty.${d}`, {
              defaultValue: d === "easy" ? "Easy" : d === "medium" ? "Medium" : "Hard",
            })}
            accessibilityState={{ selected }}
            aria-checked={selected}
            style={[
              styles.btn,
              {
                backgroundColor: selected ? colors.accent : colors.surface,
              },
            ]}
          >
            <Text style={[styles.label, { color: selected ? colors.textOnAccent : colors.text }]}>
              {t(`difficulty.${d}`, {
                defaultValue: d === "easy" ? "Easy" : d === "medium" ? "Medium" : "Hard",
              })}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 8,
    overflow: "hidden",
  },
  btn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
  },
});
