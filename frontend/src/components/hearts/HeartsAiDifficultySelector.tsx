import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import type { AiPreset } from "../../game/hearts/types";
import { AI_PERSONAS } from "../../game/hearts/types";

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

function PersonaBtn({
  preset,
  value,
  onChange,
  colors,
  t,
  full = false,
}: {
  preset: AiPreset;
  value: AiPreset;
  onChange: (d: AiPreset) => void;
  colors: ReturnType<typeof useTheme>["colors"];
  t: ReturnType<typeof useTranslation>["t"];
  full?: boolean;
}) {
  const selected = preset === value;
  const defaults = PRESET_DEFAULTS[preset];
  return (
    <Pressable
      onPress={() => onChange(preset)}
      accessibilityRole="radio"
      accessibilityLabel={t(`difficulty.${preset}`, { defaultValue: defaults.label })}
      accessibilityState={{ selected }}
      style={[full ? styles.btnFull : styles.btn, { backgroundColor: selected ? colors.accent : colors.surface }]}
    >
      <Text style={[styles.label, { color: selected ? colors.textOnAccent : colors.text }]}>
        {t(`difficulty.${preset}`, { defaultValue: defaults.label })}
      </Text>
      <Text style={[styles.desc, { color: selected ? colors.textOnAccent : colors.textMuted }]}>
        {t(`difficulty.${preset}.desc`, { defaultValue: defaults.desc })}
      </Text>
    </Pressable>
  );
}

export default function HeartsAiDifficultySelector({ value, onChange }: Props) {
  const { t } = useTranslation("hearts");
  const { colors } = useTheme();
  const shared = { value, onChange, colors, t };

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t("difficulty.groupLabel", { defaultValue: "Opponent Style" })}
      style={[styles.container, { borderColor: colors.border }]}
    >
      <View style={[styles.personaRow, { borderBottomColor: colors.border }]}>
        {AI_PERSONAS.map((d) => (
          <PersonaBtn key={d} preset={d} {...shared} />
        ))}
      </View>
      <PersonaBtn preset="mixed" full {...shared} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 8,
    overflow: "hidden",
  },
  personaRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
  },
  btn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  btnFull: {
    alignSelf: "stretch",
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
