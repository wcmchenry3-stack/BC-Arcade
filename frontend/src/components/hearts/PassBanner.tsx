import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import type { PassDirection } from "../../game/hearts/types";

interface Props {
  passDirection: PassDirection;
  selectedCount: number;
  onConfirm: () => void;
}

export default function PassBanner({ passDirection, selectedCount, onConfirm }: Props) {
  const { t } = useTranslation("hearts");
  const { colors } = useTheme();

  const direction = t(`pass.direction.${passDirection}`);
  const canConfirm = selectedCount === 3;

  return (
    <View
      style={[styles.banner, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.text}>
        <Text style={[styles.prompt, { color: colors.text }]} numberOfLines={1}>
          {t("pass.instructions", { direction })}
        </Text>
        <Text style={[styles.counter, { color: canConfirm ? colors.accent : colors.textMuted }]}>
          {t("pass.selected", { count: selectedCount })}
        </Text>
      </View>
      <Pressable
        onPress={canConfirm ? onConfirm : undefined}
        disabled={!canConfirm}
        testID="hearts-pass-confirm"
        accessibilityLabel={t("pass.confirmLabel", { count: selectedCount })}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canConfirm }}
        style={styles.buttonWrap}
      >
        <LinearGradient
          colors={[colors.accent, colors.accentBright]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.button, !canConfirm && styles.buttonDisabled]}
        >
          <Text style={[styles.buttonText, { color: colors.textOnAccent }]}>
            {t("pass.confirm")}
          </Text>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginHorizontal: 12,
    marginBottom: 8,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  prompt: {
    fontSize: 15,
    fontWeight: "700",
  },
  counter: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  buttonWrap: {
    borderRadius: 999,
    overflow: "hidden",
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  buttonText: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
});
