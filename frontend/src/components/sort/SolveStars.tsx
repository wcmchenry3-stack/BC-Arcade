import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import type { Stars } from "../../game/sort/stars";
import { StarRow } from "./StarRow";

interface Props {
  readonly stars: Stars;
  readonly moves: number;
  readonly par: number;
}

/**
 * The result card's stars and "Moves N · Target P" (#3687), passed to the
 * shared card's `detail` slot so no other game's card changes.
 */
export function SolveStars({ stars, moves, par }: Props) {
  const { t } = useTranslation("sort");
  const { colors } = useTheme();
  return (
    <View
      testID="sort-result-stars"
      style={styles.wrap}
      accessible
      accessibilityLabel={t("stars.summary", { stars, moves, par })}
    >
      <StarRow stars={stars} size={34} testID="sort-result-star" />
      <Text style={[styles.line, { color: colors.textMuted }]}>
        {t("stars.movesTarget", { moves, par })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 6 },
  line: { fontFamily: typography.bodyMedium, fontSize: 14, textAlign: "center" },
});
