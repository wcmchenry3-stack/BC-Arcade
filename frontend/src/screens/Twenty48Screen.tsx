import React, { useEffect, useState, useCallback, useRef } from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { HomeStackParamList } from "../types/navigation";
import { useTheme } from "../theme/ThemeContext";
import { GameShell } from "../components/shared/GameShell";
import { Twenty48State } from "../game/twenty48/types";
import { newGame, move as engineMove, Direction } from "../game/twenty48/engine";
import {
  saveGame,
  loadGame,
  clearGame,
  saveBestScore,
  loadBestScore,
  loadStats,
  saveStats,
  type Twenty48Stats,
} from "../game/twenty48/storage";
import Grid from "../components/twenty48/Grid";
import ScoreBoard from "../components/twenty48/ScoreBoard";
import GameOverlay from "../components/twenty48/GameOverlay";
import StatsBento from "../components/twenty48/StatsBento";
import NewGameConfirmModal from "../components/shared/NewGameConfirmModal";
import { AnimationOverlay } from "../components/shared/AnimationOverlay";
import { useGameSync } from "../game/_shared/useGameSync";
import { useTwenty48Scoreboard } from "../game/twenty48/Twenty48ScoreboardContext";
import { useSound } from "../game/_shared/useSound";

function flattenBoard(board: number[][]): number[] {
  return board.flat();
}

function highestTile(board: number[][]): number {
  return Math.max(0, ...board.flat());
}

function computeDurationMs(s: Twenty48State): number {
  return s.accumulatedMs + (s.startedAt !== null ? Date.now() - s.startedAt : 0);
}

const SWIPE_THRESHOLD = 30;
/** How long (ms) to hold the move lock — matches slide animation duration. */
const MOVE_LOCK_MS = 120;

type Props = {
  navigation: NativeStackNavigationProp<HomeStackParamList, "Twenty48">;
};

export default function Twenty48Screen({ navigation }: Props) {
  const { t } = useTranslation(["twenty48", "common", "errors"]);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [state, setState] = useState<Twenty48State | null>(null);
  const [loading, setLoading] = useState(true);
  const [winDismissed, setWinDismissed] = useState(false);
  const [bestScore, setBestScore] = useState(0);
  const [stats, setStats] = useState<Twenty48Stats>({ bestTile: 0, gamesPlayed: 0, gamesWon: 0 });
  const [confirmNewGameVisible, setConfirmNewGameVisible] = useState(false);

  /** Blocks new moves while the slide animation plays. */
  const movingRef = useRef(false);
  /** One queued move — fires immediately after the current animation ends. */
  const pendingMove = useRef<Direction | null>(null);
  /** Guards against double-counting a win within a single game session. */
  const winRecordedRef = useRef(false);

  const { play: playTileMerge } = useSound("twenty48.tileMerge", 0.3);
  const { play: playTileSpawn } = useSound("twenty48.tileSpawn", 0.2);
  const { play: playWin2048 } = useSound("twenty48.win2048");
  const { play: playGameOverSound } = useSound("twenty48.gameOver");

  // Game event instrumentation (#369 / #549). One session per game from load /
  // reset until game_over OR keep-playing. After a keep-playing end, further
  // moves are still playable but aren't tracked — they belong to no session.
  const {
    start: syncStart,
    markStarted: syncMarkStarted,
    enqueue: syncEnqueue,
    complete: syncComplete,
  } = useGameSync("twenty48");
  const moveCountRef = useRef(0);
  const stateRef = useRef<Twenty48State | null>(null);
  const { setSnapshot: setScoreboardSnapshot } = useTwenty48Scoreboard();
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const endedPayload = useCallback(
    (s: Twenty48State, outcome: "completed" | "abandoned" | "kept_playing") => ({
      final_score: s.score,
      highest_tile: highestTile(s.board),
      move_count: moveCountRef.current,
      duration_ms: computeDurationMs(s),
      outcome,
    }),
    []
  );

  // Disable back swipe gesture on this screen.
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: false });
  }, [navigation]);

  // Load saved game, best score, and stats on mount.
  useEffect(() => {
    let active = true;
    Promise.all([loadGame(), loadBestScore(), loadStats()]).then(([saved, best, savedStats]) => {
      if (!active) return;
      let next = saved ?? newGame();
      // Resume timer when reloading a mid-game state.
      if (!next.game_over && next.startedAt !== null) {
        next = { ...next, startedAt: Date.now() };
      }
      setState(next);
      if (!saved) saveGame(next);
      setBestScore(best);
      setLoading(false);
      if (!next.game_over) {
        moveCountRef.current = 0;
        syncStart({ initial_board: flattenBoard(next.board) });
        // Resuming a saved mid-game means the player already started — mark it.
        if (saved) syncMarkStarted();
      }
      // Count a fresh start; also catch any best-tile improvement from the
      // loaded board (e.g. user had a 1024 before stats were tracked).
      const currentBestTile = highestTile(next.board);
      const initialStats: Twenty48Stats = {
        bestTile: Math.max(savedStats.bestTile, currentBestTile),
        gamesPlayed: saved ? savedStats.gamesPlayed : savedStats.gamesPlayed + 1,
        gamesWon: savedStats.gamesWon,
      };
      if (
        initialStats.bestTile !== savedStats.bestTile ||
        initialStats.gamesPlayed !== savedStats.gamesPlayed
      ) {
        saveStats(initialStats);
      }
      setStats(initialStats);
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

  useEffect(() => {
    if (!state) return;
    setScoreboardSnapshot({
      score: state.score,
      bestTile: highestTile(state.board),
      moveCount: moveCountRef.current,
      bestScore,
      hasGame: true,
      allTimeBestTile: stats.bestTile,
      gamesPlayed: stats.gamesPlayed,
      gamesWon: stats.gamesWon,
    });
  }, [state, bestScore, stats, setScoreboardSnapshot]);

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
      // Track all-time best tile and first win per session.
      const tile = highestTile(next.board);
      const justWon = next.has_won && !winRecordedRef.current;
      if (justWon) winRecordedRef.current = true;
      if (tile > 0 || justWon) {
        setStats((prev) => {
          let updated = prev;
          if (tile > prev.bestTile) updated = { ...updated, bestTile: tile };
          if (justWon) updated = { ...updated, gamesWon: updated.gamesWon + 1 };
          if (updated !== prev) saveStats(updated);
          return updated;
        });
      }
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
      if (next.game_over) {
        syncComplete(
          { finalScore: next.score, outcome: "completed", durationMs: computeDurationMs(next) },
          endedPayload(next, "completed")
        );
      }
      // Hold the lock for the slide animation duration, then fire any queued move.
      setTimeout(() => {
        movingRef.current = false;
        const queued = pendingMove.current;
        pendingMove.current = null;
        if (queued) {
          setState((s) => {
            if (s) executeMove(queued, s);
            return s;
          });
        }
      }, MOVE_LOCK_MS);
    },
    [endedPayload, syncComplete, syncEnqueue, syncMarkStarted]
  );

  const handleMove = useCallback(
    (direction: Direction) => {
      if (!state || state.game_over) return;
      if (movingRef.current) {
        pendingMove.current = direction;
        return;
      }
      executeMove(direction, state);
    },
    [state, executeMove]
  );

  const resetGame = useCallback(() => {
    movingRef.current = false;
    pendingMove.current = null;
    winRecordedRef.current = false;
    setWinDismissed(false);
    // Close out the previous session with proper payload (if still open).
    const prev = stateRef.current;
    if (prev) {
      const outcome = prev.game_over ? "completed" : "abandoned";
      syncComplete(
        { finalScore: prev.score, outcome, durationMs: computeDurationMs(prev) },
        endedPayload(prev, outcome)
      );
    }
    const next = newGame();
    setState(next);
    saveGame(next);
    moveCountRef.current = 0;
    syncStart({ initial_board: flattenBoard(next.board) });
    setStats((prev) => {
      const updated = { ...prev, gamesPlayed: prev.gamesPlayed + 1 };
      saveStats(updated);
      return updated;
    });
  }, [endedPayload, syncComplete, syncStart]);

  const handleNewGamePress = useCallback(() => {
    if (state && state.score > 0 && !state.game_over) {
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

  const showWinOverlay = state?.has_won && !winDismissed && !state.game_over;
  const showGameOverOverlay = state?.game_over;

  return (
    <GameShell
      title={t("game.title")}
      requireBack
      onBack={() => navigation.popToTop()}
      onNewGame={resetGame}
      onOpenScoreboard={() => navigation.navigate("Scoreboard", { gameKey: "twenty48" })}
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
        <View style={styles.boardContainer}>
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

      {/* Overlays */}
      <AnimationOverlay visible={!!showWinOverlay} onDismiss={() => setWinDismissed(true)}>
        {showWinOverlay && (
          <GameOverlay
            type="win"
            score={state!.score}
            onNewGame={resetGame}
            onKeepPlaying={() => {
              setWinDismissed(true);
              const s = stateRef.current;
              if (s) {
                syncComplete(
                  {
                    finalScore: s.score,
                    outcome: "kept_playing",
                    durationMs: computeDurationMs(s),
                  },
                  endedPayload(s, "kept_playing")
                );
              }
            }}
            onHome={() => navigation.goBack()}
          />
        )}
      </AnimationOverlay>
      <AnimationOverlay visible={!!showGameOverOverlay} onDismiss={() => {}}>
        {showGameOverOverlay && (
          <GameOverlay
            type="game_over"
            score={state!.score}
            onNewGame={resetGame}
            onHome={() => navigation.goBack()}
          />
        )}
      </AnimationOverlay>

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
