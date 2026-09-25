import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";

import type { HomeStackParamList } from "../types/navigation";
import { useTheme } from "../theme/ThemeContext";
import { GameShell } from "../components/shared/GameShell";
import { HudStatRow } from "../components/shared/HudStatRow";
import { PillButton } from "../components/shared/PillButton";
import FreeCellBoard from "../components/freecell/FreeCellBoard";
import { CARD_WIDTH, CARD_HEIGHT } from "../components/freecell/FreeCellSlot";
import { FreeCellFoundationAnimation } from "../components/freecell/FreeCellFoundationAnimation";
import { FreeCellGameWinAnimation } from "../components/freecell/FreeCellGameWinAnimation";
import GameResultModal from "../components/shared/GameResultModal";
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
import { freecellLeaderboard } from "../game/freecell/leaderboard";
import { useLeaderboardSubmit } from "../game/_shared/useLeaderboardSubmit";
import { useGameEvents } from "../game/_shared/useGameEvents";
import { useGameSync } from "../game/_shared/useGameSync";
import { useSound } from "../game/_shared/useSound";
import { FREECELL_SOUNDS } from "../game/freecell/sounds";
import { CardSizeContext, useResponsiveCardSize } from "../game/_shared/CardSizeContext";

const AUTO_STEP_MS = 120;
const TABLEAU_COLS = 8;
const COL_GAP = 2;
const SCREEN_H_PADDING = 24;

export default function FreeCellScreen() {
  const { t } = useTranslation("freecell");
  const { t: tResult } = useTranslation("result");
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();

  const [state, setState] = useState<FreeCellState | null>(null);
  // Always the latest state — read by the new-game abandon and the unmount snapshot,
  // neither of which can close over `state`.
  const stateRef = useRef<FreeCellState | null>(null);
  stateRef.current = state;
  const [loading, setLoading] = useState(true);
  const statsRef = useRef<FreeCellStats>({ bestMoves: 0, gamesPlayed: 0, gamesWon: 0 });

  const hasLoadedRef = useRef(false);
  const isMountedRef = useRef(true);
  const autoCompletingRef = useRef(false);
  const autoStepTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoCompleting, setAutoCompleting] = useState(false);
  /** Guards against double-counting a win within a single game session. */
  const winRecordedRef = useRef(false);
  const prevCompleteRef = useRef(false);
  /** Best moves after this win, and whether the win beat the old best — for the result card. */
  const [winSummary, setWinSummary] = useState<{ best: number; isNewBest: boolean } | null>(null);
  /**
   * The loaded save was already won — the app was closed between the win and
   * `clearGame()`. Its result was submitted and its celebration played back then.
   */
  const [resumedWin, setResumedWin] = useState(false);
  const leaderboard = useLeaderboardSubmit(freecellLeaderboard);
  const { submit: submitScore, reset: resetSubmission } = leaderboard;

  // #2452 — record each game as a per-session `games` row so FreeCell earns Arcade
  // XP, shows in Profile history and can be measured by the daily challenge. This
  // is separate from the leaderboard submit (`freecellLeaderboard`, #2508),
  // which posts the move count under the player's display name. No score is sent, on a win or an abandon: the leaderboard
  // ranks every row with a non-null `final_score` (fewer moves first), so a scored
  // session row would duplicate each win as "anon" and rank abandoned games.
  const {
    start: syncStart,
    markStarted: syncMarkStarted,
    complete: syncComplete,
    getGameId: syncGetGameId,
    setProgressSnapshot: syncSetProgressSnapshot,
  } = useGameSync("freecell");
  /** Move count last seen — a rise is the first move of a session. */
  const seenMovesRef = useRef<number | null>(null);

  useEffect(() => {
    syncSetProgressSnapshot(() => ({
      result: { won: false, moves: stateRef.current?.moveCount ?? 0 },
    }));
  }, [syncSetProgressSnapshot]);

  const [showFoundation, setShowFoundation] = useState(false);
  const [showNoMovesBanner, setShowNoMovesBanner] = useState(false);

  const { play: playCardPlace } = useSound("freecell.cardPlace", FREECELL_SOUNDS, 0.4);
  const { play: playSupermove } = useSound("freecell.supermove", FREECELL_SOUNDS, 0.5);
  const { play: playFoundationComplete } = useSound("freecell.foundationComplete", FREECELL_SOUNDS);
  const { play: playGameWin } = useSound("freecell.gameWin", FREECELL_SOUNDS);

  const startAutoComplete = useCallback((fromState: FreeCellState) => {
    if (autoCompletingRef.current) return;
    if (!canAutoComplete(fromState)) return;
    autoCompletingRef.current = true;
    setAutoCompleting(true);

    const step = (current: FreeCellState) => {
      if (!isMountedRef.current) return;
      const next = autoComplete(current);
      if (next === current || next.isComplete) {
        setState(next === current ? current : next);
        autoCompletingRef.current = false;
        setAutoCompleting(false);
        return;
      }
      setState(next);
      autoStepTimeoutRef.current = setTimeout(() => step(next), AUTO_STEP_MS);
    };

    autoStepTimeoutRef.current = setTimeout(() => step(fromState), AUTO_STEP_MS);
  }, []);

  // Track mount status for async safety
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (autoStepTimeoutRef.current !== null) clearTimeout(autoStepTimeoutRef.current);
    };
  }, []);

  // Mount: resume saved game or deal fresh, load stats
  useEffect(() => {
    let alive = true;
    Promise.all([loadGame(), loadStats()]).then(([saved, savedStats]) => {
      if (!alive) return;
      hasLoadedRef.current = true;
      const initial = saved ?? dealGame();
      setState(initial);
      // Suppress re-counting a win when resuming an already-won game.
      if (saved?.isComplete) {
        winRecordedRef.current = true;
        setResumedWin(true);
        setWinSummary({ best: savedStats.bestMoves, isNewBest: false });
      }
      if (!saved) {
        // First deal (not a resume) — count as a game started.
        const withPlay = { ...savedStats, gamesPlayed: savedStats.gamesPlayed + 1 };
        statsRef.current = withPlay;
        saveStats(withPlay).catch(() => {});
      } else {
        statsRef.current = savedStats;
      }
      setLoading(false);
      startAutoComplete(initial);
    });
    return () => {
      alive = false;
    };
  }, [startAutoComplete]);

  // Persist on every state change once the mount load has resolved
  useEffect(() => {
    if (!hasLoadedRef.current || state === null) return;
    saveGame(state).catch(() => {});
  }, [state]);

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
    () => setState((prev) => (prev === null ? null : { ...prev, events: [] }))
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
  }, [state, syncGetGameId, syncStart, syncMarkStarted]);

  // Handle win: update stats and clear saved game
  useEffect(() => {
    if (state === null) {
      prevCompleteRef.current = false;
      return;
    }
    if (state.isComplete && !prevCompleteRef.current) {
      syncComplete(
        { outcome: "completed" },
        { outcome: "completed", won: true, moves: state.moveCount }
      );
      clearGame().catch(() => {});
      if (!winRecordedRef.current) {
        winRecordedRef.current = true;
        const finalMoves = state.moveCount;
        const curr = statsRef.current;
        // Submit only a win that happened this session, so a resumed won
        // game can't post the same result twice.
        submitScore({ moves: finalMoves });
        const isNewBest = curr.bestMoves === 0 || finalMoves < curr.bestMoves;
        setWinSummary({ best: isNewBest ? finalMoves : curr.bestMoves, isNewBest });
        const updated: FreeCellStats = {
          ...curr,
          gamesWon: curr.gamesWon + 1,
          bestMoves:
            curr.bestMoves === 0 || finalMoves < curr.bestMoves ? finalMoves : curr.bestMoves,
        };
        statsRef.current = updated;
        saveStats(updated).catch(() => {});
      }
    }
    prevCompleteRef.current = state.isComplete;
  }, [state, syncComplete, submitScore]);

  const handleMove = useCallback(
    (move: Move) => {
      if (state === null || autoCompletingRef.current) return;
      const next = applyMove(state, move);
      if (next === state) return;
      setState(next);
      startAutoComplete(next);
    },
    [state, startAutoComplete]
  );

  const handleUndo = useCallback(() => {
    if (state === null || state.undoStack.length === 0) return;
    setShowNoMovesBanner(false);
    setState(undoMove(state));
  }, [state]);

  const handleHint = useCallback(() => {
    if (state === null || state.isComplete) return;
    if (getHintMoves(state).length === 0) {
      setShowNoMovesBanner(true);
      return;
    }
    setState(applyHint(state));
  }, [state]);

  const handleNewGame = useCallback(() => {
    // Close the current session as abandoned (a no-op after a win or before a move).
    if (syncGetGameId()) {
      syncComplete(
        { outcome: "abandoned" },
        { outcome: "abandoned", won: false, moves: stateRef.current?.moveCount ?? 0 }
      );
    }
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
    clearGame().catch(() => {});
    setState(dealGame());
    const updated = { ...statsRef.current, gamesPlayed: statsRef.current.gamesPlayed + 1 };
    statsRef.current = updated;
    saveStats(updated).catch(() => {});
    winRecordedRef.current = false;
    setResumedWin(false);
    setWinSummary(null);
    resetSubmission();
  }, [syncGetGameId, syncComplete, resetSubmission]);

  const undoDisabled =
    state === null || state.undoStack.length === 0 || state.isComplete || autoCompleting;
  const hintDisabled = state === null || state.isComplete || autoCompleting;
  const cardSize = useResponsiveCardSize(
    CARD_WIDTH,
    CARD_HEIGHT,
    TABLEAU_COLS,
    COL_GAP,
    SCREEN_H_PADDING
  );

  return (
    <GameShell
      title={t("freecell:game.title")}
      requireBack
      loading={loading}
      onBack={() => navigation.popToTop()}
      style={{
        paddingBottom: Math.max(insets.bottom, 16),
        paddingLeft: Math.max(insets.left, 12),
        paddingRight: Math.max(insets.right, 12),
      }}
      onNewGame={handleNewGame}
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
              testID="freecell-board"
              style={styles.boardWrap}
              accessibilityLabel={t("freecell:a11y.boardRegion")}
            >
              <FreeCellBoard state={state} onMove={handleMove} />
            </View>

            {showNoMovesBanner && (
              <View
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
          submission={{
            status: leaderboard.status,
            rank: leaderboard.rank,
            playerName: leaderboard.playerName,
            onProvideName: leaderboard.provideName,
            onRetry: leaderboard.retry,
          }}
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
    marginTop: 8,
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
  boardWrap: {
    alignSelf: "stretch",
    alignItems: "center",
  },
});
