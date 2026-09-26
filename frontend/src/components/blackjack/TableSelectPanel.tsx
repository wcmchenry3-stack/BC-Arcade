import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import { TABLE_CONFIGS, TableConfig, isTableUnlocked } from "../../game/blackjack/tables";
import { RunRecord } from "../../game/blackjack/storage";
import { loadLastDifficulty } from "../../game/_shared/lastDifficulty";
import { PREMIUM_LEVEL_OPACITY, usePremiumLevels } from "../shared/usePremiumLevels";

const TABLE_IDS = TABLE_CONFIGS.map((c) => c.id);

interface Props {
  runs: RunRecord[];
  onSelectTable: (config: TableConfig) => void;
  onViewHistory: () => void;
}

export default function TableSelectPanel({ runs, onSelectTable, onViewHistory }: Props) {
  const { t } = useTranslation(["blackjack", "common"]);
  const { colors } = useTheme();
  // The table the last run was played at, marked so it is easy to pick again (#1129).
  const [lastTableId, setLastTableId] = useState<TableConfig["id"] | null>(null);
  const premium = usePremiumLevels("blackjack", "blackjack-premium");

  useEffect(() => {
    let alive = true;
    void loadLastDifficulty("blackjack", TABLE_IDS).then((id) => {
      if (alive) setLastTableId(id);
    });
    return () => {
      alive = false;
    };
  }, []);

  // The table start itself remembers the table (BlackjackGameContext).
  const handlePress = (config: TableConfig) => {
    if (premium.isLocked(config.id)) premium.explain();
    else onSelectTable(config);
  };

  return (
    <View style={styles.container}>
      {/* Intro header */}
      <View style={styles.header}>
        <Text style={[styles.kicker, { color: colors.textMuted, fontFamily: typography.label }]}>
          {t("tableSelect.kicker")}
        </Text>
        <Text style={[styles.tagline, { color: colors.text, fontFamily: typography.heading }]}>
          {t("tableSelect.tagline")}
        </Text>
        <Text style={[styles.taglineSub, { color: colors.textMuted }]}>
          {t("tableSelect.taglineSub")}
        </Text>
      </View>

      <View style={styles.cards}>
        {TABLE_CONFIGS.map((config, idx) => {
          const unlocked = isTableUnlocked(idx, runs);
          // Premium tables stay tappable, to explain the lock; progress locks don't.
          const premiumTable = unlocked && premium.isLocked(config.id);
          const playable = unlocked && !premiumTable;
          const lastPlayed = playable && config.id === lastTableId;
          const prevConfig = idx > 0 ? TABLE_CONFIGS[idx - 1] : null;
          const accentColor = colors[config.accentKey];
          const tableName = t(config.labelKey as Parameters<typeof t>[0]);

          return (
            <Pressable
              key={config.id}
              style={[
                styles.card,
                {
                  backgroundColor: colors.surface,
                  borderColor: lastPlayed
                    ? accentColor
                    : playable
                      ? accentColor + "66"
                      : colors.border,
                  opacity: playable ? 1 : premiumTable ? PREMIUM_LEVEL_OPACITY : 0.5,
                },
              ]}
              onPress={() => unlocked && handlePress(config)}
              disabled={!unlocked}
              accessibilityRole="button"
              accessibilityLabel={
                premiumTable
                  ? premium.lockedLabel(tableName)
                  : unlocked
                    ? t("tableSelect.selectLabel", { table: tableName })
                    : t("tableSelect.lockedLabel", { table: tableName })
              }
              accessibilityHint={lastPlayed ? t("tableSelect.lastPlayed") : undefined}
              accessibilityState={{ disabled: !unlocked }}
              testID={`blackjack-table-${config.id}`}
            >
              <View style={styles.cardTop}>
                <View>
                  <Text
                    style={[
                      styles.cardName,
                      {
                        color: playable ? accentColor : colors.textMuted,
                        fontFamily: typography.heading,
                      },
                    ]}
                  >
                    {t(config.labelKey as Parameters<typeof t>[0])}
                  </Text>
                  <Text style={[styles.cardSubtitle, { color: colors.textMuted }]}>
                    {t(config.subtitleKey as Parameters<typeof t>[0])}
                  </Text>
                </View>

                {lastPlayed && (
                  <Text style={[styles.lockHint, { color: accentColor }]}>
                    {t("tableSelect.lastPlayed")}
                  </Text>
                )}
                {premiumTable && (
                  <Text style={[styles.lockHint, { color: colors.textMuted }]}>
                    {premium.lockedText(t("common:premiumLevel.tag"))}
                  </Text>
                )}
                {!unlocked && prevConfig && (
                  <Text style={[styles.lockHint, { color: colors.textMuted }]}>
                    🔒{" "}
                    {t("tableSelect.locked", {
                      table: t(prevConfig.labelKey as Parameters<typeof t>[0]),
                    })}
                  </Text>
                )}
              </View>

              <View style={styles.statsRow}>
                <View style={styles.stat}>
                  <Text style={[styles.statLabel, { color: colors.textMuted }]}>
                    {t("tableSelect.startChips")}
                  </Text>
                  <Text style={[styles.statValue, { color: colors.text }]}>
                    {config.startingChips}
                  </Text>
                </View>

                <Text style={[styles.arrow, { color: colors.border }]}>→</Text>

                <View style={styles.stat}>
                  <Text style={[styles.statLabel, { color: colors.textMuted }]}>
                    {t("tableSelect.goal")}
                  </Text>
                  <Text style={[styles.statValue, { color: playable ? accentColor : colors.text }]}>
                    {config.runGoal}
                  </Text>
                </View>

                <View style={styles.stat}>
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

      <Pressable
        onPress={onViewHistory}
        style={styles.historyLink}
        accessibilityRole="button"
        accessibilityLabel={t("stats.viewStatsLabel")}
      >
        <Text style={[styles.historyText, { color: colors.textMuted }]}>
          ◷{"  "}
          {t("tableSelect.viewHistory")}
        </Text>
      </Pressable>

      {premium.notice}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    gap: 16,
    width: "100%",
    maxWidth: 360,
  },
  header: {
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
  },
  kicker: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  tagline: {
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  taglineSub: {
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
  },
  cards: {
    width: "100%",
    gap: 10,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 14,
    gap: 10,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  cardName: {
    fontSize: 16,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  cardSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  lockHint: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stat: {
    gap: 2,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  statValue: {
    fontSize: 15,
    fontWeight: "700",
  },
  arrow: {
    fontSize: 16,
    marginHorizontal: 2,
  },
  historyLink: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  historyText: {
    fontSize: 12,
    fontWeight: "600",
  },
});
