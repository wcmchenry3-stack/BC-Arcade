import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import { TABLE_CONFIGS, TableConfig, isTableUnlocked } from "../../game/blackjack/tables";
import { RunRecord } from "../../game/blackjack/storage";

interface Props {
  runs: RunRecord[];
  onSelectTable: (config: TableConfig) => void;
}

export default function TableSelectPanel({ runs, onSelectTable }: Props) {
  const { t } = useTranslation("blackjack");
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: colors.text, fontFamily: typography.heading }]}>
        {t("tableSelect.title")}
      </Text>

      <View style={styles.cards}>
        {TABLE_CONFIGS.map((config, idx) => {
          const unlocked = isTableUnlocked(idx, runs);
          const prevConfig = idx > 0 ? TABLE_CONFIGS[idx - 1] : null;

          return (
            <Pressable
              key={config.id}
              style={[
                styles.card,
                {
                  backgroundColor: colors.surface,
                  borderColor: unlocked ? colors.accent : colors.border,
                  opacity: unlocked ? 1 : 0.55,
                },
              ]}
              onPress={() => unlocked && onSelectTable(config)}
              disabled={!unlocked}
              accessibilityRole="button"
              accessibilityLabel={
                unlocked
                  ? t("tableSelect.selectLabel", {
                      table: t(config.labelKey as Parameters<typeof t>[0]),
                    })
                  : t("tableSelect.lockedLabel", {
                      table: t(config.labelKey as Parameters<typeof t>[0]),
                    })
              }
              accessibilityState={{ disabled: !unlocked }}
            >
              <Text
                style={[styles.cardName, { color: unlocked ? colors.accent : colors.textMuted }]}
              >
                {t(config.labelKey as Parameters<typeof t>[0])}
              </Text>

              {!unlocked && prevConfig && (
                <Text style={[styles.lockHint, { color: colors.textMuted }]}>
                  {t("tableSelect.locked", {
                    table: t(prevConfig.labelKey as Parameters<typeof t>[0]),
                  })}
                </Text>
              )}

              <View style={styles.stats}>
                <View style={styles.statRow}>
                  <Text style={[styles.statLabel, { color: colors.textMuted }]}>
                    {t("tableSelect.startChips")}
                  </Text>
                  <Text style={[styles.statValue, { color: colors.text }]}>
                    {config.startingChips}
                  </Text>
                </View>
                <View style={styles.statRow}>
                  <Text style={[styles.statLabel, { color: colors.textMuted }]}>
                    {t("tableSelect.goal")}
                  </Text>
                  <Text style={[styles.statValue, { color: colors.text }]}>{config.runGoal}</Text>
                </View>
                <View style={styles.statRow}>
                  <Text style={[styles.statLabel, { color: colors.textMuted }]}>
                    {t("tableSelect.betRange")}
                  </Text>
                  <Text style={[styles.statValue, { color: colors.text }]}>
                    {config.betMin}–{config.betMax}
                  </Text>
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    gap: 20,
    width: "100%",
    maxWidth: 360,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  cards: {
    width: "100%",
    gap: 12,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  cardName: {
    fontSize: 16,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  lockHint: {
    fontSize: 11,
    fontStyle: "italic",
  },
  stats: {
    gap: 4,
  },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  statLabel: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 12,
    fontWeight: "600",
  },
});
