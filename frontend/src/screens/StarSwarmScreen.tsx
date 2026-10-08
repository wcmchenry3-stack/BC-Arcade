import React, { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import { useTheme } from "../theme/ThemeContext";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { HomeStackParamList } from "../types/navigation";
import { GameShell } from "../components/shared/GameShell";
import { bestOf } from "../game/_shared/bestOf";
import { useGameLeaderboard } from "../game/_shared/useGameLeaderboard";
import GameCanvas from "../components/starswarm/GameCanvas";
import type { GameCanvasHandle, DevOptions } from "../components/starswarm/GameCanvas";
import Controls, { hapticPlayerHit, hapticWaveClear } from "../components/starswarm/Controls";
import {
  CANVAS_W,
  CANVAS_H,
  DIFFICULTY_TIERS,
  difficultyLabel,
  difficultyMultiplier,
  engineCounters,
} from "../game/starswarm/engine";
import type {
  DifficultyTier,
  CarrierEvent,
  UpgradeEvent,
  StarSwarmState,
} from "../game/starswarm/types";
import { reportRunStats } from "../game/starswarm/telemetry";
import { summarizeScoreLedger } from "../game/starswarm/scoreLedger";
import { isPreLaunchApiBuild } from "../game/_shared/envFlags";
import { registerStarSwarmTestHooks } from "../game/starswarm/testHooks";
import FrameStatsReadout from "../components/starswarm/FrameStatsReadout";
import StarSwarmDevPanel, {
  DEFAULT_STARSWARM_DEV_OPTIONS,
  canvasDevOptions,
  type StarSwarmDevOptions,
} from "../components/starswarm/StarSwarmDevPanel";
import { DevButton } from "../components/dev/DevPanelShell";
import { loadBestScore, saveBestScore } from "../game/starswarm/bestScore";
import GameResultModal from "../components/shared/GameResultModal";
import { toSubmission } from "../components/shared/toSubmission";
import { recordedOutcome } from "../game/_shared/recordedOutcome";
import { useLastDifficulty } from "../game/_shared/lastDifficulty";
import { DifficultyPicker, type DifficultyOption } from "../components/shared/DifficultyPicker";
import { ModalActions, ModalCard, ModalPrimaryButton } from "../components/shared/ModalCard";
import { useGameSync } from "../game/_shared/useGameSync";
import {
  getSavedPausedState,
  savePausedState,
  clearSavedPausedState,
  hydratePausedState,
  isPausedStateHydrated,
} from "../game/starswarm/pauseStore";
import { useStarSwarmAudio } from "../hooks/useStarSwarmAudio";
import { usePauseWhileAway } from "../hooks/usePauseWhileAway";
import {
  initialRunState,
  isLiveRun as isLiveRunOf,
  isRunOver,
  isRunPaused,
  runReducer,
} from "../game/starswarm/runPhase";

/**
 * #2567: the dev panel exists in dev builds and in internal pre-launch builds (TestFlight / Play
 * test against the pre-launch API, as Hearts does) — the frame-time numbers are measured on
 * release builds, and reaching wave 5 or 9 there needs the panel. Store builds never show it.
 */
const DEV_TOOLS = __DEV__ || isPreLaunchApiBuild();

/** The run stays paused on return until the player resumes it: nothing to do then. */
const noop = () => {};

// Each tier on its own row, its score multiplier underneath (#2982).
const tierOptions: readonly DifficultyOption<DifficultyTier>[] = DIFFICULTY_TIERS.map((tier) => ({
  value: tier,
  label: difficultyLabel(tier),
  description: `×${difficultyMultiplier(tier)}`,
  accessibilityLabel: `${difficultyLabel(tier)} ×${difficultyMultiplier(tier)}`,
  fullWidth: true,
}));

/**
 * Star Swarm: the canvas, its touch controls, the difficulty picker, the result card and the
 * dev panel. The game itself is the engine in game/starswarm; this screen owns the run's
 * lifecycle, one reducer (game/starswarm/runPhase, #2981) with the phases
 * picker | running | paused | over. Every new run goes through `startRun(tier, devOpts?)`:
 * the picker's Start, the card's Play Again and the dev panel's New Game. Leaving the app or
 * the screen mid-run pauses and saves the run; a game over records it through useGameSync.
 *
 * A run paused by a previous process is on disk (#2645); the game reads the saved pause
 * synchronously at mount, so it mounts once that's loaded — a few ms, once per process, and
 * never more than HYDRATE_TIMEOUT_MS. Until then the header, its back button and a spinner are up.
 */
export default function StarSwarmScreen() {
  const { t } = useTranslation("starswarm");
  const { colors } = useTheme();
  const [hydrated, setHydrated] = useState(isPausedStateHydrated);
  useEffect(() => {
    if (hydrated) return;
    let alive = true;
    void hydratePausedState().then(() => {
      if (alive) setHydrated(true);
    });
    return () => {
      alive = false;
    };
  }, [hydrated]);
  if (hydrated) return <StarSwarmGame />;
  return (
    <GameShell gameType="starswarm" title={t("game.title")} requireBack gutter={null}>
      <View style={styles.canvasOuter}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    </GameShell>
  );
}

function StarSwarmGame() {
  const { t } = useTranslation("starswarm");
  const { t: tResult } = useTranslation("result");
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList, "StarSwarm">>();

  const canvasRef = useRef<GameCanvasHandle>(null);

  // Capture saved paused session once at mount — used to restore game state and skip difficulty picker.
  const savedPauseRef = useRef(getSavedPausedState());

  const [highScore, setHighScore] = useState(0);
  // The run lifecycle (#2981): picker | running | paused | over, the finished run's result card
  // (#2516) and the canvas's reset tick. A restored pause opens paused, skipping the picker.
  const [run, dispatchRun] = useReducer(
    runReducer,
    savedPauseRef.current !== null,
    initialRunState
  );
  const { phase, result, resetTick } = run;
  const isPaused = isRunPaused(run);
  const isGameOver = isRunOver(run);
  const showDifficultyPicker = phase === "picker";
  // Per-session `games` row (#2516), like every other game: XP, Profile history
  // and SyncWorker. Since #2626 the finished run carries its score and is the
  // leaderboard entry itself, on its difficulty tier's board.
  const {
    restart: syncRestart,
    markStarted: syncMarkStarted,
    complete: syncComplete,
    resume: syncResume,
    getGameId: syncGetGameId,
    reportBug: syncReportBug,
    resetPlayWindow: syncResetPlayWindow,
  } = useGameSync("starswarm");
  const [containerW, setContainerW] = useState(0);
  const [containerH, setContainerH] = useState(0);

  // Dev panel — used only when DEV_TOOLS (dev and internal pre-launch builds, #2567)
  const [devOpen, setDevOpen] = useState(false);
  const [devOptions, setDevOptions] = useState<StarSwarmDevOptions>(DEFAULT_STARSWARM_DEV_OPTIONS);

  // Pre-game difficulty selector — shown before each new game (skipped when restoring a saved session).
  // Its tier defaults to Ensign for new users, then opens on the last tier played (#1129). A saved
  // paused run supplies its own tier, which takes precedence.
  const { difficulty, setDifficulty, rememberDifficulty } = useLastDifficulty<DifficultyTier>(
    "starswarm",
    DIFFICULTY_TIERS,
    "Ensign",
    { initial: savedPauseRef.current?.difficulty }
  );
  // The card's rank line, and its "View leaderboard" link and the ⋯ menu item
  // (#2633), which open the finished run's tier board, else the current tier's.
  const { leaderboard, openLeaderboard } = useGameLeaderboard("starswarm", navigation, {
    difficulty_tier: result?.tier ?? difficulty,
  });
  const { lookup: lookupRank, reset: resetSubmission } = leaderboard;

  const scoreRef = useRef(0);
  const highScoreRef = useRef(0);

  // The best score survives restarts (#2516); it was session-only before.
  useEffect(() => {
    let alive = true;
    loadBestScore().then((best) => {
      if (!alive || best <= highScoreRef.current) return;
      highScoreRef.current = best;
      setHighScore(best);
    });
    return () => {
      alive = false;
    };
  }, []);

  const {
    playLaser,
    playPowerUpCollect,
    playExplosion,
    playPlayerHit,
    playWaveClear,
    playGameOver,
    playBossWave,
    playRout,
    playBonusLife,
    playCarrierEvent,
    playUpgrade,
  } = useStarSwarmAudio(!isGameOver, devOptions.volumes, resetTick, isPaused);
  // In dev builds, the dev panel's opts for the current run (applied to the canvas). Any
  // start other than the panel's own New Game clears them (#2567).
  const lastDevOptsRef = useRef<DevOptions | undefined>(undefined);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainerW(Math.floor(width));
    setContainerH(Math.floor(height));
  }, []);

  const handleScoreChange = useCallback((s: number) => {
    scoreRef.current = s;
  }, []);

  // #2491: the run's counters go to Sentry once per run; the canvas has already stored the
  // game-over state when it calls back, so getState() sees the final tick's counts too.
  // Re-armed on every new game: startRun (difficulty picker, dev panel) bumps resetTick.
  const runStatsReportedRef = useRef(false);
  useEffect(() => {
    runStatsReportedRef.current = false;
  }, [resetTick]);

  const handleGameOver = useCallback(
    (finalScore: number, wave: number) => {
      clearSavedPausedState();
      playGameOver();
      // The result card's haptic marks the end of the run (#2516).
      const priorBest = highScoreRef.current;
      const { improved, isNewBest } = bestOf(priorBest, finalScore, false);
      // bestOf counts any result as improving on no best; a 0 score never set one.
      if (improved && finalScore > 0) {
        highScoreRef.current = finalScore;
        setHighScore(finalScore);
        void saveBestScore(finalScore);
      }
      // #2567: the tier the run was actually played at — a dev-panel New Game sets its own
      const tier = canvasRef.current?.getState()?.difficulty ?? difficulty;
      dispatchRun({
        type: "GAME_OVER",
        result: { score: finalScore, wave, tier, best: Math.max(finalScore, priorBest), isNewBest },
      });
      // #2626: the run is the leaderboard entry. `difficulty_tier` lands in
      // games.metadata (StarSwarmResult), where the board partitions on it.
      // Score-only: the outcome stays `completed`. No duration: the engine
      // keeps no play clock, and a made-up 0 would read as a real time.
      const outcome = recordedOutcome("ended");
      const payload = { outcome, wave_reached: wave, difficulty_tier: tier };
      // #2837: where the score came from, wave by wave — in the result only, not the event.
      const ledger = canvasRef.current?.getState()?.scoreLedger;
      const result = ledger
        ? { ...payload, score_breakdown: summarizeScoreLedger(ledger, finalScore) }
        : payload;
      const gameId = syncComplete({ outcome, finalScore, result }, payload);
      // The card reads the run's rank on its tier's board (shown when it is the player's best).
      if (gameId) {
        void lookupRank(gameId);
      } else {
        // No open session: the run gets no row and no rank. Say so.
        syncReportBug("warn", "starswarm", "game over with no open session: run not recorded", {
          score: finalScore,
          wave,
          difficulty_tier: tier,
        });
      }
      if (!runStatsReportedRef.current) {
        const state = canvasRef.current?.getState();
        if (state) {
          runStatsReportedRef.current = true;
          reportRunStats(state);
        }
      }
    },
    [playGameOver, difficulty, syncComplete, syncReportBug, lookupRank]
  );

  // #2490: a boss wave has no on-screen text beyond the banner — play the sting and speak it.
  const handleBossWave = useCallback(() => {
    playBossWave();
    AccessibilityInfo.announceForAccessibility(t("a11y.bossWave"));
  }, [playBossWave, t]);

  // #2489: the rout has its banner, but the count is worth speaking — it's what to chase.
  const handleRout = useCallback(
    (count: number) => {
      playRout();
      AccessibilityInfo.announceForAccessibility(t("a11y.rout", { count }));
    },
    [playRout, t]
  );

  // #2845: Buddy going down has no on-screen text beyond the explosion — speak it.
  const handleBuddyLost = useCallback(() => {
    AccessibilityInfo.announceForAccessibility(t("a11y.buddyDown"));
  }, [t]);

  // #2484: the Carrier's armor dropping is a state change with no on-screen text — speak it.
  const handleCarrierExposed = useCallback(() => {
    AccessibilityInfo.announceForAccessibility(t("a11y.carrierExposed"));
  }, [t]);

  // #2485/#2843: beam telegraph, reinforcement launches, attack-run telegraph and the final
  // stand — sound plus a spoken cue, since none has on-screen text and the beam gives the
  // player only ~0.6 s to react.
  const handleCarrierEvent = useCallback(
    (kind: CarrierEvent) => {
      playCarrierEvent(kind);
      if (kind === "beamCharge") {
        AccessibilityInfo.announceForAccessibility(t("a11y.carrierBeam"));
      } else if (kind === "reinforce") {
        AccessibilityInfo.announceForAccessibility(t("a11y.reinforcements"));
      } else if (kind === "attackRun") {
        AccessibilityInfo.announceForAccessibility(t("a11y.carrierAttackRun"));
      } else if (kind === "finalStand") {
        AccessibilityInfo.announceForAccessibility(t("a11y.carrierFinalStand"));
      }
    },
    [playCarrierEvent, t]
  );

  // #2488: ladder changes — sound plus a spoken level, since the HUD text is canvas-only
  const handleUpgrade = useCallback(
    (ev: UpgradeEvent) => {
      playUpgrade(ev);
      const key =
        ev.kind === "gunsUp"
          ? "a11y.gunsUp"
          : ev.kind === "gunsDown"
            ? "a11y.gunsDown"
            : ev.kind === "hullUp"
              ? "a11y.hullUp"
              : "a11y.hullHit";
      AccessibilityInfo.announceForAccessibility(
        t(key, { level: ev.kind.startsWith("guns") ? ev.guns : ev.hull })
      );
    },
    [playUpgrade, t]
  );

  const handlePlayerHit = useCallback(() => {
    playPlayerHit();
    hapticPlayerHit();
  }, [playPlayerHit]);

  const handleWaveClear = useCallback(() => {
    playWaveClear();
    hapticWaveClear();
  }, [playWaveClear]);

  const handleBonusLife = useCallback(() => {
    playBonusLife();
  }, [playBonusLife]);

  // #2567: stable, so the readout's poll timer is not restarted by screen re-renders
  const readFrameStats = useCallback(() => canvasRef.current?.getFrameStats() ?? null, []);

  const handleGameOverRef = useRef(handleGameOver);
  handleGameOverRef.current = handleGameOver;

  // #2491 / #2516: E2E hooks (EXPO_PUBLIC_TEST_HOOKS=1 builds only), see game/starswarm/testHooks.ts.
  useEffect(
    () =>
      registerStarSwarmTestHooks({
        getCanvas: () => canvasRef.current,
        pause: () => dispatchRun({ type: "PAUSE" }),
        endRun: (score, wave) => handleGameOverRef.current(score, wave),
      }),
    []
  );

  /** Opens the run's sync session, abandoning any open one, and clears the last rank lookup. */
  const openRunSession = useCallback(
    (tier: DifficultyTier) => {
      // The run's play time starts now: time on the difficulty picker is not
      // play (#2710). With a session open, syncRestart() closes it and starts
      // the window over itself, so the window is only reset when none is.
      if (!syncGetGameId()) syncResetPlayWindow();
      syncRestart({ difficulty_tier: tier }, { difficulty_tier: tier });
      syncMarkStarted();
      resetSubmission();
    },
    [syncGetGameId, syncResetPlayWindow, syncRestart, syncMarkStarted, resetSubmission]
  );

  // A run restored from a saved pause is a run in progress: give it a session. After a cold
  // start that is the killed process's session for the run, if it is still open (#2654).
  useEffect(() => {
    if (savedPauseRef.current !== null && !syncResume()) {
      openRunSession(savedPauseRef.current.difficulty);
    }
    // Mount-only: the saved pause is read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Starts a fresh run at `tier` (#2981): the picker's Start and the card's Play Again (no dev
   * options), and the dev panel's New Game (with them). Any saved pause is dropped, a new sync
   * session opens, and the canvas resets on the bumped tick.
   */
  const startRun = useCallback(
    (tier: DifficultyTier, devOpts?: DevOptions) => {
      // #2567: a picker New Game is a clean run — the dev panel's wave, lives and difficulty stay
      // with the panel's own New Game, now that internal testers can reach it. A picker or Play
      // Again start (no devOpts) clears the last panel opts.
      lastDevOptsRef.current = DEV_TOOLS ? devOpts : undefined;
      clearSavedPausedState();
      savedPauseRef.current = null;
      openRunSession(tier);
      scoreRef.current = 0;
      dispatchRun({ type: "START" });
    },
    [openRunSession]
  );

  // The picker's Start and the card's Play Again: same tier, a clean run.
  // A premium tier (e.g. a paused run's) starts at Ensign instead (#1129).
  const handleStartFromPicker = useCallback(
    () => startRun(rememberDifficulty(difficulty)),
    [startRun, rememberDifficulty, difficulty]
  );

  // The dev panel's New Game: its own tier if it sets one.
  const handleDevNewGame = useCallback(
    (opts: DevOptions) => startRun(opts.difficulty ?? rememberDifficulty(difficulty), opts),
    [startRun, rememberDifficulty, difficulty]
  );

  // Show difficulty picker — header "New Game", the pause overlay, and the
  // result card's Change Difficulty. The card steps aside for the picker.
  const handleRequestNewGame = useCallback(() => dispatchRun({ type: "OPEN_PICKER" }), []);

  const handlePause = useCallback(() => dispatchRun({ type: "PAUSE" }), []);

  // The run is live again: a save of it is stale from here on.
  const handleResume = useCallback(() => {
    clearSavedPausedState();
    dispatchRun({ type: "RESUME" });
  }, []);

  /** Saves the paused run, to survive navigation and, since #2645, the process. */
  const savePausedRun = useCallback((state: StarSwarmState) => {
    // A finished run is never saved as a paused one.
    if (state.phase === "GameOver") return;
    // Already saved: a paused engine hands back the same state object, and iOS sends
    // "inactive" then "background" for one trip to the home screen.
    if (getSavedPausedState()?.gameState === state) return;
    savePausedState({
      gameState: state,
      difficulty: state.difficulty,
      counters: engineCounters(),
    });
  }, []);

  /** A run is on screen and not over — the only time pausing means anything. */
  const isLiveRun = isLiveRunOf(run);
  const isLiveRunRef = useRef(isLiveRun);
  isLiveRunRef.current = isLiveRun;

  // Leaving the app mid-run pauses it, so the player returns to the pause overlay, and saves
  // it (#2645): the OS may kill the app from here. "inactive" too — iOS's app switcher only
  // makes the app inactive, and a swipe-away there kills it without reaching "background".
  // Subscribed once; it reads the live run from a ref, and game over from the engine itself —
  // the canvas stores the game-over state before React renders it, so a run that has just
  // ended is never paused.
  const pauseLiveRun = useCallback(() => {
    if (!isLiveRunRef.current) return;
    const state = canvasRef.current?.getState();
    if (!state || state.phase === "GameOver") return;
    handlePause();
    savePausedRun(state);
  }, [handlePause, savePausedRun]);

  // Leaving the screen mid-run (the ⋯ menu's Leaderboard, #2633) pauses it the same way:
  // the screen stays mounted under the pushed one, so the run would go on unseen.
  // Both act on every leave event (`onLeave`), not once per absence (`onPause`): a run resumed
  // while the player still counts as away (the app inactive, say) is paused by the next one.
  usePauseWhileAway(navigation, noop, noop, { onLeave: pauseLiveRun });

  // The canvas reads its dev options through a ref, so a fresh object per render costs nothing.
  const canvasDev = DEV_TOOLS ? canvasDevOptions(lastDevOptsRef.current, devOptions) : undefined;

  const scale =
    containerW > 0 && containerH > 0 ? Math.min(containerW / CANVAS_W, containerH / CANVAS_H) : 0;

  const displayW = Math.round(CANVAS_W * scale);
  const displayH = Math.round(CANVAS_H * scale);

  const showPauseBtn = isLiveRun && scale > 0;

  return (
    <GameShell
      gameType="starswarm"
      title={t("game.title")}
      requireBack
      onBack={() => {
        if (isPaused) {
          const state = canvasRef.current?.getState();
          if (state) savePausedRun(state);
        }
        navigation.popToTop();
      }}
      onNewGame={handleRequestNewGame}
      onOpenLeaderboard={openLeaderboard}
      rightSlot={
        showPauseBtn ? (
          <Pressable
            onPress={isPaused ? handleResume : handlePause}
            accessibilityRole="button"
            accessibilityLabel={isPaused ? t("controls.resumeLabel") : t("controls.pauseLabel")}
            style={({ pressed }) => [
              styles.pauseHeaderBtn,
              pressed && styles.pauseHeaderBtnPressed,
            ]}
            hitSlop={8}
          >
            <MaterialIcons
              name={isPaused ? "play-arrow" : "pause"}
              size={22}
              color={colors.textOnAccent}
            />
          </Pressable>
        ) : undefined
      }
      gutter={0}
      style={{
        paddingBottom: Math.max(insets.bottom, 8),
      }}
    >
      <View testID="starswarm-canvas-outer" style={styles.canvasOuter} onLayout={onLayout}>
        {scale > 0 && (
          <View style={{ width: displayW, height: displayH }}>
            <GameCanvas
              ref={canvasRef}
              highScore={highScore}
              onScoreChange={handleScoreChange}
              onGameOver={handleGameOver}
              onPlayerHit={handlePlayerHit}
              onWaveClear={handleWaveClear}
              onLaserFire={playLaser}
              onPowerUpCollect={playPowerUpCollect}
              onExplosion={playExplosion}
              onBossWave={handleBossWave}
              onRout={handleRout}
              onBuddyLost={handleBuddyLost}
              onCarrierExposed={handleCarrierExposed}
              onCarrierEvent={handleCarrierEvent}
              onUpgrade={handleUpgrade}
              onBonusLife={handleBonusLife}
              isPaused={isPaused || showDifficultyPicker}
              onPause={handlePause}
              width={CANVAS_W}
              height={CANVAS_H}
              scale={scale}
              difficulty={difficulty}
              resetTick={resetTick}
              initialState={savedPauseRef.current?.gameState}
              devOptions={canvasDev}
            />
            <Controls
              canvasRef={canvasRef}
              scale={scale}
              isLiveRun={isLiveRun}
              isPaused={isPaused}
              onPause={handlePause}
              onResume={handleResume}
              onNewGame={handleRequestNewGame}
            />
            <DevButton enabled={DEV_TOOLS} onPress={() => setDevOpen(true)} />
            {DEV_TOOLS && devOptions.frameReadout && <FrameStatsReadout read={readFrameStats} />}
          </View>
        )}
        {showDifficultyPicker && scale > 0 && (
          <ModalCard
            visible
            onRequestClose={handleStartFromPicker}
            title={t("difficulty.selectTitle")}
            size="md"
          >
            <ScrollView showsVerticalScrollIndicator={false} style={styles.pickerScroll}>
              <DifficultyPicker
                gameKey="starswarm"
                options={tierOptions}
                value={difficulty}
                onChange={setDifficulty}
                accessibilityLabel={t("difficulty.selectTitle")}
                testID="starswarm-tier"
                premiumTestID="starswarm-premium"
              />
            </ScrollView>
            <ModalActions style={styles.pickerActions}>
              <ModalPrimaryButton
                label={t("difficulty.start")}
                onPress={handleStartFromPicker}
                testID="starswarm-start-game"
              />
            </ModalActions>
          </ModalCard>
        )}

        <GameResultModal
          visible={result !== null && !showDifficultyPicker}
          outcome="ended"
          eyebrow={`${t("game.title")} · ${difficultyLabel(result?.tier ?? difficulty)}`}
          subtitle={result ? t("result.reachedWave", { wave: result.wave }) : undefined}
          hero={{ kind: "score", label: tResult("stat.score"), value: result?.score ?? 0 }}
          isNewBest={result?.isNewBest ?? false}
          stats={
            result
              ? [
                  { label: t("result.wave"), value: result.wave },
                  { label: tResult("stat.best"), value: result.best },
                ]
              : []
          }
          submission={toSubmission(leaderboard)}
          onViewLeaderboard={openLeaderboard}
          // Same difficulty, straight into a new run.
          onPlayAgain={handleStartFromPicker}
          secondaryAction={{
            label: tResult("action.changeDifficulty"),
            onPress: handleRequestNewGame,
          }}
          onHome={() => navigation.popToTop()}
          testID="starswarm-result"
        />

        <StarSwarmDevPanel
          enabled={DEV_TOOLS}
          open={devOpen}
          onClose={() => setDevOpen(false)}
          canvasRef={canvasRef}
          options={devOptions}
          onOptionsChange={setDevOptions}
          onNewGame={handleDevNewGame}
        />
      </View>
    </GameShell>
  );
}

const styles = StyleSheet.create({
  canvasOuter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  pauseHeaderBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#00aaff",
  },
  pauseHeaderBtnPressed: {
    opacity: 0.7,
  },
  // The md card caps its height; the tier list shrinks inside it so the
  // Start button stays on screen in short landscape windows.
  pickerScroll: {
    maxHeight: 320,
    flexShrink: 1,
    alignSelf: "stretch",
  },
  pickerActions: {
    marginTop: 12,
  },
});
