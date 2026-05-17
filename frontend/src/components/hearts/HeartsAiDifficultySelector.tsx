import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import type { AiPreset } from "../../game/hearts/types";
import { AI_PRESETS } from "../../game/hearts/types";

interface Props {
  value: AiPreset;
  onChange: (d: AiPreset) => void;
}

const PRESET_DEFAULTS: Record<AiPreset, { label: string; desc: string }> = {
  cautious: { label: "Cautious", desc: "Plays conservatively, avoids taking points" },
  schemer: { label: "Schemer", desc: "Creates suit voids, deflects the Queen of Spades" },
  daring: { label: "Daring", desc: "Swings for moon shots, targets you with the Queen" },
  mixed: { label: "Mixed Table", desc: "One of each: Cautious left, Schemer across, Daring right" },
};

export default function HeartsAiDifficultySelector({ value, onChange }: Props) {
  const { t } = useTranslation("hearts");
  const { colors } = useTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t("difficulty.groupLabel", { defaultValue: "Opponent Style" })}
      style={[styles.row, { borderColor: colors.border }]}
    >
      {AI_PRESETS.map((d) => {
        const selected = d === value;
        const defaults = PRESET_DEFAULTS[d];
        return (
          <Pressable
            key={d}
            onPress={() => onChange(d)}
            accessibilityRole="radio"
            accessibilityLabel={t(`difficulty.${d}`, { defaultValue: defaults.label })}
            accessibilityState={{ selected }}
            style={[styles.btn, { backgroundColor: selected ? colors.accent : colors.surface }]}
          >
            <Text style={[styles.label, { color: selected ? colors.textOnAccent : colors.text }]}>
              {t(`difficulty.${d}`, { defaultValue: defaults.label })}
            </Text>
            <Text
              style={[styles.desc, { color: selected ? colors.textOnAccent : colors.textMuted }]}
            >
              {t(`difficulty.${d}.desc`, { defaultValue: defaults.desc })}
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
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
  },
  desc: {
    fontSize: 11,
    textAlign: "center",
  },
});
