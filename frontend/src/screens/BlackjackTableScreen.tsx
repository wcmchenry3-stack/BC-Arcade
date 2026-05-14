import React, { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from "react-native";
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
import type { HomeStackParamList } from "../../App";
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
import { TABLE_CONFIGS } from "../game/blackjack/tables";
import { useGameEvents } from "../game/_shared/useGameEvents";
import { useSound } from "../game/_shared/useSound";
import BlackjackTable from "../components/blackjack/BlackjackTable";
import ActionButtons from "../components/blackjack/ActionButtons";
import ResultBanner from "../components/blackjack/ResultBanner";
import GameOverModal from "../components/blackjack/GameOverModal";
import HudSidebar from "../components/blackjack/HudSidebar";
import NewGameConfirmModal from "../components/shared/NewGameConfirmModal";
import { GameShell } from "../components/shared/GameShell";
import { BlackjackCelebrationAnimation } from "../components/blackjack/BlackjackCelebrationAnimation";

// Below this viewport height, card sizes, action-button sizes, and table
// padding collapse to compact variants so the dealer hand, player hand, and
// action cluster all fit without overlapping. Catches Galaxy Fold unfolded
// in landscape (~604dp), Fold unfolded in portrait (~725dp), and smaller
// phones in landscape.
const COMPACT_HEIGHT_BREAKPOINT = 780;

type Props = {
  navigation: NativeStackNavigationProp<HomeStackParamList, "BlackjackTable">;
};

export default function BlackjackTableScreen({ navigation }: Props) {
  const { t } = useTranslation(["blackjack", "common"]);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const isCompact = height < COMPACT_HEIGHT_BREAKPOINT;
  const { engine, loading, error, apply, clearEvents, handlePlayAgain, sessionStats } =
    useBlackjackGame();
  const [confirmNewGameVisible, setConfirmNewGameVisible] = useState(false);
  const [celebrationVisible, setCelebrationVisible] = useState(false);
  const [milestoneChips, setMilestoneChips] = useState<number | null>(null);
  const [comebackVisible, setComebackVisible] = useState(false);
  const [allInVisible, setAllInVisible] = useState(false);
  const milestoneOpacity = useSharedValue(0);
  const comebackOpacity = useSharedValue(0);
  const allInOpacity = useSharedValue(0);

  const cardDealSound = useSound("blackjack.cardDeal");
  const blackjackSound = useSound("blackjack.blackjack");
  const bustSound = useSound("blackjack.bust");
  const winSound = useSound("blackjack.win");
  const pushSound = useSound("blackjack.push");

  // Flash animations for player hand area
  const bustFlash = useSharedValue(0);
  const winFlash = useSharedValue(0);

  const bustFlashStyle = useAnimatedStyle(() => ({
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(220,38,38,0.4)",
    opacity: bustFlash.value,
    pointerEvents: "none",
  }));
  const winFlashStyle = useAnimatedStyle(() => ({
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(34,197,94,0.35)",
    opacity: winFlash.value,
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
  const activeTable =
    TABLE_CONFIGS.find((c) => c.betMin === engine?.betMin && c.betMax === engine?.betMax) ??
    TABLE_CONFIGS[0]!;
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
        <Pressable
          onPress={handleNewGamePress}
          style={[styles.newGameBtn, { borderColor: tableAccentColor }]}
          accessibilityRole="button"
          accessibilityLabel={t("common:newGame.button")}
        >
          <Text style={[styles.newGameText, { color: tableAccentColor }]}>
            {t("common:newGame.button")}
          </Text>
        </Pressable>
      </View>

      {/* Table */}
      {state && (
        <View style={styles.tableArea}>
          <BlackjackTable
            playerHand={state.player_hand}
            dealerHand={state.dealer_hand}
            phase={state.phase}
            playerHands={state.player_hands}
            activeHandIndex={state.active_hand_index}
            handBets={state.hand_bets}
            handOutcomes={state.hand_outcomes}
            handPayouts={state.hand_payouts}
            compact={isCompact}
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
      <View style={[styles.controls, isCompact && styles.controlsCompact]}>
        {state?.phase === "result" && (
          <>
            {!isSplit && <ResultBanner outcome={state.outcome!} payout={state.payout} />}

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
            compact={isCompact}
          />
        )}

        {state && state.phase !== "betting" && error && (
          <Text style={[styles.error, { color: colors.error }]}>{error}</Text>
        )}
      </View>

      {state && (
        <GameOverModal
          visible={state.game_over}
          onPlayAgain={handlePlayAgain}
          onHome={() => navigation.goBack()}
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
  newGameBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 32,
    justifyContent: "center",
  },
  newGameText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
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
    paddingBottom: 32,
    gap: 16,
    // flexShrink: 0 keeps the action cluster fully rendered even when the
    // tableRow above is competing for space — without this, on compact
    // viewports the controls could be squeezed to zero height.
    flexShrink: 0,
  },
  controlsCompact: {
    paddingBottom: 12,
    gap: 8,
  },
  resultActions: {
    width: "100%",
    maxWidth: 320,
    gap: 12,
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
