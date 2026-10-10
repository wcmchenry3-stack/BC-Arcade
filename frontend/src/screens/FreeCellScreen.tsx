/**
 * FreeCellScreen — playable FreeCell with full lifecycle wiring.
 *
 * Concerns:
 *   1. Game logic — FreeCellBoard (components/freecell) sends drags and taps to the pure
 *      engine (`applyMove`, `undoMove`, `applyHint`); deals come from the solvable seed bank.
 *   2. Auto-complete — `startAutoComplete` steps the finish with the board input-locked (#2225).
 *   3. Persistence — `usePersistedGameState` (#3087) restores the save on mount (or deals
 *      fresh) and saves after every change once it has loaded.
 *   4. Instrumentation (#2452) — `useGameSync("freecell")`, opened on the first move; a win
 *      records its move count (#2632); a restored game resumes its session (#2654).
 *   5. Result + leaderboard (#2633) — the win is `useCompletionTransition` (#3087): once
 *      per game, a resumed won game records nothing; the shared GameResultModal; best
 *      moves via `bestOf`; ranked via `useGameLeaderboard`.
 *   6. Events and layout — `useGameEvents` plays sounds and the foundation animation; tall
 *      columns compress to fit the screen (#1108).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Sentry from "@sentry/react-native";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";

import type { HomeStackParamList } from "../types/navigation";
import { useTheme } from "../theme/ThemeContext";
import { GameShell } from "../components/shared/GameShell";
import { bestOf } from "../game/_shared/bestOf";
import { useCompletionTransition } from "../game/_shared/useCompletionTransition";
import { useGameLeaderboard } from "../game/_shared/useGameLeaderboard";
import { HudStatRow } from "../components/shared/HudStatRow";
import { PillButton } from "../components/shared/PillButton";
import FreeCellBoard from "../components/freecell/FreeCellBoard";
import { CARD_WIDTH, CARD_HEIGHT } from "../components/freecell/FreeCellSlot";
import { FreeCellFoundationAnimation } from "../components/freecell/FreeCellFoundationAnimation";
import { FreeCellGameWinAnimation } from "../components/freecell/FreeCellGameWinAnimation";
import GameResultModal from "../components/shared/GameResultModal";
import { toSubmission } from "../components/shared/toSubmission";
import {
  dealGame,
  applyMove,
  undoMove,
  applyHint,
  getHintMoves,
  canAutoComplete,
  autoComplete,
} from "../game/freecell/engine";
import type { FreeCellState, Move } from "../game/freecell/types";
import {
  clearGame,
  loadGame,
  saveGame,
  loadStats,
  saveStats,
  type FreeCellStats,
} from "../game/freecell/storage";
import { useGameEvents } from "../game/_shared/useGameEvents";
import { useGameRestored, usePersistedGameState } from "../game/_shared/usePersistedGameState";
import { useGameSync } from "../game/_shared/useGameSync";
import { useSound } from "../game/_shared/useSound";
import { FREECELL_SOUNDS } from "../game/freecell/sounds";
import { CardSizeContext, useResponsiveCardSize } from "../game/_shared/CardSizeContext";

const AUTO_STEP_MS = 120;
const TABLEAU_COLS = 8;
const COL_GAP = 2;
const SCREEN_H_PADDING = 24;
const BANNER_MARGIN_TOP = 8;

export default function FreeCellScreen() {
  const { t } = useTranslation("freecell");
  const { t: tResult } = useTranslation("result");
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();

  const statsRef = useRef<FreeCellStats>({ bestMoves: 0 });
  // The saved game (usePersistedGameState, #3087): loaded with the stats on mount, then
  // saved on every change once that load has landed. Called before the win effect, so a
  // winning move is saved before the win clears it. `stateRef` is the latest state, read
  // by the new-game abandon and the unmount snapshot, neither of which can close over
  // `state`. The restore is below.
  const game = usePersistedGameState<FreeCellState>({
    load: async () => {
      const [saved, savedStats] = await Promise.all([loadGame(), loadStats()]);
      statsRef.current = savedStats;
      return saved;
    },
    save: saveGame,
    clear: clearGame,
  });
  const { state, setState, stateRef, loading, hasLoadedRef, clear: clearSavedGame } = game;

  const isMountedRef = useRef(true);
  const autoCompletingRef = useRef(false);
  const autoStepTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoCompleting, setAutoCompleting] = useState(false);
  /** Best moves after this win, and whether the win beat the old best — for the result card. */
  const [winSummary, setWinSummary] = useState<{ best: number; isNewBest: boolean } | null>(null);
  /**
   * The loaded save was already won — the app was closed between the win and
   * `clearGame()`. Its result was submitted and its celebration played back then.
   */
  const [resumedWin, setResumedWin] = useState(false);
  // The card's rank line, "View leaderboard" link and ⋯ menu item (#2633).
  const { leaderboard, openLeaderboard } = useGameLeaderboard("freecell", navigation);
  const { lookup: lookupRank, reset: resetSubmission } = leaderboard;

  // #2452 — record each game as a per-session `games` row so FreeCell earns Arcade
  // XP, shows in Profile history and can be measured by the daily challenge. Since
  // #2632 that row is also the leaderboard entry: a win sends its move count as
  // `finalScore` (the board ranks fewest moves first, once per player), and an
  // abandon (the hook's own, or New Game) sends no score, so it never ranks.
  const {
    start: syncStart,
    resume: syncResume,
    markStarted: syncMarkStarted,
    complete: syncComplete,
    getGameId: syncGetGameId,
    setProgressSnapshot: syncSetProgressSnapshot,
    resetPlayWindow: syncResetPlayWindow,
  } = useGameSync("freecell");
  /** Move count last seen — a rise is the first move of a session. */
  const seenMovesRef = useRef<number | null>(null);

  // #2450 / #2619 — the abandon result block (backend FreeCellResult). Both the
  // hook's own abandon (unmount) and the New Game abandon build it here.
  const progressResult = useCallback(
    () => ({ won: false, moves: stateRef.current?.moveCount ?? 0 }),
    [stateRef]
  );
  useEffect(() => {
    syncSetProgressSnapshot(() => ({ result: progressResult() }));
  }, [syncSetProgressSnapshot, progressResult]);

  const [showFoundation, setShowFoundation] = useState(false);
  const [showNoMovesBanner, setShowNoMovesBanner] = useState(false);

  const { play: playCardPlace } = useSound("freecell.cardPlace", FREECELL_SOUNDS, 0.4);
  const { play: playSupermove } = useSound("freecell.supermove", FREECELL_SOUNDS, 0.5);
  const { play: playFoundationComplete } = useSound("freecell.foundationComplete", FREECELL_SOUNDS);
  const { play: playGameWin } = useSound("freecell.gameWin", FREECELL_SOUNDS);

  const startAutoComplete = useCallback(
    (fromState: FreeCellState) => {
      if (autoCompletingRef.current) return;
      if (!canAutoComplete(fromState)) return;
      autoCompletingRef.current = true;
      setAutoCompleting(true);

      const release = () => {
        autoCompletingRef.current = false;
        setAutoCompleting(false);
      };

      const step = (current: FreeCellState) => {
        if (!isMountedRef.current) return;
        // The board is input-locked while this runs (#2225), so every way out
        // of a step — including a throw — must release the lock, or the player
        // is left with a board that rejects every tap.
        let scheduled = false;
        try {
          const next = autoComplete(current);
          if (next === current || next.isComplete) {
            setState(next === current ? current : next);
            return;
          }
          setState(next);
          autoStepTimeoutRef.current = setTimeout(() => step(next), AUTO_STEP_MS);
          scheduled = true;
        } catch (e) {
          Sentry.captureException(e, { tags: { subsystem: "autoComplete", game: "freecell" } });
        } finally {
          if (!scheduled) release();
        }
      };

      autoStepTimeoutRef.current = setTimeout(() => step(fromState), AUTO_STEP_MS);
    },
    [setState]
  );

  // Track mount status for async safety
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (autoStepTimeoutRef.current !== null) clearTimeout(autoStepTimeoutRef.current);
    };
  }, []);

  useGameEvents(
    state?.events,
    {
      cardPlace: () => {
        playCardPlace();
        setShowNoMovesBanner(false);
      },
      supermove: () => {
        playSupermove();
        setShowNoMovesBanner(false);
      },
      foundationComplete: () => {
        playFoundationComplete();
        setShowFoundation(true);
        setShowNoMovesBanner(false);
      },
      gameWin: () => {
        playGameWin();
        setShowNoMovesBanner(false);
      },
      noMovesAvailable: () => setShowNoMovesBanner(true),
    },
    // A completed game keeps its events: a new state would be saved again after the
    // win's clear, and the next mount would resume the won board (#3087). The
    // identity check above already keeps them from firing twice.
    () => setState((prev) => (prev === null || prev.isComplete ? prev : { ...prev, events: [] }))
  );

  // Open the session on the first move made here — not on load, so opening a
  // resumed or untouched game records nothing. Watching the move count (rather than
  // hooking handleMove) also covers drag, tap and auto-complete: a resumed game whose
  // remaining cards all go straight to the foundation auto-completes on load, and
  // that finish is recorded — it is the player's own game. Must run before the win
  // effect below: a winning move opens and closes the session in one commit.
  useEffect(() => {
    if (state === null || !hasLoadedRef.current) return;
    const previous = seenMovesRef.current;
    seenMovesRef.current = state.moveCount;
    if (previous !== null && state.moveCount > previous && !syncGetGameId()) {
      syncStart();
      syncMarkStarted();
    }
  }, [state, syncGetGameId, syncStart, syncMarkStarted, hasLoadedRef]);

  // The win (useCompletionTransition, #3087): end the session and clear the save on
  // the step to complete, then record the win once per game. A resumed, already-won
  // game (marked by the restore below) only has its save cleared: its session ended
  // and its win was counted when it happened.
  const finishGame = (s: FreeCellState): string | null => {
    const gameId = syncComplete(
      {
        finalScore: s.moveCount,
        outcome: "completed",
        result: { won: true, moves: s.moveCount },
      },
      {
        final_score: s.moveCount,
        outcome: "completed",
        won: true,
        moves: s.moveCount,
      }
    );
    clearSavedGame();
    return gameId;
  };
  const { markRestoredComplete, reset: resetCompletion } = useCompletionTransition(
    state,
    state?.isComplete ?? false,
    {
      onComplete: (s) => {
        const gameId = finishGame(s);
        const finalMoves = s.moveCount;
        const curr = statsRef.current;
        // Only a win that happened this session has a session to rank.
        if (gameId) void lookupRank(gameId);
        const { best, isNewBest } = bestOf(curr.bestMoves, finalMoves, true);
        setWinSummary({ best, isNewBest });
        const updated: FreeCellStats = { ...curr, bestMoves: best };
        statsRef.current = updated;
        saveStats(updated).catch(() => {});
      },
      onAlreadyComplete: finishGame,
    }
  );

  // Mount: resume the saved game, or deal fresh in its place. After the win hook, whose
  // guard it sets for a resumed won game (a layout-time registration: its place among
  // the effects above changes nothing).
  useGameRestored(game, (saved) => {
    const initial = saved ?? dealGame();
    if (!saved) setState(initial);
    // A restored game continues the session a killed app left open (#2654).
    if (saved && !saved.isComplete) syncResume();
    // Suppress re-counting a win when resuming an already-won game.
    if (saved?.isComplete) {
      // The winning move was saved with its events, and a save the win never got to
      // clear still holds them: drop them in the same batch as the load, so the win's
      // sound and animation don't play again (#3087).
      setState({ ...saved, events: [] });
      markRestoredComplete();
      setResumedWin(true);
      setWinSummary({ best: statsRef.current.bestMoves, isNewBest: false });
    }
    startAutoComplete(initial);
  });

  const handleMove = useCallback(
    (move: Move) => {
      if (state === null || autoCompletingRef.current) return;
      const next = applyMove(state, move);
      if (next === state) return;
      setState(next);
      startAutoComplete(next);
    },
    [state, startAutoComplete, setState]
  );

  const handleUndo = useCallback(() => {
    if (state === null || state.undoStack.length === 0) return;
    setShowNoMovesBanner(false);
    setState(undoMove(state));
  }, [state, setState]);

  const handleHint = useCallback(() => {
    if (state === null || state.isComplete) return;
    if (getHintMoves(state).length === 0) {
      setShowNoMovesBanner(true);
      return;
    }
    setState(applyHint(state));
  }, [state, setState]);

  const handleNewGame = useCallback(() => {
    // Close the current session as abandoned (a no-op after a win or before a move).
    if (syncGetGameId()) {
      const result = progressResult();
      syncComplete({ outcome: "abandoned", result }, { outcome: "abandoned", ...result });
    }
    // The new deal's play time starts now, though its session opens at the
    // first move: the thinking time before that move counts, and time spent on
    // the previous board or its result card does not (#2710).
    syncResetPlayWindow();
    // Stop an in-flight auto-complete. Its next scheduled step would otherwise overwrite
    // the new deal with the old game's state — and, since that state's move count is
    // above zero, the first-move effect would open a second session for the old game.
    if (autoStepTimeoutRef.current !== null) {
      clearTimeout(autoStepTimeoutRef.current);
      autoStepTimeoutRef.current = null;
    }
    autoCompletingRef.current = false;
    setAutoCompleting(false);
    seenMovesRef.current = 0;
    clearSavedGame();
    setState(dealGame());
    resetCompletion();
    setResumedWin(false);
    setWinSummary(null);
    resetSubmission();
  }, [
    syncGetGameId,
    syncComplete,
    syncResetPlayWindow,
    resetSubmission,
    resetCompletion,
    progressResult,
    clearSavedGame,
    setState,
  ]);

  const undoDisabled =
    state === null || state.undoStack.length === 0 || state.isComplete || autoCompleting;
  const hintDisabled = state === null || state.isComplete || autoCompleting;
  // The height the board and the no-moves banner share, so tall tableau
  // columns compress to stay on screen (#1108).
  const [boardAreaHeight, setBoardAreaHeight] = useState<number | undefined>(undefined);
  const [bannerHeight, setBannerHeight] = useState(0);
  const handleBoardAreaLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    setBoardAreaHeight((prev) => (prev === h ? prev : h));
  }, []);
  const handleBannerLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height + BANNER_MARGIN_TOP;
    setBannerHeight((prev) => (prev === h ? prev : h));
  }, []);
  // Last resort (#1108 review): if the board is still taller than its area —
  // a long column at the minimum spacing in a short landscape window
  // (Android rotates; iPad allows landscape) — it scrolls so no card is ever
  // out of reach. Only then: the usual portrait board keeps a plain View, so
  // no ScrollView sits under its drag gestures.
  const [boardContentHeight, setBoardContentHeight] = useState(0);
  const handleBoardContentLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    setBoardContentHeight((prev) => (prev === h ? prev : h));
  }, []);
  const boardOverflows = boardAreaHeight !== undefined && boardContentHeight > boardAreaHeight + 1;
  const boardAvailableHeight =
    boardAreaHeight === undefined
      ? undefined
      : Math.max(0, boardAreaHeight - (showNoMovesBanner ? bannerHeight : 0));

  const wrapBoard = (content: React.ReactElement) =>
    boardOverflows ? (
      <ScrollView
        testID="freecell-board-scroll"
        style={styles.boardScroll}
        bounces={false}
        showsVerticalScrollIndicator
      >
        {content}
      </ScrollView>
    ) : (
      content
    );

  const cardSize = useResponsiveCardSize(
    CARD_WIDTH,
    CARD_HEIGHT,
    TABLEAU_COLS,
    COL_GAP,
    SCREEN_H_PADDING
  );

  return (
    <GameShell
      gameType="freecell"
      title={t("freecell:game.title")}
      requireBack
      loading={loading}
      style={{ paddingBottom: Math.max(insets.bottom, 16) }}
      onNewGame={handleNewGame}
      onOpenLeaderboard={openLeaderboard}
      rightSlot={
        <View style={styles.headerBtnRow}>
          <PillButton
            testID="freecell-hint-button"
            label={t("freecell:action.hint")}
            onPress={handleHint}
            disabled={hintDisabled}
            color={colors.bonus}
          />
          <PillButton
            label={t("freecell:action.undo")}
            onPress={handleUndo}
            disabled={undoDisabled}
          />
        </View>
      }
    >
      {state !== null && (
        <CardSizeContext.Provider value={cardSize}>
          <View style={styles.body}>
            <HudStatRow
              stats={[
                { key: "title", text: t("freecell:game.title"), bold: true },
                {
                  key: "moves",
                  text: t("freecell:score.moves", { moves: state.moveCount }),
                  muted: true,
                },
              ]}
            />

            <View
              testID="freecell-board-area"
              style={styles.boardArea}
              onLayout={handleBoardAreaLayout}
            >
              {wrapBoard(
                <View testID="freecell-board-content" onLayout={handleBoardContentLayout}>
                  <View
                    testID="freecell-board"
                    style={styles.boardWrap}
                    accessibilityLabel={t("freecell:a11y.boardRegion")}
                  >
                    <FreeCellBoard
                      state={state}
                      onMove={handleMove}
                      inputLocked={autoCompleting}
                      availableHeight={boardAvailableHeight}
                    />
                  </View>

                  {showNoMovesBanner && (
                    <View
                      onLayout={handleBannerLayout}
                      style={[
                        styles.noMovesBanner,
                        { backgroundColor: colors.surfaceHigh, borderColor: colors.border },
                      ]}
                      accessibilityRole="alert"
                      accessibilityLiveRegion="assertive"
                    >
                      <Text style={[styles.noMovesText, { color: colors.text }]}>
                        {t("freecell:noMoves.message")}
                      </Text>
                      <PillButton
                        label={t("freecell:action.undo")}
                        onPress={handleUndo}
                        disabled={undoDisabled}
                      />
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>
        </CardSizeContext.Provider>
      )}

      {state !== null ? (
        <GameResultModal
          visible={state.isComplete}
          outcome="win"
          eyebrow={t("game.title")}
          subtitle={tResult("subtitle.completedIn", { count: state.moveCount })}
          hero={{ kind: "score", label: tResult("stat.moves"), value: state.moveCount }}
          isNewBest={winSummary?.isNewBest ?? false}
          stats={
            winSummary && winSummary.best > 0
              ? [{ label: tResult("stat.best"), value: winSummary.best }]
              : []
          }
          submission={toSubmission(leaderboard)}
          onViewLeaderboard={openLeaderboard}
          onPlayAgain={handleNewGame}
          onHome={() => navigation.popToTop()}
          // Only a win that just happened plays the celebration; a resumed,
          // already-won game goes straight to the card.
          celebration={
            resumedWin ? undefined : (done) => <FreeCellGameWinAnimation visible onDismiss={done} />
          }
          testID="freecell-result"
        />
      ) : null}

      <FreeCellFoundationAnimation
        visible={showFoundation}
        onAnimationEnd={() => setShowFoundation(false)}
      />
    </GameShell>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  headerBtnRow: {
    flexDirection: "row",
    gap: 6,
  },
  noMovesBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: BANNER_MARGIN_TOP,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  noMovesText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
  },
  boardArea: {
    flex: 1,
  },
  boardScroll: {
    flex: 1,
  },
  boardWrap: {
    alignSelf: "stretch",
    alignItems: "center",
  },
});
