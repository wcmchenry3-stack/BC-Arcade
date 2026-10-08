import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import { ModalPrimaryButton } from "../shared/ModalCard";
import DifficultySelector from "./DifficultySelector";
import VariantSelector from "./VariantSelector";
import type { Difficulty, Variant } from "../../game/sudoku/types";

// ---------------------------------------------------------------------------
// Pre-game — difficulty picker + start button
// ---------------------------------------------------------------------------

export default function PreGame({
  difficulty,
  onChange,
  variant,
  onVariantChange,
  onStart,
}: {
  readonly difficulty: Difficulty;
  readonly onChange: (d: Difficulty) => void;
  readonly variant: Variant;
  readonly onVariantChange: (v: Variant) => void;
  readonly onStart: () => void;
}) {
  const { t } = useTranslation("sudoku");
  const { colors } = useTheme();

  return (
    <View style={styles.preGameWrap}>
      <View
        style={[
          styles.preGameCard,
          { backgroundColor: colors.surfaceHigh, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.preGameTitle, { color: colors.text }]} accessibilityRole="header">
          {t("preGame.title")}
        </Text>
        <Text style={[styles.preGameBody, { color: colors.textMuted }]}>{t("preGame.body")}</Text>
        <View style={styles.preGameSelector}>
          <VariantSelector value={variant} onChange={onVariantChange} />
        </View>
        <View style={[styles.preGameSelector, { marginTop: 8 }]}>
          <DifficultySelector value={difficulty} onChange={onChange} />
        </View>
        <ModalPrimaryButton
          testID="sudoku-pregame-start"
          label={t("action.start")}
          onPress={onStart}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  preGameWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  preGameCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    width: "90%",
    maxWidth: 360,
    alignItems: "center",
  },
  preGameTitle: {
    fontFamily: typography.heading,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0.5,
    marginBottom: 8,
    textAlign: "center",
  },
  preGameBody: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
    textAlign: "center",
  },
  preGameSelector: {
    alignSelf: "stretch",
    marginBottom: 20,
  },
});
