import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { HomeStackParamList } from "../types/navigation";
import { useTheme } from "../theme/ThemeContext";
import { useBlackjackGame } from "../game/blackjack/BlackjackGameContext";
import { TABLE_CONFIGS } from "../game/blackjack/tables";
import { GameShell } from "../components/shared/GameShell";
import {
  ResultCard,
  useResultFeedback,
  type ResultHero,
} from "../components/shared/GameResultModal";
import { formatPL, winRatePct } from "../components/scoreboard/blackjackStatsModel";
import {
  Unlock,
  evaluateUnlocks,
  loadUnlocks,
  mergeUnlocks,
  saveUnlocks,
} from "../game/blackjack/unlocks";
import { loadRuns } from "../game/blackjack/storage";

type Props = {
  navigation: NativeStackNavigationProp<HomeStackParamList, "BlackjackVictory">;
};

/**
 * Goal Reached (#2507) — stays its own screen (epic #2500), built from the
 * shared result card: the win stripe, icon and title, the stats strip and the
 * button row. Play the next table, keep playing this one, or cash out Home.
 */
export default function BlackjackVictoryScreen({ navigation }: Props) {
  const { t } = useTranslation(["blackjack"]);
  const { t: tResult } = useTranslation("result");
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { engine, sessionStats, lowestChips, handleCashOut, handleKeepPlaying, handleTableSelect } =
    useBlackjackGame();

  const activeTable =
    TABLE_CONFIGS.find((tc) => tc.betMin === engine?.betMin && tc.betMax === engine?.betMax) ??
    TABLE_CONFIGS[0]!;
  const tableIndex = TABLE_CONFIGS.indexOf(activeTable);
  const nextTable = TABLE_CONFIGS[tableIndex + 1];

  const [newUnlocks, setNewUnlocks] = useState<Unlock[]>([]);

  useEffect(() => {
    let active = true;
    async function evaluate() {
      const [runs, existing] = await Promise.all([loadRuns(), loadUnlocks()]);
      // Synthesize the current completed run so evaluateUnlocks sees it even
      // before handleCashOut persists the RunRecord to storage.
      const currentRun = {
        table: activeTable.id,
        startingChips: engine?.startingChips ?? 0,
        finalChips: engine?.chips ?? 0,
        runGoal: engine?.runGoal ?? null,
        completed: true,
        handsPlayed: sessionStats.handsPlayed,
        biggestWin: sessionStats.biggestWin,
        lowestChips,
        startedAt: Date.now(),
        endedAt: Date.now(),
      };
      const triggered = evaluateUnlocks([...runs, currentRun], existing);
      if (!active) return;
      if (triggered.length > 0) {
        await saveUnlocks(mergeUnlocks(existing, triggered));
        setNewUnlocks(triggered);
      }
    }
    void evaluate();
    return () => {
      active = false;
    };
    // Intentionally no deps — evaluate once on mount when victory is confirmed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tableName = t(activeTable.labelKey as Parameters<typeof t>[0]);
  const netPL = engine ? engine.chips - engine.startingChips : 0;

  const onCashOutHome = useCallback(async () => {
    await handleCashOut();
    navigation.popToTop();
  }, [handleCashOut, navigation]);

  // End the run then immediately start the next table — bypasses TableSelectPanel.
  const onNextTable = useCallback(async () => {
    if (!nextTable) return;
    await handleCashOut();
    handleTableSelect(nextTable);
    navigation.replace("BlackjackBetting");
  }, [handleCashOut, handleTableSelect, nextTable, navigation]);

  const onKeepPlaying = useCallback(() => {
    handleKeepPlaying();
    navigation.replace("BlackjackBetting");
  }, [handleKeepPlaying, navigation]);

  const keepPlaying = {
    label: t("blackjack:victory.keepPlaying"),
    accessibilityLabel: t("blackjack:victory.keepPlayingLabel"),
    onPress: onKeepPlaying,
  };
  const nextTableName = nextTable ? t(nextTable.labelKey as Parameters<typeof t>[0]) : undefined;

  const subtitle = t("blackjack:victory.subtitle", { table: tableName });
  const hero: ResultHero = {
    kind: "score",
    label: t("blackjack:victory.goalLine", {
      goal: engine?.runGoal?.toLocaleString() ?? "—",
    }),
    value: engine?.chips ?? 0,
  };
  useResultFeedback({ active: true, outcome: "win", subtitle, hero });

  return (
    <GameShell
      title={t("blackjack:game.title")}
      requireBack
      onBack={() => navigation.popToTop()}
      style={{ paddingBottom: Math.max(insets.bottom, 16) }}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <ResultCard
          outcome="win"
          eyebrow={`${t("blackjack:game.title")} · ${tableName}`}
          subtitle={subtitle}
          hero={hero}
          stats={[
            { label: tResult("stat.hands"), value: sessionStats.handsPlayed },
            { label: tResult("stat.winRate"), value: `${winRatePct(sessionStats) ?? 0}%` },
            { label: tResult("stat.biggestWin"), value: `+${sessionStats.biggestWin}` },
            { label: tResult("stat.netPL"), value: formatPL(netPL) },
          ]}
          detail={
            newUnlocks.length > 0 ? (
              <View
                style={[styles.unlockPanel, { borderColor: colors.accent }]}
                accessibilityLiveRegion="polite"
              >
                {newUnlocks.map((u) => (
                  <Text key={u.id} style={[styles.unlockText, { color: colors.text }]}>
                    {t("blackjack:victory.unlocked", { name: u.name })}
                  </Text>
                ))}
              </View>
            ) : undefined
          }
          primaryAction={
            nextTable && nextTableName
              ? {
                  label: t("blackjack:victory.nextTable", { table: nextTableName }),
                  accessibilityLabel: t("blackjack:victory.nextTableLabel", {
                    table: nextTableName,
                  }),
                  onPress: () => void onNextTable(),
                }
              : keepPlaying
          }
          secondaryAction={nextTable ? keepPlaying : undefined}
          // Cash Out: ending the run and leaving are one step now.
          onHome={() => void onCashOutHome()}
          homeLabel={tResult("a11y.cashOutHome")}
          testID="blackjack-victory"
        />
      </ScrollView>
    </GameShell>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  unlockPanel: {
    alignSelf: "stretch",
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 4,
  },
  unlockText: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
});
