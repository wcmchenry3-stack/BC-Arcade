/**
 * SortScreen — the ball-sort puzzle: a level grid, then one level at a time.
 *
 * Concerns:
 *   1. Data — `useSortLevels` (#2981) owns the view (`loading | select |
 *      play`), the level definitions (the fixed catalog shipped in the app,
 *      #2761) and the player's progress. The stored best moves load with it
 *      and merge into `bestMovesRef`.
 *   2. Game logic — taps go to the pure engine (`isValidPour`, `applyPour`,
 *      `undo`); Hint asks the solver (only on tap, #2768) and drops its answer
 *      once the board has changed (`levelGenRef`). A dead board gets a notice
 *      with "Back to last good move" and "Restart level".
 *   3. Pour animation — `usePourAnimation` (#2981) holds the one pour in
 *      flight (`pour: { from, to, holdMs } | null`); its move lands when
 *      SortBoard's animation ends, or on a timer under Reduce Motion. A
 *      reset, level change or back-navigation cancels it (#2297).
 *   4. Persistence — the in-play board is saved on every change and on app
 *      background; a solve unlocks the next level.
 *   5. Instrumentation — one `useGameSync("sort")` session per level played,
 *      opened at the first pour, completed on a solve with the player's
 *      standing (#2625, #2746) and abandoned otherwise (#2619).
 *   6. Result (#2512) — the shared GameResultModal with the level's best
 *      moves (a new best only once a prior best exists) and the synced
 *      game's rank (#2633). A solve is handled on a `useCompletionTransition`
 *      edge (#3109).
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";

import type { HomeStackParamList } from "../types/navigation";
import { usePauseWhileAway } from "../hooks/usePauseWhileAway";
import { useTheme } from "../theme/ThemeContext";
import { typography } from "../theme/typography";
import {
  applyPour,
  initState,
  isValidPour,
  pourUnits,
  undo as undoState,
} from "../game/sort/engine";
import { solveBoardAsync } from "../game/sort/solver";
import type { Color, SortState } from "../game/sort/types";
import SortBoard, { POUR_PER_UNIT_MS } from "../components/sort/SortBoard";
import { TILT_IN_MS, TILT_HOLD_MS, TILT_OUT_MS } from "../components/sort/BottleView";
import HintNotice, { type HintNoticeKind } from "../components/sort/HintNotice";
import LevelSelectScreen from "../components/sort/LevelSelectScreen";
import { BOARD_PADDING } from "../components/sort/gridGeometry";
import {
  applyLevelSolve,
  highestSolvedLevel,
  mergeBestMoves,
  saveBestMoves,
  saveProgress,
  totalBestMoves,
  type BestMoves,
  type SortProgress,
} from "../game/sort/storage";
import { usePourAnimation, type Pour } from "../game/sort/usePourAnimation";
import { useSortLevels } from "../game/sort/useSortLevels";
import { SORT_CATALOG_VERSION } from "../game/sort/catalog";
import { ConnectedOfflineBanner } from "../components/shared/OfflineBanner";
import { GameShell } from "../components/shared/GameShell";
import { useGameLeaderboard } from "../game/_shared/useGameLeaderboard";
import { useCompletionTransition } from "../game/_shared/useCompletionTransition";
import { HudStatRow } from "../components/shared/HudStatRow";
import { PillButton } from "../components/shared/PillButton";
import { useSortAudio } from "../game/sort/useSortAudio";
import GameResultModal from "../components/shared/GameResultModal";
import { toSubmission } from "../components/shared/toSubmission";
import { useGameSync } from "../game/_shared/useGameSync";
import { useReduceMotion } from "../components/shared/useReduceMotion";

/** "Back to last good move" stops solving after this many solves or ms. */
const UNDO_SEARCH_MAX_SOLVES = 24;
const UNDO_SEARCH_MAX_MS = 8000;

/** Sort has no clock to pause: it only saves on the way out (`onLeave`). */
const noop = () => {};

/** SortBoard's pour props for the pour in flight, or none. */
function boardPourProps(pour: Pour | null) {
  return {
    pouringFrom: pour?.from ?? null,
    pouringTo: pour?.to ?? null,
    pourHoldMs: pour?.holdMs ?? POUR_PER_UNIT_MS,
  };
}

export default function SortScreen() {
  const { t } = useTranslation("sort");
  const { t: tResult } = useTranslation("result");
  const { colors } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();

  /**
   * The best moves per level: the one source of truth for every solve's card
   * and score, so the session completes before the player can move on.
   * Loaded (merged) from `@sort/best_moves` with the screen; storage mirrors it.
   */
  const bestMovesRef = useRef<BestMoves>({});
  /** Storage was read, so writing `bestMovesRef` can't lose a stored best. */
  const bestsStoredRef = useRef(false);
  const adoptStoredBests = useCallback((stored: BestMoves) => {
    // Merge, never replace: a Retry must keep a best still only in memory
    // (its write failed, or storage couldn't be read before).
    const merged = mergeBestMoves(bestMovesRef.current, stored);
    bestMovesRef.current = merged;
    bestsStoredRef.current = true;
    if (Object.entries(merged).some(([level, moves]) => stored[level] !== moves)) {
      void saveBestMoves(merged);
    }
  }, []);

  // Top-level view, the catalog's levels and the progress (loaded on mount)
  const { view, setView, levels, progress, setProgress } = useSortLevels({
    onStoredBests: adoptStoredBests,
  });

  // Active game
  const [currentLevelId, setCurrentLevelId] = useState<number | null>(null);
  const [gameState, setGameState] = useState<SortState | null>(null);
  const [history, setHistory] = useState<readonly SortState[]>([]);
  const [colorblindMode, setColorblindMode] = useState(false);

  const [boardHeight, setBoardHeight] = useState(0);
  const reduceMotion = useReduceMotion();
  const audio = useSortAudio();

  // The pour in flight (#2981). Its move lands when the animation ends, on
  // the board it was made on.
  const landPour = useCallback(
    (snapshot: SortState, from: number, to: number) => {
      const nextState = applyPour(snapshot, from, to);
      setGameState(nextState);
      if (nextState.isComplete) {
        audio.playWin();
      }
    },
    [audio]
  );
  const {
    pour,
    start: startPour,
    complete: completePour,
    cancel: cancelPour,
  } = usePourAnimation<SortState>({
    reduceMotion,
    // Reduce Motion: BottleView only tilts, with no ghost overlay, so SortBoard
    // never calls onPourComplete; the hook lands the pour on this timer.
    reduceMotionMs: TILT_IN_MS + TILT_HOLD_MS + TILT_OUT_MS + 50,
    onLand: landPour,
  });
  const isPouring = pour !== null;

  // Result card (#2512)
  const [showWinModal, setShowWinModal] = useState(false);
  /** The solved level's best (fewest) moves, including this solve. */
  const [winSummary, setWinSummary] = useState<{ best: number; isNewBest: boolean } | null>(null);
  // The card's rank line, "View leaderboard" link and ⋯ menu item (#2633).
  const { leaderboard, openLeaderboard } = useGameLeaderboard("sort", navigation);
  const { lookup: lookupRank, reset: resetSubmission } = leaderboard;

  // One `games` row per level played (#2512): XP, Profile history, stats and
  // the leaderboard (#2625). Every solve, replays included, is scored with the
  // player's standing after it (see the solve effect); the board keeps each
  // named player's best row. The levels are the fixed catalog (#2761), the
  // same for everyone, so a tie on level goes to fewer `total_moves`; only
  // solves sent with the current `catalog_version` rank.
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
  /**
   * Bumped whenever the board changes under the player (a level change, a
   * restart, a pour or an undo), so a hint or a search back through the
   * history that finished for an older board is dropped.
   */
  const levelGenRef = useRef(0);

  /** A Hint (or the search back to the last good move) is running. */
  const [isHinting, setIsHinting] = useState(false);
  /** The notice in the play area after a Hint with no pour to offer (#2768). */
  const [hintNotice, setHintNotice] = useState<{
    kind: HintNoticeKind;
    /** Per Hint tap, so a repeat of the same notice is announced again. */
    seq: number;
    /** False once a search found no winnable board in the history. */
    undoable: boolean;
  } | null>(null);
  const hintSeqRef = useRef(0);
  const showHintNotice = (kind: HintNoticeKind, undoable = true) =>
    setHintNotice({ kind, seq: ++hintSeqRef.current, undoable });

  /**
   * The board changed under the player (a pour or an undo): drop any answer
   * still being computed for the old board, and the notice about it. Hint is
   * free to run again at once.
   */
  function boardChanged() {
    levelGenRef.current += 1;
    setHintNotice(null);
    setIsHinting(false);
  }

  const progressRef = useRef(progress);
  progressRef.current = progress;

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

  // Save on app background: each move of the app to "background" or
  // "inactive" (not a blur — the board is saved on every change anyway, and
  // nothing here pauses). The handler reads this render's board.
  usePauseWhileAway(navigation, noop, noop, {
    onLeave: (event) => {
      if (event.reason !== "appState") return;
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
    },
  });

  // Unlock the next level, complete the session and show the result card as
  // soon as the puzzle is solved. Nothing here waits on the network or on
  // storage, so Next Level is available at once.
  //
  // The edge (useCompletionTransition, #3109) is a solved board whose card is
  // not up, so it keeps the screen's own timing: it fires on the solve, and
  // again whenever the card is closed while the solved board is still in state
  // (Change Level). The plain-function form has no once-per-game guard, since
  // every solve is scored, replays included. Nothing is cleared: a solve saves
  // progress (the save effect above has already dropped the solved board).
  // Sort never restores a solved board (only an unfinished one is saved), so
  // there is nothing to mark with `markRestoredComplete`.
  useCompletionTransition(gameState, !!gameState?.isComplete && !showWinModal, (solved) => {
    setShowWinModal(true);
    if (currentLevelId === null) return;
    const solvedLevel = currentLevelId;
    const moves = solved.moveCount;
    // Decided now, from the bests in memory, so the session completes before
    // the player can leave the card (#2625).
    const { solve, bests } = applyLevelSolve(bestMovesRef.current, solvedLevel, moves);
    bestMovesRef.current = bests;
    setWinSummary(solve);
    // Storage mirrors memory; skipped while it couldn't be read, so a failed
    // read never overwrites the stored bests.
    if (solve.improved && bestsStoredRef.current) void saveBestMoves(bests);
    // Every solve is scored with the player's standing after it (#2625): the
    // highest level solved, and the sum of best moves up to it (the
    // tie-break, #2761), from this catalog. The board keeps each player's
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
      undos: solved.undosUsed,
      level_reached: frontier,
      catalog_version: SORT_CATALOG_VERSION,
    };
    const totalMoves = totalBestMoves(bests, frontier);
    if (totalMoves !== null) result.total_moves = totalMoves;
    const gameId = syncComplete(
      { outcome: "completed", finalScore: frontier, result },
      { outcome: "completed", ...result }
    );
    // The row ranks by itself under the player's name (#2624): the card
    // only asks where it landed, or for a name if there is none.
    if (gameId) void lookupRank(gameId);
    const newUnlocked = Math.min(
      Math.max(progressRef.current.unlockedLevel, solvedLevel + 1),
      levels.length || solvedLevel + 1
    );
    const updated: SortProgress = {
      ...progressRef.current,
      unlockedLevel: newUnlocked,
      currentLevelId: null,
      currentState: null,
    };
    setProgress(updated);
    void saveProgress(updated);
  });

  // ---------------------------------------------------------------------------
  // Game handlers
  // ---------------------------------------------------------------------------

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
      // The move lands when the animation ends (usePourAnimation).
      if (!startPour(snapshot, selectedBottleIndex, index, POUR_PER_UNIT_MS * units)) return;
      if (!syncGetGameId()) {
        syncStart({ level: currentLevelId });
        syncMarkStarted();
      }
      boardChanged();
      setHistory((h) => [...h, snapshot]);
      setGameState({ ...gameState, selectedBottleIndex: null });
      audio.playPour();
    } else {
      setGameState({ ...gameState, selectedBottleIndex: null });
    }
  }

  function handleUndo() {
    if (!gameState || isPouring) return;
    const { state: newState, history: newHistory } = undoState(gameState, history);
    boardChanged();
    setGameState(newState);
    setHistory(newHistory);
  }

  async function handleHint() {
    if (!gameState || gameState.isComplete || isPouring || isHinting) return;
    setIsHinting(true);
    const gen = levelGenRef.current;
    try {
      const result = await solveBoardAsync(gameState);
      // Drop an answer for a board the player has since restarted, left, or
      // poured on.
      if (gen !== levelGenRef.current) return;
      if (result.verdict === "solvable") {
        setHintNotice(null);
        const first = result.moves[0];
        if (first) {
          setGameState((cur) =>
            cur && !cur.isComplete ? { ...cur, selectedBottleIndex: first.from } : cur
          );
        }
      } else {
        showHintNotice(result.verdict === "unsolvable" ? "dead" : "unknown");
      }
    } finally {
      // A newer search may own the busy flag once the board has changed.
      if (gen === levelGenRef.current) setIsHinting(false);
    }
  }

  /**
   * Steps back through the history to the newest board the solver proves
   * solvable, each step an undo (`undosUsed` counts them) (#2768). Once a board
   * is dead every later one is too, so this binary-searches the history
   * (about log2 n solves) instead of solving every state. Only "solvable"
   * counts; "unknown" is treated as not winnable. The oldest state is solved
   * too: a restored board has no level start behind it. With nothing proven
   * solvable (or the solve cap spent) the board is left alone and the notice
   * offers Restart only.
   */
  async function handleBackToLastGoodMove() {
    if (!gameState || isPouring || isHinting || history.length === 0) return;
    setIsHinting(true);
    const gen = levelGenRef.current;
    const board = gameState;
    const past = history;
    try {
      const startedAt = Date.now();
      let solves = 0;
      const winnable = async (i: number): Promise<boolean | null> => {
        if (solves >= UNDO_SEARCH_MAX_SOLVES || Date.now() - startedAt > UNDO_SEARCH_MAX_MS) {
          return null; // out of budget
        }
        solves += 1;
        const result = await solveBoardAsync(past[i]!);
        return result.verdict === "solvable";
      };
      let lo = -1; // newest index proven solvable
      if (await winnable(0)) {
        if (gen !== levelGenRef.current) return;
        lo = 0;
        let hi = past.length;
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          const ok = await winnable(mid);
          if (gen !== levelGenRef.current) return;
          if (ok === null) break;
          if (ok) lo = mid;
          else hi = mid;
        }
      }
      if (gen !== levelGenRef.current) return;
      if (lo < 0) {
        showHintNotice("dead", false);
        return;
      }
      let state = board;
      let rest = past;
      while (rest.length > lo) {
        ({ state, history: rest } = undoState(state, rest));
      }
      setHintNotice(null);
      setGameState(state);
      setHistory(rest);
    } finally {
      if (gen === levelGenRef.current) setIsHinting(false);
    }
  }

  /**
   * Leaves the board on screen: no pour from it may carry over to the next
   * board (#2297), neither its animation nor its pending move, and its open,
   * unfinished session is abandoned.
   */
  function leaveBoard() {
    setHintNotice(null);
    setIsHinting(false);
    cancelPour();
    abandonSession();
  }

  /** Shows a level's board (set just before) with no history and no result. */
  function enterPlay() {
    setHistory([]);
    setHintNotice(null);
    setIsHinting(false);
    setShowWinModal(false);
    setWinSummary(null);
    resetSubmission();
    setView("play");
  }

  function handleSelectLevel(levelId: number) {
    const level = levels.find((l) => l.id === levelId);
    if (!level) return;
    leaveBoard();
    // The level's play time starts now, though its session opens at the first
    // pour: the thinking time before that pour counts, and time on the level
    // grid or the previous level's result card does not (#2710).
    syncResetPlayWindow();
    levelGenRef.current += 1;
    setCurrentLevelId(levelId);
    setGameState(initState(level.bottles as (Color | "")[][]));
    enterPlay();
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
    enterPlay();
  }

  function handleBackToSelect() {
    leaveBoard();
    levelGenRef.current += 1;
    setView("select");
    setShowWinModal(false);
  }

  function handleResetLevel() {
    if (!currentLevelId) return;
    const level = levels.find((l) => l.id === currentLevelId);
    if (!level) return;
    // A pour whose animation is still finishing must not land on the fresh board.
    leaveBoard();
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
    return (
      <GameShell
        gameType="sort"
        key="loading"
        title={t("game.title")}
        onBack={null}
        gutter={null}
        loading
      />
    );
  }

  if (view === "select") {
    return (
      <GameShell
        gameType="sort"
        key="select"
        title={t("game.title")}
        requireBack
        onBack={() => navigation.goBack()}
        gutter={null}
        onOpenLeaderboard={openLeaderboard}
      >
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
      gameType="sort"
      key="play"
      title={t("game.title")}
      requireBack
      onBack={handleBackToSelect}
      gutter={null}
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
            {...boardPourProps(pour)}
            // onLayout reports the container's full height, padding included;
            // the board itself only gets the space inside the padding (#2207).
            availableHeight={Math.max(0, boardHeight - 2 * BOARD_PADDING)}
            onPourComplete={completePour}
          />
        )}
        {/* An overlay (absolute), so showing or dismissing it never resizes the
            board or moves its bottles (#2297). */}
        {hintNotice && (
          <HintNotice
            key={`hint-notice-${hintNotice.seq}`}
            kind={hintNotice.kind}
            onBackToLastGoodMove={
              hintNotice.undoable && history.length > 0
                ? () => void handleBackToLastGoodMove()
                : undefined
            }
            onRestart={handleResetLevel}
            busy={isHinting}
            onDismiss={() => setHintNotice(null)}
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
          submission={toSubmission(leaderboard)}
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

  boardContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: BOARD_PADDING,
  },

  colorblindToggle: { alignItems: "center", paddingVertical: 8 },
  colorblindToggleText: { fontFamily: typography.body, fontSize: 11 },
});
