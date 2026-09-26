import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { HomeStackParamList } from "../types/navigation";
import { useGameStatsLink } from "../hooks/useGameStatsLink";
import { useTheme } from "../theme/ThemeContext";
import { placeBet as enginePlaceBet, toViewState, DEFAULT_RULES } from "../game/blackjack/engine";
import { useBlackjackGame } from "../game/blackjack/BlackjackGameContext";
import { loadRuns, RunRecord } from "../game/blackjack/storage";
import { TABLE_CONFIGS, tableForBetLimits } from "../game/blackjack/tables";
import BettingPanel from "../components/blackjack/BettingPanel";
import TableSelectPanel from "../components/blackjack/TableSelectPanel";
import HudSidebar from "../components/blackjack/HudSidebar";
import BlackjackTable from "../components/blackjack/BlackjackTable";
import { GameShell } from "../components/shared/GameShell";

type Props = {
  navigation: NativeStackNavigationProp<HomeStackParamList, "BlackjackBetting">;
};

export default function BlackjackBettingScreen({ navigation }: Props) {
  const openStats = useGameStatsLink(navigation, "blackjack");
  const { t } = useTranslation(["blackjack", "common"]);
  const { colors } = useTheme();
  const { engine, loading, error, apply, handleRulesChange, handlePlayAgain, handleTableSelect } =
    useBlackjackGame();
  const [runs, setRuns] = useState<RunRecord[]>([]);

  useEffect(() => {
    loadRuns()
      .then(setRuns)
      .catch(() => {});
  }, []);

  // Show table selection when the engine is in "pending table" state:
  // fresh game (runGoal=null) that hasn't had any chips committed yet.
  const showTableSelect =
    engine !== null &&
    engine.runGoal === null &&
    engine.chips === engine.startingChips &&
    engine.bet === 0;

  // Derive active table config from engine's betMin/betMax (set by handleTableSelect).
  const activeTable = tableForBetLimits(engine) ?? TABLE_CONFIGS[0]!;
  const tableAccentColor = colors[activeTable.accentKey];

  // Redirect when loaded mid-hand or into victory (app restart, injected state).
  useEffect(() => {
    if (loading || !engine || engine.phase === "betting") return;
    if (engine.phase === "victory") {
      navigation.replace("BlackjackVictory");
    } else {
      navigation.replace("BlackjackTable");
    }
  }, [loading, engine, navigation]);

  const state = engine ? toViewState(engine) : null;
  const handleDeal = (amount: number) => apply((s) => enginePlaceBet(s, amount));

  return (
    <GameShell
      title={t("game.title")}
      requireBack
      onBack={() => navigation.popToTop()}
      onNewGame={handlePlayAgain}
      onOpenScoreboard={() => navigation.navigate("Scoreboard", { gameKey: "blackjack" })}
      onOpenStats={openStats}
      loading={!engine && loading}
    >
      {/* Full-width run HUD — shown once a table is selected */}
      {state && !showTableSelect && engine?.runGoal != null && (
        <View style={styles.hudContainer}>
          <HudSidebar
            chips={engine.chips}
            startingChips={engine.startingChips}
            runGoal={engine.runGoal}
            milestones={activeTable.milestones}
            tableName={t(activeTable.labelKey as Parameters<typeof t>[0])}
            tableAccentColor={tableAccentColor}
          />
        </View>
      )}

      {/*
       * GH #226 — Table is always rendered so the felt is visible between hands.
       * Faded (opacity 0.4) during betting to emphasise the betting controls.
       */}
      {state && (
        <View style={styles.dealerArea}>
          <View style={styles.tableWrapper}>
            <BlackjackTable
              playerHand={state.player_hand}
              dealerHand={state.dealer_hand}
              phase={state.phase}
              playerHands={state.player_hands}
              activeHandIndex={state.active_hand_index}
              handBets={state.hand_bets}
            />
          </View>
        </View>
      )}

      {/* Table selection or betting controls */}
      <View style={styles.controls}>
        {showTableSelect ? (
          <TableSelectPanel
            runs={runs}
            onSelectTable={handleTableSelect}
            onViewHistory={() => navigation.navigate("BlackjackStats")}
          />
        ) : (
          <BettingPanel
            chips={state?.chips ?? activeTable.startingChips}
            betMin={engine?.betMin ?? activeTable.betMin}
            betMax={engine?.betMax ?? activeTable.betMax}
            chipDenominations={activeTable.chipDenominations}
            accentColor={tableAccentColor}
            onDeal={handleDeal}
            loading={false}
            error={error}
            rules={state?.rules ?? DEFAULT_RULES}
            onRulesChange={handleRulesChange}
          />
        )}
      </View>

      {/* Stats link — only shown during betting phase (table select has its own history link) */}
      {!showTableSelect && (
        <Pressable
          style={styles.statsLink}
          onPress={() => navigation.navigate("BlackjackStats")}
          accessibilityRole="button"
          accessibilityLabel={t("blackjack:stats.viewStatsLabel")}
        >
          <Text style={[styles.statsLinkText, { color: colors.textMuted }]}>
            {t("blackjack:stats.viewStats")}
          </Text>
        </Pressable>
      )}
    </GameShell>
  );
}

const styles = StyleSheet.create({
  hudContainer: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 4,
  },
  dealerArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 6,
  },
  tableWrapper: {
    opacity: 0.4,
    width: "100%",
    alignItems: "center",
  },
  controls: {
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 0,
  },
  statsLink: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 16,
  },
  statsLinkText: {
    fontSize: 12,
    fontWeight: "500",
    textDecorationLine: "underline",
  },
});
