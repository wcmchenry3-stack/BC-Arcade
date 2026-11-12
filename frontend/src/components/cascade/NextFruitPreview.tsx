import React, { memo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { FruitDefinition } from "../../theme/fruitSets";
import { useTheme } from "../../theme/ThemeContext";
import FruitGlyph from "./FruitGlyph";

interface Props {
  current: FruitDefinition;
  next: FruitDefinition;
}

function NextFruitPreview({ current, next }: Props) {
  const { t } = useTranslation("cascade");
  const pieceName = (f: FruitDefinition) => t(`pieces.${f.i18nKey}`, { defaultValue: f.name });
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <View
        style={[styles.chip, { backgroundColor: colors.surface, borderColor: colors.border }]}
        accessible
        accessibilityLabel={t("preview.droppingNext", { name: pieceName(current) })}
      >
        <FruitGlyph fruit={current} size={styles.dropEmoji.fontSize} />
        <Text style={[styles.label, { color: colors.textMuted }]} importantForAccessibility="no">
          {t("preview.dropLabel")}
        </Text>
      </View>
      <View
        style={[styles.chip, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
        accessible
        accessibilityLabel={t("preview.comingUp", { name: pieceName(next) })}
      >
        <FruitGlyph fruit={next} size={styles.nextEmoji.fontSize} />
        <Text style={[styles.label, { color: colors.textMuted }]} importantForAccessibility="no">
          {t("preview.nextLabel")}
        </Text>
      </View>
    </View>
  );
}

// Memoized (#2960): it re-renders only when the queue's pieces change.
export default memo(NextFruitPreview);

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
  },
  dropEmoji: {
    fontSize: 22,
  },
  nextEmoji: {
    fontSize: 16,
  },
  label: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    fontWeight: "600",
  },
});
