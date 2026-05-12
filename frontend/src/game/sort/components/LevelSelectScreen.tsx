import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../theme/ThemeContext";
import { typography } from "../../../theme/typography";
import type { LevelData } from "../api";
import type { SortProgress } from "../storage";

const COLS = 4;

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

interface Props {
  readonly levels: LevelData[];
  readonly progress: SortProgress;
  readonly onSelectLevel: (id: number) => void;
  readonly onContinue: () => void;
}

export default function LevelSelectScreen({ levels, progress, onSelectLevel, onContinue }: Props) {
  const { t } = useTranslation("sort");
  const { colors } = useTheme();

  const hasContinue = progress.currentLevelId !== null && progress.currentState !== null;

  const rows = chunk(levels, COLS);

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>{t("levelSelect.title")}</Text>

      {hasContinue && (
        <Pressable
          style={[styles.continueBtn, { backgroundColor: colors.accent }]}
          onPress={onContinue}
          accessibilityRole="button"
          accessibilityLabel={t("levelSelect.continue", {
            level: progress.currentLevelId,
          })}
        >
          <Text style={[styles.continueBtnText, { color: colors.textOnAccent }]}>
            {t("levelSelect.continue", { level: progress.currentLevelId })}
          </Text>
        </Pressable>
      )}

      <View style={styles.grid}>
        {rows.map((row, rowIdx) => (
          <View key={rowIdx} style={styles.row}>
            {row.map((level) => {
              const isUnlocked = level.id <= progress.unlockedLevel;
              return (
                <Pressable
                  key={level.id}
                  style={[
                    styles.card,
                    {
                      backgroundColor: isUnlocked ? colors.surfaceHigh : colors.surface,
                      borderColor: isUnlocked ? colors.accent : colors.border,
                      opacity: isUnlocked ? 1 : 0.5,
                    },
                  ]}
                  onPress={isUnlocked ? () => onSelectLevel(level.id) : undefined}
                  disabled={!isUnlocked}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isUnlocked
                      ? t("hud.level", { level: level.id })
                      : t("levelSelect.lockedLevel", { level: level.id })
                  }
                  accessibilityState={{ disabled: !isUnlocked }}
                >
                  <Text
                    style={[
                      styles.levelNum,
                      { color: isUnlocked ? colors.text : colors.textMuted },
                    ]}
                  >
                    {level.id}
                  </Text>
                  {!isUnlocked && <Text style={styles.lockIcon}>🔒</Text>}
                </Pressable>
              );
            })}
            {/* Pad last row so cards stay the correct width */}
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
    gap: 8,
  },
  row: {
    flexDirection: "row",
    gap: 8,
  },
  card: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  cardPad: {
    flex: 1,
  },
  levelNum: {
    fontFamily: typography.heading,
    fontSize: 18,
    fontWeight: "700",
  },
  lockIcon: {
    fontSize: 12,
  },
});
