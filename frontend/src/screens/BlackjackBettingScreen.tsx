import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { HomeStackParamList } from "../../App";
import { useTheme } from "../theme/ThemeContext";
import { placeBet as enginePlaceBet, toViewState, DEFAULT_RULES } from "../game/blackjack/engine";
import { useBlackjackGame } from "../game/blackjack/BlackjackGameContext";
import { loadRuns, RunRecord } from "../game/blackjack/storage";
import { TABLE_CONFIGS } from "../game/blackjack/tables";
import BettingPanel from "../components/blackjack/BettingPanel";
import TableSelectPanel from "../components/blackjack/TableSelectPanel";
import BlackjackTable from "../components/blackjack/BlackjackTable";
import { AppHeader, APP_HEADER_HEIGHT } from "../components/shared/AppHeader";

type Props = {
  navigation: NativeStackNavigationProp<HomeStackParamList, "BlackjackBetting">;
};

export default function BlackjackBettingScreen({ navigation }: Props) {
  const { t } = useTranslation(["blackjack", "common"]);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
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
  const activeTable =
    TABLE_CONFIGS.find((t) => t.betMin === engine?.betMin && t.betMax === engine?.betMax) ??
    TABLE_CONFIGS[0]!;

  // Redirect when loaded mid-hand or into victory (app restart, injected state).
  useEffect(() => {
    if (loading || !engine || engine.phase === "betting") return;
    if (engine.phase === "victory") {
      navigation.replace("BlackjackVictory");
    } else {
      navigation.replace("BlackjackTable");
    }
  }, [loading, engine, navigation]);

  if (!engine && loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  const state = engine ? toViewState(engine) : null;
  const handleDeal = (amount: number) => apply((s) => enginePlaceBet(s, amount));

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingTop: APP_HEADER_HEIGHT + insets.top,
          paddingBottom: Math.max(insets.bottom, 16),
        },
      ]}
    >
      <AppHeader
        title={t("game.title")}
        requireBack
        onBack={() => navigation.popToTop()}
        onNewGame={handlePlayAgain}
        onOpenScoreboard={() => navigation.navigate("Scoreboard", { gameKey: "blackjack" })}
        rightSlot={
          state ? (
            <View style={styles.bankroll}>
              <Text style={[styles.bankrollLabel, { color: colors.textMuted }]}>
                {t("header.bankrollLabel")}
              </Text>
              <Text
                style={[styles.bankrollValue, { color: colors.text }]}
                accessibilityLabel={t("header.bankrollAccessibilityLabel", {
                  chips: state.chips,
                })}
              >
                {state.chips.toLocaleString()}
              </Text>
            </View>
          ) : undefined
        }
      />

      {/* Phase label */}
      {state && (
        <Text style={[styles.phaseLabel, { color: colors.textMuted }]}>
          {t(`blackjack:phase.${state.phase}` as Parameters<typeof t>[0])}
        </Text>
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
              handOutcomes={state.hand_outcomes}
            />
          </View>
          <Text style={[styles.dealerRule, { color: colors.textMuted }]}>
            {t(
              `blackjack:rules.${state.rules.hit_soft_17 ? "h17Label" : "s17Label"}` as Parameters<
                typeof t
              >[0]
            )}
          </Text>
        </View>
      )}

      {/* Table selection or betting controls */}
      <View style={styles.controls}>
        {showTableSelect ? (
          <TableSelectPanel runs={runs} onSelectTable={handleTableSelect} />
        ) : (
          <BettingPanel
            chips={state?.chips ?? activeTable.startingChips}
            betMin={engine?.betMin ?? activeTable.betMin}
            betMax={engine?.betMax ?? activeTable.betMax}
            chipDenominations={activeTable.chipDenominations}
            onDeal={handleDeal}
            loading={false}
            error={error}
            rules={state?.rules ?? DEFAULT_RULES}
            onRulesChange={handleRulesChange}
          />
        )}
      </View>

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
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  container: {
    flex: 1,
  },
  phaseLabel: {
    textAlign: "center",
    fontSize: 13,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 4,
    marginBottom: 4,
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
  dealerRule: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    fontWeight: "500",
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
  bankroll: {
    alignItems: "flex-end",
  },
  bankrollLabel: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    fontWeight: "500",
  },
  bankrollValue: {
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 20,
  },
});
