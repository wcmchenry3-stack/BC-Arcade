/**
 * MahjongScreen — Mahjong Solitaire with full lifecycle wiring (#874).
 *
 * Concerns:
 *   1. Game logic — dispatches engine functions (selectTile, shuffleBoard,
 *      undoMove) in response to GameCanvas callbacks; engine is pure and
 *      replaces state wholesale on every transition.
 *   2. Persistence — AsyncStorage save/resume, debounced (useMahjongPersistence).
 *   3. Instrumentation — useGameSync session started on first tile tap (the
 *      layout played is its metadata), completed as a `win` on a cleared
 *      board (`useCompletionTransition`, #3087), a `loss` when the player
 *      leaves a deadlock, abandoned otherwise (#2627).
 *   4. Result (#2510) — the shared GameResultModal on a win (the finished
 *      game is the leaderboard entry; the card shows its rank through
 *      `lookupGameRank`, #2677) and on a deadlock (a loss, no rank).
 *   5. Audio + animations (#914) — SFX on every game event, lo-fi bg music,
 *      flying pairs, deadlock shake and shuffle pulse: useMahjongFeedback
 *      (#2981), driven by the engine's events (#3087).
 *   6. Board zoom/pan — pinch and drag on the board, zoomed back to fit when
 *      no moves remain: useBoardZoomPan owns the shared values and gestures
 *      (#2981).
 *   7. Hints — the hinted pair glows for 2 s; "no hint" is a transient toast
 *      (useTransientToast, #2981).
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";

import type { HomeStackParamList } from "../types/navigation";
import { loadTileAssets } from "../components/mahjong/tileAssetLoader";
import { useTheme } from "../theme/ThemeContext";
import {
  DEV_ACCENT,
  MAHJONG_HINT_COLOR,
  MAHJONG_NO_MOVES_OVERLAY_BG,
  MAHJONG_OVERLAY_BTN_BG,
} from "../theme/theme.constants";
import { typography } from "../theme/typography";
import { GameShell } from "../components/shared/GameShell";
import { useGameLeaderboard } from "../game/_shared/useGameLeaderboard";
import { usePausableClock } from "../hooks/usePausableClock";
import { PillButton } from "../components/shared/PillButton";
import { PlayClockText } from "../components/shared/PlayClockText";
import GameResultModal from "../components/shared/GameResultModal";
import { toSubmission } from "../components/shared/toSubmission";
import GameCanvas from "../components/mahjong/GameCanvas";
import MahjongDevPanel from "../components/mahjong/MahjongDevPanel";
import FlyingPair from "../components/mahjong/FlyingPair";
import { useMahjongCamera } from "../game/mahjong/layout";
import {
  createGame,
  DEADLOCK_OVERLAY_DELAY_MS,
  elapsedMs,
  nextBestTime,
  getAnyFreePair,
  pauseGame,
  resumeGame,
  selectTile,
  shuffleBoard,
  undoMove,
} from "../game/mahjong/engine";
import { getLayout, LAYOUTS } from "../game/mahjong/layouts/registry";
import type { MahjongState } from "../game/mahjong/types";
import {
  loadGame,
  loadProgress,
  loadStats,
  saveProgress,
  saveStats,
  unlockNextLayout,
  DEFAULT_PROGRESS,
  type MahjongProgress,
  type MahjongStats,
} from "../game/mahjong/storage";
import LayoutSelectScreen from "../components/mahjong/LayoutSelectScreen";
import { useMahjongFeedback } from "../components/mahjong/useMahjongFeedback";
import { useBoardZoomPan } from "../game/mahjong/useBoardZoomPan";
import { useMahjongPersistence } from "../game/mahjong/useMahjongPersistence";
import { freeIdsFor, useFreeTiles } from "../game/mahjong/useFreeTiles";
import { useGameSync } from "../game/_shared/useGameSync";
import { useCompletionTransition } from "../game/_shared/useCompletionTransition";
import { recordedOutcome } from "../game/_shared/recordedOutcome";
import { formatMs } from "../game/_shared/formatMs";
import { useReduceMotion } from "../components/shared/useReduceMotion";
import { useTransientToast } from "../components/shared/useTransientToast";

// ---------------------------------------------------------------------------
// MahjongScreen
// ---------------------------------------------------------------------------

/** What the win card shows beyond the final state. */
interface WinSummary {
  /** The fastest clear of this layout on this device, this one included. */
  readonly bestTimeMs: number;
  /** This clear is faster than every earlier one on this layout (#2747). */
  readonly isNewBest: boolean;
}

export default function MahjongScreen() {
  const { t } = useTranslation("mahjong");
  const { t: tResult } = useTranslation("result");
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const [view, setView] = useState<"loading" | "select" | "play">("loading");
  const [state, setState] = useState<MahjongState | null>(null);
  const camera = useMahjongCamera(getLayout(state?.currentLayoutId ?? "turtle"));
  // Pairs on the board = the layout's tile count / 2 (144 tiles -> 72 for every layout).
  const totalPairs =
    (LAYOUTS.find((l) => l.id === (state?.currentLayoutId ?? "turtle"))?.tileCount ?? 144) / 2;
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<MahjongProgress>(DEFAULT_PROGRESS);
  const [hasSavedGame, setHasSavedGame] = useState(false);
  const progressRef = useRef<MahjongProgress>(DEFAULT_PROGRESS);
  const [winSummary, setWinSummary] = useState<WinSummary | null>(null);
  // The card's rank line, and its "View leaderboard" link and the ⋯ menu item
  // (#2633), which open the board of the layout on screen: each layout has its
  // own (#2747).
  const { leaderboard, openLeaderboard } = useGameLeaderboard("mahjong", navigation, {
    layout: state?.currentLayoutId ?? "turtle",
  });
  const { lookup: lookupRank, reset: resetSubmission } = leaderboard;
  // The HUD clock's screen-reader label; stable, so the clock's own
  // one-second tick is the only thing that re-renders it.
  const clockA11yLabel = useCallback((time: string) => t("hud.elapsed", { time }), [t]);
  const [stats, setStats] = useState<MahjongStats>({
    bestScore: 0,
    bestTimeMsByLayout: {},
    gamesPlayed: 0,
    gamesWon: 0,
  });

  // Hint state — IDs of the pair currently being highlighted; auto-clears after 2 s.
  const [hintIds, setHintIds] = useState<ReadonlySet<number>>(new Set());
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // "No hint" toast — hides itself 2 s after the last press.
  const { visible: noHintVisible, show: showNoHint } = useTransientToast(2000);

  // Dev panel — __DEV__ only; toggled from the HUD's DEV pill, a long press on the clock, or
  // Shift+D (web).
  const [devOpen, setDevOpen] = useState(false);
  const toggleDev = useCallback(() => setDevOpen((o) => !o), []);
  const [debugShowFree, setDebugShowFree] = useState(false);
  // The board's free tiles, once per board (#2962): shared by the canvas, overlays and moves.
  const free = useFreeTiles(state);

  // Tile image URIs for the flying-pair overlay (web: loaded via expo-asset; native: stays null[]).
  const [tileUris, setTileUris] = useState<(string | null)[]>(Array(42).fill(null));

  // Sound and motion for each move (#2981): flying pairs, shake, pulse.
  const reduceMotion = useReduceMotion();
  const { flyingPairs, dismissFlyingPair, boardAnimStyle } = useMahjongFeedback(
    state,
    reduceMotion
  );

  // Pinch-to-zoom and drag-to-pan on the board (#2981).
  const { boardGesture, gestureAnimStyle, fitToScreen } = useBoardZoomPan(camera);

  // Derived display state for no-moves overlays — computed here (not inside
  // GameCanvas) so the overlays render at viewport level and are always visible.
  // Not once deadlocked: the overlay is delayed, and the engine ignores shuffles then (#3090).
  const showShuffleCTA = free.noFreePairs && !state?.isDeadlocked && (state?.shufflesLeft ?? 0) > 0;

  const [showDeadlockOverlay, setShowDeadlockOverlay] = useState(false);
  useEffect(() => {
    if (!state?.isDeadlocked) {
      setShowDeadlockOverlay(false);
      return;
    }
    const timer = setTimeout(() => setShowDeadlockOverlay(true), DEADLOCK_OVERLAY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state?.isDeadlocked]);

  // Zoom to fit when no moves remain so the whole board is visible behind the overlay —
  // the shuffle CTA, or the deadlock overlay (a geometric deadlock never shows the CTA).
  // A boolean, so it fires once per transition into either state.
  const showNoMoves = showShuffleCTA || !!state?.isDeadlocked;
  useEffect(() => {
    if (showNoMoves) fitToScreen(reduceMotion);
    // reduceMotion is excluded on purpose: it is read when the CTA appears, so
    // a mid-session toggle applies to the next one. fitToScreen is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNoMoves]);

  const hasLoadedRef = useRef(false);
  const stateRef = useRef<MahjongState | null>(null);

  const {
    start: syncStart,
    resume: syncResume,
    markStarted: syncMarkStarted,
    complete: syncComplete,
    close: syncClose,
    getGameId: syncGetGameId,
    setProgressSnapshot: syncSetProgressSnapshot,
  } = useGameSync("mahjong");

  // #2450 / #2619 — the unfinished-board result block (backend MahjongResult).
  // The hook's abandons (unmount, close()) and the deadlock loss build it here.
  const progressResult = useCallback(
    () => ({ won: false, pairs: stateRef.current?.pairsRemoved ?? 0 }),
    []
  );
  // The abandon also carries Mahjong's own play timer, which wins over the
  // hook's foreground clock (#2684).
  useEffect(() => {
    syncSetProgressSnapshot(() => {
      const s = stateRef.current;
      return { result: progressResult(), durationMs: s ? elapsedMs(s) : null };
    });
  }, [syncSetProgressSnapshot, progressResult]);

  // Load SVG asset URIs for the flying-pair tile overlay (web only — native SVG
  // display requires Skia and can't run inside Animated.View).
  // Reuses the singleton promise from loadTileAssets() so no duplicate
  // network requests are made when GameCanvas also calls it on mount.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    let cancelled = false;
    loadTileAssets().then((uris) => {
      if (!cancelled) setTileUris([...uris]);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Saves only when the board, undo history or banked clock change, debounced (#2961).
  const { saveNow, discardSave, adoptSaved } = useMahjongPersistence(state, hasLoadedRef);

  // Another screen covering the game (⋯ → Leaderboard, #2633) or the app
  // going to the background (#2750) stops its clock, so the finish and best
  // times count only play (usePausableClock). The pause is saved at once
  // (saveOnLeave), so a kill while backgrounded keeps the play banked.
  const { adoptLoaded, matchPresence } = usePausableClock({
    navigation,
    state,
    setState,
    pauseGame,
    resumeGame,
    // Level Select pauses the clock too: coming back to the app there
    // mustn't start it; CONTINUE does.
    hold: view === "select",
    saveOnLeave: saveNow,
  });

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Stats as of the win, read by the win lifecycle below.
  const statsRef = useRef(stats);
  useEffect(() => {
    statsRef.current = stats;
  }, [stats]);

  // Win lifecycle (useCompletionTransition, #3087): complete the sync session
  // and discard the save on the step to a cleared board, record the win once
  // per game, and unlock the next layout. A won game restored from storage
  // (marked by the mount load below) records nothing: its session ended and
  // its win was counted when it happened. It still unlocks: that is idempotent.
  const finishGame = (s: MahjongState): string | null => {
    const outcome = recordedOutcome("win");
    // Null for a won game restored from storage: its session already ended.
    const gameId = syncComplete(
      {
        finalScore: s.score,
        outcome,
        // elapsedMs, not accumulatedMs: the running segment is only banked
        // on pause, so accumulatedMs alone misses the current play time.
        durationMs: elapsedMs(s),
        result: { won: true, pairs: s.pairsRemoved },
      },
      { final_score: s.score, outcome, won: true, pairs: s.pairsRemoved }
    );
    discardSave();
    return gameId;
  };
  const unlockAfterWin = (s: MahjongState) => {
    // Unlock the next layout in registry order, then clear the active layout
    // from progress regardless of whether a new layout was unlocked.
    const completedId = s.currentLayoutId ?? "turtle";
    const newUnlocked = unlockNextLayout(completedId, LAYOUTS, progressRef.current.unlockedLayouts);
    const newProgress: MahjongProgress = {
      ...progressRef.current,
      unlockedLayouts: newUnlocked,
      currentLayoutId: null,
      currentState: null,
    };
    progressRef.current = newProgress;
    setProgress(newProgress);
    saveProgress(newProgress).catch(() => {});
    setHasSavedGame(false);
  };
  const { markRestoredComplete, reset: resetCompletion } = useCompletionTransition(
    state,
    state?.isComplete ?? false,
    {
      onComplete: (s) => {
        const gameId = finishGame(s);
        // The play timer, not accumulatedMs: the engine banks the running
        // segment only on pause, so a board cleared in one sitting has 0 there.
        const finalMs = elapsedMs(s);
        const finalScore = s.score;
        // The finished game is the leaderboard entry (#2624): the card only
        // asks where it ranks. Only a win completed in this session has one.
        if (gameId) void lookupRank(gameId);
        // Fastest clear wins, per layout like the boards (#2747), and only a
        // plausible one counts: an old save resumed with no time banked can
        // finish under the ranking floor.
        const layoutId = s.currentLayoutId ?? "turtle";
        setWinSummary(nextBestTime(statsRef.current.bestTimeMsByLayout[layoutId] ?? 0, finalMs));
        setStats((prev) => {
          const best = nextBestTime(prev.bestTimeMsByLayout[layoutId] ?? 0, finalMs).bestTimeMs;
          const updated: MahjongStats = {
            ...prev,
            gamesWon: prev.gamesWon + 1,
            bestScore: finalScore > prev.bestScore ? finalScore : prev.bestScore,
            bestTimeMsByLayout:
              best > 0 ? { ...prev.bestTimeMsByLayout, [layoutId]: best } : prev.bestTimeMsByLayout,
          };
          saveStats(updated).catch(() => {});
          return updated;
        });
        unlockAfterWin(s);
      },
      onAlreadyComplete: (s) => {
        finishGame(s);
        unlockAfterWin(s);
      },
    }
  );

  // Mount: restore saved game or show layout select. After the win hook, whose
  // guard it sets for a won game restored from storage.
  useEffect(() => {
    let alive = true;
    Promise.all([loadGame(), loadStats(), loadProgress()]).then(
      ([saved, savedStats, savedProgress]) => {
        if (!alive) return;
        hasLoadedRef.current = true;
        progressRef.current = savedProgress;
        setProgress(savedProgress);
        if (saved !== null) {
          setState(adoptSaved(adoptLoaded(saved)));
          setHasSavedGame(!saved.isComplete);
          if (saved.isComplete) markRestoredComplete();
          // A restored game continues the session a killed app left open (#2654).
          if (!saved.isComplete) syncResume();
          setView("play");
        } else {
          setView("select");
        }
        setStats(savedStats);
        setLoading(false);
      }
    );
    return () => {
      alive = false;
    };
  }, [syncResume, adoptLoaded, adoptSaved, markRestoredComplete]);

  // Disable native swipe-back (iOS edge gesture) while the game is open so that
  // a left-pan on the board doesn't accidentally exit to the lobby.
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: false });
    return () => navigation.setOptions({ gestureEnabled: true });
  }, [navigation]);

  /**
   * A deadlocked board the player leaves is a lost game (#2517), not an
   * abandoned one: it was played to its end. Recorded on leaving rather than
   * at the deadlock, so "Undo last move" on the card can still rescue it.
   * No score: a loss counts everywhere (only abandons are excluded), and
   * Mahjong's leaderboard ranks every scored row. The lost board is then
   * finished: its save is cleared so CONTINUE can't reopen it and record the
   * same board again (#2592 review). Returns whether it closed the session.
   */
  const recordDeadlockLoss = useCallback((): boolean => {
    const s = stateRef.current;
    if (!syncGetGameId() || !s?.isDeadlocked || s.isComplete) return false;
    const result = progressResult();
    syncComplete(
      { outcome: "loss", durationMs: elapsedMs(s), result },
      { outcome: "loss", ...result }
    );
    discardSave();
    setHasSavedGame(false);
    return true;
  }, [syncGetGameId, syncComplete, progressResult, discardSave]);

  // Leaving a deadlocked board records the loss. Any other open session is
  // abandoned by useGameSync itself when the screen unmounts, with the
  // progress snapshot as its result (#2619, #2627).
  useEffect(() => {
    const unsub = navigation.addListener("beforeRemove", () => {
      recordDeadlockLoss();
    });
    return unsub;
  }, [navigation, recordDeadlockLoss]);

  const ensureSyncStarted = useCallback(
    (s: MahjongState) => {
      if (syncGetGameId()) return;
      const layout = s.currentLayoutId ?? "turtle";
      // Event data for the game_started event; metadata for the row (#2627).
      syncStart({ layout }, { layout });
      syncMarkStarted();
    },
    [syncGetGameId, syncStart, syncMarkStarted]
  );

  // Any move drops the hint: an undo or a shuffle can renumber the tiles it names.
  const clearHint = useCallback(() => {
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = null;
    setHintIds((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  const handleTilePress = useCallback(
    (tileId: number) => {
      clearHint();
      setState((prev) => {
        if (!prev) return prev;
        const moved = selectTile(prev, tileId, freeIdsFor(free, prev.tiles));
        if (moved === prev) return prev;
        // A first tap that lands while the player is away mustn't start the
        // clock running (#2750).
        const next = matchPresence(moved);
        ensureSyncStarted(next);
        return next;
      });
    },
    [ensureSyncStarted, matchPresence, clearHint, free]
  );

  const handleHint = useCallback(() => {
    if (!state) return;
    const pair = getAnyFreePair(state.tiles, free.ids);
    if (!pair) {
      showNoHint();
      return;
    }
    clearHint();
    setHintIds(new Set(pair));
    hintTimerRef.current = setTimeout(() => setHintIds(new Set()), 2000);
  }, [state, free, clearHint, showNoHint]);

  useEffect(
    () => () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    },
    []
  );

  const handleShuffle = useCallback(() => {
    clearHint();
    setState((prev) => {
      if (!prev) return prev;
      const shuffled = shuffleBoard(prev);
      if (shuffled === prev) return prev;
      const next = matchPresence(shuffled);
      ensureSyncStarted(next);
      return next;
    });
  }, [ensureSyncStarted, matchPresence, clearHint]);

  const handleUndo = useCallback(() => {
    clearHint();
    setState((prev) => (prev ? matchPresence(undoMove(prev)) : prev));
  }, [matchPresence, clearHint]);

  /**
   * Closes an open session: a loss for a deadlocked board, otherwise the
   * hook's close() — abandoned with the progress snapshot if started,
   * discarded if not (a no-op after a win or with no session open).
   */
  const abandonOpenSession = useCallback(() => {
    if (recordDeadlockLoss()) return;
    syncClose();
  }, [recordDeadlockLoss, syncClose]);

  /**
   * Leaves the board for a new one: closes its session (abandonOpenSession) and
   * clears its result, so the next game's completion is recorded afresh.
   */
  const leaveCurrentGame = useCallback(() => {
    abandonOpenSession();
    setWinSummary(null);
    resetSubmission();
    resetCompletion();
  }, [abandonOpenSession, resetSubmission, resetCompletion]);

  const startNewGame = useCallback(() => {
    leaveCurrentGame();
    const s = stateRef.current;
    // A deadlocked board left this way is lost (#2517) — nothing to continue.
    setHasSavedGame(s !== null && !s.isComplete && !s.isDeadlocked);
    setState(null);
    setView("select");
  }, [leaveCurrentGame]);

  // Navigates directly to level select without an abandon confirmation or server
  // abandon event — the in-progress game is preserved locally so CONTINUE works.
  // Level Select isn't play: the clock pauses here and CONTINUE resumes it
  // (#2750). The clock's own state decides: only a running clock pauses, and
  // only a paused one on an unfinished board resumes.
  const goToLevelSelect = useCallback(() => {
    const s = stateRef.current;
    setHasSavedGame(s !== null && !s.isComplete);
    const now = Date.now();
    setState((prev) => (prev ? pauseGame(prev, now) : prev));
    setView("select");
  }, []);

  const handleSelectLayout = useCallback(
    (layoutId: string) => {
      // Level Select keeps the board's session open (so CONTINUE resumes it);
      // a new deal closes it here, so the next tap opens a session with this
      // layout (#2627).
      leaveCurrentGame();
      const fresh = { ...createGame(getLayout(layoutId)), currentLayoutId: layoutId };
      setState(fresh);
      setView("play");
      setHasSavedGame(false);
      setStats((prev) => {
        const updated = { ...prev, gamesPlayed: prev.gamesPlayed + 1 };
        saveStats(updated).catch(() => {});
        return updated;
      });
      const newProgress: MahjongProgress = {
        ...progressRef.current,
        currentLayoutId: layoutId,
        currentState: null,
      };
      progressRef.current = newProgress;
      setProgress(newProgress);
      saveProgress(newProgress).catch(() => {});
      // Sync session starts on first tile tap via ensureSyncStarted, not here.
    },
    [leaveCurrentGame]
  );

  // Play Again from a result card: a fresh deal of the same layout.
  const handlePlayAgain = useCallback(() => {
    handleSelectLayout(stateRef.current?.currentLayoutId ?? "turtle");
  }, [handleSelectLayout]);

  const handleContinue = useCallback(() => {
    const inMemory = stateRef.current;
    if (inMemory !== null && !inMemory.isComplete) {
      // Level Select kept this board in memory, with its session open and its
      // clock stopped: carry on from it (#2750). Reloading the save would drop
      // the play since the last save, and a resume would reopen the session.
      setHasSavedGame(false);
      const now = Date.now();
      setState((prev) => (prev ? resumeGame(prev, now) : prev));
      setView("play");
      return;
    }
    loadGame()
      .then((saved) => {
        if (!saved) {
          // Storage was cleared or corrupt — dismiss the continue button and stay on select.
          setHasSavedGame(false);
          return;
        }
        setState(adoptSaved(adoptLoaded(saved)));
        setHasSavedGame(false);
        // A restored game continues the session a killed app left open (#2654).
        if (!saved.isComplete) syncResume();
        setView("play");
      })
      .catch(() => {
        setHasSavedGame(false);
      });
  }, [syncResume, adoptLoaded, adoptSaved]);

  const undoDisabled = !state || state.undoStack.length === 0 || state.isComplete;

  if (!loading && view === "select") {
    return (
      <GameShell
        gameType="mahjong"
        title={t("game.title")}
        requireBack
        loading={false}
        onOpenLeaderboard={openLeaderboard}
        style={{ paddingBottom: Math.max(insets.bottom, 16) }}
      >
        <LayoutSelectScreen
          layouts={LAYOUTS}
          progress={progress}
          hasContinue={hasSavedGame}
          onSelectLayout={handleSelectLayout}
          onContinue={handleContinue}
        />
      </GameShell>
    );
  }

  return (
    <GameShell
      gameType="mahjong"
      title={t("game.title")}
      requireBack
      loading={loading}
      style={{ paddingBottom: Math.max(insets.bottom, 16) }}
      onNewGame={startNewGame}
      onLevelSelect={goToLevelSelect}
      // No Scoreboard item (#2627): it led to an untranslated fallback. The
      // Stats item (GameShell's gameType, #2635) takes its place.
      onOpenLeaderboard={openLeaderboard}
      rightSlot={
        <View style={styles.hudGroup}>
          <PillButton
            label={t("action.undo")}
            accessibilityLabel={t("action.undoLabel")}
            onPress={handleUndo}
            disabled={undoDisabled}
            testID="mahjong-undo-button"
          />
          <PillButton
            label={t("action.hint")}
            accessibilityLabel={t("action.hintLabel")}
            onPress={handleHint}
            disabled={!!(state?.isComplete || state?.isDeadlocked)}
            color={MAHJONG_HINT_COLOR}
            testID="mahjong-hint-button"
          />
        </View>
      }
    >
      {state !== null && (
        <View style={{ flex: 1, alignItems: "center" }}>
          <View style={styles.hudRow} accessibilityRole="summary">
            <View style={styles.hudGroup}>
              {/* The play clock that ranks (#2747), in place of the score: while
                  playing, the score is 10 per pair, which PAIRS already shows.
                  The score stays on the result card. */}
              {__DEV__ ? (
                <Pressable onLongPress={toggleDev} accessibilityRole="none">
                  <PlayClockText
                    startedAt={state.startedAt}
                    accumulatedMs={state.accumulatedMs}
                    label={t("hud.time")}
                    accessibilityLabel={clockA11yLabel}
                    style={[styles.hudText, { color: colors.text }]}
                    testID="mahjong-clock"
                  />
                </Pressable>
              ) : (
                <PlayClockText
                  startedAt={state.startedAt}
                  accumulatedMs={state.accumulatedMs}
                  label={t("hud.time")}
                  accessibilityLabel={clockA11yLabel}
                  style={[styles.hudText, { color: colors.text }]}
                  testID="mahjong-clock"
                />
              )}
              <Text style={[styles.hudText, { color: colors.textMuted }]}>
                {t("hud.pairs")} {state.pairsRemoved}/{totalPairs}
              </Text>
            </View>
            <View style={styles.hudGroup}>
              <PillButton
                label={`${t("action.shuffle")} ${state.shufflesLeft}`}
                accessibilityLabel={t("action.shuffleLabel")}
                onPress={handleShuffle}
                disabled={state.shufflesLeft === 0 || state.isComplete || state.isDeadlocked}
                color="#ffd700"
                testID="mahjong-shuffle-button"
              />
              <Text style={[styles.hudText, styles.dealIdText, { color: colors.textMuted }]}>
                {t("hud.deal")} #{state.dealId}
              </Text>
              {__DEV__ && (
                <PillButton
                  label="DEV"
                  accessibilityLabel="Toggle dev panel"
                  onPress={toggleDev}
                  color={DEV_ACCENT}
                />
              )}
            </View>
          </View>

          {noHintVisible && (
            <Text
              style={styles.noHintToast}
              accessibilityLiveRegion="polite"
              testID="no-hint-toast"
            >
              {t("action.noHint")}
            </Text>
          )}

          {/* Viewport container — clips the board during zoom/pan */}
          <View
            testID="mahjong-board-viewport"
            style={{
              width: camera.viewportWidth,
              height: camera.viewportHeight,
              overflow: "hidden",
              alignSelf: "center",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <GestureDetector gesture={boardGesture}>
              {/* Gesture layer — pinch-to-zoom + two-finger pan */}
              <Animated.View
                style={[{ width: camera.boardWidth, height: camera.boardHeight }, gestureAnimStyle]}
              >
                <Animated.View style={boardAnimStyle}>
                  <GameCanvas
                    state={state}
                    camera={camera}
                    freeIds={free.ids}
                    hintIds={hintIds}
                    debugShowFree={__DEV__ && debugShowFree}
                    onTilePress={handleTilePress}
                  />
                </Animated.View>
                {flyingPairs.map((pair) => (
                  <FlyingPair
                    key={pair.id}
                    {...pair}
                    camera={camera}
                    tileUris={tileUris}
                    onDone={() => dismissFlyingPair(pair.id)}
                  />
                ))}
              </Animated.View>
            </GestureDetector>

            {/* No-moves overlays — viewport-level siblings to the gesture layer so
                they always fill the visible area regardless of board height. */}
            {showShuffleCTA && (
              <View
                style={[StyleSheet.absoluteFill, styles.noMovesOverlay]}
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
              >
                <Text style={styles.overlayTitle}>{t("overlay.noMoves")}</Text>
                <Text style={styles.overlayDetail}>{t("overlay.noMovesDetail")}</Text>
                <Pressable
                  style={styles.overlayBtn}
                  onPress={handleShuffle}
                  accessibilityLabel={t("action.shuffleLabel")}
                >
                  <Text style={styles.overlayBtnText}>
                    {t("overlay.shuffleButton")} ({state!.shufflesLeft})
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      )}

      <MahjongDevPanel
        enabled={__DEV__}
        open={devOpen}
        onToggle={toggleDev}
        state={state}
        free={free}
        showFree={debugShowFree}
        onToggleShowFree={() => setDebugShowFree((v) => !v)}
        onOpenLayoutInspector={() => navigation.navigate("MahjongLayoutInspector")}
      />

      {state !== null ? (
        <GameResultModal
          visible={state.isComplete || showDeadlockOverlay}
          outcome={state.isComplete ? "win" : "loss"}
          eyebrow={`${t("game.title")} · ${t(`layout.${state.currentLayoutId ?? "turtle"}`)}`}
          subtitle={
            state.isComplete
              ? tResult("subtitle.pairsCleared", { count: state.pairsRemoved })
              : tResult("subtitle.noFreePairs")
          }
          // A clear ranks by its time (#2747), so the win card leads with it.
          hero={
            state.isComplete
              ? { kind: "score", label: tResult("stat.time"), value: formatMs(elapsedMs(state)) }
              : { kind: "score", label: tResult("stat.score"), value: state.score }
          }
          isNewBest={state.isComplete && (winSummary?.isNewBest ?? false)}
          // A deadlock one undo away from a live board isn't final: offer the
          // undo the header had before the card covered it.
          detail={
            !state.isComplete && state.undoStack.length > 0 ? (
              <Pressable
                testID="mahjong-result-undo"
                style={styles.resultUndoBtn}
                onPress={handleUndo}
                accessibilityRole="button"
                accessibilityLabel={tResult("action.undoLastMove")}
              >
                <Text style={[styles.resultUndoText, { color: colors.accent }]}>
                  {tResult("action.undoLastMove")}
                </Text>
              </Pressable>
            ) : undefined
          }
          stats={
            state.isComplete
              ? [
                  { label: tResult("stat.score"), value: state.score },
                  ...(winSummary && winSummary.bestTimeMs > 0
                    ? [{ label: tResult("stat.best"), value: formatMs(winSummary.bestTimeMs) }]
                    : []),
                ]
              : [{ label: tResult("stat.time"), value: formatMs(elapsedMs(state)) }]
          }
          submission={state.isComplete ? toSubmission(leaderboard) : undefined}
          onViewLeaderboard={openLeaderboard}
          onPlayAgain={handlePlayAgain}
          secondaryAction={{ label: tResult("action.changeLayout"), onPress: startNewGame }}
          onHome={() => navigation.popToTop()}
          testID="mahjong-result"
        />
      ) : null}
    </GameShell>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  resultUndoBtn: {
    alignSelf: "center",
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  resultUndoText: {
    fontSize: 15,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
  hudRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    alignSelf: "stretch",
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  hudGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  noHintToast: {
    fontFamily: typography.heading,
    fontSize: 12,
    letterSpacing: 0.5,
    paddingBottom: 4,
    color: MAHJONG_HINT_COLOR,
  },
  hudText: {
    fontFamily: typography.heading,
    fontSize: 14,
    letterSpacing: 0.5,
  },
  dealIdText: {
    fontSize: 10,
  },
  noMovesOverlay: {
    backgroundColor: MAHJONG_NO_MOVES_OVERLAY_BG,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  overlayTitle: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 8,
  },
  overlayDetail: {
    color: "#cccccc",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 16,
  },
  overlayBtn: {
    backgroundColor: MAHJONG_OVERLAY_BTN_BG,
    paddingVertical: 10,
    paddingHorizontal: 28,
    borderRadius: 6,
    marginTop: 4,
  },
  overlayBtnText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "bold",
    textAlign: "center",
  },
});
