import React, { useEffect, useState, useCallback, useRef } from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { HomeStackParamList } from "../types/navigation";
import { useTheme } from "../theme/ThemeContext";
import { GameShell } from "../components/shared/GameShell";
import { useLeaderboardLink } from "../hooks/useLeaderboardLink";
import { Twenty48State } from "../game/twenty48/types";
import {
  newGame,
  move as engineMove,
  pauseGame,
  resumeGame,
  Direction,
} from "../game/twenty48/engine";
import {
  saveGame,
  loadGame,
  clearGame,
  saveBestScore,
  loadBestScore,
} from "../game/twenty48/storage";
import Grid from "../components/twenty48/Grid";
import ScoreBoard from "../components/twenty48/ScoreBoard";
import GameResultModal from "../components/shared/GameResultModal";
import StatsBento from "../components/twenty48/StatsBento";
import NewGameConfirmModal from "../components/shared/NewGameConfirmModal";
import { useGameSync } from "../game/_shared/useGameSync";
import { useLeaderboardSubmit } from "../game/_shared/useLeaderboardSubmit";
import { sessionBoardAdapter } from "../game/_shared/sessionBoardAdapter";
import { recordedOutcome } from "../game/_shared/recordedOutcome";
import { useSound } from "../game/_shared/useSound";
import { TWENTY48_SOUNDS } from "../game/twenty48/sounds";

function flattenBoard(board: number[][]): number[] {
  return board.flat();
}

function highestTile(board: number[][]): number {
  return Math.max(0, ...board.flat());
}

function computeDurationMs(s: Twenty48State): number {
  return s.accumulatedMs + (s.startedAt !== null ? Date.now() - s.startedAt : 0);
}

/** The result card's leaderboard line: one global board by score (#2631). */
const twenty48Board = sessionBoardAdapter("twenty48");

const SWIPE_THRESHOLD = 30;
/** How long (ms) to hold the move lock — matches slide animation duration. */
const MOVE_LOCK_MS = 120;

type Props = {
  navigation: NativeStackNavigationProp<HomeStackParamList, "Twenty48">;
};

export default function Twenty48Screen({ navigation }: Props) {
  const { t } = useTranslation(["twenty48", "common", "errors"]);
  const { t: tResult } = useTranslation("result");
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [state, setState] = useState<Twenty48State | null>(null);
  const [loading, setLoading] = useState(true);
  const [winDismissed, setWinDismissed] = useState(false);
  /** The move that made 2048 also ended the game: the card is still the win. */
  const [wonOnLastMove, setWonOnLastMove] = useState(false);
  const [bestScore, setBestScore] = useState(0);
  // Best score before the current game began: bestScore rises live with the
  // score, so "New Best" compares against this instead (#2513).
  const [bestAtGameStart, setBestAtGameStart] = useState(0);
  const [confirmNewGameVisible, setConfirmNewGameVisible] = useState(false);

  /** Blocks new moves while the slide animation plays. */
  const movingRef = useRef(false);
  /** One queued move — fires immediately after the current animation ends. */
  const pendingMove = useRef<Direction | null>(null);
  /** Guards against double-counting a win within a single game session. */
  const winRecordedRef = useRef(false);

  const { play: playTileMerge } = useSound("twenty48.tileMerge", TWENTY48_SOUNDS, 0.3);
  const { play: playTileSpawn } = useSound("twenty48.tileSpawn", TWENTY48_SOUNDS, 0.2);
  const { play: playWin2048 } = useSound("twenty48.win2048", TWENTY48_SOUNDS);
  const { play: playGameOverSound } = useSound("twenty48.gameOver", TWENTY48_SOUNDS);

  // Game event instrumentation (#369 / #549). One session per game from load /
  // reset until the 2048 tile (`win`) or a game over without it (`loss`)
  // (#2631). Keep Playing after the win is untracked: those moves belong to no
  // session, and the board keeps the score at the 2048 moment.
  const {
    start: syncStart,
    resume: syncResume,
    markStarted: syncMarkStarted,
    enqueue: syncEnqueue,
    complete: syncComplete,
    setProgressSnapshot: syncSetProgressSnapshot,
  } = useGameSync("twenty48");
  // The card's leaderboard line (#2631, #2677): looked up once per session, at
  // the win or the game over; never on an abandon.
  const leaderboard = useLeaderboardSubmit(twenty48Board);
  const { submit: submitLeaderboard, reset: resetLeaderboard } = leaderboard;
  // The card's "View leaderboard" link and the ⋯ menu item (#2633).
  const openLeaderboard = useLeaderboardLink(navigation, "twenty48");
  const moveCountRef = useRef(0);
  const stateRef = useRef<Twenty48State | null>(null);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Another screen covering the game (⋯ → Stats, Leaderboard, Scoreboard,
  // #2735) stops its clock, so the reported duration counts only play. Only
  // a clock this pauses is restarted on return: a board with no move yet
  // keeps waiting for its first. `screenFocusedRef` also gates the queued
  // move below: applying it while blurred would run move()'s timer logic
  // on a paused (`startedAt: null`) state, restarting the clock mid-blur.
  const pausedOnBlurRef = useRef(false);
  const screenFocusedRef = useRef(true);
  useEffect(() => {
    const offBlur = navigation.addListener("blur", () => {
      screenFocusedRef.current = false;
      const s = stateRef.current;
      if (!s || s.startedAt === null) return;
      pausedOnBlurRef.current = true;
      setState(pauseGame(s));
    });
    const offFocus = navigation.addListener("focus", () => {
      screenFocusedRef.current = true;
      if (!pausedOnBlurRef.current) return;
      pausedOnBlurRef.current = false;
      setState((s) => (s ? resumeGame(s) : s));
    });
    return () => {
      offBlur?.();
      offFocus?.();
    };
  }, [navigation]);

  // #2450 / #2619 — the board's result block. The hook's own abandon (unmount)
  // and the New Game abandon both build it here. final_score goes in the result
  // (games.metadata) — the daily challenge's score goals read it — but NOT as
  // summary.finalScore on an abandon: that column ranks the game on
  // leaderboards, and an abandon must not (#2468).
  const progressResult = useCallback(
    (s: Twenty48State) => ({
      final_score: s.score,
      highest_tile: highestTile(s.board),
      move_count: moveCountRef.current,
      duration_ms: computeDurationMs(s),
    }),
    []
  );
  useEffect(() => {
    syncSetProgressSnapshot(() => {
      const s = stateRef.current;
      if (!s) return {};
      const result = progressResult(s);
      // Twenty48's own timer, so the abandon's duration is the game's, not the
      // hook's foreground window (#2684).
      return { result, durationMs: result.duration_ms };
    });
  }, [syncSetProgressSnapshot, progressResult]);

  // Close the session as a finished game (#2631): `win` when the 2048 card
  // shows, `loss` on a game over without it. New builds never write
  // `kept_playing`. The card then asks where the game ranks.
  const finishSession = useCallback(
    (s: Twenty48State, card: "win" | "loss") => {
      const outcome = recordedOutcome(card);
      const result = progressResult(s);
      const payload = { ...result, outcome };
      // No open session (a resumed game that already won, or one already
      // finished) means nothing to send.
      const gameId = syncComplete(
        { finalScore: s.score, outcome, durationMs: result.duration_ms, result: payload },
        payload
      );
      if (!gameId) return;
      void submitLeaderboard({ gameId });
    },
    [progressResult, syncComplete, submitLeaderboard]
  );

  // Disable back swipe gesture on this screen.
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: false });
  }, [navigation]);

  // Load the saved game and the best score on mount. The best score is the
  // only local figure kept: the result card's "New best" badge compares with
  // it. The old `twenty48_stats_v1` counters are no longer read or written
  // (#2636); the Stats screen reads the server.
  useEffect(() => {
    let active = true;
    Promise.all([loadGame(), loadBestScore()]).then(([saved, best]) => {
      if (!active) return;
      let next = saved ?? newGame();
      // Resume timer when reloading a mid-game state.
      if (!next.game_over && next.startedAt !== null) {
        next = { ...next, startedAt: Date.now() };
      }
      setState(next);
      if (!saved) saveGame(next);
      setBestScore(best);
      setBestAtGameStart(best);
      setLoading(false);
      if (!next.game_over && next.has_won) {
        // A saved game past 2048 was finished at the win (#2631): the rest of
        // it is untracked, so it opens no session. A build from before #2631
        // left its session open while the win card was up, though; if the app
        // was killed then, record that session now as the win it was.
        moveCountRef.current = 0;
        if (saved && syncResume()) finishSession(next, "win");
      } else if (!next.game_over) {
        moveCountRef.current = 0;
        // A saved mid-game continues the session a killed app left open (#2654).
        if (!(saved && syncResume())) {
          syncStart({ initial_board: flattenBoard(next.board) });
          // Resuming a saved mid-game means the player already started — mark it.
          if (saved) syncMarkStarted();
        }
      }
      // Suppress re-counting a win when resuming an already-won game.
      if (next.has_won) winRecordedRef.current = true;
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Unmount cleanup is handled by useGameSync (abandons any open session).

  // Update and persist best score whenever score improves.
  useEffect(() => {
    if (!state) return;
    if (state.score > bestScore) {
      setBestScore(state.score);
      saveBestScore(state.score);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.score]); // intentional: only re-run when score changes, not on every state update

  // Fire tile sounds from isMerge/isNew flags on the render layer.
  useEffect(() => {
    if (!state) return;
    const hasMerge = state.tiles.some((t) => t.isMerge);
    const hasSpawn = state.tiles.some((t) => t.isNew && !t.isMerge);
    if (hasMerge) playTileMerge();
    if (hasSpawn) playTileSpawn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.tiles]);

  // Fire one-shot event sounds from engine events.
  useEffect(() => {
    if (!state?.events) return;
    if (state.events.includes("win2048")) playWin2048();
    if (state.events.includes("gameOver")) playGameOverSound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.events]);

  const executeMove = useCallback(
    (direction: Direction, currentState: Twenty48State) => {
      movingRef.current = true;
      let next: Twenty48State;
      try {
        next = engineMove(currentState, direction);
      } catch {
        // "no effect" or game over — release lock immediately.
        movingRef.current = false;
        pendingMove.current = null;
        return;
      }
      setState(next);
      saveGame({ ...next, events: undefined });
      moveCountRef.current += 1;
      syncMarkStarted();
      // The first win per session finishes it.
      const justWon = next.has_won && !winRecordedRef.current;
      if (justWon) winRecordedRef.current = true;
      syncEnqueue({
        type: "move",
        data: {
          direction,
          score_delta: next.scoreDelta,
          score_after: next.score,
          highest_tile_after: highestTile(next.board),
          is_game_over: next.game_over,
          has_won: next.has_won,
        },
      });
      // Reaching 2048 is the win, even on the move that ends the game; a game
      // over after it (Keep Playing) has no session left to finish.
      if (justWon) finishSession(next, "win");
      else if (next.game_over && !next.has_won) finishSession(next, "loss");
      // The card shows the win even when this move also left no moves.
      if (justWon && next.game_over) setWonOnLastMove(true);
      // Hold the lock for the slide animation duration, then fire any queued move.
      setTimeout(() => {
        movingRef.current = false;
        // A move queued during the winning move would play behind the win
        // card (handleMove's guard only sees moves made after it shows): drop
        // it. One queued during a blur is dropped too (#2735): another screen
        // is covering the board by the time this fires, and applying it would
        // restart the paused clock mid-blur.
        const queued = justWon || !screenFocusedRef.current ? null : pendingMove.current;
        pendingMove.current = null;
        if (queued) {
          setState((s) => {
            if (s) executeMove(queued, s);
            return s;
          });
        }
      }, MOVE_LOCK_MS);
    },
    [finishSession, syncEnqueue, syncMarkStarted]
  );

  const handleMove = useCallback(
    (direction: Direction) => {
      if (!state || state.game_over) return;
      // The win card is up: no moves behind it until Keep Playing / Play Again
      // (on web the keyboard would otherwise keep playing under the card).
      if (state.has_won && !winDismissed) return;
      if (movingRef.current) {
        pendingMove.current = direction;
        return;
      }
      executeMove(direction, state);
    },
    [state, winDismissed, executeMove]
  );

  const resetGame = useCallback(() => {
    movingRef.current = false;
    pendingMove.current = null;
    winRecordedRef.current = false;
    setWinDismissed(false);
    setWonOnLastMove(false);
    setBestAtGameStart((prevBest) => Math.max(prevBest, stateRef.current?.score ?? 0));
    resetLeaderboard();
    const next = newGame();
    // syncStart closes the open session first, if any: abandoned with the
    // progress snapshot when the player moved, discarded when they never did.
    // A game over or the 2048 win already finished it (#2631). It runs before
    // moveCountRef resets, so the snapshot still counts the old game's moves
    // (stateRef still holds the old board until the next render).
    syncStart({ initial_board: flattenBoard(next.board) });
    setState(next);
    saveGame(next);
    moveCountRef.current = 0;
  }, [syncStart, resetLeaderboard]);

  const handleNewGamePress = useCallback(() => {
    // Only a game still in progress is lost: after the 2048 win its session
    // is already recorded, and after a game over there is nothing to lose.
    if (state && state.score > 0 && !state.game_over && !state.has_won) {
      setConfirmNewGameVisible(true);
    } else {
      resetGame();
    }
  }, [state, resetGame]);

  const handleConfirmNewGame = useCallback(() => {
    setConfirmNewGameVisible(false);
    resetGame();
  }, [resetGame]);

  // When game ends, remove the saved state so a fresh game starts next launch.
  useEffect(() => {
    if (state?.game_over) clearGame();
  }, [state?.game_over]);

  // Web keyboard controls — arrow keys + WASD.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const keyMap: Record<string, Direction> = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      w: "up",
      W: "up",
      s: "down",
      S: "down",
      a: "left",
      A: "left",
      d: "right",
      D: "right",
    };
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
          return;
        }
      }
      const direction = keyMap[e.key];
      if (!direction) return;
      e.preventDefault();
      handleMove(direction);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleMove]);

  // Blur filter for ambient glow blobs — web only (native uses opacity alone).
  const glowBlur = Platform.OS === "web" ? ({ filter: "blur(80px)" } as object) : undefined;

  const swipeGesture = Gesture.Pan()
    .minDistance(SWIPE_THRESHOLD)
    .onEnd((e) => {
      const { translationX, translationY } = e;
      const absX = Math.abs(translationX);
      const absY = Math.abs(translationY);
      if (absX < SWIPE_THRESHOLD && absY < SWIPE_THRESHOLD) return;
      let direction: Direction;
      if (absX > absY) {
        direction = translationX > 0 ? "right" : "left";
      } else {
        direction = translationY > 0 ? "down" : "up";
      }
      handleMove(direction);
    })
    .runOnJS(true);

  // The session already finished at the win: Keep Playing only hides the
  // card, and the rest of the game is untracked (#2631).
  const handleKeepPlaying = useCallback(() => setWinDismissed(true), []);

  // The win card, until Keep Playing. When the 2048 move also left no moves,
  // it is still the win card, just without Keep Playing (#2631).
  const showWinOverlay = !!state?.has_won && !winDismissed && (!state.game_over || wonOnLastMove);
  const showGameOverOverlay = !!state?.game_over && !showWinOverlay;
  const canKeepPlaying = showWinOverlay && !state?.game_over;

  return (
    <GameShell
      gameType="twenty48"
      title={t("game.title")}
      requireBack
      onBack={() => navigation.popToTop()}
      onNewGame={resetGame}
      onOpenLeaderboard={openLeaderboard}
      loading={!state && loading}
      style={{
        paddingBottom: Math.max(insets.bottom, 16),
        paddingLeft: Math.max(insets.left, 16),
        paddingRight: Math.max(insets.right, 16),
        alignItems: "center",
      }}
    >
      {/* Score + New Game */}
      <View style={styles.scoreRow}>
        {state && (
          <View style={styles.scoreBoardWrap}>
            <ScoreBoard score={state.score} bestScore={bestScore} scoreDelta={state.scoreDelta} />
          </View>
        )}
        <Pressable
          style={[styles.newGameBtn, { backgroundColor: colors.accent }]}
          onPress={handleNewGamePress}
          accessibilityRole="button"
          accessibilityLabel={t("twenty48:actions.newGameLabel")}
        >
          <Text style={[styles.newGameBtnText, { color: colors.textOnAccent }]} numberOfLines={1}>
            {t("twenty48:actions.newGame")}
          </Text>
        </Pressable>
      </View>

      {/* Swipe hint */}
      <Text style={[styles.hint, { color: colors.textMuted }]}>{t("twenty48:swipe.hint")}</Text>
      {Platform.OS === "web" && (
        <Text style={[styles.hint, { color: colors.textMuted }]}>
          {t("twenty48:controls.keyboardHint")}
        </Text>
      )}

      {/* Board */}
      <GestureDetector gesture={swipeGesture}>
        <View testID="twenty48-board" style={styles.boardContainer}>
          {/* Ambient glow blobs — decorative, placed behind the grid */}
          <View
            style={[styles.glowTopLeft, { backgroundColor: colors.accent }, glowBlur]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
          />
          <View
            style={[styles.glowBottomRight, { backgroundColor: colors.secondary }, glowBlur]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
          />
          {state && <Grid tiles={state.tiles} />}
        </View>
      </GestureDetector>

      {/* Stats bento — Highest Tile + Time Played */}
      {state && <StatsBento state={state} />}

      {/* End-of-game result card (#2513): the 2048 win (Keep Playing) or no moves. */}
      <GameResultModal
        // Remount on a win → game-over switch so the new outcome is announced.
        key={showGameOverOverlay ? "game-over" : "win"}
        visible={showWinOverlay || showGameOverOverlay}
        outcome={showGameOverOverlay ? "ended" : "win"}
        eyebrow={t("twenty48:game.title")}
        subtitle={canKeepPlaying ? t("twenty48:win.body") : tResult("subtitle.noMoves")}
        hero={{ kind: "score", label: tResult("stat.score"), value: state?.score ?? 0 }}
        isNewBest={
          !!state?.game_over && bestAtGameStart > 0 && (state?.score ?? 0) > bestAtGameStart
        }
        stats={
          state
            ? [
                { label: t("twenty48:score.best"), value: Math.max(bestScore, state.score) },
                { label: t("twenty48:stats.highestTile"), value: highestTile(state.board) },
              ]
            : []
        }
        primaryAction={
          canKeepPlaying
            ? {
                label: t("twenty48:actions.keepPlaying"),
                accessibilityLabel: t("twenty48:actions.keepPlayingLabel"),
                onPress: handleKeepPlaying,
              }
            : undefined
        }
        onPlayAgain={resetGame}
        secondaryAction={
          canKeepPlaying ? { label: tResult("action.playAgain"), onPress: resetGame } : undefined
        }
        // The session's leaderboard line. A game over after Keep Playing is
        // untracked, so its card has none.
        submission={
          winDismissed
            ? undefined
            : {
                status: leaderboard.status,
                rank: leaderboard.rank,
                isBest: leaderboard.isBest,
                playerName: leaderboard.playerName,
                onProvideName: leaderboard.provideName,
                onRetry: leaderboard.retry,
              }
        }
        onViewLeaderboard={openLeaderboard}
        onHome={() => navigation.popToTop()}
        testID="twenty48-result"
      />

      <NewGameConfirmModal
        visible={confirmNewGameVisible}
        onConfirm={handleConfirmNewGame}
        onCancel={() => setConfirmNewGameVisible(false)}
      />
    </GameShell>
  );
}

const styles = StyleSheet.create({
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
    width: "100%",
    maxWidth: 360,
  },
  scoreBoardWrap: {
    flex: 1,
    minWidth: 0,
  },
  newGameBtn: {
    flexShrink: 0,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    minHeight: 44,
    justifyContent: "center",
  },
  newGameBtnText: {
    fontSize: 14,
    fontWeight: "700",
  },
  hint: {
    fontSize: 12,
    marginBottom: 12,
  },
  boardContainer: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  glowTopLeft: {
    position: "absolute",
    width: 192,
    height: 192,
    top: -24,
    left: -24,
    borderRadius: 96,
    opacity: 0.1,
  },
  glowBottomRight: {
    position: "absolute",
    width: 192,
    height: 192,
    bottom: -24,
    right: -24,
    borderRadius: 96,
    opacity: 0.1,
  },
  error: {
    fontSize: 13,
    textAlign: "center",
    marginTop: 12,
  },
});
