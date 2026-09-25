import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  AppStateStatus,
  FlatList,
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
import { sortApi, type LevelData, type ScoreEntry } from "../game/sort/api";
import { isNetworkError } from "../game/_shared/httpClient";
import { withRetry } from "../game/_shared/withRetry";
import {
  loadProgress,
  saveProgress,
  loadLevelsCache,
  recordLevelSolve,
  saveLevelsCache,
  type SortProgress,
} from "../game/sort/storage";
import { ConnectedOfflineBanner } from "../components/shared/OfflineBanner";
import { GameShell } from "../components/shared/GameShell";
import { HudStatRow } from "../components/shared/HudStatRow";
import { PillButton } from "../components/shared/PillButton";
import { useSortAudio } from "../game/sort/useSortAudio";
import GameResultModal from "../components/shared/GameResultModal";
import { useGameSync } from "../game/_shared/useGameSync";
import { useLeaderboardSubmit } from "../game/_shared/useLeaderboardSubmit";
import { sortLeaderboard } from "../game/sort/leaderboard";

type ScreenView = "loading" | "select" | "play";
type SelectTab = "levels" | "leaderboard";

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

  // Level select tabs
  const [selectTab, setSelectTab] = useState<SelectTab>("levels");
  const [leaderboard, setLeaderboard] = useState<ScoreEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);

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
  const leaderboardSubmit = useLeaderboardSubmit(sortLeaderboard);
  const { submit: submitScore, reset: resetSubmission } = leaderboardSubmit;

  // Per-session `games` row (#2512), like every other game: XP, Profile history
  // and SyncWorker. It never carries a score — Sort's leaderboard ranks every
  // Sort row with a `final_score`, so a scored session would duplicate each
  // solve there. The leaderboard entry is `sortLeaderboard`'s job.
  const {
    start: syncStart,
    markStarted: syncMarkStarted,
    complete: syncComplete,
    getGameId: syncGetGameId,
    setProgressSnapshot: syncSetProgressSnapshot,
  } = useGameSync("sort");
  const gameStateRef = useRef<SortState | null>(null);
  gameStateRef.current = gameState;
  const currentLevelIdRef = useRef<number | null>(null);
  currentLevelIdRef.current = currentLevelId;
  /** Bumped whenever the played level changes, so a late solve result is dropped. */
  const levelGenRef = useRef(0);

  const [isHinting, setIsHinting] = useState(false);

  const progressRef = useRef(progress);
  progressRef.current = progress;

  const audio = useSortAudio();

  useEffect(() => {
    syncSetProgressSnapshot(() => ({
      result: {
        won: false,
        level: currentLevelIdRef.current,
        moves: gameStateRef.current?.moveCount ?? 0,
      },
    }));
  }, [syncSetProgressSnapshot]);

  /** Closes an open, unfinished session as abandoned (a no-op otherwise). */
  const abandonSession = useCallback(() => {
    if (!syncGetGameId()) return;
    syncComplete(
      { outcome: "abandoned" },
      {
        outcome: "abandoned",
        won: false,
        level: currentLevelIdRef.current,
        moves: gameStateRef.current?.moveCount ?? 0,
      }
    );
  }, [syncGetGameId, syncComplete]);

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
    const [levelsResult, prog] = await Promise.all([
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
    ]);
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

  // Unlock next level and show win modal as soon as the puzzle is solved.
  // Unlocking is tied to solving, not to leaderboard submission, so players
  // who skip score entry still progress.
  useEffect(() => {
    if (!gameState?.isComplete || showWinModal) return;
    setShowWinModal(true);
    if (currentLevelId !== null) {
      // Read before the unlock below moves it on.
      const atFrontier = currentLevelId >= progressRef.current.unlockedLevel;
      syncComplete(
        { outcome: "completed" },
        {
          outcome: "completed",
          won: true,
          level: currentLevelId,
          moves: gameState.moveCount,
          undos: gameState.undosUsed,
        }
      );
      const solvedLevel = currentLevelId;
      const gen = levelGenRef.current;
      void recordLevelSolve(solvedLevel, gameState.moveCount).then((solve) => {
        // The player already moved on (Next Level / Change Level): don't let
        // this solve land on the next level's card or submission.
        if (gen !== levelGenRef.current) return;
        setWinSummary(solve);
        // The leaderboard is "highest level reached", and every POST adds a
        // row — so only the first solve of the player's frontier level can
        // raise it. Replays (incl. the last level's Play Again) submit nothing.
        if (atFrontier && solve.firstSolve) submitScore({ level: solvedLevel });
      });
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
    submitScore,
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
    try {
      const hint = await getNextHintAsync(gameState);
      if (hint) {
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

  const handleLoadLeaderboard = useCallback(async () => {
    setLeaderboardLoading(true);
    try {
      const res = await sortApi.getLeaderboard();
      setLeaderboard(res.scores as ScoreEntry[]);
    } catch {
      // keep stale data on error
    } finally {
      setLeaderboardLoading(false);
    }
  }, []);

  const handleSelectTab = useCallback(
    (tab: SelectTab) => {
      setSelectTab(tab);
      if (tab === "leaderboard") {
        void handleLoadLeaderboard();
      }
    },
    [handleLoadLeaderboard]
  );

  function handleResetLevel() {
    if (!currentLevelId) return;
    const level = levels.find((l) => l.id === currentLevelId);
    if (!level) return;
    if (pourTimerRef.current !== null) {
      clearTimeout(pourTimerRef.current);
      pourTimerRef.current = null;
    }
    setIsPouring(false);
    setPouringFrom(null);
    setPouringTo(null);
    abandonSession();
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
  // Render helpers
  // ---------------------------------------------------------------------------

  function renderLeaderboard() {
    if (leaderboardLoading) {
      return <ActivityIndicator style={styles.leaderboardLoading} />;
    }
    if (leaderboard.length === 0) {
      return (
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>
          {t("leaderboard.empty")}
        </Text>
      );
    }
    return (
      <FlatList
        data={leaderboard}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={styles.leaderboardList}
        renderItem={({ item, index }) => (
          <View style={[styles.leaderboardRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.leaderboardRank, { color: colors.textMuted }]}>#{index + 1}</Text>
            <Text style={[styles.leaderboardName, { color: colors.text }]}>{item.player_name}</Text>
            <Text style={[styles.leaderboardLevel, { color: colors.accent }]}>
              {t("leaderboard.levelReached", { level: item.level_reached })}
            </Text>
          </View>
        )}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------

  if (view === "loading") {
    return (
      <GameShell title={t("game.title")} loading>
        {null}
      </GameShell>
    );
  }

  if (view === "select") {
    return (
      <GameShell title={t("game.title")} requireBack onBack={() => navigation.goBack()}>
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

        {/* Tab bar */}
        <View
          style={[styles.tabBar, { borderBottomColor: colors.border }]}
          accessibilityRole="tablist"
        >
          {(["levels", "leaderboard"] as SelectTab[]).map((tab) => (
            <Pressable
              key={tab}
              style={[
                styles.tab,
                selectTab === tab && {
                  borderBottomColor: colors.accent,
                  borderBottomWidth: 2,
                },
              ]}
              onPress={() => handleSelectTab(tab)}
              accessibilityRole="tab"
              accessibilityState={{ selected: selectTab === tab }}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: selectTab === tab ? colors.accent : colors.textMuted },
                ]}
              >
                {t(`tab.${tab}`)}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Tab content */}
        {selectTab === "levels" ? (
          <LevelSelectScreen
            levels={levels}
            progress={progress}
            onSelectLevel={handleSelectLevel}
            onContinue={handleContinue}
          />
        ) : (
          <View style={styles.leaderboardContainer}>{renderLeaderboard()}</View>
        )}
      </GameShell>
    );
  }

  // view === "play"
  return (
    <GameShell
      title={t("game.title")}
      requireBack
      onBack={handleBackToSelect}
      backAccessibilityLabel={t("action.backToLevels")}
      onNewGame={handleResetLevel}
      onLevelSelect={handleBackToSelect}
      rightSlot={
        <View style={styles.headerBtnRow}>
          <PillButton
            label={t("action.undo")}
            onPress={handleUndo}
            disabled={history.length === 0}
          />
          <PillButton
            label={t("action.hint")}
            onPress={handleHint}
            busy={isHinting}
            color={colors.bonus}
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
            playerName: leaderboardSubmit.playerName,
            onProvideName: leaderboardSubmit.provideName,
            onRetry: leaderboardSubmit.retry,
          }}
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
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
  },
  tabText: {
    fontFamily: typography.label,
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  leaderboardContainer: { flex: 1 },
  leaderboardLoading: { marginTop: 32 },
  leaderboardList: { padding: 16 },
  leaderboardRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  leaderboardRank: { fontFamily: typography.label, fontSize: 13, width: 28 },
  leaderboardName: { flex: 1, fontFamily: typography.body, fontSize: 14 },
  leaderboardLevel: { fontFamily: typography.label, fontSize: 13 },
  emptyText: {
    textAlign: "center",
    marginTop: 32,
    fontFamily: typography.body,
    fontSize: 14,
  },

  // Play view — HUD

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
