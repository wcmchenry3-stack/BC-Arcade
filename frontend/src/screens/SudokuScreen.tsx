/**
 * SudokuScreen — playable Sudoku with full lifecycle wiring.
 *
 * Layers:
 *   1. Pure engine from #616 + components from #617 (screen from #618).
 *   2. Persistence (#619) — AsyncStorage save after every mutation so a
 *      backgrounded or force-killed app resumes at the exact puzzle
 *      state; cleared on New Puzzle / Change Difficulty.
 *   3. Instrumentation (#619) — `useGameSync("sudoku")` session started
 *      on the first `enterDigit`, completed on win, and otherwise
 *      abandoned by the hook on unmount (back-navigation included) with
 *      its progress snapshot and no score (#2632).
 *   4. Result + leaderboard (#2511) — the shared GameResultModal shows
 *      where the synced game ranks on its (difficulty, variant) board
 *      (`sessionBoardAdapter`, #2677).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";

import type { HomeStackParamList } from "../types/navigation";
import { useTheme } from "../theme/ThemeContext";
import { GameShell } from "../components/shared/GameShell";
import { bestOf } from "../game/_shared/bestOf";
import { useGameLeaderboard } from "../game/_shared/useGameLeaderboard";
import { usePauseWhileAway } from "../hooks/usePauseWhileAway";
import { HudStatRow } from "../components/shared/HudStatRow";
import { ElapsedText, createClockActivity } from "../components/shared/ElapsedText";
import { PillButton } from "../components/shared/PillButton";
import SudokuGrid from "../components/sudoku/SudokuGrid";
import NumberPad from "../components/sudoku/NumberPad";
import PreGame from "../components/sudoku/PreGame";
import NewGameModal from "../components/sudoku/NewGameModal";
import {
  enterDigit,
  eraseCell,
  loadPuzzle,
  selectCell,
  toggleNotesMode,
  undo,
} from "../game/sudoku/engine";
import type { CellValue, Difficulty, SudokuState, Variant } from "../game/sudoku/types";
import { DIFFICULTIES, variantConfig } from "../game/sudoku/types";
import { useSound } from "../game/_shared/useSound";
import { SUDOKU_SOUNDS } from "../game/sudoku/sounds";
import {
  clearGame,
  loadGame,
  saveGame,
  loadStats,
  saveStats,
  EMPTY_SUDOKU_STATS,
  type SudokuStats,
} from "../game/sudoku/storage";
import { useGameSync } from "../game/_shared/useGameSync";
import { useLastDifficulty } from "../game/_shared/lastDifficulty";
import GameResultModal from "../components/shared/GameResultModal";
import { toSubmission } from "../components/shared/toSubmission";

const FLASH_MS = 200;
const DIFFICULTY_BASE: Record<Difficulty, number> = {
  easy: 100,
  medium: 200,
  hard: 300,
};

function computeScore(difficulty: Difficulty, errors: number): number {
  return Math.max(0, DIFFICULTY_BASE[difficulty] - errors * 10);
}

function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export default function SudokuScreen() {
  const { t } = useTranslation("sudoku");
  const { t: tResult } = useTranslation("result");
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();

  // Opens on the difficulty of the last puzzle started (#1129).
  const { difficulty, setDifficulty, rememberDifficulty } = useLastDifficulty<Difficulty>(
    "sudoku",
    DIFFICULTIES,
    "easy"
  );
  const [variant, setVariant] = useState<Variant>("classic");
  const [state, setState] = useState<SudokuState | null>(null);
  // Bumped when a puzzle starts over, so the HUD clock shows 00:00 at once.
  const [clockEpoch, setClockEpoch] = useState(0);
  // Whether the clock is advancing (started, not paused). It lives outside
  // React state: the first move, a pause and a resume reach the HUD's
  // `ElapsedText` without re-rendering the screen, grid and pad (#2964).
  const [clockActivity] = useState(createClockActivity);
  const [loading, setLoading] = useState(true);
  const [newGameModalVisible, setNewGameModalVisible] = useState(false);
  // What the result card shows, captured when the puzzle is solved.
  const [result, setResult] = useState<{
    /** Null when the clock gave no usable time (the device clock stepped back). */
    elapsedS: number | null;
    bestTimeS: number;
    isNewBest: boolean;
  } | null>(null);
  // The card's rank line, and its "View leaderboard" link and the ⋯ menu item
  // (#2633), which open the board of the puzzle on screen, else of the picker's.
  const { leaderboard, openLeaderboard } = useGameLeaderboard("sudoku", navigation, {
    difficulty: state?.difficulty ?? difficulty,
    variant: state?.variant ?? variant,
  });
  const { submit: submitScore, reset: resetScore } = leaderboard;

  // Timer bookkeeping.  `startMs` is the wall-clock at which play began,
  // shifted forward while the app sits in the background so elapsed
  // reads as "time actively spent playing." null = no input yet.
  const startMsRef = useRef<number | null>(null);
  const pausedAtRef = useRef<number | null>(null);

  // Lifecycle refs.  `hasLoadedRef` gates saves so a fresh puzzle can't
  // clobber a resumable save still being read off disk.
  const hasLoadedRef = useRef(false);
  const stateRef = useRef<SudokuState | null>(null);
  const prevCompleteRef = useRef(false);

  // The device's cached best time per puzzle kind (`sudoku_stats_v1`), for the
  // result card's best time and "New best" badge only (#2636): the player's
  // history is the Stats screen, fed by the server.
  const statsRef = useRef<SudokuStats>(EMPTY_SUDOKU_STATS);

  const flashOpacity = useRef(new Animated.Value(0)).current;
  const unitFlashOpacity = useRef(new Animated.Value(0)).current;
  const isComplete = state?.isComplete ?? false;

  const { play: playPuzzleComplete } = useSound("sudoku.puzzleComplete", SUDOKU_SOUNDS);

  const {
    start: syncStart,
    restart: syncRestart,
    close: syncClose,
    resume: syncResume,
    markStarted: syncMarkStarted,
    complete: syncComplete,
    getGameId: syncGetGameId,
    setProgressSnapshot: syncSetProgressSnapshot,
  } = useGameSync("sudoku");

  // #2450 / #2619 — the abandon result block (backend SudokuResult), sent by
  // the hook's own abandon (unmount). Back-navigation needs nothing more: the
  // screen unmounts, and that abandon carries no score (#2632).
  const progressResult = useCallback(
    () => ({ won: false, errors: stateRef.current?.errorCount ?? 0 }),
    []
  );
  // The puzzle's own play timer (#2684), which wins over the hook's foreground
  // clock: time since the first input, with backgrounded time taken out (the
  // start moves forward on resume, and a pause in progress stops the count).
  const playedMs = useCallback((): number | null => {
    if (startMsRef.current === null) return null;
    // Raw, so a wall clock that stepped back after a resume shows as a negative
    // time: a completion then records no duration (below). The HUD clamps it.
    return (pausedAtRef.current ?? Date.now()) - startMsRef.current;
  }, []);
  const syncClockActivity = useCallback(() => {
    clockActivity.set(startMsRef.current !== null && pausedAtRef.current === null);
  }, [clockActivity]);
  useEffect(() => {
    syncSetProgressSnapshot(() => ({ result: progressResult(), durationMs: playedMs() }));
  }, [syncSetProgressSnapshot, progressResult, playedMs]);

  // Pause on background or blur, resume once neither holds it. Two
  // independent reasons (#2735: a pushed Stats/Leaderboard/Scoreboard screen,
  // alongside the app itself backgrounding) can overlap, so the timer only
  // actually resumes once both have cleared: usePauseWhileAway tracks both.
  const pauseTimer = useCallback(() => {
    if (startMsRef.current === null || isComplete || pausedAtRef.current !== null) return;
    pausedAtRef.current = Date.now();
    syncClockActivity();
  }, [isComplete, syncClockActivity]);
  const resumeTimer = useCallback(() => {
    if (pausedAtRef.current === null || startMsRef.current === null) return;
    startMsRef.current += Date.now() - pausedAtRef.current;
    pausedAtRef.current = null;
    syncClockActivity();
  }, [syncClockActivity]);
  const awayRef = usePauseWhileAway(navigation, pauseTimer, resumeTimer);

  // Mount load — restores a saved game silently; on a clean slot the
  // pre-game picker shows.
  useEffect(() => {
    let alive = true;
    Promise.all([loadGame(), loadStats()])
      .then(([saved, savedStats]) => {
        if (!alive) return;
        statsRef.current = savedStats;
        hasLoadedRef.current = true;
        if (saved !== null) {
          setState(saved);
          setDifficulty(saved.difficulty);
          setVariant(saved.variant);
          // A restored game continues the session a killed app left open
          // (#2654) — only one for the same puzzle settings, so a restore never
          // adopts another difficulty's or variant's session.
          if (!saved.isComplete) {
            syncResume({ difficulty: saved.difficulty, variant: saved.variant });
          }
          // Treat any resumed state that already has moves as "timer
          // already started" — the player wants to see it ticking
          // immediately on return.  Elapsed resets to 0 because we
          // don't persist it; this is intentional per the issue.
          const anyMoves =
            saved.errorCount > 0 ||
            saved.undoStack.length > 0 ||
            saved.grid.some((row) => row.some((c) => !c.given && c.value !== 0));
          if (anyMoves) {
            startMsRef.current = Date.now();
            // A load that lands while the player is away (#2750) starts
            // paused, and resumes with everything else on return.
            if (awayRef.current) pausedAtRef.current = startMsRef.current;
          }
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [syncResume, setDifficulty, awayRef]);

  // Persist on every state change after the initial load has resolved.
  // Suppressed pre-load to protect the disk copy; `state === null`
  // represents pre-game and is handled by `clearGame` in the callers.
  useEffect(() => {
    stateRef.current = state;
    if (!hasLoadedRef.current) return;
    if (state === null) return;
    saveGame(state).catch(() => {});
  }, [state]);

  // A move, a load or a new puzzle can start or clear the clock (inside state
  // updaters and handlers, which only touch the refs): tell the HUD.
  useEffect(() => {
    syncClockActivity();
  }, [state, syncClockActivity]);

  // The HUD's `ElapsedText` owns the clock's tick and reads `playedMs`, so the
  // HUD always shows the time the game reports (pauses taken out), and the
  // screen, grid and pad do not re-render as time passes (#2964).
  const elapsedA11yLabel = useCallback((time: string) => t("hud.elapsed", { time }), [t]);

  // Complete the gameSync session exactly once on the completion
  // transition; clear the saved game so the next mount starts fresh.
  useEffect(() => {
    if (state === null) {
      prevCompleteRef.current = false;
      return;
    }
    if (state.isComplete && !prevCompleteRef.current) {
      const score = computeScore(state.difficulty, state.errorCount);
      // A time is usable only when positive: a device clock that stepped back
      // after a resume cannot make a 00:00 solve, a "New best", or a best of 0
      // (which is also the "no best yet" mark). Then the duration is unknown.
      const playedS = Math.floor((playedMs() ?? 0) / 1000);
      const finalElapsed = playedS > 0 ? playedS : null;
      const gid = syncComplete(
        {
          finalScore: score,
          outcome: "completed",
          durationMs: finalElapsed === null ? null : finalElapsed * 1000,
          result: { won: true, errors: state.errorCount },
        },
        {
          final_score: score,
          outcome: "completed",
          won: true,
          difficulty: state.difficulty,
          variant: state.variant,
          errors: state.errorCount,
        }
      );
      if (gid) {
        // The card shows where this game ranks on its board.
        void submitScore({ gameId: gid });
      }
      clearGame().catch(() => {});

      const diff = state.difficulty;
      const variantKey = state.variant;
      const prev = statsRef.current[variantKey][diff];
      const outcome = finalElapsed !== null ? bestOf(prev.bestTimeS, finalElapsed, true) : null;
      const improved = outcome?.improved ?? false;
      // The cache is written only when this puzzle kind's best improves.
      if (improved) {
        statsRef.current = {
          ...statsRef.current,
          [variantKey]: { ...statsRef.current[variantKey], [diff]: { bestTimeS: finalElapsed } },
        };
        saveStats(statsRef.current).catch(() => {});
      }
      setResult({
        elapsedS: finalElapsed,
        bestTimeS: outcome?.best ?? prev.bestTimeS,
        isNewBest: outcome?.isNewBest ?? false,
      });
    }
    prevCompleteRef.current = state.isComplete;
  }, [state, syncComplete, submitScore, playedMs]);

  const ensureSyncStarted = useCallback(
    (next: SudokuState) => {
      // A new puzzle opened its session already (`openPuzzleSession`); a
      // restored one whose session couldn't be resumed opens one now.
      if (!syncGetGameId()) {
        const settings = { difficulty: next.difficulty, variant: next.variant };
        syncStart(settings, settings);
      }
      syncMarkStarted();
    },
    [syncGetGameId, syncStart, syncMarkStarted]
  );

  /**
   * #2690: every new puzzle gets its own session, with its own difficulty and
   * variant. The restart closes whatever is still open (abandoned with the
   * snapshot if the player started it, discarded if not) while `stateRef`
   * still holds the old puzzle; the new session is sent on the first digit.
   */
  const openPuzzleSession = useCallback(
    (fresh: SudokuState) => {
      const settings = { difficulty: fresh.difficulty, variant: fresh.variant };
      syncRestart(settings, settings);
    },
    [syncRestart]
  );

  const flashError = useCallback(() => {
    Animated.sequence([
      Animated.timing(flashOpacity, {
        toValue: 0.3,
        duration: 80,
        useNativeDriver: true,
      }),
      Animated.timing(flashOpacity, {
        toValue: 0,
        duration: FLASH_MS - 80,
        useNativeDriver: true,
      }),
    ]).start();
  }, [flashOpacity]);

  useEffect(() => {
    const evts = state?.events;
    if (!evts?.length) return;
    for (const evt of evts) {
      if (evt.type === "errorEntered") {
        flashError();
      } else if (evt.type === "unitComplete") {
        Animated.sequence([
          Animated.timing(unitFlashOpacity, { toValue: 0.35, duration: 80, useNativeDriver: true }),
          Animated.timing(unitFlashOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
        ]).start();
      } else if (evt.type === "puzzleComplete") {
        playPuzzleComplete();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.events]);

  const handleStart = useCallback(() => {
    clearGame().catch(() => {});
    const fresh = loadPuzzle(rememberDifficulty(difficulty), variant);
    openPuzzleSession(fresh);
    setState(fresh);
    setClockEpoch((n) => n + 1);
    setResult(null);
    resetScore();
    startMsRef.current = null;
    pausedAtRef.current = null;
  }, [difficulty, variant, resetScore, rememberDifficulty, openPuzzleSession]);

  const handleStartWithSettings = useCallback(
    (d: Difficulty, v: Variant) => {
      setNewGameModalVisible(false);
      setVariant(v);
      clearGame().catch(() => {});
      // A premium level starts at the default instead (#1129).
      const fresh = loadPuzzle(rememberDifficulty(d), v);
      openPuzzleSession(fresh);
      setState(fresh);
      setClockEpoch((n) => n + 1);
      setResult(null);
      resetScore();
      startMsRef.current = null;
      pausedAtRef.current = null;
    },
    [resetScore, rememberDifficulty, openPuzzleSession]
  );

  const handleNewGameRequest = useCallback(() => {
    setNewGameModalVisible(true);
  }, []);

  const handleCellPress = useCallback((row: number, col: number) => {
    setState((s) => (s ? selectCell(s, row, col) : s));
  }, []);

  const handleDigit = useCallback(
    (digit: CellValue) => {
      setState((s) => {
        if (!s) return s;
        const next = enterDigit(s, digit);
        if (next === s) return s;

        // Timer + session start on the first input that actually
        // changes state.
        if (startMsRef.current === null) startMsRef.current = Date.now();
        ensureSyncStarted(next);

        return next;
      });
    },
    [ensureSyncStarted]
  );

  const handleErase = useCallback(() => {
    setState((s) => (s ? eraseCell(s) : s));
  }, []);

  const handleToggleNotes = useCallback(() => {
    setState((s) => (s ? toggleNotesMode(s) : s));
  }, []);

  const handleUndo = useCallback(() => {
    setState((s) => (s ? undo(s) : s));
  }, []);

  const handleChangeDifficulty = useCallback(() => {
    // #2690: close this puzzle's session now, while the snapshot still reads
    // it (abandoned if started, discarded if not). The next puzzle opens its own.
    syncClose();
    clearGame().catch(() => {});
    setState(null);
    setClockEpoch((n) => n + 1);
    setResult(null);
    resetScore();
    startMsRef.current = null;
    pausedAtRef.current = null;
  }, [resetScore, syncClose]);

  const handleHint = useCallback(() => {
    setState((s) => {
      if (!s || s.selectedRow === null || s.selectedCol === null) return s;
      const cell = s.grid[s.selectedRow]?.[s.selectedCol];
      if (!cell || cell.given || cell.value !== 0) return s;
      const { size } = variantConfig(s.variant);
      const idx = s.selectedRow * size + s.selectedCol;
      const hintDigit = (s.solution.charCodeAt(idx) - 48) as CellValue;
      if (startMsRef.current === null) startMsRef.current = Date.now();
      ensureSyncStarted(s);
      return enterDigit(s, hintDigit);
    });
  }, [ensureSyncStarted]);

  const headerRight = useMemo(() => {
    if (!state) return null;
    return (
      <PillButton
        label={t("action.undo")}
        onPress={handleUndo}
        disabled={state.undoStack.length === 0}
      />
    );
  }, [state, handleUndo, t]);

  return (
    <GameShell
      gameType="sudoku"
      title={t("game.title")}
      requireBack
      loading={loading}
      onNewGame={state !== null ? handleNewGameRequest : undefined}
      onOpenLeaderboard={openLeaderboard}
      rightSlot={headerRight}
      style={{ paddingBottom: Math.max(insets.bottom, 16) }}
    >
      {state === null ? (
        <PreGame
          difficulty={difficulty}
          onChange={setDifficulty}
          variant={variant}
          onVariantChange={setVariant}
          onStart={handleStart}
        />
      ) : (
        <View style={styles.body}>
          <HudStatRow
            style={styles.hudTight}
            stats={[
              { key: "difficulty", text: t(`difficulty.${state.difficulty}`) },
              {
                key: "errors",
                text:
                  state.errorCount === 1
                    ? t("hud.errorsOne")
                    : t("hud.errors", { count: state.errorCount }),
                muted: true,
              },
              {
                key: "elapsed",
                muted: true,
                render: (textStyle) => (
                  <ElapsedText
                    getElapsedMs={playedMs}
                    running={!isComplete}
                    activity={clockActivity}
                    frozenS={result?.elapsedS ?? null}
                    resetKey={clockEpoch}
                    format={formatElapsed}
                    accessibilityLabel={elapsedA11yLabel}
                    style={textStyle}
                  />
                ),
              },
            ]}
          />

          <View style={styles.gridWrap}>
            <SudokuGrid
              grid={state.grid}
              selectedRow={state.selectedRow}
              selectedCol={state.selectedCol}
              variant={state.variant}
              onCellPress={handleCellPress}
            />
          </View>

          <View
            style={[styles.gridPadDivider, { backgroundColor: colors.border }]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />

          <View style={styles.padWrap}>
            <NumberPad
              grid={state.grid}
              variant={state.variant}
              notesMode={state.notesMode}
              onDigit={handleDigit}
              onErase={handleErase}
              onToggleNotes={handleToggleNotes}
              onHint={handleHint}
            />
          </View>

          <Animated.View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: colors.error, opacity: flashOpacity },
            ]}
            testID="sudoku-invalid-flash"
          />
          <Animated.View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: "#2ecc71", opacity: unitFlashOpacity },
            ]}
            testID="sudoku-unit-flash"
          />
        </View>
      )}

      {state !== null ? (
        <GameResultModal
          visible={isComplete}
          outcome="win"
          eyebrow={`${t("game.title")} · ${t(`difficulty.${state.difficulty}`)}`}
          subtitle={t(`variant.${state.variant}`)}
          hero={
            result !== null && result.elapsedS === null
              ? undefined
              : {
                  kind: "score",
                  label: tResult("stat.time"),
                  value: formatElapsed(result?.elapsedS ?? 0),
                }
          }
          isNewBest={result?.isNewBest ?? false}
          stats={[
            {
              label: tResult("stat.score"),
              value: computeScore(state.difficulty, state.errorCount),
            },
            { label: tResult("stat.errors"), value: state.errorCount },
            ...(result && result.bestTimeS > 0
              ? [{ label: tResult("stat.best"), value: formatElapsed(result.bestTimeS) }]
              : []),
          ]}
          submission={toSubmission(leaderboard)}
          onViewLeaderboard={openLeaderboard}
          onPlayAgain={handleStart}
          secondaryAction={{ label: t("action.changeDifficulty"), onPress: handleChangeDifficulty }}
          onHome={() => navigation.popToTop()}
          testID="sudoku-result"
        />
      ) : null}

      {newGameModalVisible ? (
        <NewGameModal
          currentDifficulty={difficulty}
          currentVariant={variant}
          onQuickRestart={() => handleStartWithSettings(difficulty, variant)}
          onStart={handleStartWithSettings}
        />
      ) : null}
    </GameShell>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  body: {
    flex: 1,
    gap: 12,
  },
  // Sudoku's grid fills the height, so its HUD keeps the tighter padding.
  hudTight: {
    paddingVertical: 4,
  },
  gridWrap: {
    alignSelf: "stretch",
  },
  gridPadDivider: {
    alignSelf: "stretch",
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 4,
  },
  padWrap: {
    flex: 1,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
  },
});
