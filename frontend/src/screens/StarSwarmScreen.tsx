import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  AppState,
  AppStateStatus,
  LayoutChangeEvent,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
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
import GameCanvas from "../components/starswarm/GameCanvas";
import type { GameCanvasHandle, DevOptions } from "../components/starswarm/GameCanvas";
import Controls, { hapticPlayerHit, hapticWaveClear } from "../components/starswarm/Controls";
import {
  CANVAS_W,
  CANVAS_H,
  DIFFICULTY_TIERS,
  difficultyLabel,
  difficultyMultiplier,
  dodgeRateByTier,
} from "../game/starswarm/engine";
import type { TierDodgeRow } from "../game/starswarm/engine";
import type {
  GamePhase,
  PowerUpType,
  DifficultyTier,
  CarrierEvent,
  UpgradeEvent,
  RunStats,
  StarSwarmState,
} from "../game/starswarm/types";
import { reportRunStats } from "../game/starswarm/telemetry";
import { areTestHooksEnabled, isPreLaunchApiBuild } from "../game/_shared/envFlags";
import FrameStatsReadout from "../components/starswarm/FrameStatsReadout";
import type { FrameStatsSummary } from "../game/starswarm/render/frameStats";
import { starSwarmLeaderboard } from "../game/starswarm/leaderboard";
import { loadBestScore, saveBestScore } from "../game/starswarm/bestScore";
import GameResultModal from "../components/shared/GameResultModal";
import { useLeaderboardSubmit } from "../game/_shared/useLeaderboardSubmit";
import { useGameSync } from "../game/_shared/useGameSync";
import {
  getSavedPausedState,
  savePausedState,
  clearSavedPausedState,
} from "../game/starswarm/pauseStore";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useStarSwarmAudio, DEFAULT_SFX_VOLUMES } from "../hooks/useStarSwarmAudio";
import type { SfxVolumes } from "../hooks/useStarSwarmAudio";

/**
 * #2567: the dev panel exists in dev builds and in internal pre-launch builds (TestFlight / Play
 * test against the pre-launch API, as Hearts does) — the frame-time numbers are measured on
 * release builds, and reaching wave 5 or 9 there needs the panel. Store builds never show it.
 */
const DEV_TOOLS = __DEV__ || isPreLaunchApiBuild();

// #2491: dev-panel run-stats view — a 4 Hz snapshot of the engine's counters.
const DEV_STATS_POLL_MS = 250;

interface DevStatsSnapshot {
  readonly wave: number;
  readonly difficulty: DifficultyTier;
  readonly score: number;
  readonly rows: readonly TierDodgeRow[];
  readonly run: RunStats;
}

function snapshotStats(s: StarSwarmState): DevStatsSnapshot {
  return {
    wave: s.wave,
    difficulty: s.difficulty,
    score: s.score,
    rows: dodgeRateByTier(s),
    run: s.runStats,
  };
}

/** What the `__starswarm_getRunStats` test hook returns (#2491). */
interface RunStatsHook {
  readonly runStats: RunStats;
  readonly tierStats: StarSwarmState["tierStats"];
  readonly wave: number;
  readonly difficulty: DifficultyTier;
  readonly score: number;
  /** #2567: the last second of frame times and canvas commits (null on web or before a frame). */
  readonly frame: FrameStatsSummary | null;
}

const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);
const col = (x: number | string, w: number) => String(x).padStart(w);
const TIER_TABLE_HEADER = `${"tier".padEnd(7)} base  eff rolls dodge  rate struck flak`;

function tierTableLine(row: TierDodgeRow): string {
  const rate = row.rolls > 0 ? pct(row.dodged / row.rolls) : col("-", 4);
  return (
    `${row.tier.padEnd(7)} ${pct(row.base)} ${pct(row.effective)} ` +
    `${col(row.rolls, 5)} ${col(row.dodged, 5)} ${col(rate, 5)} ${col(row.struck, 6)} ${col(row.flak, 4)}`
  );
}

const RUN_STAT_LINES: readonly (readonly [string, keyof RunStats])[] = [
  ["Reinforcements launched", "reinforced"],
  ["Armor deflections", "armorDeflects"],
  ["Beam hits on player", "beamHits"],
  ["Rout caught", "routCaught"],
  ["Rout escaped", "routEscaped"],
  ["Rocks spawned", "rocksSpawned"],
  ["Rocks broken by player", "rocksBrokenByPlayer"],
  ["Rocks broken by enemies", "rocksBrokenByEnemy"],
];

const DIFFICULTY_STORAGE_KEY = "starswarm.difficulty";

export default function StarSwarmScreen() {
  const { t } = useTranslation("starswarm");
  const { t: tResult } = useTranslation("result");
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList, "StarSwarm">>();

  const canvasRef = useRef<GameCanvasHandle>(null);

  // Capture saved paused session once at mount — used to restore game state and skip difficulty picker.
  const savedPauseRef = useRef(getSavedPausedState());

  const [highScore, setHighScore] = useState(0);
  /** The finished run the result card shows (#2516); null while playing. */
  const [result, setResult] = useState<{
    score: number;
    wave: number;
    best: number;
    isNewBest: boolean;
  } | null>(null);
  const leaderboard = useLeaderboardSubmit(starSwarmLeaderboard);
  const { submit: submitScore, reset: resetSubmission } = leaderboard;

  // Per-session `games` row (#2516), like every other game: XP, Profile history
  // and SyncWorker. It never carries a score — Star Swarm's leaderboard ranks
  // every scored Star Swarm row, so a scored session would list each run twice.
  const {
    restart: syncRestart,
    markStarted: syncMarkStarted,
    complete: syncComplete,
  } = useGameSync("starswarm");
  const [phase, setPhase] = useState<GamePhase>("SwoopIn");
  const [isPaused, setIsPaused] = useState(savedPauseRef.current !== null);
  const [containerW, setContainerW] = useState(0);
  const [containerH, setContainerH] = useState(0);

  // Dev panel state — used only when DEV_TOOLS (dev and internal pre-launch builds, #2567)
  const [devPanelOpen, setDevPanelOpen] = useState(false);
  const [devWave, setDevWave] = useState(1);
  const [devInfiniteLives, setDevInfiniteLives] = useState(false);
  const [devStragglerEnabled, setDevStragglerEnabled] = useState(true);
  const [devPauseStraggler, setDevPauseStraggler] = useState(false);
  const [devDifficulty, setDevDifficulty] = useState<DifficultyTier>("LieutenantJG");
  const [devVolumes, setDevVolumes] = useState<SfxVolumes>(DEFAULT_SFX_VOLUMES);
  const [devPlayerFireOff, setDevPlayerFireOff] = useState(false);
  const [devEnemyFireOff, setDevEnemyFireOff] = useState(false);
  const [devAsteroidsOff, setDevAsteroidsOff] = useState(false); // #2486
  const [devDodgeOff, setDevDodgeOff] = useState(false); // #2491
  const [devFlakOff, setDevFlakOff] = useState(false); // #2491
  const [devRoutOff, setDevRoutOff] = useState(false); // #2489
  const [devFrameReadout, setDevFrameReadout] = useState(false); // #2567
  // #2491: a snapshot of the engine's counters, polled at ≤4 Hz while the panel is open
  const [devStats, setDevStats] = useState<DevStatsSnapshot | null>(null);

  // Pre-game difficulty selector — shown before each new game (skipped when restoring a saved session).
  // Defaults to Ensign for new users; AsyncStorage load below promotes it to the last-played tier.
  const [difficulty, setDifficulty] = useState<DifficultyTier>(
    savedPauseRef.current?.difficulty ?? "Ensign"
  );
  const [showDifficultyPicker, setShowDifficultyPicker] = useState(savedPauseRef.current === null);

  // On mount, restore the last-used difficulty from local storage (skipped when a saved-pause
  // session supplies its own difficulty, which takes precedence).
  useEffect(() => {
    if (savedPauseRef.current !== null) return;
    AsyncStorage.getItem(DIFFICULTY_STORAGE_KEY)
      .then((stored) => {
        if (stored !== null && (DIFFICULTY_TIERS as readonly string[]).includes(stored)) {
          setDifficulty(stored as DifficultyTier);
        }
      })
      .catch(() => {});
  }, []);

  const adjustVolume = useCallback((key: keyof SfxVolumes, delta: number) => {
    setDevVolumes((v) => ({
      ...v,
      [key]: Math.round(Math.min(1, Math.max(0, v[key] + delta)) * 10) / 10,
    }));
  }, []);

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
  // Increments on every new-game request; GameCanvas watches this via useEffect to reset.
  const [resetTick, setResetTick] = useState(0);

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
  } = useStarSwarmAudio(phase !== "GameOver", devVolumes, resetTick);
  // In dev builds, track the last opts from the panel so every subsequent "New Game"
  // (header, game-over overlay) re-applies them without reopening the dev panel.
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
  // Re-armed on every new game: both paths (difficulty picker, dev panel) bump resetTick.
  const runStatsReportedRef = useRef(false);
  useEffect(() => {
    runStatsReportedRef.current = false;
  }, [resetTick]);

  const handleGameOver = useCallback(
    (finalScore: number, wave: number) => {
      setPhase("GameOver");
      playGameOver();
      // The result card's haptic marks the end of the run (#2516).
      const priorBest = highScoreRef.current;
      const isNewBest = finalScore > priorBest;
      if (isNewBest) {
        highScoreRef.current = finalScore;
        setHighScore(finalScore);
        void saveBestScore(finalScore);
      }
      setResult({ score: finalScore, wave, best: Math.max(finalScore, priorBest), isNewBest });
      // #2567: the tier the run was actually played at — a dev-panel New Game sets its own
      const tier = canvasRef.current?.getState()?.difficulty ?? difficulty;
      // The starswarm router reads wave_reached / difficulty_tier from games.metadata.
      const payload = { outcome: "completed", wave_reached: wave, difficulty_tier: tier };
      syncComplete({ outcome: "completed", result: payload }, payload);
      submitScore({ score: finalScore, wave, difficulty: tier });
      if (!runStatsReportedRef.current) {
        const state = canvasRef.current?.getState();
        if (state) {
          runStatsReportedRef.current = true;
          reportRunStats(state);
        }
      }
    },
    [playGameOver, difficulty, syncComplete, submitScore]
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

  // #2484: the Carrier's armor dropping is a state change with no on-screen text — speak it.
  const handleCarrierExposed = useCallback(() => {
    AccessibilityInfo.announceForAccessibility(t("a11y.carrierExposed"));
  }, [t]);

  // #2485: beam telegraph and reinforcement launches — sound plus a spoken cue, since neither
  // has on-screen text and the beam gives the player only ~0.6 s to react.
  const handleCarrierEvent = useCallback(
    (kind: CarrierEvent) => {
      playCarrierEvent(kind);
      if (kind === "beamCharge") {
        AccessibilityInfo.announceForAccessibility(t("a11y.carrierBeam"));
      } else if (kind === "reinforce") {
        AccessibilityInfo.announceForAccessibility(t("a11y.reinforcements"));
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
    setPhase("WaveClear");
    playWaveClear();
    hapticWaveClear();
  }, [playWaveClear]);

  const handleBonusLife = useCallback(() => {
    playBonusLife();
  }, [playBonusLife]);

  const handleTriggerPowerUp = useCallback((type: PowerUpType) => {
    canvasRef.current?.triggerPowerUp(type);
  }, []);

  const handleThrowAsteroid = useCallback(() => {
    canvasRef.current?.throwAsteroid(); // #2486
  }, []);

  // #2567: stable, so the readout's poll timer is not restarted by screen re-renders
  const readFrameStats = useCallback(() => canvasRef.current?.getFrameStats() ?? null, []);

  const handleKillEscorts = useCallback(() => {
    canvasRef.current?.killEscorts(); // #2491
  }, []);

  // #2491: refresh the dev panel's counters at 4 Hz while it is open — a timer, never a
  // per-frame React update; the loop itself keeps running in the canvas untouched.
  useEffect(() => {
    if (!DEV_TOOLS || !devPanelOpen) return;
    const read = () => {
      const s = canvasRef.current?.getState();
      setDevStats(s ? snapshotStats(s) : null);
    };
    read();
    const id = setInterval(read, DEV_STATS_POLL_MS);
    return () => clearInterval(id);
  }, [devPanelOpen]);

  const handleGameOverRef = useRef(handleGameOver);
  handleGameOverRef.current = handleGameOver;

  // #2491: test-hook seam (EXPO_PUBLIC_TEST_HOOKS=1 builds only) so an E2E driver can read the
  // counters without the panel: `__starswarm_getRunStats()` → counts + wave/difficulty/score.
  // #2516: `__starswarm_endRun(score, wave)` ends the run through the real game-over path
  // (result card, leaderboard submit, game sync) with the canvas frozen behind the card —
  // reaching game over by real play isn't practical in an E2E run.
  useEffect(() => {
    if (!areTestHooksEnabled()) return;
    const g = globalThis as typeof globalThis & {
      __starswarm_getRunStats?: () => RunStatsHook | null;
      __starswarm_endRun?: (score: number, wave: number) => void;
    };
    g.__starswarm_endRun = (score, wave) => {
      setIsPaused(true);
      handleGameOverRef.current(score, wave);
    };
    g.__starswarm_getRunStats = () => {
      const s = canvasRef.current?.getState();
      return s
        ? {
            runStats: s.runStats,
            tierStats: s.tierStats,
            wave: s.wave,
            difficulty: s.difficulty,
            score: s.score,
            frame: canvasRef.current?.getFrameStats() ?? null,
          }
        : null;
    };
    return () => {
      delete g.__starswarm_getRunStats;
      delete g.__starswarm_endRun;
    };
  }, []);

  /** Opens the new run's sync session (abandoning any open one) and clears the last result. */
  const beginRun = useCallback(
    (tier: DifficultyTier) => {
      syncRestart({ difficulty_tier: tier }, { difficulty_tier: tier });
      syncMarkStarted();
      setResult(null);
      resetSubmission();
    },
    [syncRestart, syncMarkStarted, resetSubmission]
  );

  // A run restored from a saved pause is a run in progress: give it a session.
  useEffect(() => {
    if (savedPauseRef.current !== null) beginRun(savedPauseRef.current.difficulty);
    // Mount-only: the saved pause is read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNewGame = useCallback(
    (opts?: DevOptions) => {
      if (DEV_TOOLS && opts !== undefined) lastDevOptsRef.current = opts;
      beginRun(opts?.difficulty ?? difficulty);
      scoreRef.current = 0;
      setPhase("SwoopIn");
      setIsPaused(false);
      setResetTick((t) => t + 1);
    },
    [beginRun, difficulty]
  );

  // Show difficulty picker — header "New Game", the pause overlay, and the
  // result card's Change Difficulty. The card steps aside for the picker.
  const handleRequestNewGame = useCallback(() => {
    setResult(null);
    setShowDifficultyPicker(true);
  }, []);

  // Confirm difficulty selection and start the game
  const handleConfirmDifficulty = useCallback(() => {
    // #2567: a picker New Game is a clean run — the dev panel's wave, lives and difficulty stay
    // with the panel's own New Game, now that internal testers can reach it
    lastDevOptsRef.current = undefined;
    AsyncStorage.setItem(DIFFICULTY_STORAGE_KEY, difficulty).catch(() => {});
    clearSavedPausedState();
    savedPauseRef.current = null;
    setShowDifficultyPicker(false);
    beginRun(difficulty);
    scoreRef.current = 0;
    setPhase("SwoopIn");
    setIsPaused(false);
    setResetTick((t) => t + 1);
  }, [difficulty, beginRun]);

  const handlePause = useCallback(() => {
    setIsPaused(true);
  }, []);

  const handleResume = useCallback(() => {
    setIsPaused(false);
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if ((next === "background" || next === "inactive") && phase === "Playing") {
        handlePause();
      }
    });
    return () => sub.remove();
  }, [phase, handlePause]);

  const dynamicStyles = getStyles(colors);

  const scale =
    containerW > 0 && containerH > 0 ? Math.min(containerW / CANVAS_W, containerH / CANVAS_H) : 0;

  const displayW = Math.round(CANVAS_W * scale);
  const displayH = Math.round(CANVAS_H * scale);

  const showPauseBtn = !showDifficultyPicker && phase !== "GameOver" && scale > 0;

  return (
    <GameShell
      title={t("game.title")}
      requireBack
      onBack={() => {
        if (isPaused) {
          const state = canvasRef.current?.getState();
          if (state) savePausedState({ gameState: state, difficulty });
        }
        navigation.popToTop();
      }}
      onNewGame={handleRequestNewGame}
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
      style={{
        paddingBottom: Math.max(insets.bottom, 8),
        paddingLeft: Math.max(insets.left, 0),
        paddingRight: Math.max(insets.right, 0),
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
              // #1311/#1312: spread lastDevOptsRef for new-game options (wave, lives, etc.),
              // then override live-toggleable fields so they propagate mid-game without New Game.
              // pauseStraggler is also overridden here (fixes a pre-existing gap where the toggle
              // only took effect after New Game).
              devOptions={
                DEV_TOOLS
                  ? {
                      ...lastDevOptsRef.current,
                      pauseStraggler: devPauseStraggler,
                      playerFireDisabled: devPlayerFireOff,
                      enemyFireDisabled: devEnemyFireOff,
                      asteroidsDisabled: devAsteroidsOff,
                      dodgeDisabled: devDodgeOff,
                      flakDisabled: devFlakOff,
                      routDisabled: devRoutOff,
                    }
                  : undefined
              }
            />
            <Controls
              canvasRef={canvasRef}
              scale={scale}
              phase={phase}
              isPaused={isPaused}
              onPause={handlePause}
              onResume={handleResume}
              onNewGame={handleRequestNewGame}
            />
            {DEV_TOOLS && (
              <Pressable style={dynamicStyles.devButton} onPress={() => setDevPanelOpen(true)}>
                <Text style={styles.devButtonText}>DEV</Text>
              </Pressable>
            )}
            {DEV_TOOLS && devFrameReadout && <FrameStatsReadout read={readFrameStats} />}
          </View>
        )}
        {showDifficultyPicker && scale > 0 && (
          <Modal
            visible
            transparent
            animationType="fade"
            onRequestClose={handleConfirmDifficulty}
            accessibilityViewIsModal
          >
            <View style={styles.pickerOverlay}>
              <View style={dynamicStyles.pickerPanel}>
                <Text style={dynamicStyles.pickerTitle}>{t("difficulty.selectTitle")}</Text>
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  style={styles.pickerScroll}
                  contentContainerStyle={styles.pickerScrollContent}
                >
                  {DIFFICULTY_TIERS.map((tier) => (
                    <Pressable
                      key={tier}
                      style={[
                        dynamicStyles.pickerRow,
                        difficulty === tier && dynamicStyles.pickerRowSelected,
                      ]}
                      onPress={() => setDifficulty(tier)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: difficulty === tier }}
                      aria-checked={difficulty === tier}
                      accessibilityLabel={`${difficultyLabel(tier)} ×${difficultyMultiplier(tier)}`}
                    >
                      <Text
                        style={[
                          dynamicStyles.pickerTierName,
                          difficulty === tier && dynamicStyles.pickerTierNameSelected,
                        ]}
                      >
                        {difficultyLabel(tier)}
                      </Text>
                      <Text style={styles.pickerTierMult}>{`×${difficultyMultiplier(tier)}`}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <Pressable
                  testID="starswarm-start-game"
                  style={[styles.devActionBtn, dynamicStyles.devPrimary, styles.pickerStartBtn]}
                  onPress={handleConfirmDifficulty}
                >
                  <Text style={styles.devPrimaryText}>{t("difficulty.start")}</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        )}

        <GameResultModal
          visible={result !== null && !showDifficultyPicker}
          outcome="ended"
          eyebrow={`${t("game.title")} · ${difficultyLabel(difficulty)}`}
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
          submission={{
            status: leaderboard.status,
            rank: leaderboard.rank,
            playerName: leaderboard.playerName,
            onProvideName: leaderboard.provideName,
            onRetry: leaderboard.retry,
          }}
          // Same difficulty, straight into a new run.
          onPlayAgain={handleConfirmDifficulty}
          secondaryAction={{
            label: tResult("action.changeDifficulty"),
            onPress: handleRequestNewGame,
          }}
          onHome={() => navigation.popToTop()}
          testID="starswarm-result"
        />

        {DEV_TOOLS && devPanelOpen && (
          <View
            style={dynamicStyles.devPanelOverlay}
            accessible
            accessibilityLabel="Developer panel"
            accessibilityRole="menu"
          >
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.devScrollContent}
            >
              <Text style={dynamicStyles.devTitle}>DEV</Text>

              <View style={styles.devRow}>
                <Text style={dynamicStyles.devLabel}>Wave</Text>
                <Pressable
                  style={styles.devStepBtn}
                  onPress={() => setDevWave((w) => Math.max(1, w - 1))}
                  accessibilityLabel="Decrease wave"
                >
                  <Text style={styles.devStepText}>−</Text>
                </Pressable>
                <Text style={styles.devValue}>{devWave}</Text>
                <Pressable
                  style={styles.devStepBtn}
                  onPress={() => setDevWave((w) => Math.min(15, w + 1))}
                  accessibilityLabel="Increase wave"
                >
                  <Text style={styles.devStepText}>+</Text>
                </Pressable>
              </View>

              <View style={styles.devRow}>
                <Text style={dynamicStyles.devLabel}>Infinite lives</Text>
                <Switch value={devInfiniteLives} onValueChange={setDevInfiniteLives} />
              </View>

              <View style={styles.devRow}>
                <Text style={dynamicStyles.devLabel}>Straggler AI</Text>
                <Switch value={devStragglerEnabled} onValueChange={setDevStragglerEnabled} />
              </View>

              <View style={styles.devRow}>
                <Text style={dynamicStyles.devLabel}>Pause straggler</Text>
                <Switch value={devPauseStraggler} onValueChange={setDevPauseStraggler} />
              </View>

              <View style={styles.devRow}>
                <Text style={dynamicStyles.devLabel}>Player missiles off</Text>
                <Switch value={devPlayerFireOff} onValueChange={setDevPlayerFireOff} />
              </View>

              <View style={styles.devRow}>
                <Text style={dynamicStyles.devLabel}>Enemy missiles off</Text>
                <Switch value={devEnemyFireOff} onValueChange={setDevEnemyFireOff} />
              </View>

              <View style={styles.devRow}>
                <Text style={dynamicStyles.devLabel}>Asteroids off</Text>
                <Switch value={devAsteroidsOff} onValueChange={setDevAsteroidsOff} />
              </View>

              <Pressable
                style={styles.devActionBtn}
                onPress={handleThrowAsteroid}
                accessibilityLabel="Throw asteroid"
              >
                <Text style={dynamicStyles.devLabel}>Throw asteroid</Text>
              </Pressable>

              <View style={styles.devRow}>
                <Text style={dynamicStyles.devLabel}>Dodge off</Text>
                <Switch value={devDodgeOff} onValueChange={setDevDodgeOff} />
              </View>

              <View style={styles.devRow}>
                <Text style={dynamicStyles.devLabel}>Flak off</Text>
                <Switch value={devFlakOff} onValueChange={setDevFlakOff} />
              </View>

              <View style={styles.devRow}>
                <Text style={dynamicStyles.devLabel}>Rout off</Text>
                <Switch value={devRoutOff} onValueChange={setDevRoutOff} />
              </View>

              {/* #2567: frame-time avg / p95 and canvas commits/s, shown over the game */}
              <View style={styles.devRow}>
                <Text style={dynamicStyles.devLabel}>Frame readout</Text>
                <Switch value={devFrameReadout} onValueChange={setDevFrameReadout} />
              </View>

              <Pressable
                style={styles.devActionBtn}
                onPress={handleKillEscorts}
                accessibilityLabel="Kill escorts"
              >
                <Text style={dynamicStyles.devLabel}>Kill escorts</Text>
              </Pressable>

              <Text style={dynamicStyles.devSectionHeader}>── Run stats ──</Text>

              {devStats ? (
                <View accessibilityLabel="Run stats">
                  <Text style={styles.devMono}>
                    {`wave ${devStats.wave} · ${devStats.difficulty} · score ${devStats.score}`}
                  </Text>
                  <Text style={styles.devMono}>{TIER_TABLE_HEADER}</Text>
                  {devStats.rows.map((row) => (
                    <Text key={row.tier} style={styles.devMono}>
                      {tierTableLine(row)}
                    </Text>
                  ))}
                  {RUN_STAT_LINES.map(([label, key]) => (
                    <View key={key} style={styles.devRow}>
                      <Text style={dynamicStyles.devLabel}>{label}</Text>
                      <Text style={styles.devValue}>{devStats.run[key]}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={dynamicStyles.devLabel}>Start a game to see counters</Text>
              )}

              <Text style={dynamicStyles.devSectionHeader}>── Difficulty ──</Text>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.devTierScroll}
                contentContainerStyle={styles.devTierScrollContent}
              >
                {DIFFICULTY_TIERS.map((tier) => (
                  <Pressable
                    key={tier}
                    style={[styles.devTierBtn, devDifficulty === tier && styles.devTierBtnActive]}
                    onPress={() => setDevDifficulty(tier)}
                    accessibilityLabel={`Dev difficulty ${difficultyLabel(tier)}`}
                  >
                    <Text
                      style={[
                        styles.devTierText,
                        devDifficulty === tier && styles.devTierTextActive,
                      ]}
                    >
                      {difficultyLabel(tier)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              <Text style={dynamicStyles.devSectionHeader}>── Power-ups ──</Text>

              <View style={styles.devPowerUpRow}>
                {(["lightning", "shield", "buddy", "bomb", "salvage", "hull"] as PowerUpType[]).map(
                  (type) => (
                    <Pressable
                      key={type}
                      style={styles.devPowerUpBtn}
                      onPress={() => handleTriggerPowerUp(type)}
                      accessibilityLabel={`Trigger ${type} power-up`}
                    >
                      <Text style={styles.devPowerUpText}>{type}</Text>
                    </Pressable>
                  )
                )}
              </View>

              <Text style={dynamicStyles.devSectionHeader}>── Sound ──</Text>

              {(
                [
                  ["Laser", "laser"],
                  ["PU: Lightning", "poweruplightning"],
                  ["PU: Shield", "powerupshield"],
                  ["PU: Buddy", "powerupbuddy"],
                  ["PU: Bomb", "powerupbomb"],
                  ["Explosion", "explosion"],
                  ["Player hit", "playerhit"],
                  ["Wave clear", "waveclear"],
                  ["Game over", "gameover"],
                  ["Boss wave", "bosswave"],
                  ["Beam charge", "beamcharge"],
                  ["Beam fire", "beamfire"],
                  ["Reinforce", "reinforce"],
                  ["Salvage", "salvage"],
                  ["Hull up", "hullup"],
                  ["Hull hit", "hullhit"],
                  ["Rout", "rout"],
                ] as [string, keyof SfxVolumes][]
              ).map(([label, key]) => (
                <View key={key} style={styles.devRow}>
                  <Text style={[dynamicStyles.devLabel, styles.devMixerLabel]}>{label}</Text>
                  <Pressable
                    style={styles.devStepBtn}
                    onPress={() => adjustVolume(key, -0.1)}
                    accessibilityLabel={`Decrease ${label} volume`}
                  >
                    <Text style={styles.devStepText}>−</Text>
                  </Pressable>
                  <Text style={styles.devValue}>{devVolumes[key].toFixed(1)}</Text>
                  <Pressable
                    style={styles.devStepBtn}
                    onPress={() => adjustVolume(key, 0.1)}
                    accessibilityLabel={`Increase ${label} volume`}
                  >
                    <Text style={styles.devStepText}>+</Text>
                  </Pressable>
                </View>
              ))}

              <Pressable
                style={[styles.devActionBtn, dynamicStyles.devPrimary]}
                onPress={() => {
                  setDevPanelOpen(false);
                  handleNewGame({
                    wave: devWave,
                    infiniteLives: devInfiniteLives,
                    stragglerEnabled: devStragglerEnabled,
                    pauseStraggler: devPauseStraggler,
                    difficulty: devDifficulty,
                  });
                }}
              >
                <Text style={styles.devPrimaryText}>New Game</Text>
              </Pressable>

              <Pressable style={styles.devActionBtn} onPress={() => setDevPanelOpen(false)}>
                <Text style={dynamicStyles.devLabel}>Collapse</Text>
              </Pressable>
            </ScrollView>
          </View>
        )}
      </View>
    </GameShell>
  );
}

const baseStyles = StyleSheet.create({
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
  devButtonText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
  },
  devRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  devStepBtn: {
    backgroundColor: "rgba(255,255,255,0.1)",
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  devStepText: {
    color: "#fff",
    fontSize: 18,
    lineHeight: 22,
  },
  devValue: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    minWidth: 28,
    textAlign: "center",
  },
  devMono: {
    color: "#fff",
    fontSize: 11,
    lineHeight: 16,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },
  devScrollContent: {
    gap: 16,
  },
  devMixerLabel: {
    fontSize: 11,
    minWidth: 80,
  },
  devPowerUpRow: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
  },
  devPowerUpBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: "center",
    backgroundColor: "rgba(255,200,0,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,200,0,0.4)",
  },
  devPowerUpText: {
    color: "#ffc800",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  devActionBtn: {
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  devPrimaryText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  devTierScroll: {
    marginVertical: 2,
  },
  devTierScrollContent: {
    gap: 6,
    paddingVertical: 2,
  },
  devTierBtn: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  devTierBtnActive: {
    backgroundColor: "rgba(255,128,0,0.3)",
    borderColor: "rgba(255,128,0,0.8)",
  },
  devTierText: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 9,
    fontWeight: "700",
  },
  devTierTextActive: {
    color: "#ff8000",
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,10,0.88)",
    alignItems: "center",
    justifyContent: "center",
  },
  pickerScroll: {
    maxHeight: 320,
  },
  pickerScrollContent: {
    gap: 6,
    paddingVertical: 4,
  },
  pickerTierMult: {
    color: "rgba(255,238,0,0.8)",
    fontSize: 13,
    fontWeight: "700",
  },
  pickerStartBtn: {
    marginTop: 12,
    backgroundColor: "#b05800", // #fff text on this gives ~5.1:1 contrast (WCAG AA)
  },
});

// Create dynamic styles based on theme tokens to comply with design-tokens policy
const getStyles = (colors: ReturnType<typeof useTheme>["colors"]) =>
  StyleSheet.create({
    ...baseStyles,
    devButton: {
      position: "absolute",
      top: 6,
      left: 6,
      backgroundColor: "rgba(255,128,0,0.85)",
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      zIndex: 100,
    },
    devPanelOverlay: {
      position: "absolute",
      right: 0,
      top: 0,
      bottom: 0,
      width: 180,
      backgroundColor: "rgba(0,0,0,0.88)",
      borderLeftWidth: 1,
      borderLeftColor: "rgba(255,128,0,0.4)",
      zIndex: 100,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    devTitle: {
      color: "rgba(255,128,0,1)",
      fontSize: 14,
      fontWeight: "700",
      letterSpacing: 2,
      textAlign: "center",
      textTransform: "uppercase",
    },
    devLabel: {
      color: colors.textMuted,
      fontSize: 13,
      flex: 1,
    },
    devSectionHeader: {
      color: "rgba(255,128,0,0.7)",
      fontSize: 10,
      letterSpacing: 1,
      textAlign: "center",
      marginTop: 4,
    },
    devPrimary: {
      backgroundColor: "rgba(255,128,0,1)",
    },
    pickerPanel: {
      backgroundColor: colors.surfaceHigh,
      borderRadius: 14,
      padding: 24,
      width: 300,
      maxHeight: "80%",
      borderWidth: 1,
      borderColor: "rgba(0,255,200,0.3)",
    },
    pickerTitle: {
      color: "#00ffcc",
      fontSize: 15,
      fontWeight: "700",
      letterSpacing: 1.5,
      textAlign: "center",
      textTransform: "uppercase",
      marginBottom: 14,
    },
    pickerRowSelected: {
      backgroundColor: "rgba(0,255,200,0.12)",
      borderColor: "rgba(0,255,200,0.55)",
    },
    pickerTierNameSelected: {
      color: "#ffffff",
    },
    pickerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.textMuted + "30",
      backgroundColor: colors.textMuted + "0d",
    },
    pickerTierName: {
      color: colors.text,
      fontSize: 13,
      fontWeight: "600",
    },
  });

const styles = baseStyles;
