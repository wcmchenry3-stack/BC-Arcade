import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import type { AiDifficulty } from "../../game/yacht/types";
import { AI_DIFFICULTIES } from "../../game/yacht/types";

interface Props {
  value: AiDifficulty;
  onChange: (d: AiDifficulty) => void;
}

export default function AiDifficultySelector({ value, onChange }: Props) {
  const { t } = useTranslation("yacht");
  const { colors } = useTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t("difficulty.groupLabel")}
      style={[styles.row, { borderColor: colors.border }]}
    >
      {AI_DIFFICULTIES.map((d) => {
        const selected = d === value;
        return (
          <Pressable
            key={d}
            onPress={() => onChange(d)}
            accessibilityRole="radio"
            accessibilityLabel={t(`difficulty.${d}`)}
            accessibilityState={{ checked: selected }}
            style={[styles.btn, { backgroundColor: selected ? colors.accent : colors.surface }]}
          >
            <Text style={[styles.label, { color: selected ? colors.textOnAccent : colors.text }]}>
              {t(`difficulty.${d}`)}
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
