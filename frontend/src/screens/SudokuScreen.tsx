/**
 * SudokuScreen — playable Sudoku with full lifecycle wiring.
 *
 * Layers:
 *   1. Pure engine from #616 + components from #617 (screen from #618).
 *   2. Persistence (#619) — `usePersistedGameState` (#3087) restores the
 *      save on mount and saves after every mutation, so a backgrounded or
 *      force-killed app resumes at the exact puzzle state; cleared on New
 *      Puzzle / Change Difficulty.
 *   3. Instrumentation (#619) — `useGameRecorder("sudoku")` (useGameSync + the
 *      shared recorder; every entry is recorded in chunks, #3288) session
 *      started on the first changing input, completed on win
 *      (`useCompletionTransition`, #3087), and otherwise
 *      abandoned by the hook on unmount (back-navigation included) with
 *      its progress snapshot and no score (#2632).
 *   4. Result + leaderboard (#2511) — the shared GameResultModal shows
 *      where the synced game ranks on its (difficulty, variant) board
 *      (`lookupGameRank`, #2677).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";

import type { HomeStackParamList } from "../types/navigation";
import { useTheme } from "../theme/ThemeContext";
import { GameShell } from "../components/shared/GameShell";
import { bestOf } from "../game/_shared/bestOf";
import { captureThrottledMessage } from "../game/_shared/sentryThrottle";
import { useCompletionTransition } from "../game/_shared/useCompletionTransition";
import { useGameEvents } from "../game/_shared/useGameEvents";
import { useGameLeaderboard } from "../game/_shared/useGameLeaderboard";
import { useGameRestored, usePersistedGameState } from "../game/_shared/usePersistedGameState";
import { usePauseWhileAway } from "../hooks/usePauseWhileAway";
import { HudStatRow } from "../components/shared/HudStatRow";
import { ElapsedText, createClockActivity } from "../components/shared/ElapsedText";
import { PillButton } from "../components/shared/PillButton";
import SudokuGrid from "../components/sudoku/SudokuGrid";
import NumberPad from "../components/sudoku/NumberPad";
import PreGame from "../components/sudoku/PreGame";
import NewGameModal from "../components/sudoku/NewGameModal";
import { isFullButWrong, loadPuzzle, selectCell, toggleNotesMode } from "../game/sudoku/engine";
import type { CellValue, Difficulty, SudokuState, Variant } from "../game/sudoku/types";
import { DIFFICULTIES } from "../game/sudoku/types";
import { useSound } from "../game/_shared/useSound";
import { SUDOKU_SOUNDS } from "../game/sudoku/sounds";
import {
  clearGame,
  loadGame,
  saveGame,
  loadStats,
  saveStats,
  loadShowMistakes,
  saveShowMistakes,
  EMPTY_SUDOKU_STATS,
  type SudokuStats,
} from "../game/sudoku/storage";
import { useGameRecorder } from "../game/_shared/useGameRecorder";
import { applyRecorded, createEntryLog, unitOfEntry, type EntryTuple } from "../game/sudoku/replay";
import { useLastDifficulty } from "../game/_shared/lastDifficulty";
import GameResultModal from "../components/shared/GameResultModal";
import { toSubmission } from "../components/shared/toSubmission";

const FLASH_MS = 200;

/**
 * Recording must never break play (#3288): a recorder call that throws is
 * reported once an hour per op (sentryThrottle) and the game goes on.
 */
function guardRecording(op: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    captureThrottledMessage(`sudoku.replay.${op}`, `sudoku replay recording failed (${op})`, {
      level: "warning",
      tags: { game_type: "sudoku", op },
      extra: { error: e instanceof Error ? e.message : "unknown" },
    });
  }
}
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
  // The device's cached best time per puzzle kind (`sudoku_stats_v1`), for the
  // result card's best time and "New best" badge only (#2636): the player's
  // history is the Stats screen, fed by the server.
  const statsRef = useRef<SudokuStats>(EMPTY_SUDOKU_STATS);
  // The saved puzzle (usePersistedGameState, #3087): loaded with the stats on
  // mount, then saved on every state change once that load has landed, so a
  // fresh puzzle can't clobber a resumable save still being read off disk.
  // `state === null` is pre-game: nothing is saved, and the callers clear
  // the save. Called before the completion effect, so a solving move is saved
  // before the completion clears it. The restore is below.
  const game = usePersistedGameState<SudokuState>({
    load: async () => {
      const [saved, savedStats] = await Promise.all([loadGame(), loadStats()]);
      statsRef.current = savedStats;
      return saved;
    },
    save: saveGame,
    clear: clearGame,
  });
  const { state, setState, stateRef, loading, clear: clearSavedGame } = game;
  // Bumped when a puzzle starts over, so the HUD clock shows 00:00 at once.
  const [clockEpoch, setClockEpoch] = useState(0);
  // The player's explicit "Show mistakes" choice (#2943), null until they make
  // one: the default is then by difficulty (on for easy only).
  const [showMistakesPref, setShowMistakesPref] = useState<boolean | null>(null);
  // False until the stored choice has been read: until then nothing is
  // coloured, so a stored "off" never flashes the easy default.
  const [showMistakesLoaded, setShowMistakesLoaded] = useState(false);
  const prefChosenRef = useRef(false);
  useEffect(() => {
    let alive = true;
    void loadShowMistakes().then((stored) => {
      if (!alive) return;
      if (!prefChosenRef.current) setShowMistakesPref(stored);
      setShowMistakesLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  const handleToggleShowMistakes = useCallback((value: boolean) => {
    prefChosenRef.current = true;
    setShowMistakesPref(value);
    setShowMistakesLoaded(true);
    void saveShowMistakes(value);
  }, []);
  // Whether the clock is advancing (started, not paused). It lives outside
  // React state: the first move, a pause and a resume reach the HUD's
  // `ElapsedText` without re-rendering the screen, grid and pad (#2964).
  const [clockActivity] = useState(createClockActivity);
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
  const { lookup: lookupRank, reset: resetScore } = leaderboard;

  // Timer bookkeeping.  `startMs` is the wall-clock at which play began,
  // shifted forward while the app sits in the background so elapsed
  // reads as "time actively spent playing." null = no input yet.
  const startMsRef = useRef<number | null>(null);
  const pausedAtRef = useRef<number | null>(null);

  const flashOpacity = useRef(new Animated.Value(0)).current;
  const unitFlashOpacity = useRef(new Animated.Value(0)).current;
  const isComplete = state?.isComplete ?? false;

  const { play: playPuzzleComplete } = useSound("sudoku.puzzleComplete", SUDOKU_SOUNDS);

  // The player's actions are recorded through the shared recorder (#3288):
  // `entryLog` collects them in memory and hands a chunk of ENTRIES_PER_CHUNK
  // over as one `entries` event and one recorder unit (docs/games/sudoku.md).
  // This effect is declared before `useGameRecorder`, so its cleanup runs first
  // on unmount (cleanups run in declaration order): the partial chunk reaches
  // the recorder before the recorder's own cleanup saves the session, ahead of
  // the abandon's `game_ended`.
  const flushEntriesRef = useRef<() => void>(() => undefined);
  useEffect(() => () => flushEntriesRef.current(), []);
  const {
    start: syncStart,
    restart: syncRestart,
    close: syncClose,
    resume: syncResume,
    markStarted: syncMarkStarted,
    complete: syncComplete,
    getGameId: syncGetGameId,
    setProgressSnapshot: syncSetProgressSnapshot,
    beginUnit,
    record: recordEvent,
    closeUnit,
    flush: flushRecorder,
  } = useGameRecorder("sudoku");
  const entryLog = useMemo(
    () =>
      createEntryLog((first, entries) => {
        // A unit is numbered by where its chunk starts, so a resumed game's
        // units go on from its saved entry count instead of repeating.
        guardRecording("emit", () => {
          beginUnit(unitOfEntry(first));
          recordEvent("entries", { i: first, e: entries });
          closeUnit();
        });
      }),
    [beginUnit, recordEvent, closeUnit]
  );
  const { flush: flushEntries, reset: resetEntries } = entryLog;
  useEffect(() => {
    flushEntriesRef.current = flushEntries;
  }, [flushEntries]);
  // The app leaves the foreground, or another screen covers the game: the
  // chunk in progress goes to the recorder, and the recorder hands its units to
  // the queue now (the storage write that follows is async): an idle hand-over
  // may never run before the OS kills the process.
  const saveReplayNow = useCallback(() => {
    flushEntries();
    guardRecording("flush", flushRecorder);
  }, [flushEntries, flushRecorder]);
  // True for a game whose replay could not be rebuilt from its first entry:
  // restored with moves from before recording (no `entryCount`), or restored
  // with moves whose session could not be resumed (the new session's events
  // start mid-game). Such a game records nothing (cost and data: a replay
  // that cannot be rebuilt is only bytes), and its save keeps no `entryCount`,
  // so a later restore skips it too. Cleared when a new puzzle starts.
  const skipReplayRef = useRef(false);
  /**
   * `next`, counted as one more recorded entry; the entry is logged. Updaters
   * can run twice (StrictMode) or be rebased, so the push is idempotent on the
   * ordinal: it happens only when the state's count is the log's, and the
   * log's count then moves on.
   */
  const recordEntry = useCallback(
    (from: SudokuState, next: SudokuState, entry: EntryTuple): SudokuState => {
      if (skipReplayRef.current) return { ...next, entryCount: undefined };
      const ordinal = from.entryCount ?? 0;
      if (ordinal === entryLog.count) entryLog.push(entry);
      return { ...next, entryCount: ordinal + 1 };
    },
    [entryLog]
  );

  // #2450 / #2619 — the abandon result block (backend SudokuResult), sent by
  // the hook's own abandon (unmount). Back-navigation needs nothing more: the
  // screen unmounts, and that abandon carries no score (#2632).
  const progressResult = useCallback(
    () => ({ won: false, errors: stateRef.current?.errorCount ?? 0 }),
    [stateRef]
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
  const awayRef = usePauseWhileAway(navigation, pauseTimer, resumeTimer, {
    // Every departure, not once per absence (#3288); an overlay (the ⋯ menu)
    // keeps the game on screen, so it needs no save.
    onLeave: (event) => {
      if (event.reason !== "overlay") saveReplayNow();
    },
  });

  // The clock starts on the first interaction (#2942): the first cell
  // selection or digit, whichever comes first. A first interaction that lands
  // while the player is away starts paused, like a load (#2750).
  // Ref-only, so it is safe inside a state updater; the [state] effect tells
  // the HUD afterwards.
  const startClockRef = useCallback(() => {
    if (startMsRef.current !== null) return;
    startMsRef.current = Date.now();
    if (awayRef.current) pausedAtRef.current = startMsRef.current;
  }, [awayRef]);

  // The mount load's restore — restores a saved game silently; on a clean
  // slot the pre-game picker shows.
  useGameRestored(game, (saved) => {
    if (saved === null) return;
    setDifficulty(saved.difficulty);
    setVariant(saved.variant);
    // The entries recorded before the kill are counted in the save: the next
    // ones, and their recorder units, go on from there (#3288).
    resetEntries(saved.entryCount ?? 0);
    // A restored game continues the session a killed app left open
    // (#2654) — only one for the same puzzle settings, so a restore never
    // adopts another difficulty's or variant's session.
    const resumed = saved.isComplete
      ? false
      : syncResume({ difficulty: saved.difficulty, variant: saved.variant });
    // Treat any resumed state that already has moves as "timer
    // already started" — the player wants to see it ticking
    // immediately on return.  Elapsed resets to 0 because we
    // don't persist it; this is intentional per the issue.
    const anyMoves =
      saved.errorCount > 0 ||
      saved.undoStack.length > 0 ||
      saved.grid.some((row) => row.some((c) => !c.given && c.value !== 0));
    // A game with moves is replayable only if its record started with the
    // first of them (#3288): it has a count, and its session carried on.
    skipReplayRef.current = anyMoves && (saved.entryCount === undefined || !resumed);
    if (anyMoves) {
      startMsRef.current = Date.now();
      // A load that lands while the player is away (#2750) starts
      // paused, and resumes with everything else on return.
      if (awayRef.current) pausedAtRef.current = startMsRef.current;
    }
  });

  // A move, a load or a new puzzle can start or clear the clock (inside state
  // updaters and handlers, which only touch the refs): tell the HUD.
  useEffect(() => {
    syncClockActivity();
  }, [state, syncClockActivity]);

  // The HUD's `ElapsedText` owns the clock's tick and reads `playedMs`, so the
  // HUD always shows the time the game reports (pauses taken out), and the
  // screen, grid and pad do not re-render as time passes (#2964).
  const elapsedA11yLabel = useCallback((time: string) => t("hud.elapsed", { time }), [t]);

  // The completion transition (useCompletionTransition, #3087): complete the
  // gameSync session and clear the saved game so the next mount starts fresh.
  // Every step to complete runs it, a restored solved puzzle included: there
  // is no once-per-game guard, as a restored one has no session to complete
  // and no usable time (its clock restarts on load), so it records no time
  // and no best: only its result card is filled in.
  useCompletionTransition(state, isComplete, (s) => {
    const score = computeScore(s.difficulty, s.errorCount);
    // A time is usable only when positive: a device clock that stepped back
    // after a resume cannot make a 00:00 solve, a "New best", or a best of 0
    // (which is also the "no best yet" mark). Then the duration is unknown.
    const playedS = Math.floor((playedMs() ?? 0) / 1000);
    const finalElapsed = playedS > 0 ? playedS : null;
    // The last chunk goes to the recorder first: `complete` ends its session.
    flushEntries();
    const gid = syncComplete(
      {
        finalScore: score,
        outcome: "completed",
        durationMs: finalElapsed === null ? null : finalElapsed * 1000,
        result: { won: true, errors: s.errorCount },
      },
      {
        final_score: score,
        outcome: "completed",
        won: true,
        difficulty: s.difficulty,
        variant: s.variant,
        errors: s.errorCount,
      }
    );
    if (gid) {
      // The card shows where this game ranks on its board.
      void lookupRank(gid);
    }
    clearSavedGame();

    const diff = s.difficulty;
    const variantKey = s.variant;
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
  });

  const ensureSyncStarted = useCallback(
    (next: SudokuState) => {
      // A new puzzle opened its session already (`openPuzzleSession`); a
      // restored one whose session couldn't be resumed opens one now.
      if (!syncGetGameId()) {
        const settings = { difficulty: next.difficulty, variant: next.variant };
        // The givens go in `game_started` once (#3288): the entries rebuild from them.
        syncStart({ ...settings, puzzle: next.puzzle }, settings);
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
      // The old puzzle's last chunk goes to the recorder first, so the restart
      // saves it to that game; the new one counts from its first entry (#3288).
      flushEntries();
      syncRestart({ ...settings, puzzle: fresh.puzzle }, settings);
      resetEntries(0);
      skipReplayRef.current = false;
    },
    [syncRestart, flushEntries, resetEntries]
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

  // The engine emits a new array on each digit entry; the events stay in
  // state (a save drops them), so no clear is needed.
  useGameEvents(state?.events, {
    errorEntered: () => flashError(),
    unitComplete: () => {
      Animated.sequence([
        Animated.timing(unitFlashOpacity, { toValue: 0.35, duration: 80, useNativeDriver: true }),
        Animated.timing(unitFlashOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start();
    },
    puzzleComplete: () => playPuzzleComplete(),
  });

  const handleStart = useCallback(() => {
    clearSavedGame();
    const fresh = loadPuzzle(rememberDifficulty(difficulty), variant);
    openPuzzleSession(fresh);
    setState(fresh);
    setClockEpoch((n) => n + 1);
    setResult(null);
    resetScore();
    startMsRef.current = null;
    pausedAtRef.current = null;
  }, [
    difficulty,
    variant,
    resetScore,
    rememberDifficulty,
    openPuzzleSession,
    clearSavedGame,
    setState,
  ]);

  const handleStartWithSettings = useCallback(
    (d: Difficulty, v: Variant) => {
      setNewGameModalVisible(false);
      setVariant(v);
      clearSavedGame();
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
    [resetScore, rememberDifficulty, openPuzzleSession, clearSavedGame, setState]
  );

  const handleNewGameRequest = useCallback(() => {
    setNewGameModalVisible(true);
  }, []);

  const handleCellPress = useCallback(
    (row: number, col: number) => {
      // Selecting a cell starts the clock but not the sync session: a puzzle
      // that was only looked at is discarded, not abandoned (#2942).
      startClockRef();
      syncClockActivity(); // an event handler: tell the HUD directly
      setState((s) => (s ? selectCell(s, row, col) : s));
    },
    [startClockRef, syncClockActivity, setState]
  );

  const handleDigit = useCallback(
    (digit: CellValue) => {
      // Any number pad press is a first interaction, even one that changes
      // nothing (no cell selected): it starts the clock. Done here, not in the
      // updater, because a no-op leaves the state (and the [state] effect) alone.
      startClockRef();
      syncClockActivity();
      setState((s) => {
        if (!s) return s;
        const applied = applyRecorded(s, { kind: "digit", digit });
        if (!applied) return s;

        // The session starts only on an input that actually changes state.
        ensureSyncStarted(applied.next);

        return recordEntry(s, applied.next, applied.entry);
      });
    },
    [startClockRef, syncClockActivity, ensureSyncStarted, recordEntry, setState]
  );

  const handleErase = useCallback(() => {
    setState((s) => {
      if (!s) return s;
      const applied = applyRecorded(s, { kind: "erase" });
      if (!applied) return s;
      return recordEntry(s, applied.next, applied.entry);
    });
  }, [recordEntry, setState]);

  const handleToggleNotes = useCallback(() => {
    setState((s) => (s ? toggleNotesMode(s) : s));
  }, [setState]);

  const handleUndo = useCallback(() => {
    setState((s) => {
      if (!s) return s;
      const applied = applyRecorded(s, { kind: "undo" });
      if (!applied) return s;
      return recordEntry(s, applied.next, applied.entry);
    });
  }, [recordEntry, setState]);

  const handleChangeDifficulty = useCallback(() => {
    // #2690: close this puzzle's session now, while the snapshot still reads
    // it (abandoned if started, discarded if not). The next puzzle opens its own.
    // Its last chunk goes to the recorder first (#3288): `close` ends the session.
    flushEntries();
    syncClose();
    resetEntries(0);
    clearSavedGame();
    setState(null);
    setClockEpoch((n) => n + 1);
    setResult(null);
    resetScore();
    startMsRef.current = null;
    pausedAtRef.current = null;
  }, [resetScore, syncClose, flushEntries, resetEntries, clearSavedGame, setState]);

  const handleHint = useCallback(() => {
    // Like a number pad press, a hint press is a first interaction even when
    // it does nothing (no cell selected): it starts the clock, here and not in
    // the updater because a no-op leaves the state alone.
    startClockRef();
    syncClockActivity();
    setState((s) => {
      if (!s) return s;
      // A selected empty cell is filled; on a full-but-wrong grid (#2943) a
      // wrong cell is selected and corrected. Anything else is a no-op.
      const applied = applyRecorded(s, { kind: "hint" });
      if (!applied) return s;
      ensureSyncStarted(s);
      return recordEntry(s, applied.next, applied.entry);
    });
  }, [startClockRef, syncClockActivity, ensureSyncStarted, recordEntry, setState]);

  const showMistakes = showMistakesLoaded && (showMistakesPref ?? state?.difficulty === "easy");
  const fullButWrong = state !== null && isFullButWrong(state);

  // Say it aloud when the banner appears (iOS has no live regions).
  useEffect(() => {
    // Android announces the pad message through its live region instead.
    if (fullButWrong && Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(t("fullWrong.message"));
    }
  }, [fullButWrong, t]);

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
      menuToggle={
        state !== null
          ? {
              label: t("settings.showMistakes"),
              value: showMistakes,
              onToggle: handleToggleShowMistakes,
              testID: "sudoku-show-mistakes",
            }
          : undefined
      }
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
              solution={state.solution}
              showMistakes={showMistakes}
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
              message={fullButWrong ? t("fullWrong.message") : undefined}
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
              { backgroundColor: colors.bonus, opacity: unitFlashOpacity },
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
