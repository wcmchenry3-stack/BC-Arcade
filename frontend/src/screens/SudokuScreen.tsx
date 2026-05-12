/**
 * SudokuScreen — playable Sudoku with full lifecycle wiring.
 *
 * Layers:
 *   1. Pure engine from #616 + components from #617 (screen from #618).
 *   2. Persistence (#619) — AsyncStorage save after every mutation so a
 *      backgrounded or force-killed app resumes at the exact puzzle
 *      state; cleared on New Puzzle / Change Difficulty.
 *   3. Instrumentation (#619) — `useGameSync("sudoku")` session started
 *      on the first `enterDigit`, completed on win, abandoned on
 *      unmount or back-navigation when at least one digit was placed
 *      and the puzzle is unfinished.
 *   4. Leaderboard (#619) — `POST /sudoku/score` on win with an
 *      in-modal retry affordance; POST failures never block the rest
 *      of the modal.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  AppState,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from "react-native";
import type { AppStateStatus } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { HomeStackParamList } from "../../App";
import { useTheme } from "../theme/ThemeContext";
import { typography } from "../theme/typography";
import { GameShell } from "../components/shared/GameShell";
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
import { VARIANTS, variantConfig } from "../game/sudoku/types";
import { useSound } from "../game/_shared/useSound";
import {
  clearGame,
  loadGame,
  saveGame,
  loadStats,
  saveStats,
  EMPTY_SUDOKU_STATS,
  type SudokuStats,
} from "../game/sudoku/storage";
import { useSudokuScoreboard } from "../game/sudoku/SudokuScoreboardContext";
import { scoreQueue } from "../game/_shared/scoreQueue";
import { useGameSync } from "../game/_shared/useGameSync";
import { useNetwork } from "../game/_shared/NetworkContext";
import { OfflineBanner } from "../components/shared/OfflineBanner";

const FLASH_MS = 200;
const MAX_NAME_LENGTH = 32;
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
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();

  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [variant, setVariant] = useState<Variant>("classic");
  const [state, setState] = useState<SudokuState | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [newGameModalVisible, setNewGameModalVisible] = useState(false);
  // Game ID captured at completion time (before syncComplete clears it).
  const [completedGameId, setCompletedGameId] = useState<string | null>(null);

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
  const digitCountRef = useRef(0);
  const prevCompleteRef = useRef(false);

  const statsRef = useRef<SudokuStats>(EMPTY_SUDOKU_STATS);

  const flashOpacity = useRef(new Animated.Value(0)).current;
  const unitFlashOpacity = useRef(new Animated.Value(0)).current;
  const isComplete = state?.isComplete ?? false;

  const { play: playPuzzleComplete } = useSound("sudoku.puzzleComplete");

  const {
    start: syncStart,
    markStarted: syncMarkStarted,
    complete: syncComplete,
    getGameId: syncGetGameId,
  } = useGameSync("sudoku");

  const { setSnapshot: setScoreboardSnapshot } = useSudokuScoreboard();

  useEffect(() => {
    if (!state) return;
    setScoreboardSnapshot({
      elapsed,
      difficulty: state.difficulty,
      variant: state.variant,
      errorCount: state.errorCount,
      hasGame: true,
      stats: statsRef.current,
    });
  }, [state, elapsed, setScoreboardSnapshot]);

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
  }, []);

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
      const gid = syncGetGameId();
      if (gid) {
        setCompletedGameId(gid);
        syncComplete(
          { finalScore: score, outcome: "completed", durationMs: 0 },
          {
            final_score: score,
            outcome: "completed",
            difficulty: state.difficulty,
            variant: state.variant,
            errors: state.errorCount,
          }
        );
      }
      clearGame().catch(() => {});

      const finalElapsed =
        startMsRef.current !== null ? Math.floor((Date.now() - startMsRef.current) / 1000) : 0;
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
      setScoreboardSnapshot({
        elapsed: finalElapsed,
        difficulty: state.difficulty,
        variant: state.variant,
        errorCount: state.errorCount,
        hasGame: true,
        stats: updatedStats,
      });
    }
    prevCompleteRef.current = state.isComplete;
  }, [state, syncComplete, syncGetGameId, setCompletedGameId, setScoreboardSnapshot]);

  // Abandon on back-navigation when a digit has been placed and the
  // puzzle isn't finished.  useGameSync's own unmount handler provides
  // a second line of defense; calling complete here first makes the
  // unmount path a no-op for the same session.
  useEffect(() => {
    const unsub = navigation.addListener("beforeRemove", () => {
      const s = stateRef.current;
      if (!syncGetGameId()) return;
      if (s !== null && s.isComplete) return;
      if (digitCountRef.current < 1) return;
      syncComplete(
        {
          outcome: "abandoned",
          finalScore: s !== null ? computeScore(s.difficulty, s.errorCount) : 0,
          durationMs: 0,
        },
        {
          outcome: "abandoned",
          difficulty: s?.difficulty,
          variant: s?.variant,
          errors: s?.errorCount ?? 0,
        }
      );
    });
    return unsub;
  }, [navigation, syncComplete, syncGetGameId]);

  const ensureSyncStarted = useCallback(
    (next: SudokuState) => {
      if (syncGetGameId()) return;
      syncStart(
        { difficulty: next.difficulty, variant: next.variant },
        { difficulty: next.difficulty, variant: next.variant }
      );
      syncMarkStarted();
    },
    [syncGetGameId, syncStart, syncMarkStarted]
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
    digitCountRef.current = 0;
    const fresh = loadPuzzle(difficulty, variant);
    setState(fresh);
    setElapsed(0);
    startMsRef.current = null;
    pausedAtRef.current = null;
  }, [difficulty, variant]);

  const handleStartWithSettings = useCallback((d: Difficulty, v: Variant) => {
    setNewGameModalVisible(false);
    setDifficulty(d);
    setVariant(v);
    clearGame().catch(() => {});
    digitCountRef.current = 0;
    const fresh = loadPuzzle(d, v);
    setState(fresh);
    setElapsed(0);
    startMsRef.current = null;
    pausedAtRef.current = null;
  }, []);

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
        digitCountRef.current += 1;
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
    clearGame().catch(() => {});
    digitCountRef.current = 0;
    setState(null);
    setElapsed(0);
    startMsRef.current = null;
    pausedAtRef.current = null;
  }, []);

  const handleHint = useCallback(() => {
    setState((s) => {
      if (!s || s.selectedRow === null || s.selectedCol === null) return s;
      const cell = s.grid[s.selectedRow][s.selectedCol];
      if (cell.given || cell.value !== 0) return s;
      const { size } = variantConfig(s.variant);
      const idx = s.selectedRow * size + s.selectedCol;
      const hintDigit = (s.solution.charCodeAt(idx) - 48) as CellValue;
      if (startMsRef.current === null) startMsRef.current = Date.now();
      digitCountRef.current += 1;
      ensureSyncStarted(s);
      return enterDigit(s, hintDigit);
    });
  }, [ensureSyncStarted]);

  const headerRight = useMemo(() => {
    if (!state) return null;
    const undoDisabled = state.undoStack.length === 0;
    return (
      <Pressable
        onPress={handleUndo}
        disabled={undoDisabled}
        style={[styles.headerBtn, { borderColor: colors.accent, opacity: undoDisabled ? 0.4 : 1 }]}
        accessibilityRole="button"
        accessibilityLabel={t("action.undo")}
        accessibilityState={{ disabled: undoDisabled }}
      >
        <Text style={[styles.headerBtnText, { color: colors.accent }]}>{t("action.undo")}</Text>
      </Pressable>
    );
  }, [state, colors, handleUndo, t]);

  return (
    <GameShell
      title={t("game.title")}
      requireBack
      loading={loading}
      onBack={() => navigation.popToTop()}
      onNewGame={state !== null ? handleNewGameRequest : undefined}
      onOpenScoreboard={() => navigation.navigate("Scoreboard", { gameKey: "sudoku" })}
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
          <View style={styles.hudRow} accessibilityRole="summary">
            <Text style={[styles.hudText, { color: colors.text }]}>
              {t(`difficulty.${state.difficulty}`)}
            </Text>
            <Text style={[styles.hudText, { color: colors.textMuted }]}>
              {state.errorCount === 1
                ? t("hud.errorsOne")
                : t("hud.errors", { count: state.errorCount })}
            </Text>
            <Text
              style={[styles.hudText, { color: colors.textMuted }]}
              accessibilityLabel={t("hud.elapsed", {
                time: formatElapsed(elapsed),
              })}
            >
              {formatElapsed(elapsed)}
            </Text>
          </View>

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

      {state !== null && isComplete ? (
        <WinModal
          difficulty={state.difficulty}
          errors={state.errorCount}
          elapsed={elapsed}
          score={computeScore(state.difficulty, state.errorCount)}
          gameId={completedGameId ?? undefined}
          onNewPuzzle={handleStart}
          onChangeDifficulty={handleChangeDifficulty}
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
  const gradient: ViewStyle =
    Platform.OS === "web"
      ? ({
          backgroundImage: `linear-gradient(135deg, ${colors.accent}, ${colors.accentBright})`,
        } as ViewStyle)
      : { backgroundColor: colors.accentBright };

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
        <Pressable
          onPress={onStart}
          style={[styles.preGameStart, gradient]}
          accessibilityRole="button"
          accessibilityLabel={t("action.start")}
        >
          <Text style={[styles.preGameStartText, { color: colors.textOnAccent }]}>
            {t("action.start")}
          </Text>
        </Pressable>
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
// Win modal — name entry + score POST with retry
// ---------------------------------------------------------------------------

function WinModal({
  difficulty,
  errors,
  elapsed,
  score,
  gameId,
  onNewPuzzle,
  onChangeDifficulty,
}: {
  readonly difficulty: Difficulty;
  readonly errors: number;
  readonly elapsed: number;
  readonly score: number;
  readonly gameId?: string;
  readonly onNewPuzzle: () => void;
  readonly onChangeDifficulty: () => void;
}) {
  const { t } = useTranslation("sudoku");
  const { colors } = useTheme();
  const { isOnline, isInitialized } = useNetwork();

  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offline = isInitialized && !isOnline;

  const gradient: ViewStyle =
    Platform.OS === "web"
      ? ({
          backgroundImage: `linear-gradient(135deg, ${colors.accent}, ${colors.accentBright})`,
        } as ViewStyle)
      : { backgroundColor: colors.accentBright };

  const trimmed = name.trim();
  const canSubmit = !submitting && !offline && trimmed.length > 0;

  async function handleSubmit() {
    if (!canSubmit || !gameId) return;
    setSubmitting(true);
    setError(null);
    try {
      await scoreQueue.enqueue("sudoku", { game_id: gameId, player_name: trimmed });
      setSubmitted(true);
      // Kick off a background flush; failures are retried on next reconnect.
      scoreQueue.flush().catch(() => undefined);
    } catch {
      setError(t("win.submitFailed", { defaultValue: "Couldn't save your score. Tap to retry." }));
    } finally {
      setSubmitting(false);
    }
  }

  const submitLabel = error
    ? t("win.submitRetry", { defaultValue: "Retry submit" })
    : t("action.submitScore");

  return (
    <Modal visible transparent animationType="fade" accessibilityViewIsModal>
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.modalCard,
            { backgroundColor: colors.surfaceHigh, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.modalTitle, { color: colors.text }]} accessibilityRole="header">
            {t("win.title")}
          </Text>
          <Text style={[styles.modalBody, { color: colors.textMuted }]}>
            {t(`difficulty.${difficulty}`)}
          </Text>
          <Text style={[styles.modalBody, { color: colors.text }]}>
            {t("win.score", { score })}
          </Text>
          <Text style={[styles.modalBody, { color: colors.textMuted }]}>
            {t("win.errors", { count: errors })}
          </Text>
          <Text style={[styles.modalBody, { color: colors.textMuted }]}>
            {t("win.elapsed", { time: formatElapsed(elapsed) })}
          </Text>

          {!submitted ? (
            <>
              <TextInput
                style={[
                  styles.nameInput,
                  {
                    backgroundColor: colors.surfaceAlt,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
                placeholder={t("win.namePlaceholder", {
                  defaultValue: "Enter your name",
                })}
                placeholderTextColor={colors.textMuted}
                value={name}
                onChangeText={setName}
                maxLength={MAX_NAME_LENGTH}
                editable={!submitting}
                accessibilityLabel={t("win.nameLabel", {
                  defaultValue: "Your name",
                })}
              />
              {offline ? (
                <OfflineBanner />
              ) : (
                error !== null && (
                  <Text
                    style={[styles.winError, { color: colors.error }]}
                    accessibilityLiveRegion="assertive"
                    accessibilityRole="alert"
                  >
                    {error}
                  </Text>
                )
              )}
              <Pressable
                style={[styles.modalPrimary, gradient, !canSubmit && styles.modalPrimaryDisabled]}
                onPress={handleSubmit}
                disabled={!canSubmit}
                accessibilityRole="button"
                accessibilityLabel={submitLabel}
                accessibilityState={{ disabled: !canSubmit, busy: submitting }}
              >
                {submitting ? (
                  <ActivityIndicator color={colors.textOnAccent} />
                ) : (
                  <Text style={[styles.modalPrimaryText, { color: colors.textOnAccent }]}>
                    {submitLabel}
                  </Text>
                )}
              </Pressable>
            </>
          ) : (
            <Text
              style={[styles.winSaved, { color: colors.bonus }]}
              accessibilityLiveRegion="polite"
            >
              {t("win.saved", { defaultValue: "Saved! Score submitted." })}
            </Text>
          )}

          <Pressable
            style={[styles.modalSecondary, { borderColor: colors.accent }]}
            onPress={onNewPuzzle}
            accessibilityRole="button"
            accessibilityLabel={t("action.newGame")}
          >
            <Text style={[styles.modalSecondaryText, { color: colors.accent }]}>
              {t("action.newGame")}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.modalSecondary, { borderColor: colors.accent }]}
            onPress={onChangeDifficulty}
            accessibilityRole="button"
            accessibilityLabel={t("action.changeDifficulty")}
          >
            <Text style={[styles.modalSecondaryText, { color: colors.accent }]}>
              {t("action.changeDifficulty")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
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
  const { colors } = useTheme();
  const [pendingDifficulty, setPendingDifficulty] = useState(currentDifficulty);
  const [pendingVariant, setPendingVariant] = useState(currentVariant);

  const gradient: ViewStyle =
    Platform.OS === "web"
      ? ({
          backgroundImage: `linear-gradient(135deg, ${colors.accent}, ${colors.accentBright})`,
        } as ViewStyle)
      : { backgroundColor: colors.accentBright };

  return (
    <Modal visible transparent animationType="fade" accessibilityViewIsModal>
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.modalCard,
            { backgroundColor: colors.surfaceHigh, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.modalTitle, { color: colors.text }]} accessibilityRole="header">
            {t("newGame.title")}
          </Text>
          <View style={styles.newGameSelector}>
            <VariantSelector value={pendingVariant} onChange={setPendingVariant} />
          </View>
          <View style={[styles.newGameSelector, { marginTop: 8 }]}>
            <DifficultySelector value={pendingDifficulty} onChange={setPendingDifficulty} />
          </View>
          <Pressable
            style={[styles.modalPrimary, gradient]}
            onPress={() => onStart(pendingDifficulty, pendingVariant)}
            accessibilityRole="button"
            accessibilityLabel={t("action.start")}
          >
            <Text style={[styles.modalPrimaryText, { color: colors.textOnAccent }]}>
              {t("action.start")}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.modalSecondary, { borderColor: colors.accent }]}
            onPress={onQuickRestart}
            accessibilityRole="button"
            accessibilityLabel={t("action.quickRestart")}
          >
            <Text style={[styles.modalSecondaryText, { color: colors.accent }]}>
              {t("action.quickRestart")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
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
  headerBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 32,
    justifyContent: "center",
  },
  headerBtnText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  hudRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  hudText: {
    fontFamily: typography.heading,
    fontSize: 14,
    letterSpacing: 0.5,
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
  preGameStart: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 999,
    minWidth: 180,
    alignItems: "center",
  },
  preGameStartText: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  newGameSelector: {
    alignSelf: "stretch",
    marginBottom: 4,
  },
  modalOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000000bf",
  },
  modalCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    width: "86%",
    maxWidth: 360,
  },
  modalTitle: {
    fontFamily: typography.heading,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0.5,
    marginBottom: 10,
    textAlign: "center",
  },
  modalBody: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 6,
    textAlign: "center",
  },
  modalPrimary: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 999,
    marginTop: 14,
    marginBottom: 8,
    alignItems: "center",
    minWidth: 180,
  },
  modalPrimaryDisabled: {
    opacity: 0.5,
  },
  modalPrimaryText: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  modalSecondary: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 8,
    minWidth: 180,
    alignItems: "center",
  },
  modalSecondaryText: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  nameInput: {
    width: "100%",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 15,
    marginTop: 10,
    marginBottom: 6,
  },
  winError: {
    fontSize: 13,
    marginBottom: 8,
    textAlign: "center",
  },
  winSaved: {
    fontSize: 18,
    fontWeight: "700",
    marginTop: 12,
    marginBottom: 6,
  },
});
