import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  AppState,
  AppStateStatus,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";

import type { HomeStackParamList } from "../types/navigation";
import { useTheme } from "../theme/ThemeContext";
import { typography } from "../theme/typography";
import {
  applyPour,
  initState,
  isValidPour,
  pourUnits,
  undo as undoState,
} from "../game/sort/engine";
import { getNextHintAsync } from "../game/sort/solver";
import type { Color, SortState } from "../game/sort/types";
import SortBoard, { POUR_PER_UNIT_MS } from "../game/sort/components/SortBoard";
import { TILT_IN_MS, TILT_HOLD_MS, TILT_OUT_MS } from "../game/sort/components/BottleView";
import LevelSelectScreen from "../game/sort/components/LevelSelectScreen";
import { sortApi, type LevelData } from "../game/sort/api";
import { isNetworkError } from "../game/_shared/httpClient";
import { withRetry } from "../game/_shared/withRetry";
import {
  applyLevelSolve,
  highestSolvedLevel,
  loadBestMoves,
  loadProgress,
  mergeBestMoves,
  saveBestMoves,
  saveProgress,
  loadLevelsCache,
  saveLevelsCache,
  totalBestMoves,
  type BestMoves,
  type SortProgress,
} from "../game/sort/storage";
import { ConnectedOfflineBanner } from "../components/shared/OfflineBanner";
import { GameShell } from "../components/shared/GameShell";
import { useLeaderboardLink } from "../hooks/useLeaderboardLink";
import { HudStatRow } from "../components/shared/HudStatRow";
import { PillButton } from "../components/shared/PillButton";
import { useSortAudio } from "../game/sort/useSortAudio";
import GameResultModal from "../components/shared/GameResultModal";
import { useGameSync } from "../game/_shared/useGameSync";
import { useLeaderboardSubmit } from "../game/_shared/useLeaderboardSubmit";
import { sessionBoardAdapter } from "../game/_shared/sessionBoardAdapter";

type ScreenView = "loading" | "select" | "play";

/** The result card's rank lookup on Sort's session board (#2625, #2677). */
const sortBoard = sessionBoardAdapter("sort");

export default function SortScreen() {
  const { t } = useTranslation("sort");
  const { t: tResult } = useTranslation("result");
  const { colors } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();

  // Top-level view
  const [view, setView] = useState<ScreenView>("loading");
  const [levels, setLevels] = useState<LevelData[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [progress, setProgress] = useState<SortProgress>({
    unlockedLevel: 1,
    currentLevelId: null,
    currentState: null,
  });

  // Active game
  const [currentLevelId, setCurrentLevelId] = useState<number | null>(null);
  const [gameState, setGameState] = useState<SortState | null>(null);
  const [history, setHistory] = useState<readonly SortState[]>([]);
  const [colorblindMode, setColorblindMode] = useState(false);

  // Pour animation state
  const [pouringFrom, setPouringFrom] = useState<number | null>(null);
  const [pouringTo, setPouringTo] = useState<number | null>(null);
  const [pourHoldMs, setPourHoldMs] = useState(POUR_PER_UNIT_MS);
  const [isPouring, setIsPouring] = useState(false);
  const [boardHeight, setBoardHeight] = useState(0);
  const pourTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPourRef = useRef<{ snapshot: SortState; from: number; to: number } | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);

  // Result card (#2512)
  const [showWinModal, setShowWinModal] = useState(false);
  /** The solved level's best (fewest) moves, including this solve. */
  const [winSummary, setWinSummary] = useState<{ best: number; isNewBest: boolean } | null>(null);
  const leaderboardSubmit = useLeaderboardSubmit(sortBoard);
  const { submit: submitRank, reset: resetSubmission } = leaderboardSubmit;
  // The card's "View leaderboard" link and the ⋯ menu item (#2633).
  const openLeaderboard = useLeaderboardLink(navigation, "sort");

  // One `games` row per level played (#2512): XP, Profile history, stats and
  // the leaderboard (#2625). Only the first solve of the player's frontier
  // level is scored (see the solve effect); the board ranks those rows, one
  // entry per named player.
  const {
    start: syncStart,
    resume: syncResume,
    markStarted: syncMarkStarted,
    complete: syncComplete,
    getGameId: syncGetGameId,
    setProgressSnapshot: syncSetProgressSnapshot,
    resetPlayWindow: syncResetPlayWindow,
  } = useGameSync("sort");
  const gameStateRef = useRef<SortState | null>(null);
  gameStateRef.current = gameState;
  const currentLevelIdRef = useRef<number | null>(null);
  currentLevelIdRef.current = currentLevelId;
  /** Bumped whenever the played level changes, so a late hint is dropped. */
  const levelGenRef = useRef(0);

  const [isHinting, setIsHinting] = useState(false);

  const progressRef = useRef(progress);
  progressRef.current = progress;
  /**
   * The best moves per level: the one source of truth for every solve's card
   * and score, so the session completes before the player can move on.
   * Loaded (merged) from `@sort/best_moves` with the screen; storage mirrors it.
   */
  const bestMovesRef = useRef<BestMoves>({});
  /** Storage was read, so writing `bestMovesRef` can't lose a stored best. */
  const bestsStoredRef = useRef(false);

  const audio = useSortAudio();

  // #2619 — the abandon result block. Both the hook's own abandon (unmount) and
  // abandonSession build it here.
  const progressResult = useCallback(
    () => ({
      won: false,
      level: currentLevelIdRef.current,
      moves: gameStateRef.current?.moveCount ?? 0,
    }),
    []
  );
  useEffect(() => {
    syncSetProgressSnapshot(() => ({ result: progressResult() }));
  }, [syncSetProgressSnapshot, progressResult]);

  /** Closes an open, unfinished session as abandoned (a no-op otherwise). */
  const abandonSession = useCallback(() => {
    if (!syncGetGameId()) return;
    const result = progressResult();
    syncComplete({ outcome: "abandoned", result }, { outcome: "abandoned", ...result });
  }, [syncGetGameId, syncComplete, progressResult]);

  useEffect(() => {
    return () => {
      if (pourTimerRef.current !== null) clearTimeout(pourTimerRef.current);
    };
  }, []);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  // ---------------------------------------------------------------------------
  // Init — extracted so the retry button can re-invoke it
  // ---------------------------------------------------------------------------

  const loadScreen = useCallback(async () => {
    setLoadError(false);
    setView("loading");
    const [levelsResult, prog, stored] = await Promise.all([
      withRetry(() => sortApi.getLevels())
        .then((result) => {
          // Cache the level definitions for offline use. Fire-and-forget —
          // don't block the render on the AsyncStorage write.
          saveLevelsCache(result).catch(() => {});
          return result;
        })
        // Only serve cached levels on network failures (isNetworkError). HTTP errors
        // such as 401 Unauthorized mean the server is actively denying access
        // (e.g. entitlement expired) — falling back to cache would bypass that.
        .catch((e) => (isNetworkError(e) ? loadLevelsCache() : null)),
      loadProgress(),
      loadBestMoves(),
    ]);
    if (stored !== null) {
      // Merge, never replace: a Retry must keep a best still only in memory
      // (its write failed, or storage couldn't be read before).
      const merged = mergeBestMoves(bestMovesRef.current, stored);
      bestMovesRef.current = merged;
      bestsStoredRef.current = true;
      if (Object.entries(merged).some(([level, moves]) => stored[level] !== moves)) {
        void saveBestMoves(merged);
      }
    }
    if (!levelsResult) {
      setLoadError(true);
    } else {
      setLevels(levelsResult.levels as LevelData[]);
    }
    setProgress(prog);
    setView("select");
  }, []);

  useEffect(() => {
    void loadScreen();
  }, [loadScreen]);

  // ---------------------------------------------------------------------------
  // Persistence effects
  // ---------------------------------------------------------------------------

  // Save whenever the in-play game state changes
  useEffect(() => {
    if (view !== "play" || currentLevelId === null || gameState === null) return;
    const inProgress = !gameState.isComplete;
    void saveProgress({
      ...progressRef.current,
      currentLevelId: inProgress ? currentLevelId : null,
      currentState: inProgress ? gameState : null,
    });
  }, [gameState, view, currentLevelId]);

  // Save on app background
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "background" || next === "inactive") {
        if (
          view === "play" &&
          currentLevelId !== null &&
          gameState !== null &&
          !gameState.isComplete
        ) {
          void saveProgress({
            ...progressRef.current,
            currentLevelId,
            currentState: gameState,
          });
        }
      }
    });
    return () => sub.remove();
    // progressRef is a stable ref, so it doesn't belong in the dep array.
  }, [view, currentLevelId, gameState]);

  // Unlock the next level, complete the session and show the result card as
  // soon as the puzzle is solved. Nothing here waits on the network or on
  // storage, so Next Level is available at once.
  useEffect(() => {
    if (!gameState?.isComplete || showWinModal) return;
    setShowWinModal(true);
    if (currentLevelId !== null) {
      const solvedLevel = currentLevelId;
      const moves = gameState.moveCount;
      // Decided now, from the bests in memory, so the session completes before
      // the player can leave the card (#2625).
      const { solve, bests } = applyLevelSolve(bestMovesRef.current, solvedLevel, moves);
      bestMovesRef.current = bests;
      setWinSummary(solve);
      // Storage mirrors memory; skipped while it couldn't be read, so a failed
      // read never overwrites the stored bests.
      if (solve.isNewBest && bestsStoredRef.current) void saveBestMoves(bests);
      // Every solve is scored with the player's standing after it (#2625): the
      // highest level solved, and the sum of best moves up to it. A replay that
      // lowers a best improves the tie-break; the board keeps each player's
      // best row. `level`/`moves`/`undos` are the level actually played.
      const frontier = Math.min(
        Math.max(
          solvedLevel,
          progressRef.current.unlockedLevel - 1, // read before the unlock below
          highestSolvedLevel(bests)
        ),
        // Never past the last level: the server rejects (and the sync worker
        // would drop) a level_reached above its cap.
        Math.max(levels.length, solvedLevel)
      );
      const result: Record<string, number | boolean> = {
        won: true,
        level: solvedLevel,
        moves,
        undos: gameState.undosUsed,
        level_reached: frontier,
      };
      const totalMoves = totalBestMoves(bests, frontier);
      if (totalMoves !== null) result.total_moves = totalMoves;
      const gameId = syncComplete(
        { outcome: "completed", finalScore: frontier, result },
        { outcome: "completed", ...result }
      );
      // The row ranks by itself under the player's name (#2624): the card
      // only asks where it landed, or for a name if there is none.
      if (gameId) void submitRank({ gameId });
      const newUnlocked = Math.min(
        Math.max(progressRef.current.unlockedLevel, currentLevelId + 1),
        levels.length || currentLevelId + 1
      );
      const updated: SortProgress = {
        ...progressRef.current,
        unlockedLevel: newUnlocked,
        currentLevelId: null,
        currentState: null,
      };
      setProgress(updated);
      void saveProgress(updated);
    }
  }, [
    gameState?.isComplete,
    gameState?.moveCount,
    gameState?.undosUsed,
    showWinModal,
    currentLevelId,
    levels,
    syncComplete,
    submitRank,
  ]);

  // ---------------------------------------------------------------------------
  // Game handlers
  // ---------------------------------------------------------------------------

  const handlePourComplete = useCallback(() => {
    const pending = pendingPourRef.current;
    if (!pending) return;
    pendingPourRef.current = null;
    const nextState = applyPour(pending.snapshot, pending.from, pending.to);
    setGameState(nextState);
    setIsPouring(false);
    setPouringFrom(null);
    setPouringTo(null);
    if (nextState.isComplete) {
      audio.playWin();
    }
  }, [audio]);

  function handleBottleTap(index: number) {
    if (!gameState || gameState.isComplete || isPouring) return;
    const { selectedBottleIndex } = gameState;

    if (selectedBottleIndex === null) {
      if ((gameState.bottles[index]?.length ?? 0) > 0) {
        setGameState({ ...gameState, selectedBottleIndex: index });
      }
      return;
    }

    if (index === selectedBottleIndex) {
      setGameState({ ...gameState, selectedBottleIndex: null });
      return;
    }

    if (isValidPour(gameState.bottles[selectedBottleIndex]!, gameState.bottles[index]!)) {
      const snapshot = gameState;
      const units = pourUnits(gameState.bottles[selectedBottleIndex]!, gameState.bottles[index]!);
      const holdMs = POUR_PER_UNIT_MS * units;
      if (!syncGetGameId()) {
        syncStart({ level: currentLevelId });
        syncMarkStarted();
      }
      setHistory((h) => [...h, snapshot]);
      setIsPouring(true);
      setPouringFrom(selectedBottleIndex);
      setPouringTo(index);
      setPourHoldMs(holdMs);
      setGameState({ ...gameState, selectedBottleIndex: null });
      audio.playPour();
      if (reduceMotion) {
        // Reduce-motion: BottleView does a tilt-only animation with no ghost overlay,
        // so there is no onPourComplete callback from SortBoard — drive state update
        // with a timer instead.
        const totalMs = TILT_IN_MS + TILT_HOLD_MS + TILT_OUT_MS + 50;
        pourTimerRef.current = setTimeout(() => {
          const nextState = applyPour(snapshot, selectedBottleIndex, index);
          setGameState(nextState);
          setIsPouring(false);
          setPouringFrom(null);
          setPouringTo(null);
          if (nextState.isComplete) {
            audio.playWin();
          }
        }, totalMs);
      } else {
        // Full animation: state update is driven by onPourComplete fired from SortBoard
        // the moment the ghost overlay is removed, so both happen in the same render.
        pendingPourRef.current = { snapshot, from: selectedBottleIndex, to: index };
      }
    } else {
      setGameState({ ...gameState, selectedBottleIndex: null });
    }
  }

  function handleUndo() {
    if (!gameState || isPouring) return;
    const { state: newState, history: newHistory } = undoState(gameState, history);
    setGameState(newState);
    setHistory(newHistory);
  }

  async function handleHint() {
    if (!gameState || gameState.isComplete || isPouring || isHinting) return;
    setIsHinting(true);
    const gen = levelGenRef.current;
    try {
      const hint = await getNextHintAsync(gameState);
      // Drop a hint computed for a board the player has since restarted or left.
      if (hint && gen === levelGenRef.current) {
        setGameState((cur) =>
          cur && !cur.isComplete ? { ...cur, selectedBottleIndex: hint.from } : cur
        );
      }
    } finally {
      setIsHinting(false);
    }
  }

  function handleSelectLevel(levelId: number) {
    const level = levels.find((l) => l.id === levelId);
    if (!level) return;
    abandonSession();
    // The level's play time starts now, though its session opens at the first
    // pour: the thinking time before that pour counts, and time on the level
    // grid or the previous level's result card does not (#2710).
    syncResetPlayWindow();
    levelGenRef.current += 1;
    setCurrentLevelId(levelId);
    setGameState(initState(level.bottles as (Color | "")[][]));
    setHistory([]);
    setShowWinModal(false);
    setWinSummary(null);
    resetSubmission();
    setView("play");
  }

  function handleContinue() {
    const prog = progressRef.current;
    if (!prog.currentLevelId || !prog.currentState) return;
    levelGenRef.current += 1;
    setCurrentLevelId(prog.currentLevelId);
    setGameState(prog.currentState);
    // A restored game continues the session a killed app left open (#2654);
    // resume() counts its play time from here. With no session to resume the
    // level's play time still starts now, not on the level grid (#2710).
    if (!syncResume()) syncResetPlayWindow();
    setHistory([]);
    setShowWinModal(false);
    setWinSummary(null);
    resetSubmission();
    setView("play");
  }

  function handleBackToSelect() {
    if (pourTimerRef.current !== null) {
      clearTimeout(pourTimerRef.current);
      pourTimerRef.current = null;
    }
    pendingPourRef.current = null;
    setIsPouring(false);
    setPouringFrom(null);
    setPouringTo(null);
    abandonSession();
    levelGenRef.current += 1;
    setView("select");
    setShowWinModal(false);
    // Silently refresh levels in the background so the next session gets new mixtures
    void sortApi
      .getLevels()
      .then((res) => setLevels(res.levels as LevelData[]))
      .catch(() => {});
  }

  function handleResetLevel() {
    if (!currentLevelId) return;
    const level = levels.find((l) => l.id === currentLevelId);
    if (!level) return;
    if (pourTimerRef.current !== null) {
      clearTimeout(pourTimerRef.current);
      pourTimerRef.current = null;
    }
    // A pour whose animation is still finishing must not land on the fresh board.
    pendingPourRef.current = null;
    setIsPouring(false);
    setPouringFrom(null);
    setPouringTo(null);
    abandonSession();
    // The fresh board's play time starts now, not with the board it replaces
    // (#2710).
    syncResetPlayWindow();
    levelGenRef.current += 1;
    setGameState(initState(level.bottles as (Color | "")[][]));
    setHistory([]);
  }

  function handleNextLevel() {
    const nextId = (currentLevelId ?? 0) + 1;
    const nextLevel = levels.find((l) => l.id === nextId);
    if (!nextLevel) {
      handleBackToSelect();
      return;
    }
    setShowWinModal(false);
    handleSelectLevel(nextId);
  }

  // ---------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------

  if (view === "loading") {
    return <GameShell key="loading" title={t("game.title")} loading />;
  }

  if (view === "select") {
    return (
      <GameShell
        key="select"
        title={t("game.title")}
        requireBack
        onBack={() => navigation.goBack()}
        onOpenLeaderboard={openLeaderboard}
      >
        {/* Error banner with retry */}
        {loadError && (
          <View style={styles.errorRow}>
            <Text style={[styles.loadErrorText, { color: colors.error }]}>
              {t("error.loadFailed")}
            </Text>
            <Pressable
              onPress={() => void loadScreen()}
              accessibilityRole="button"
              accessibilityLabel={t("error.submitRetry")}
            >
              <Text style={[styles.retryText, { color: colors.accent }]}>
                {t("error.submitRetry")}
              </Text>
            </Pressable>
          </View>
        )}

        {/* The board is the shared leaderboard screen now (#2633), from the
            ⋯ menu and the result card; the inline Leaderboard tab is gone. */}
        <LevelSelectScreen
          levels={levels}
          progress={progress}
          onSelectLevel={handleSelectLevel}
          onContinue={handleContinue}
        />
      </GameShell>
    );
  }

  // view === "play"
  return (
    <GameShell
      key="play"
      title={t("game.title")}
      requireBack
      onBack={handleBackToSelect}
      backAccessibilityLabel={t("action.backToLevels")}
      onNewGame={handleResetLevel}
      onLevelSelect={handleBackToSelect}
      onOpenLeaderboard={openLeaderboard}
      rightSlot={
        <View style={styles.headerBtnRow}>
          <PillButton
            label={t("action.hint")}
            onPress={handleHint}
            busy={isHinting}
            disabled={isPouring || !!gameState?.isComplete}
            color={colors.bonus}
          />
          <PillButton
            label={t("action.undo")}
            onPress={handleUndo}
            disabled={history.length === 0}
          />
        </View>
      }
    >
      <ConnectedOfflineBanner style={styles.offlineBannerWrap} />

      <HudStatRow
        style={styles.hud}
        stats={[
          { key: "level", text: t("hud.level", { level: currentLevelId }), bold: true },
          { key: "moves", text: t("hud.moves", { moves: gameState?.moveCount ?? 0 }), muted: true },
          { key: "undos", text: t("hud.undos", { undos: gameState?.undosUsed ?? 0 }), muted: true },
        ]}
      />

      {/* Board */}
      <View
        testID="sort-board"
        style={styles.boardContainer}
        onLayout={(e: LayoutChangeEvent) => setBoardHeight(e.nativeEvent.layout.height)}
      >
        {gameState && (
          <SortBoard
            // Force a fresh SortBoard instance (and thus fresh layout-position
            // refs) on every level change. handleNextLevel advances levels
            // without unmounting SortBoard, so without this key a pour made
            // before the new grid's onLayout events land could compute its
            // ghost/highlight/stream from the previous level's stale bottle
            // positions — see #2297. Defense in depth alongside the ref-reset
            // effect inside SortBoard itself.
            key={currentLevelId}
            state={gameState}
            colorblindMode={colorblindMode}
            onBottleTap={handleBottleTap}
            pouringFrom={pouringFrom}
            pouringTo={pouringTo}
            availableHeight={boardHeight}
            pourHoldMs={pourHoldMs}
            onPourComplete={handlePourComplete}
          />
        )}
      </View>

      {/* Colorblind toggle */}
      <Pressable
        onPress={() => setColorblindMode((m) => !m)}
        style={styles.colorblindToggle}
        accessibilityRole="switch"
        accessibilityLabel={t("action.colorblindToggle")}
        accessibilityState={{ checked: colorblindMode }}
        // RN Web 0.21 drops accessibilityState; aria-checked reaches the DOM.
        aria-checked={colorblindMode}
      >
        <Text style={[styles.colorblindToggleText, { color: colors.textMuted }]}>
          {t("settings.colorblindMode")}
        </Text>
      </Pressable>

      {gameState !== null && currentLevelId !== null ? (
        <GameResultModal
          visible={showWinModal}
          outcome="win"
          eyebrow={`${t("game.title")} · ${t("hud.level", { level: currentLevelId })}`}
          hero={{ kind: "score", label: tResult("stat.moves"), value: gameState.moveCount }}
          isNewBest={winSummary?.isNewBest ?? false}
          stats={[
            { label: tResult("stat.undos"), value: gameState.undosUsed },
            ...(winSummary ? [{ label: tResult("stat.best"), value: winSummary.best }] : []),
          ]}
          submission={{
            status: leaderboardSubmit.status,
            rank: leaderboardSubmit.rank,
            isBest: leaderboardSubmit.isBest,
            playerName: leaderboardSubmit.playerName,
            onProvideName: leaderboardSubmit.provideName,
            onRetry: leaderboardSubmit.retry,
          }}
          onViewLeaderboard={openLeaderboard}
          // The next level when there is one; the last level replays.
          primaryAction={
            levels.some((l) => l.id === currentLevelId + 1)
              ? { label: tResult("action.nextLevel"), onPress: handleNextLevel }
              : undefined
          }
          onPlayAgain={() => handleSelectLevel(currentLevelId)}
          secondaryAction={{ label: tResult("action.changeLevel"), onPress: handleBackToSelect }}
          onHome={() => navigation.popToTop()}
          testID="sort-result"
        />
      ) : null}
    </GameShell>
  );
}

const styles = StyleSheet.create({
  offlineBannerWrap: { paddingHorizontal: 12, paddingTop: 4 },
  headerBtnRow: { flexDirection: "row", gap: 6 },
  hud: { paddingHorizontal: 12 },

  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  loadErrorText: { fontFamily: typography.body, fontSize: 13 },
  retryText: { fontFamily: typography.label, fontSize: 13, textDecorationLine: "underline" },
  boardContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },

  colorblindToggle: { alignItems: "center", paddingVertical: 8 },
  colorblindToggleText: { fontFamily: typography.body, fontSize: 11 },

  // Win modal
});
