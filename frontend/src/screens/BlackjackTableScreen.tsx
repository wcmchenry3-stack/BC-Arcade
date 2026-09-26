import React, { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { HomeStackParamList } from "../types/navigation";
import { useTheme } from "../theme/ThemeContext";
import {
  hit as engineHit,
  stand as engineStand,
  doubleDown as engineDoubleDown,
  split as engineSplit,
  newHand as engineNewHand,
  toViewState,
} from "../game/blackjack/engine";
import { useBlackjackGame } from "../game/blackjack/BlackjackGameContext";
import { TABLE_CONFIGS, tableForBetLimits } from "../game/blackjack/tables";
import { useBlackjackLayout } from "../hooks/useBlackjackLayout";
import { useGameEvents } from "../game/_shared/useGameEvents";
import { useSound } from "../game/_shared/useSound";
import { BLACKJACK_SOUNDS } from "../game/blackjack/sounds";
import BlackjackTable from "../components/blackjack/BlackjackTable";
import ActionButtons from "../components/blackjack/ActionButtons";
import ResultBanner from "../components/blackjack/ResultBanner";
import GameResultModal from "../components/shared/GameResultModal";
import { winRatePct } from "../components/scoreboard/blackjackStatsModel";
import HudSidebar from "../components/blackjack/HudSidebar";
import NewGameConfirmModal from "../components/shared/NewGameConfirmModal";
import { GameShell } from "../components/shared/GameShell";
import { PillButton } from "../components/shared/PillButton";
import { BlackjackCelebrationAnimation } from "../components/blackjack/BlackjackCelebrationAnimation";

type Props = {
  navigation: NativeStackNavigationProp<HomeStackParamList, "BlackjackTable">;
};

export default function BlackjackTableScreen({ navigation }: Props) {
  const { t } = useTranslation(["blackjack", "common"]);
  const { t: tResult } = useTranslation("result");
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const layout = useBlackjackLayout();
  const { engine, loading, error, apply, clearEvents, handlePlayAgain, sessionStats, runResult } =
    useBlackjackGame();
  const [confirmNewGameVisible, setConfirmNewGameVisible] = useState(false);
  const [celebrationVisible, setCelebrationVisible] = useState(false);
  const [milestoneChips, setMilestoneChips] = useState<number | null>(null);
  const [comebackVisible, setComebackVisible] = useState(false);
  const [allInVisible, setAllInVisible] = useState(false);
  const milestoneOpacity = useSharedValue(0);
  const comebackOpacity = useSharedValue(0);
  const allInOpacity = useSharedValue(0);

  const cardDealSound = useSound("blackjack.cardDeal", BLACKJACK_SOUNDS);
  const blackjackSound = useSound("blackjack.blackjack", BLACKJACK_SOUNDS);
  const bustSound = useSound("blackjack.bust", BLACKJACK_SOUNDS);
  const winSound = useSound("blackjack.win", BLACKJACK_SOUNDS);
  const pushSound = useSound("blackjack.push", BLACKJACK_SOUNDS);

  // Flash animations for player hand area
  const bustFlash = useSharedValue(0);
  const winFlash = useSharedValue(0);

  // Theme colours (#2507) at the washes' old strengths (40% / 35%).
  const bustFlashColor = colors.error;
  const winFlashColor = colors.outcomeWin;
  const bustFlashStyle = useAnimatedStyle(() => ({
    ...StyleSheet.absoluteFill,
    backgroundColor: bustFlashColor,
    opacity: bustFlash.value * 0.4,
    pointerEvents: "none",
  }));
  const winFlashStyle = useAnimatedStyle(() => ({
    ...StyleSheet.absoluteFill,
    backgroundColor: winFlashColor,
    opacity: winFlash.value * 0.35,
    pointerEvents: "none",
  }));
  const milestoneStyle = useAnimatedStyle(() => ({
    opacity: milestoneOpacity.value,
    pointerEvents: "none",
  }));
  const comebackStyle = useAnimatedStyle(() => ({
    opacity: comebackOpacity.value,
    pointerEvents: "none",
  }));
  const allInStyle = useAnimatedStyle(() => ({
    opacity: allInOpacity.value,
    pointerEvents: "none",
  }));

  const state = engine ? toViewState(engine) : null;

  useGameEvents(
    state?.events,
    {
      cardDeal: () => cardDealSound.play(),
      blackjack: () => {
        blackjackSound.play();
        setCelebrationVisible(true);
      },
      bust: () => {
        bustSound.play();
        // engine.chips reflects post-settlement state; close enough to the bust point for this threshold
        const isCriticalLow =
          engine != null && engine.startingChips > 0 && engine.chips < engine.startingChips * 0.2;
        if (isCriticalLow) {
          bustFlash.value = withSequence(
            withTiming(1, { duration: 120 }),
            withTiming(0.6, { duration: 200 }),
            withTiming(1, { duration: 100 }),
            withTiming(0, { duration: 700 })
          );
        } else {
          bustFlash.value = withSequence(
            withTiming(1, { duration: 80 }),
            withTiming(0, { duration: 400 })
          );
        }
      },
      win: () => {
        winSound.play();
        // 300ms delay creates suspense after dealer reveals hole card
        winFlash.value = withDelay(
          300,
          withSequence(withTiming(1, { duration: 80 }), withTiming(0, { duration: 500 }))
        );
      },
      push: () => pushSound.play(),
      milestone: (event) => {
        setMilestoneChips(event.value);
        milestoneOpacity.value = withSequence(
          withTiming(1, { duration: 150 }),
          withDelay(1400, withTiming(0, { duration: 250 }))
        );
      },
      comeback: () => {
        setComebackVisible(true);
        comebackOpacity.value = withSequence(
          withTiming(1, { duration: 200 }),
          withDelay(2200, withTiming(0, { duration: 400 }))
        );
        setTimeout(() => setComebackVisible(false), 2800); // 200+2200+400
      },
      allIn: () => {
        setAllInVisible(true);
        allInOpacity.value = withSequence(
          withTiming(1, { duration: 150 }),
          withDelay(900, withTiming(0, { duration: 250 }))
        );
        setTimeout(() => setAllInVisible(false), 1300); // 150+900+250
      },
    },
    clearEvents
  );

  // Redirect when phase changes away from the in-hand phases.
  useEffect(() => {
    if (loading || !engine) return;
    if (engine.phase === "betting") navigation.replace("BlackjackBetting");
    else if (engine.phase === "victory") navigation.replace("BlackjackVictory");
  }, [loading, engine, navigation]);

  const currentPhase = engine?.phase;
  const handleNewGamePress = useCallback(() => {
    if (currentPhase && currentPhase !== "betting") {
      setConfirmNewGameVisible(true);
    } else {
      handlePlayAgain();
      navigation.replace("BlackjackBetting");
    }
  }, [currentPhase, handlePlayAgain, navigation]);

  const handleConfirmNewGame = useCallback(() => {
    setConfirmNewGameVisible(false);
    handlePlayAgain();
    navigation.replace("BlackjackBetting");
  }, [handlePlayAgain, navigation]);

  const handleNewGame = useCallback(() => {
    handlePlayAgain();
    navigation.replace("BlackjackBetting");
  }, [handlePlayAgain, navigation]);

  // Derive active table config so the HUD can show the right accent colour and milestones.
  const activeTable = tableForBetLimits(engine) ?? TABLE_CONFIGS[0]!;
  const tableAccentColor = colors[activeTable.accentKey];

  const isSplit = (state?.player_hands?.length ?? 0) > 1;

  const handleHit = () => apply(engineHit, "hit");
  const handleStand = () => apply(engineStand, "stand");
  const handleDoubleDown = () => apply(engineDoubleDown, "double");
  const handleSplit = () => apply(engineSplit, "split");
  const handleNextHand = () => apply(engineNewHand);

  return (
    <GameShell
      title={t("game.title")}
      requireBack
      onBack={() => navigation.popToTop()}
      onNewGame={handleNewGame}
      onOpenScoreboard={() => navigation.navigate("Scoreboard", { gameKey: "blackjack" })}
      loading={!engine && loading}
      style={{ paddingBottom: Math.max(insets.bottom, 16) }}
    >
      {/* Full-width run HUD — table name pill, chip/goal, progress bar */}
      {state && engine?.runGoal != null && (
        <View style={styles.hudContainer}>
          <HudSidebar
            chips={engine.chips}
            startingChips={engine.startingChips}
            runGoal={engine.runGoal}
            milestones={activeTable.milestones}
            tableName={t(activeTable.labelKey as Parameters<typeof t>[0])}
            tableAccentColor={tableAccentColor}
            winStreak={sessionStats.winStreak}
          />
        </View>
      )}

      {/* New Game */}
      <View style={styles.actionRow}>
        <PillButton
          label={t("common:newGame.button")}
          onPress={handleNewGamePress}
          color={tableAccentColor}
        />
      </View>

      {/* Table */}
      {state && (
        <View testID="blackjack-table-area" style={styles.tableArea}>
          <BlackjackTable
            playerHand={state.player_hand}
            dealerHand={state.dealer_hand}
            phase={state.phase}
            playerHands={state.player_hands}
            activeHandIndex={state.active_hand_index}
            handBets={state.hand_bets}
            layout={layout}
          />
          <Animated.View style={bustFlashStyle} />
          <Animated.View style={winFlashStyle} />
          {milestoneChips !== null && (
            <Animated.View
              style={[styles.milestoneToast, milestoneStyle, { backgroundColor: tableAccentColor }]}
            >
              <Text style={[styles.toastText, { color: colors.surface }]}>
                {t("blackjack:milestone.toast", { chips: milestoneChips })}
              </Text>
            </Animated.View>
          )}
          {comebackVisible && (
            <Animated.View
              style={[styles.comebackBanner, comebackStyle, { backgroundColor: colors.bonus }]}
              accessibilityLabel={t("blackjack:comeback.bannerAccessibilityLabel")}
            >
              <Text style={[styles.comebackText, { color: colors.surface }]}>
                {t("blackjack:comeback.banner")}
              </Text>
            </Animated.View>
          )}
          {allInVisible && (
            <Animated.View
              style={[styles.allInBadge, allInStyle, { backgroundColor: colors.secondary }]}
              accessibilityLabel={t("blackjack:allIn.badgeAccessibilityLabel")}
            >
              <Text style={[styles.allInText, { color: colors.surface }]}>
                {t("blackjack:allIn.badge")}
              </Text>
            </Animated.View>
          )}
        </View>
      )}

      {/* Phase-specific controls */}
      <View
        style={[
          styles.controls,
          { paddingBottom: layout.controlsPaddingBottom, gap: layout.controlsGap },
        ]}
      >
        {state?.phase === "result" && (
          <>
            {!isSplit && <ResultBanner outcome={state.outcome!} payout={state.payout} />}
            {isSplit && (
              <View style={styles.splitResultRow}>
                {state.player_hands?.map((_, i) => (
                  <View key={i} style={styles.splitResultItem}>
                    <ResultBanner
                      outcome={state.hand_outcomes?.[i] ?? "push"}
                      payout={state.hand_payouts?.[i] ?? 0}
                      compact
                    />
                  </View>
                ))}
              </View>
            )}

            <View style={styles.resultActions}>
              <Pressable
                style={[styles.actionBtn, { backgroundColor: tableAccentColor }]}
                onPress={handleNextHand}
                accessibilityRole="button"
                accessibilityLabel={t("blackjack:actions.nextHandLabel")}
              >
                <Text style={[styles.actionBtnText, { color: colors.surface }]}>
                  {t("blackjack:actions.nextHand")}
                </Text>
              </Pressable>

              <Pressable
                style={[styles.actionBtn, styles.quitBtn, { borderColor: colors.border }]}
                onPress={() => navigation.goBack()}
                accessibilityRole="button"
                accessibilityLabel={t("blackjack:actions.quitLabel")}
              >
                <Text style={[styles.actionBtnText, { color: colors.text }]}>
                  {t("blackjack:actions.quit")}
                </Text>
              </Pressable>
            </View>
          </>
        )}

        {state?.phase === "player" && (
          <ActionButtons
            onHit={handleHit}
            onStand={handleStand}
            onDoubleDown={handleDoubleDown}
            onSplit={handleSplit}
            doubleDownAvailable={state.double_down_available}
            splitAvailable={state.split_available}
            loading={false}
            layout={layout}
          />
        )}

        {state && state.phase !== "betting" && error && (
          <Text style={[styles.error, { color: colors.error }]}>{error}</Text>
        )}
      </View>

      {state && (
        <GameResultModal
          visible={state.game_over}
          // The result the run recorded (#2628): a win if it reached its goal
          // before Keep Playing, else a loss.
          outcome={runResult ?? "ended"}
          eyebrow={`${t("game.title")} · ${t(activeTable.labelKey as Parameters<typeof t>[0])}`}
          subtitle={t("gameOver.title")}
          stats={[
            { label: tResult("stat.hands"), value: sessionStats.handsPlayed },
            { label: tResult("stat.biggestWin"), value: sessionStats.biggestWin },
            { label: tResult("stat.winRate"), value: `${winRatePct(sessionStats) ?? 0}%` },
          ]}
          // Same as the header's New Game: a fresh session, back to betting.
          onPlayAgain={handleNewGame}
          onHome={() => navigation.popToTop()}
          testID="blackjack-result"
        />
      )}

      <NewGameConfirmModal
        visible={confirmNewGameVisible}
        onConfirm={handleConfirmNewGame}
        onCancel={() => setConfirmNewGameVisible(false)}
      />

      <BlackjackCelebrationAnimation
        visible={celebrationVisible}
        onDismiss={() => setCelebrationVisible(false)}
      />
    </GameShell>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  hudContainer: {
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  actionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  tableArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    // minHeight: 0 lets this flex child shrink below intrinsic content height
    // on compact viewports (Galaxy Fold landscape, etc.)
    minHeight: 0,
    overflow: "hidden",
  },
  controls: {
    alignItems: "center",
    paddingHorizontal: 16,
    // flexShrink: 0 keeps the action cluster fully rendered even when the
    // tableRow above is competing for space — without this, on compact
    // viewports the controls could be squeezed to zero height.
    flexShrink: 0,
  },
  resultActions: {
    width: "100%",
    maxWidth: 320,
    gap: 12,
  },
  splitResultRow: {
    flexDirection: "row",
    gap: 8,
    width: "100%",
    maxWidth: 320,
  },
  splitResultItem: {
    flex: 1,
  },
  actionBtn: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: 12,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  quitBtn: {
    backgroundColor: "transparent",
    borderWidth: 1,
  },
  actionBtnText: {
    fontSize: 16,
    fontWeight: "700",
  },
  error: {
    fontSize: 13,
    textAlign: "center",
  },
  milestoneToast: {
    position: "absolute",
    top: 8,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    zIndex: 10,
  },
  toastText: {
    fontSize: 14,
    fontWeight: "700",
  },
  comebackBanner: {
    position: "absolute",
    top: "35%",
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 16,
    zIndex: 10,
  },
  comebackText: {
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  allInBadge: {
    position: "absolute",
    bottom: 12,
    alignSelf: "center",
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 20,
    zIndex: 10,
  },
  allInText: {
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
});
