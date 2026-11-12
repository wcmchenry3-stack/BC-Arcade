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
 *   3. Motion, sounds and feedback (#3581) — `useBlackjackMotion` replays
 *      each action from the settled round: the deal, the hole-card flip, the
 *      dealer's turn, the result and the chips, with each sound at its moment
 *      (and the bust/win flashes with the result; a natural's moment on the
 *      felt, #3621). Input stays live: an action lands any motion at once first.
 *      `useGameEvents` drives the milestone and comeback toasts (once the
 *      round settles) and the all-in badge.
 *   4. Navigation — the run's goal opens BlackjackVictory; the run history opens
 *      BlackjackStats; New Game is in the header's ⋯ menu (with its confirm).
 *   5. Result (#2628) — the shared GameResultModal when the chips run out.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  tableGeometryForTurn,
  DOCK_HEIGHT,
  DOCK_PADDING_BOTTOM,
  DOCK_PADDING_TOP,
  FELT_BORDER,
  FELT_FOOTER_HEIGHT,
  estimateFeltSize,
  showsResult,
  TABLE_BOTTOM_GAP,
} from "../game/blackjack/layout";
import { isLegalBet, maxBet, quickBets, trayChips } from "../game/blackjack/betRules";
import { reportCardsOffTable } from "../game/_shared/cards/offTableReport";
import { useDeck } from "../game/_shared/decks/CardDeckContext";
import { useGameEvents } from "../game/_shared/useGameEvents";
import { useBlackjackMotion } from "../components/blackjack/useBlackjackMotion";
import { useBlackjackCues } from "../components/blackjack/useBlackjackCues";
import { useReduceMotion } from "../components/shared/useReduceMotion";
import { usePauseWhileAway, type FocusEventSource } from "../hooks/usePauseWhileAway";
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
    const count = (o: string) => state.hand_outcomes.filter((h) => h === o).length;
    const won = count("win") + count("blackjack");
    const lost = count("lose");
    const pushed = state.player_hands.length - won - lost;
    const summary = [
      won > 0 ? t("blackjack:result.splitWon", { count: won }) : null,
      lost > 0 ? t("blackjack:result.splitLost", { count: lost }) : null,
      pushed > 0 ? t("blackjack:result.splitPush", { count: pushed }) : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      outcome: net > 0 ? "win" : net < 0 ? "lose" : "push",
      payout: net,
      summary,
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
    runsVersion,
    clearEvents,
    handlePlayAgain,
    handleRulesChange,
    handleTableSelect,
    sessionStats,
    runResult,
  } = useBlackjackGame();
  const [milestoneChips, setMilestoneChips] = useState<number | null>(null);
  const [comebackVisible, setComebackVisible] = useState(false);
  const [allInVisible, setAllInVisible] = useState(false);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  // The bet being built in the dock (chips tapped so far). It only means
  // something while betting: once a hand is dealt (Deal, Rebet, 2×) it is
  // cleared, so the next betting phase never starts from a stale amount.
  const [bet, setBet] = useState(0);
  const [feltSize, setFeltSize] = useState<{ width: number; height: number } | null>(null);
  const milestoneOpacity = useSharedValue(0);
  const comebackOpacity = useSharedValue(0);
  const allInOpacity = useSharedValue(0);

  // Flash animations for the felt
  const bustFlash = useSharedValue(0);
  const winFlash = useSharedValue(0);

  // Reloaded whenever a run is saved (and when the picker opens), because the
  // picker no longer remounts the screen: a table earned this run must unlock.
  useEffect(() => {
    loadRuns()
      .then(setRuns)
      .catch(() => {});
  }, [runsVersion, tablePickPending]);

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

  // Each moment's sound, and the result's effect on the felt (#3581).
  const engineChips = engine?.chips ?? 0;
  const startingChips = engine?.startingChips ?? 0;
  const playCue = useBlackjackCues({
    onWin: () =>
      winFlash.set(withSequence(withTiming(1, { duration: 80 }), withTiming(0, { duration: 500 }))),
    onBust: () => {
      // The settled chips: close enough to the bust point for this threshold.
      const isCriticalLow = startingChips > 0 && engineChips < startingChips * 0.2;
      bustFlash.set(
        isCriticalLow
          ? withSequence(
              withTiming(1, { duration: 120 }),
              withTiming(0.6, { duration: 200 }),
              withTiming(1, { duration: 100 }),
              withTiming(0, { duration: 700 })
            )
          : withSequence(withTiming(1, { duration: 80 }), withTiming(0, { duration: 400 }))
      );
    },
  });

  // The player away (another screen, the background, the ⋯ menu): the motion lands, silently.
  // The test navigation stubs have no listeners, hence the guard.
  const focusSource = useMemo<FocusEventSource>(
    () => ({
      addListener: (type, callback) =>
        typeof navigation.addListener === "function"
          ? navigation.addListener(type, callback)
          : () => undefined,
      isFocused:
        typeof navigation.isFocused === "function" ? () => navigation.isFocused() : undefined,
    }),
    [navigation]
  );
  const leaveMotionRef = useRef<() => void>(() => undefined);
  const awayRef = usePauseWhileAway(
    focusSource,
    () => leaveMotionRef.current(),
    () => undefined
  );
  const reduceMotion = useReduceMotion();
  const motion = useBlackjackMotion({ engine, reduceMotion, awayRef, playCue });
  const leaveMotion = motion.leave;
  useLayoutEffect(() => {
    leaveMotionRef.current = leaveMotion;
  }, [leaveMotion]);
  /** What the felt draws: the settled round, cut to what the motion has shown so far. */
  const shown = motion.view;

  useGameEvents(
    state?.events,
    {
      // The cards', the result's and the chips' sounds and effects are the motion's (#3581).
      milestone: (event) =>
        motion.whenSettled(() => {
          setMilestoneChips(event.value);
          milestoneOpacity.value = withSequence(
            withTiming(1, { duration: 150 }),
            withDelay(1400, withTiming(0, { duration: 250 }))
          );
        }),
      comeback: () =>
        motion.whenSettled(() => {
          setComebackVisible(true);
          comebackOpacity.value = withSequence(
            withTiming(1, { duration: 200 }),
            withDelay(2200, withTiming(0, { duration: 400 }))
          );
          setTimeout(() => setComebackVisible(false), 2800); // 200+2200+400
        }),
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

  // A dealt hand clears the dock's bet (see `bet`).
  const enginePhase = engine?.phase;
  useEffect(() => {
    if (enginePhase !== undefined && enginePhase !== "betting") setBet(0);
  }, [enginePhase]);

  // The run's goal opens the victory screen, once the winning hand has played out and paid;
  // nothing else leaves the table.
  const motionSettled = motion.settled;
  useEffect(() => {
    if (loading || !engine || !motionSettled) return;
    if (engine.phase === "victory") navigation.replace("BlackjackVictory");
  }, [loading, engine, navigation, motionSettled]);

  const resetMotion = motion.reset;
  const handleNewGame = useCallback(() => {
    setBet(0);
    resetMotion();
    handlePlayAgain();
  }, [handlePlayAgain, resetMotion]);

  // Table select: explicit context state, set for a fresh run until a table is picked.
  const showTableSelect = engine !== null && tablePickPending;

  const activeTable = tableForBetLimits(engine) ?? TABLE_CONFIGS[0]!;
  const tableAccentColor = colors[activeTable.accentKey];
  const phase = state?.phase ?? "betting";
  const betting = phase === "betting";
  const playing = phase === "player";
  const showResult = showsResult(phase);
  // The felt's phase: the player's until the result shows (the dealer's turn replays first).
  const feltPhase = shown?.phase ?? phase;
  const feltBetting = feltPhase === "betting";
  const feltShowsResult = showsResult(feltPhase);
  // The dock follows the felt: the actions while the felt shows the player's turn (greyed once the
  // engine has moved on to the result), the result's controls once the result shows.
  const dockPlaying = !feltBetting && feltPhase === "player" && (playing || showResult);

  // --- geometry: memoised on the felt's size and the card counts ---
  const handCards = useMemo(
    () => (shown && !feltBetting ? shown.player_hands.map((h) => h.cards.length) : []),
    [shown, feltBetting]
  );
  const handCardsKey = handCards.join(",");
  const dealerCards = shown && !feltBetting ? shown.dealer_hand.cards.length : 0;
  const activeHandIndex = feltPhase === "player" ? (shown?.active_hand_index ?? 0) : null;
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
  // The dealer's turn is playing out (every hand played, the result still to show): the result's
  // band is kept free already, so the banner appearing moves no hand (#3720).
  const handCount = handCards.length;
  const dealerTurn =
    !feltShowsResult && showResult && activeHandIndex !== null && activeHandIndex >= handCount;
  const geometry = useMemo(
    () =>
      tableGeometryForTurn(
        {
          feltWidth: felt.width,
          feltHeight: felt.height,
          screenWidth: window.width,
          screenHeight: window.height,
          dealerCards,
          handCards: handCardsKey ? handCardsKey.split(",").map(Number) : [],
          activeHandIndex,
          showResult: feltShowsResult,
        },
        dealerTurn
      ),
    [
      felt.width,
      felt.height,
      window.width,
      window.height,
      dealerCards,
      handCardsKey,
      activeHandIndex,
      feltShowsResult,
      dealerTurn,
    ]
  );
  // Cards off the felt (#3653): the dealer's and the player's fans against the measured felt,
  // after a layout change or a card count change only (never the first-frame estimate).
  const deckId = useDeck().activeDeck.id;
  useEffect(() => {
    if (feltSize === null) return;
    const fans = [
      ...(geometry.dealer.collapsed || dealerCards === 0 ? [] : [geometry.dealer.fan]),
      ...geometry.hands.map((h) => h.fan),
    ].filter((f) => f.count > 0);
    if (fans.length === 0) return;
    reportCardsOffTable({
      game: "blackjack",
      measured: true,
      container: { w: feltSize.width, h: feltSize.height },
      content: {
        left: Math.min(...fans.map((f) => f.x)),
        top: Math.min(...fans.map((f) => f.y)),
        right: Math.max(...fans.map((f) => f.x + f.width)),
        bottom: Math.max(...fans.map((f) => f.y + f.cardHeight)),
      },
      deck: deckId,
      context: {
        cardWidth: geometry.hands[0]?.fan.cardWidth ?? geometry.dealer.fan.cardWidth,
        cardHeight: geometry.hands[0]?.fan.cardHeight ?? geometry.dealer.fan.cardHeight,
        step: geometry.hands[0]?.fan.step ?? geometry.dealer.fan.step,
        compression: geometry.mode,
        handLengths: geometry.hands.map((h) => h.fan.count),
        dealerLength: dealerCards,
        insets,
      },
    });
  }, [feltSize, geometry, dealerCards, deckId, insets]);
  const onFeltLayout = useCallback((e: LayoutChangeEvent) => {
    // The felt's children are positioned inside its border.
    const width = e.nativeEvent.layout.width - 2 * FELT_BORDER;
    const height = e.nativeEvent.layout.height - 2 * FELT_BORDER;
    setFeltSize((prev) =>
      prev && prev.width === width && prev.height === height ? prev : { width, height }
    );
  }, []);

  const feltResult = useMemo(() => (shown ? feltResultFor(shown, t) : null), [shown, t]);

  // --- bets ---
  const limits = engine
    ? { chips: engine.chips, betMin: engine.betMin, betMax: engine.betMax }
    : { chips: 0, betMin: 0, betMax: 0 };
  const chips = trayChips(activeTable.chipDenominations, limits);
  const quick = engine ? quickBets(engine) : null;

  const addChip = (chip: number) => {
    motion.betChip();
    setBet((b) => Math.min(maxBet(limits), b + chip));
  };
  const canAddChip = (chip: number) => bet + chip <= maxBet(limits);
  /**
   * The player's action: any motion still running lands at once (a result still playing out shows
   * first and holds a beat, #3720), and this one is replayed.
   */
  const act = motion.act;
  const deal = () => act(() => apply((s) => enginePlaceBet(s, bet)));
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
    // Change / a chip start the next bet; Rebet / 2× deal at once (no bet left building).
    act(() => {
      if (!applySteps(steps, ["result"])) return;
      setBet(dealAmount === null ? startBet : 0);
      // A chip from the result's tray goes into the betting circle.
      if (dealAmount === null && startBet > 0) motion.betChip();
    });
  };

  const handleHit = () => act(() => apply(engineHit, "hit"));
  const handleStand = () => act(() => apply(engineStand, "stand"));
  const handleDoubleDown = () => act(() => apply(engineDoubleDown, "double"));
  const handleSplit = () => act(() => apply(engineSplit, "split"));

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
      style={{ paddingBottom: TABLE_BOTTOM_GAP }}
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
                // The settled count shows once the payout lands (#3581).
                chips={motion.shownChips ?? engine.chips}
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
            // A tap on the felt mid-motion lands it at once (input stays live, #3575); a result
            // still playing out shows, and holds a beat (#3720). Off while nothing moves, so the
            // felt's own controls (the rules, the stats link) take their taps as before.
            <Pressable
              testID="blackjack-table-area"
              style={styles.feltArea}
              onPress={motion.skip}
              disabled={motion.settled}
              accessible={false}
              // Not a stop for TalkBack, the D-pad or web tab focus; its children stay reachable.
              focusable={false}
              importantForAccessibility="no"
            >
              <TableFelt
                geometry={geometry}
                phase={feltPhase}
                dealerHand={(shown ?? state).dealer_hand}
                hands={feltBetting ? [] : (shown ?? state).player_hands}
                handBets={(shown ?? state).hand_bets}
                activeHandIndex={(shown ?? state).active_hand_index}
                handOutcomes={(shown ?? state).hand_outcomes}
                handPayouts={(shown ?? state).hand_payouts}
                revealedHands={motion.revealedHands}
                dealerConcealed={motion.dealerConcealed}
                result={feltResult}
                cardIds={motion.ids}
                cardMotion={motion.cards}
                chips={motion.chips}
                chipColor={tableAccentColor}
                animating={motion.animating}
                natural={motion.natural}
                onLayout={onFeltLayout}
              >
                {feltBetting && geometry.betSpot && (
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
                    {/* The felt's foot: the rules toggle and the stats link, never overlapping. */}
                    <View testID="blackjack-felt-footer" style={styles.feltFooter}>
                      <TableRules
                        rules={state.rules ?? DEFAULT_RULES}
                        onRulesChange={handleRulesChange}
                      />
                      <Pressable
                        style={styles.statsLink}
                        onPress={() => navigation.navigate("BlackjackStats")}
                        accessibilityRole="button"
                        accessibilityLabel={t("blackjack:stats.viewStatsLabel")}
                        hitSlop={8}
                      >
                        <Text
                          style={[styles.statsLinkText, { color: colors.textMuted }]}
                          numberOfLines={1}
                        >
                          {t("blackjack:stats.viewStats")}
                        </Text>
                      </Pressable>
                    </View>
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
            </Pressable>
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
              {/* The dealer's turn plays out under greyed actions; the result's dock replaces them
                  only when the result shows on the felt (owner decision, #3720). */}
              {dockPlaying && (
                <ActionButtons
                  disabled={!playing}
                  onHit={handleHit}
                  onStand={handleStand}
                  onDoubleDown={handleDoubleDown}
                  onSplit={handleSplit}
                  doubleDownAvailable={state.double_down_available}
                  splitAvailable={state.split_available}
                />
              )}
              {feltShowsResult && quick && (
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
          // Once the last hand has played out and its stake is swept (#3581).
          visible={state.game_over && motionSettled}
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
    bottom: 0,
    height: FELT_FOOTER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  statsLink: {
    flexShrink: 1,
    paddingVertical: 4,
  },
  statsLinkText: {
    fontSize: 12,
    fontWeight: "500",
    textDecorationLine: "underline",
  },
  dock: {
    paddingHorizontal: 8,
    paddingTop: DOCK_PADDING_TOP,
    paddingBottom: DOCK_PADDING_BOTTOM,
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
