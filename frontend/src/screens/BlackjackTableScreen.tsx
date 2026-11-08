/**
 * BlackjackTableScreen — the one Blackjack table (#3580): table pick, betting,
 * play and the result all happen on this screen, with no screen swap between
 * hands. The `BlackjackBetting` route renders this same screen (see
 * BlackjackBettingScreen.tsx), so the lobby, the paywall and the victory
 * screen still open it by that name.
 *
 * Concerns:
 *   1. Game logic — bets, hit, stand, double, split and the next hand go through
 *      `apply` from `useBlackjackGame` (game/blackjack/BlackjackGameContext),
 *      which owns the engine state, saving, the run's session and its replay.
 *      The next hand (Change, Rebet, 2×, a chip in the result tray) goes
 *      through `applySteps`: newHand, then placeBet for Rebet / 2×, as one
 *      transition from the latest state. The round log sees a new hand and an
 *      ordinary bet; no betting frame is drawn in between. The table picker
 *      shows while the context's `tablePickPending` is set.
 *   2. Layout — a slim HUD strip, the felt (TableFelt: dealer on top, the
 *      player low, the result between) and the dock (TableDock: one control set
 *      at a time). Card geometry is `computeTableGeometry` (game/blackjack/
 *      layout.ts), memoised on the felt's measured size and the card counts.
 *   3. Events and feedback — `useGameEvents` plays the sounds and drives the
 *      bust/win flashes, milestone, comeback and all-in banners (Reanimated)
 *      and the blackjack celebration.
 *   4. Navigation — the run's goal opens BlackjackVictory; the run history opens
 *      BlackjackStats; New Game is in the header's ⋯ menu (with its confirm).
 *   5. Result (#2628) — the shared GameResultModal when the chips run out.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
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
import { typography } from "../theme/typography";
import {
  hit as engineHit,
  stand as engineStand,
  doubleDown as engineDoubleDown,
  split as engineSplit,
  newHand as engineNewHand,
  placeBet as enginePlaceBet,
  toViewState,
  DEFAULT_RULES,
} from "../game/blackjack/engine";
import type { BlackjackState } from "../game/blackjack/types";
import type { EngineState } from "../game/blackjack/engine";
import { useBlackjackGame } from "../game/blackjack/BlackjackGameContext";
import { loadRuns, type RunRecord } from "../game/blackjack/storage";
import { TABLE_CONFIGS, tableForBetLimits } from "../game/blackjack/tables";
import {
  computeTableGeometry,
  DOCK_HEIGHT,
  estimateFeltSize,
  showsResult,
} from "../game/blackjack/layout";
import { isLegalBet, maxBet, quickBets, trayChips } from "../game/blackjack/betRules";
import { useGameEvents } from "../game/_shared/useGameEvents";
import { useSound } from "../game/_shared/useSound";
import { BLACKJACK_SOUNDS } from "../game/blackjack/sounds";
import TableFelt, { type FeltResult } from "../components/blackjack/TableFelt";
import { BettingDock, ResultDock } from "../components/blackjack/TableDock";
import TableRules from "../components/blackjack/TableRules";
import BettingCircle from "../components/blackjack/BettingCircle";
import TableSelectPanel from "../components/blackjack/TableSelectPanel";
import BlackjackDevPanel from "../components/blackjack/BlackjackDevPanel";
import ActionButtons from "../components/blackjack/ActionButtons";
import GameResultModal from "../components/shared/GameResultModal";
import { winRatePct } from "../components/scorecard/blackjackStatsModel";
import HudSidebar from "../components/blackjack/HudSidebar";
import { GameShell } from "../components/shared/GameShell";
import { APP_HEADER_HEIGHT } from "../components/shared/AppHeader";
import { BlackjackCelebrationAnimation } from "../components/blackjack/BlackjackCelebrationAnimation";

type Props = {
  navigation: NativeStackNavigationProp<HomeStackParamList, "BlackjackTable" | "BlackjackBetting">;
};

type Translate = ReturnType<typeof useTranslation>["t"];

/** The result shown on the felt: the round's outcome and one line of why. */
export function feltResultFor(state: BlackjackState, t: Translate): FeltResult | null {
  if (!showsResult(state.phase)) return null;
  const split = state.player_hands.length > 1;
  const dealer = state.dealer_hand.value;
  if (split) {
    const net = state.hand_payouts.reduce((a, b) => a + b, 0);
    return {
      outcome: net > 0 ? "win" : net < 0 ? "lose" : "push",
      payout: net,
      detail:
        dealer > 21
          ? t("blackjack:result.dealerBusts", { value: dealer })
          : t("blackjack:result.dealerHas", { value: dealer }),
    };
  }
  if (state.outcome === null) return null;
  const player = state.player_hand.value;
  let detail: string | null;
  if (player > 21) detail = t("blackjack:result.playerBusts", { value: player });
  else if (dealer > 21) detail = t("blackjack:result.dealerBusts", { value: dealer });
  else if (state.outcome === "blackjack") detail = null;
  else detail = t("blackjack:result.versus", { player, dealer });
  return { outcome: state.outcome, payout: state.payout, detail };
}

export default function BlackjackTableScreen({ navigation }: Props) {
  const { t } = useTranslation(["blackjack", "common"]);
  const { t: tResult } = useTranslation("result");
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const {
    engine,
    loading,
    error,
    apply,
    applySteps,
    tablePickPending,
    clearEvents,
    handlePlayAgain,
    handleRulesChange,
    handleTableSelect,
    sessionStats,
    runResult,
  } = useBlackjackGame();
  const [celebrationVisible, setCelebrationVisible] = useState(false);
  const [milestoneChips, setMilestoneChips] = useState<number | null>(null);
  const [comebackVisible, setComebackVisible] = useState(false);
  const [allInVisible, setAllInVisible] = useState(false);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  // The bet being built in the dock (chips tapped so far).
  const [bet, setBet] = useState(0);
  const [feltSize, setFeltSize] = useState<{ width: number; height: number } | null>(null);
  const milestoneOpacity = useSharedValue(0);
  const comebackOpacity = useSharedValue(0);
  const allInOpacity = useSharedValue(0);

  const cardDealSound = useSound("blackjack.cardDeal", BLACKJACK_SOUNDS);
  const blackjackSound = useSound("blackjack.blackjack", BLACKJACK_SOUNDS);
  const bustSound = useSound("blackjack.bust", BLACKJACK_SOUNDS);
  const winSound = useSound("blackjack.win", BLACKJACK_SOUNDS);
  const pushSound = useSound("blackjack.push", BLACKJACK_SOUNDS);

  // Flash animations for the felt
  const bustFlash = useSharedValue(0);
  const winFlash = useSharedValue(0);

  useEffect(() => {
    loadRuns()
      .then(setRuns)
      .catch(() => {});
  }, []);

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

  const state = useMemo(() => (engine ? toViewState(engine) : null), [engine]);

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

  // The run's goal opens the victory screen; nothing else leaves the table.
  useEffect(() => {
    if (loading || !engine) return;
    if (engine.phase === "victory") navigation.replace("BlackjackVictory");
  }, [loading, engine, navigation]);

  const handleNewGame = useCallback(() => {
    setBet(0);
    handlePlayAgain();
  }, [handlePlayAgain]);

  // Table select: explicit context state, set for a fresh run until a table is picked.
  const showTableSelect = engine !== null && tablePickPending;

  const activeTable = tableForBetLimits(engine) ?? TABLE_CONFIGS[0]!;
  const tableAccentColor = colors[activeTable.accentKey];
  const phase = state?.phase ?? "betting";
  const betting = phase === "betting";
  const playing = phase === "player";
  const showResult = showsResult(phase);

  // --- geometry: memoised on the felt's size and the card counts ---
  const handCards = useMemo(
    () => (state && !betting ? state.player_hands.map((h) => h.cards.length) : []),
    [state, betting]
  );
  const handCardsKey = handCards.join(",");
  const dealerCards = state && !betting ? state.dealer_hand.cards.length : 0;
  const activeHandIndex = playing ? (state?.active_hand_index ?? 0) : null;
  const feltEstimate = useMemo(
    () =>
      estimateFeltSize({
        screenWidth: window.width,
        screenHeight: window.height,
        insetTop: insets.top,
        insetBottom: insets.bottom,
        headerHeight: APP_HEADER_HEIGHT,
      }),
    [window.width, window.height, insets.top, insets.bottom]
  );
  const felt = feltSize ?? feltEstimate;
  const geometry = useMemo(
    () =>
      computeTableGeometry({
        feltWidth: felt.width,
        feltHeight: felt.height,
        screenWidth: window.width,
        dealerCards,
        handCards: handCardsKey ? handCardsKey.split(",").map(Number) : [],
        activeHandIndex,
        showResult,
      }),
    [felt.width, felt.height, window.width, dealerCards, handCardsKey, activeHandIndex, showResult]
  );
  const onFeltLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setFeltSize((prev) =>
      prev && prev.width === width && prev.height === height ? prev : { width, height }
    );
  }, []);

  const feltResult = useMemo(() => (state ? feltResultFor(state, t) : null), [state, t]);

  // --- bets ---
  const limits = engine
    ? { chips: engine.chips, betMin: engine.betMin, betMax: engine.betMax }
    : { chips: 0, betMin: 0, betMax: 0 };
  const chips = trayChips(activeTable.chipDenominations, limits);
  const quick = engine ? quickBets(engine) : null;

  const addChip = (chip: number) => setBet((b) => Math.min(maxBet(limits), b + chip));
  const canAddChip = (chip: number) => bet + chip <= maxBet(limits);
  const deal = () => apply((s) => enginePlaceBet(s, bet));
  /**
   * Leave the result for the next hand: its betting with this bet started
   * (0 = none), or, with `dealAmount` (Rebet / 2×), straight on to the deal.
   * One transition from the latest state: a second tap that lands after the
   * first has already moved on does nothing.
   */
  const nextHand = (startBet: number, dealAmount: number | null = null) => {
    const steps =
      dealAmount === null
        ? [engineNewHand]
        : [engineNewHand, (s: EngineState) => enginePlaceBet(s, dealAmount)];
    if (applySteps(steps, ["result"])) setBet(startBet);
  };

  const handleHit = () => apply(engineHit, "hit");
  const handleStand = () => apply(engineStand, "stand");
  const handleDoubleDown = () => apply(engineDoubleDown, "double");
  const handleSplit = () => apply(engineSplit, "split");

  const canContinue = !!state && !state.game_over && phase === "result";

  return (
    <GameShell
      gameType="blackjack"
      title={t("game.title")}
      requireBack
      onBack={() => navigation.popToTop()}
      gutter={null}
      onNewGame={handleNewGame}
      loading={!engine && loading}
      style={{ paddingBottom: Math.max(insets.bottom, 8) }}
    >
      {showTableSelect ? (
        <ScrollView contentContainerStyle={styles.tableSelect}>
          <TableSelectPanel
            runs={runs}
            onSelectTable={handleTableSelect}
            onViewHistory={() => navigation.navigate("BlackjackStats")}
          />
        </ScrollView>
      ) : (
        <>
          {/* Slim HUD strip: table, chips / goal, progress */}
          {state && engine?.runGoal != null && (
            <View style={styles.hud}>
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

          {/* The felt */}
          {state && (
            <View testID="blackjack-table-area" style={styles.feltArea}>
              <TableFelt
                geometry={geometry}
                phase={phase}
                dealerHand={state.dealer_hand}
                hands={betting ? [] : state.player_hands}
                handBets={state.hand_bets}
                activeHandIndex={state.active_hand_index}
                handOutcomes={state.hand_outcomes}
                handPayouts={state.hand_payouts}
                result={feltResult}
                onLayout={onFeltLayout}
              >
                {betting && geometry.betSpot && (
                  <>
                    <View
                      style={[
                        styles.abs,
                        {
                          left: geometry.betSpot.x,
                          top: geometry.betSpot.y,
                          width: geometry.betSpot.width,
                          height: geometry.betSpot.height,
                        },
                      ]}
                    >
                      <BettingCircle
                        bet={bet}
                        size={geometry.betSpot.width}
                        accentColor={tableAccentColor}
                      />
                    </View>
                    <Text
                      style={[
                        styles.limits,
                        geometry.limits && {
                          left: geometry.limits.x,
                          top: geometry.limits.y,
                          width: geometry.limits.width,
                          height: geometry.limits.height,
                          textAlign: geometry.limits.x > geometry.betSpot.x ? "left" : "center",
                        },
                        { color: colors.textMuted, fontFamily: typography.label },
                      ]}
                      numberOfLines={2}
                    >
                      {t("betting.tableLimits")}:{" "}
                      {t("betting.tableLimitsRange", { min: limits.betMin, max: limits.betMax })}
                    </Text>
                    <View style={styles.feltFooter}>
                      <TableRules
                        rules={state.rules ?? DEFAULT_RULES}
                        onRulesChange={handleRulesChange}
                      />
                    </View>
                    <Pressable
                      style={styles.statsLink}
                      onPress={() => navigation.navigate("BlackjackStats")}
                      accessibilityRole="button"
                      accessibilityLabel={t("blackjack:stats.viewStatsLabel")}
                      hitSlop={8}
                    >
                      <Text style={[styles.statsLinkText, { color: colors.textMuted }]}>
                        {t("blackjack:stats.viewStats")}
                      </Text>
                    </Pressable>
                  </>
                )}
                <Animated.View style={bustFlashStyle} />
                <Animated.View style={winFlashStyle} />
                {milestoneChips !== null && (
                  <Animated.View
                    style={[
                      styles.milestoneToast,
                      milestoneStyle,
                      { backgroundColor: tableAccentColor },
                    ]}
                  >
                    <Text style={[styles.toastText, { color: colors.surface }]}>
                      {t("blackjack:milestone.toast", { chips: milestoneChips })}
                    </Text>
                  </Animated.View>
                )}
                {comebackVisible && (
                  <Animated.View
                    style={[
                      styles.comebackBanner,
                      comebackStyle,
                      { backgroundColor: colors.bonus },
                    ]}
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
              </TableFelt>
              {/* An engine error overlays the felt's foot, so the dock never moves. */}
              {!!error && (
                <Text
                  style={[
                    styles.error,
                    { color: colors.error, backgroundColor: colors.surfaceHigh },
                  ]}
                  accessibilityRole="alert"
                >
                  {error}
                </Text>
              )}
            </View>
          )}

          {/* The dock: one control set at a time */}
          {state && (
            <View testID="blackjack-dock" style={styles.dock}>
              {betting && (
                <BettingDock
                  chips={chips}
                  bet={bet}
                  canAdd={canAddChip}
                  onChip={addChip}
                  canDeal={isLegalBet(bet, limits)}
                  onClear={() => setBet(0)}
                  onDeal={deal}
                  accentColor={tableAccentColor}
                />
              )}
              {playing && (
                <ActionButtons
                  variant="dock"
                  onHit={handleHit}
                  onStand={handleStand}
                  onDoubleDown={handleDoubleDown}
                  onSplit={handleSplit}
                  doubleDownAvailable={state.double_down_available}
                  splitAvailable={state.split_available}
                  loading={false}
                />
              )}
              {showResult && quick && (
                <ResultDock
                  chips={chips}
                  canAdd={(chip) => chip <= maxBet(limits)}
                  onChip={(chip) => nextHand(chip)}
                  onChange={() => nextHand(0)}
                  rebet={quick.rebet}
                  rebetAllowed={quick.rebetAllowed}
                  onRebet={() => nextHand(quick.rebet, quick.rebet)}
                  double={quick.double}
                  doubleAllowed={quick.doubleAllowed}
                  onDouble={() => nextHand(quick.double, quick.double)}
                  canContinue={canContinue}
                  accentColor={tableAccentColor}
                />
              )}
            </View>
          )}
        </>
      )}

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
          // Same as the ⋯ menu's New Game: a fresh session, back to the table pick.
          onPlayAgain={handleNewGame}
          onHome={() => navigation.popToTop()}
          testID="blackjack-result"
        />
      )}

      <BlackjackCelebrationAnimation
        visible={celebrationVisible}
        onDismiss={() => setCelebrationVisible(false)}
      />
      <BlackjackDevPanel />
    </GameShell>
  );
}

const styles = StyleSheet.create({
  tableSelect: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  hud: {
    paddingHorizontal: 12,
    paddingTop: 2,
    paddingBottom: 6,
  },
  feltArea: {
    flex: 1,
    marginHorizontal: 8,
    // minHeight: 0 lets the felt shrink below its content on short screens.
    minHeight: 0,
  },
  abs: {
    position: "absolute",
  },
  limits: {
    position: "absolute",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  feltFooter: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 6,
  },
  statsLink: {
    position: "absolute",
    right: 14,
    bottom: 10,
  },
  statsLinkText: {
    fontSize: 12,
    fontWeight: "500",
    textDecorationLine: "underline",
  },
  dock: {
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 4,
    // One height in every phase (#3580): the felt, and the cards on it, never
    // resize between betting, play and the result.
    height: DOCK_HEIGHT,
    minHeight: DOCK_HEIGHT,
    justifyContent: "flex-end",
    flexShrink: 0,
  },
  error: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 6,
    fontSize: 13,
    textAlign: "center",
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    overflow: "hidden",
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
