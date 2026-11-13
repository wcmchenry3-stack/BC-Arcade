/**
 * The Auto-Complete pill both card games offer in the felt's bottom band when the
 * board can finish itself (#3566). The caller decides when it shows (`canAutoComplete`,
 * not complete, no run in progress); this owns the look, the label and the
 * accessibility, so Solitaire and FreeCell stay identical.
 */
import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../../theme/ThemeContext";

interface Props {
  onPress: () => void;
  testID?: string;
}

export function AutoCompleteButton({ onPress, testID }: Props) {
  const { t } = useTranslation("common");
  const { colors } = useTheme();
  const label = t("action.autoComplete");
  return (
    <Pressable
      onPress={onPress}
      style={[styles.autoBtn, { backgroundColor: colors.accent }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <Text style={[styles.autoBtnText, { color: colors.textOnAccent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  autoBtn: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 999,
  },
  autoBtnText: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
});
