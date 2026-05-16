import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { HomeStackParamList } from "../../App";
import { useTheme } from "../theme/ThemeContext";
import { useBlackjackGame } from "../game/blackjack/BlackjackGameContext";
import { loadRuns, RunRecord } from "../game/blackjack/storage";
import { TABLE_CONFIGS } from "../game/blackjack/tables";
import { GameShell } from "../components/shared/GameShell";

type Props = {
  navigation: NativeStackNavigationProp<HomeStackParamList, "BlackjackStats">;
};

function outcomeFor(r: RunRecord): "comeback" | "completed" | "busted" {
  if (r.completed && r.lowestChips < r.startingChips * 0.25) return "comeback";
  if (r.completed) return "completed";
  return "busted";
}

export default function BlackjackStatsScreen({ navigation }: Props) {
  const { t } = useTranslation(["blackjack"]);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { sessionStats } = useBlackjackGame();
  const [runs, setRuns] = useState<RunRecord[]>([]);

  useFocusEffect(
    useCallback(() => {
      loadRuns()
        .then(setRuns)
        .catch(() => {});
    }, [])
  );

  const winRate =
    sessionStats.handsPlayed > 0
      ? Math.round((sessionStats.handsWon / sessionStats.handsPlayed) * 100)
      : 0;

  const completedRuns = runs.filter((r) => r.completed);
  const comebackRuns = completedRuns.filter((r) => r.lowestChips < r.startingChips * 0.25);

  const bestRun = completedRuns.reduce<RunRecord | null>(
    (best, r) => (r.finalChips > (best?.finalChips ?? 0) ? r : best),
    null
  );
  const mostHandsRun = runs.reduce<RunRecord | null>(
    (best, r) => (r.handsPlayed > (best?.handsPlayed ?? 0) ? r : best),
    null
  );
  const biggestComebackRun = comebackRuns.reduce<RunRecord | null>(
    (best, r) => (r.lowestChips < (best?.lowestChips ?? Infinity) ? r : best),
    null
  );

  const sortedRuns = [...runs].sort((a, b) => b.startedAt - a.startedAt);

  function tableLabel(tableId: string): string {
    const config = TABLE_CONFIGS.find((tc) => tc.id === tableId);
    return config ? t(config.labelKey as Parameters<typeof t>[0]) : tableId;
  }

  function outcomeColor(outcome: "comeback" | "completed" | "busted"): string {
    if (outcome === "comeback") return colors.accent;
    if (outcome === "completed") return colors.bonus;
    return colors.error;
  }

  return (
    <GameShell
      title={t("stats.title")}
      requireBack
      onBack={() => navigation.goBack()}
      style={{ paddingBottom: Math.max(insets.bottom, 16) }}
    >
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Current Run */}
        <Text style={[styles.sectionHeader, { color: colors.textMuted }]}>
          {t("stats.currentRun")}
        </Text>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          {sessionStats.handsPlayed === 0 ? (
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>
              {t("stats.currentRunEmpty")}
            </Text>
          ) : (
            <>
              <View style={styles.statRow}>
                <Text style={[styles.statLabel, { color: colors.textMuted }]}>
                  {t("stats.chipsLabel")}
                </Text>
                <Text style={[styles.statValue, { color: colors.text }]}>
                  {t("stats.chips", {
                    chips: sessionStats.chips.toLocaleString(),
                  })}
                </Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.statRow}>
                <Text style={[styles.statLabel, { color: colors.textMuted }]}>
                  {t("stats.handsLabel")}
                </Text>
                <Text style={[styles.statValue, { color: colors.text }]}>
                  {t("stats.hands", { hands: sessionStats.handsPlayed })}
                  {"  ·  "}
                  {t("stats.winRate", { winRate })}
                </Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.statRow}>
                <Text style={[styles.statLabel, { color: colors.textMuted }]}>
                  {t("stats.biggestWin")}
                </Text>
                <Text style={[styles.statValue, { color: colors.text }]}>
                  {t("stats.biggestWinAmount", {
                    amount: sessionStats.biggestWin,
                  })}
                </Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.statRow}>
                <Text style={[styles.statLabel, { color: colors.textMuted }]}>
                  {t("stats.netPL")}
                </Text>
                <Text
                  style={[
                    styles.statValue,
                    { color: sessionStats.plChips >= 0 ? colors.bonus : colors.error },
                  ]}
                >
                  {sessionStats.plChips >= 0
                    ? t("stats.netPLPositive", { amount: sessionStats.plChips })
                    : t("stats.netPLNegative", { amount: sessionStats.plChips })}
                </Text>
              </View>
            </>
          )}
        </View>

        {/* All-Time Best — only when run history exists */}
        {runs.length > 0 && (
          <>
            <Text style={[styles.sectionHeader, { color: colors.textMuted }]}>
              {t("stats.allTimeBest")}
            </Text>
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              {bestRun && (
                <>
                  <View style={styles.statRow}>
                    <Text style={[styles.statLabel, { color: colors.textMuted }]}>
                      {t("stats.allTimeBestRun")}
                    </Text>
                    <Text style={[styles.statValue, { color: colors.text }]}>
                      {t("stats.chips", {
                        chips: bestRun.finalChips.toLocaleString(),
                      })}
                    </Text>
                  </View>
                  {(mostHandsRun || biggestComebackRun) && (
                    <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  )}
                </>
              )}
              {mostHandsRun && (
                <>
                  <View style={styles.statRow}>
                    <Text style={[styles.statLabel, { color: colors.textMuted }]}>
                      {t("stats.allTimeMostHands")}
                    </Text>
                    <Text style={[styles.statValue, { color: colors.text }]}>
                      {t("stats.hands", { hands: mostHandsRun.handsPlayed })}
                    </Text>
                  </View>
                  {biggestComebackRun && (
                    <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  )}
                </>
              )}
              {biggestComebackRun && (
                <View style={styles.statRow}>
                  <Text style={[styles.statLabel, { color: colors.textMuted }]}>
                    {t("stats.allTimeBiggestComeback")}
                  </Text>
                  <Text style={[styles.statValue, { color: colors.accent }]}>
                    {t("stats.comebackLow", {
                      chips: biggestComebackRun.lowestChips.toLocaleString(),
                    })}
                  </Text>
                </View>
              )}
            </View>
          </>
        )}

        {/* Run History */}
        <Text style={[styles.sectionHeader, { color: colors.textMuted }]}>
          {t("stats.runHistory")}
        </Text>

        {sortedRuns.length === 0 ? (
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>{t("stats.noRuns")}</Text>
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            {sortedRuns.map((run, i) => {
              const outcome = outcomeFor(run);
              const badgeColor = outcomeColor(outcome);
              const date = new Date(run.startedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              });
              return (
                <React.Fragment key={`${run.startedAt}-${run.table}`}>
                  {i > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
                  <View
                    style={styles.runRow}
                    accessible
                    accessibilityRole="text"
                    accessibilityLabel={t("stats.runAccessibilityLabel", {
                      table: tableLabel(run.table),
                      date,
                      chips: t("stats.chips", { chips: run.finalChips.toLocaleString() }),
                      outcome: t(`stats.runOutcome.${outcome}` as Parameters<typeof t>[0]),
                    })}
                  >
                    <View style={styles.runInfo}>
                      <Text style={[styles.runTable, { color: colors.text }]}>
                        {tableLabel(run.table)}
                      </Text>
                      <Text style={[styles.runDate, { color: colors.textMuted }]}>{date}</Text>
                    </View>
                    <View style={styles.runRight}>
                      <Text style={[styles.runChips, { color: colors.text }]}>
                        {t("stats.chips", {
                          chips: run.finalChips.toLocaleString(),
                        })}
                      </Text>
                      <View
                        style={[styles.badge, { borderColor: badgeColor }]}
                        accessibilityElementsHidden
                      >
                        <Text style={[styles.badgeText, { color: badgeColor }]}>
                          {t(`stats.runOutcome.${outcome}` as Parameters<typeof t>[0])}
                        </Text>
                      </View>
                    </View>
                  </View>
                </React.Fragment>
              );
            })}
          </View>
        )}
      </ScrollView>
    </GameShell>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 8,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 12,
    marginBottom: 4,
  },
  card: {
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 16,
  },
  emptyText: {
    fontSize: 14,
    paddingVertical: 14,
    textAlign: "center",
  },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
  },
  statLabel: {
    fontSize: 14,
    fontWeight: "500",
  },
  statValue: {
    fontSize: 14,
    fontWeight: "700",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  runRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
  },
  runInfo: {
    flex: 1,
    gap: 2,
  },
  runTable: {
    fontSize: 14,
    fontWeight: "600",
  },
  runDate: {
    fontSize: 12,
    fontWeight: "400",
  },
  runRight: {
    alignItems: "flex-end",
    gap: 4,
  },
  runChips: {
    fontSize: 14,
    fontWeight: "700",
  },
  badge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
});
