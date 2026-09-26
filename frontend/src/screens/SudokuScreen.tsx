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
import { Animated, AppState, Pressable, StyleSheet, Text, View } from "react-native";
import type { AppStateStatus } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";

import type { HomeStackParamList } from "../types/navigation";
import { useTheme } from "../theme/ThemeContext";
import { typography } from "../theme/typography";
import { GameShell } from "../components/shared/GameShell";
import { useLeaderboardLink } from "../hooks/useLeaderboardLink";
import { HudStatRow } from "../components/shared/HudStatRow";
import {
  ModalActions,
  ModalCard,
  ModalPrimaryButton,
  ModalSecondaryButton,
} from "../components/shared/ModalCard";
import { PillButton } from "../components/shared/PillButton";
import SudokuGrid from "../components/sudoku/SudokuGrid";
import NumberPad from "../components/sudoku/NumberPad";
import DifficultySelector from "../components/sudoku/DifficultySelector";
import {
  enterDigit,
  eraseCell,
  loadPuzzle,
  selectCell,
  toggleNotesMode,
  undo,
} from "../game/sudoku/engine";
import type { CellValue, Difficulty, SudokuState, Variant } from "../game/sudoku/types";
import { DIFFICULTIES, VARIANTS, variantConfig } from "../game/sudoku/types";
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
import { useLeaderboardSubmit } from "../game/_shared/useLeaderboardSubmit";
import { sessionBoardAdapter } from "../game/_shared/sessionBoardAdapter";
import { useLastDifficulty } from "../game/_shared/lastDifficulty";
import GameResultModal from "../components/shared/GameResultModal";

const FLASH_MS = 200;

/** The result card reads the synced game's rank on the session board (#2632). */
const sudokuBoard = sessionBoardAdapter("sudoku");
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
  const [elapsed, setElapsed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [newGameModalVisible, setNewGameModalVisible] = useState(false);
  // What the result card shows, captured when the puzzle is solved.
  const [result, setResult] = useState<{
    elapsedS: number;
    bestTimeS: number;
    isNewBest: boolean;
  } | null>(null);
  const leaderboard = useLeaderboardSubmit(sudokuBoard);
  const { submit: submitScore, reset: resetScore } = leaderboard;
  // The card's "View leaderboard" link and the ⋯ menu item (#2633) open the
  // board of the puzzle on screen, else of the picker's choice.
  const openLeaderboard = useLeaderboardLink(navigation, "sudoku", {
    difficulty: state?.difficulty ?? difficulty,
    variant: state?.variant ?? variant,
  });

  // Timer bookkeeping.  `startMs` is the wall-clock at which play began,
  // shifted forward while the app sits in the background so elapsed
  // reads as "time actively spent playing." null = no input yet.
  const startMsRef = useRef<number | null>(null);
  const pausedAtRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Lifecycle refs.  `hasLoadedRef` gates saves so a fresh puzzle can't
  // clobber a resumable save still being read off disk.
  const hasLoadedRef = useRef(false);
  const stateRef = useRef<SudokuState | null>(null);
  const prevCompleteRef = useRef(false);

  // The device's `sudoku_stats_v1` store. Only each puzzle kind's `bestTimeS`
  // is read, for the result card's best time and "New best" badge (#2636);
  // `gamesSolved` is still kept but shown nowhere: the Stats screen reads the
  // server.
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
    return (pausedAtRef.current ?? Date.now()) - startMsRef.current;
  }, []);
  useEffect(() => {
    syncSetProgressSnapshot(() => ({ result: progressResult(), durationMs: playedMs() }));
  }, [syncSetProgressSnapshot, progressResult, playedMs]);

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
          if (anyMoves) startMsRef.current = Date.now();
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [syncResume, setDifficulty]);

  // Persist on every state change after the initial load has resolved.
  // Suppressed pre-load to protect the disk copy; `state === null`
  // represents pre-game and is handled by `clearGame` in the callers.
  useEffect(() => {
    stateRef.current = state;
    if (!hasLoadedRef.current) return;
    if (state === null) return;
    saveGame(state).catch(() => {});
  }, [state]);

  const tickTimer = useCallback(() => {
    if (startMsRef.current === null) return;
    setElapsed(Math.floor((Date.now() - startMsRef.current) / 1000));
  }, []);

  // Once-per-second ticker — only runs when a game is in progress, not
  // complete, and has actually started.
  useEffect(() => {
    if (!state || isComplete || startMsRef.current === null) {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    intervalRef.current = setInterval(tickTimer, 1000);
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [state, isComplete, tickTimer]);

  // Pause on background, resume on foreground.
  useEffect(() => {
    const handleChange = (next: AppStateStatus) => {
      if (startMsRef.current === null) return;
      if (isComplete) return;
      if (next !== "active") {
        pausedAtRef.current = Date.now();
      } else if (pausedAtRef.current !== null && startMsRef.current !== null) {
        startMsRef.current += Date.now() - pausedAtRef.current;
        pausedAtRef.current = null;
      }
    };
    const sub = AppState.addEventListener("change", handleChange);
    return () => sub.remove();
  }, [isComplete]);

  // Complete the gameSync session exactly once on the completion
  // transition; clear the saved game so the next mount starts fresh.
  useEffect(() => {
    if (state === null) {
      prevCompleteRef.current = false;
      return;
    }
    if (state.isComplete && !prevCompleteRef.current) {
      const score = computeScore(state.difficulty, state.errorCount);
      const finalElapsed =
        startMsRef.current !== null ? Math.floor((Date.now() - startMsRef.current) / 1000) : 0;
      const gid = syncComplete(
        {
          finalScore: score,
          outcome: "completed",
          durationMs: finalElapsed * 1000,
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
      const updatedStats: SudokuStats = {
        ...statsRef.current,
        [variantKey]: {
          ...statsRef.current[variantKey],
          [diff]: {
            bestTimeS:
              prev.bestTimeS === 0 || finalElapsed < prev.bestTimeS ? finalElapsed : prev.bestTimeS,
            gamesSolved: prev.gamesSolved + 1,
          },
        },
      };
      statsRef.current = updatedStats;
      saveStats(updatedStats).catch(() => {});
      setElapsed(finalElapsed);
      setResult({
        elapsedS: finalElapsed,
        bestTimeS: updatedStats[variantKey][diff].bestTimeS,
        // Only a beaten previous time is a "new best" — not a first solve.
        isNewBest: prev.bestTimeS > 0 && finalElapsed < prev.bestTimeS,
      });
    }
    prevCompleteRef.current = state.isComplete;
  }, [state, syncComplete, submitScore]);

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
    setElapsed(0);
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
      setElapsed(0);
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
    setElapsed(0);
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
      onBack={() => navigation.popToTop()}
      onNewGame={state !== null ? handleNewGameRequest : undefined}
      onOpenLeaderboard={openLeaderboard}
      rightSlot={headerRight}
      style={{
        paddingBottom: Math.max(insets.bottom, 16),
        paddingLeft: Math.max(insets.left, 12),
        paddingRight: Math.max(insets.right, 12),
      }}
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
                text: formatElapsed(elapsed),
                muted: true,
                accessibilityLabel: t("hud.elapsed", { time: formatElapsed(elapsed) }),
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
          hero={{
            kind: "score",
            label: tResult("stat.time"),
            value: formatElapsed(result?.elapsedS ?? elapsed),
          }}
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
          submission={{
            status: leaderboard.status,
            rank: leaderboard.rank,
            isBest: leaderboard.isBest,
            playerName: leaderboard.playerName,
            onProvideName: leaderboard.provideName,
            onRetry: leaderboard.retry,
          }}
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
// Pre-game — difficulty picker + start button
// ---------------------------------------------------------------------------

function PreGame({
  difficulty,
  onChange,
  variant,
  onVariantChange,
  onStart,
}: {
  readonly difficulty: Difficulty;
  readonly onChange: (d: Difficulty) => void;
  readonly variant: Variant;
  readonly onVariantChange: (v: Variant) => void;
  readonly onStart: () => void;
}) {
  const { t } = useTranslation("sudoku");
  const { colors } = useTheme();

  return (
    <View style={styles.preGameWrap}>
      <View
        style={[
          styles.preGameCard,
          { backgroundColor: colors.surfaceHigh, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.preGameTitle, { color: colors.text }]} accessibilityRole="header">
          {t("preGame.title")}
        </Text>
        <Text style={[styles.preGameBody, { color: colors.textMuted }]}>{t("preGame.body")}</Text>
        <View style={styles.preGameSelector}>
          <VariantSelector value={variant} onChange={onVariantChange} />
        </View>
        <View style={[styles.preGameSelector, { marginTop: 8 }]}>
          <DifficultySelector value={difficulty} onChange={onChange} />
        </View>
        <ModalPrimaryButton
          testID="sudoku-pregame-start"
          label={t("action.start")}
          onPress={onStart}
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Variant selector — Classic (9×9) vs Mini (6×6)
// ---------------------------------------------------------------------------

function VariantSelector({
  value,
  onChange,
}: {
  readonly value: Variant;
  readonly onChange: (v: Variant) => void;
}) {
  const { t } = useTranslation("sudoku");
  const { colors } = useTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t("variant.groupLabel", { defaultValue: "Variant" })}
      style={[styles.variantRow, { borderColor: colors.border }]}
    >
      {VARIANTS.map((v) => {
        const selected = v === value;
        return (
          <Pressable
            key={v}
            onPress={() => onChange(v)}
            accessibilityRole="radio"
            accessibilityLabel={t(`variant.${v}`, {
              defaultValue: v === "classic" ? "Classic 9×9" : "Mini 6×6",
            })}
            accessibilityState={{ selected }}
            aria-checked={selected}
            style={[
              styles.variantBtn,
              { backgroundColor: selected ? colors.accent : colors.surface },
            ]}
          >
            <Text
              style={[styles.variantLabel, { color: selected ? colors.textOnAccent : colors.text }]}
            >
              {t(`variant.${v}`, {
                defaultValue: v === "classic" ? "Classic 9×9" : "Mini 6×6",
              })}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// New Game modal — settings selection after abandon confirmation
// ---------------------------------------------------------------------------

function NewGameModal({
  currentDifficulty,
  currentVariant,
  onQuickRestart,
  onStart,
}: {
  readonly currentDifficulty: Difficulty;
  readonly currentVariant: Variant;
  readonly onQuickRestart: () => void;
  readonly onStart: (d: Difficulty, v: Variant) => void;
}) {
  const { t } = useTranslation("sudoku");
  const [pendingDifficulty, setPendingDifficulty] = useState(currentDifficulty);
  const [pendingVariant, setPendingVariant] = useState(currentVariant);

  return (
    <ModalCard visible title={t("newGame.title")}>
      <View style={styles.newGameSelector}>
        <VariantSelector value={pendingVariant} onChange={setPendingVariant} />
      </View>
      <View style={[styles.newGameSelector, { marginTop: 8 }]}>
        <DifficultySelector value={pendingDifficulty} onChange={setPendingDifficulty} />
      </View>
      <ModalActions style={styles.newGameActions}>
        <ModalPrimaryButton
          label={t("action.start")}
          onPress={() => onStart(pendingDifficulty, pendingVariant)}
        />
        <ModalSecondaryButton
          tone="accent"
          label={t("action.quickRestart")}
          onPress={onQuickRestart}
        />
      </ModalActions>
    </ModalCard>
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
  headerRow: {
    flexDirection: "row",
    gap: 8,
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
  preGameWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  preGameCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    width: "90%",
    maxWidth: 360,
    alignItems: "center",
  },
  preGameTitle: {
    fontFamily: typography.heading,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0.5,
    marginBottom: 8,
    textAlign: "center",
  },
  preGameBody: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
    textAlign: "center",
  },
  preGameSelector: {
    alignSelf: "stretch",
    marginBottom: 20,
  },
  variantRow: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 8,
    overflow: "hidden",
    alignSelf: "stretch",
    marginBottom: 0,
  },
  variantBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  variantLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
  newGameSelector: {
    alignSelf: "stretch",
    marginBottom: 4,
  },
  newGameActions: {
    marginTop: 14,
  },
});
