import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import type { LayoutMeta } from "./types";
import type { MahjongProgress } from "./storage";

const COLS = 2;

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

interface Props {
  readonly layouts: LayoutMeta[];
  readonly progress: MahjongProgress;
  readonly hasContinue: boolean;
  readonly onSelectLayout: (id: string) => void;
  readonly onContinue: () => void;
}

export default function LayoutSelectScreen({
  layouts,
  progress,
  hasContinue,
  onSelectLayout,
  onContinue,
}: Props) {
  const { t } = useTranslation("mahjong");
  const { colors } = useTheme();

  const rows = chunk(layouts, COLS);

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">{t("layoutSelect.title")}</Text>

      {hasContinue && (
        <Pressable
          style={[styles.continueBtn, { backgroundColor: colors.accent }]}
          onPress={onContinue}
          accessibilityRole="button"
          accessibilityLabel={t("layoutSelect.continue")}
        >
          <Text style={[styles.continueBtnText, { color: colors.textOnAccent }]}>
            {t("layoutSelect.continue")}
          </Text>
        </Pressable>
      )}

      <View style={styles.grid}>
        {rows.map((row, rowIdx) => (
          <View key={rowIdx} style={styles.row}>
            {row.map((layout) => {
              const isUnlocked = progress.unlockedLayouts.includes(layout.id);
              return (
                <Pressable
                  key={layout.id}
                  style={[
                    styles.card,
                    {
                      backgroundColor: isUnlocked ? colors.surfaceHigh : colors.surface,
                      borderColor: isUnlocked ? colors.accent : colors.border,
                      opacity: isUnlocked ? 1 : 0.5,
                    },
                  ]}
                  onPress={isUnlocked ? () => onSelectLayout(layout.id) : undefined}
                  disabled={!isUnlocked}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isUnlocked
                      ? t(`layout.${layout.id}`)
                      : t("layoutSelect.lockedLayout", { name: t(`layout.${layout.id}`) })
                  }
                  accessibilityState={{ disabled: !isUnlocked }}
                >
                  <Text
                    style={[
                      styles.layoutName,
                      { color: isUnlocked ? colors.text : colors.textMuted },
                    ]}
                  >
                    {t(`layout.${layout.id}`)}
                  </Text>
                  <Text
                    style={[
                      styles.tierBadge,
                      { color: isUnlocked ? colors.accent : colors.textMuted },
                    ]}
                  >
                    T{layout.tier}
                  </Text>
                  {!isUnlocked && <Text style={styles.lockIcon}>🔒</Text>}
                </Pressable>
              );
            })}
            {row.length < COLS &&
              Array.from({ length: COLS - row.length }).map((_, i) => (
                <View key={`pad-${i}`} style={styles.cardPad} />
              ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 24,
    gap: 16,
  },
  title: {
    fontFamily: typography.heading,
    fontSize: 20,
    textAlign: "center",
    marginBottom: 8,
  },
  continueBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  continueBtnText: {
    fontFamily: typography.label,
    fontSize: 14,
    fontWeight: "600",
  },
  grid: {
    gap: 12,
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  card: {
    flex: 1,
    aspectRatio: 1.4,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    padding: 12,
  },
  cardPad: {
    flex: 1,
  },
  layoutName: {
    fontFamily: typography.heading,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  tierBadge: {
    fontFamily: typography.label,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  lockIcon: {
    fontSize: 14,
    marginTop: 2,
  },
});
