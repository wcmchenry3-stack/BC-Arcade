import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, View, LayoutChangeEvent } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { createAudioPlayer } from "expo-audio";
import type { HomeStackParamList } from "../../App";
import { useTheme } from "../theme/ThemeContext";
import { GameShell } from "../components/shared/GameShell";
import { AnimationOverlay } from "../components/shared/AnimationOverlay";
import { FruitSetProvider, useFruitSet } from "../theme/FruitSetContext";
import { FruitQueue } from "../game/cascade/fruitQueue";
import { ControlledSpawnSelector, createSeededRng } from "../game/cascade/spawnSelector";
import { WORLD_W, WORLD_H, GameEvent } from "../game/cascade/engine";
import type { FruitTier } from "../theme/fruitSets";
import { scoreForMerge } from "../game/cascade/scoring";
import GameCanvas, { GameCanvasHandle } from "../components/cascade/GameCanvas";
import NextFruitPreview from "../components/cascade/NextFruitPreview";
import ScoreDisplay from "../components/cascade/ScoreDisplay";
import ThemeSelector from "../components/cascade/ThemeSelector";
import GameOverOverlay from "../components/cascade/GameOverOverlay";
import { useGameSync } from "../game/_shared/useGameSync";
import {
  saveGame as saveCascadeGame,
  loadGame as loadCascadeGame,
  clearGame as clearCascadeGame,
  CascadeGameSnapshot,
} from "../game/cascade/storage";
import { useCascadeScoreboard } from "../game/cascade/CascadeScoreboardContext";
import { useSound } from "../game/_shared/useSound";
import { useSoundSettings } from "../game/_shared/SoundContext";
import { SOUND_REGISTRY } from "../game/_shared/sounds";

/** Throttle for save-during-play — saves at most this often. */
const SAVE_THROTTLE_MS = 2000;

// ---------------------------------------------------------------------------
// Merge burst animation (react-native-reanimated)
// ---------------------------------------------------------------------------

interface MergeBurstData {
  id: string;
  x: number; // display px from left of canvas container
  y: number; // display px from top of canvas container
  color: string;
}

function MergeBurst({ x, y, color, onDone }: MergeBurstData & { onDone: () => void }) {
  const scale = useSharedValue(0.1);
  const opacity = useSharedValue(0.75);

  useEffect(() => {
    scale.value = withSpring(2.2, { damping: 6, stiffness: 50 });
    opacity.value = withTiming(0, { duration: 550 }, (finished) => {
      if (finished) runOnJS(onDone)();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    position: "absolute",
    left: x - 20,
    top: y - 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: color,
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return <Animated.View pointerEvents="none" style={animStyle} />;
}

// ---------------------------------------------------------------------------
// Tier-scaled merge sound (volume 0.35 → 1.0 across tiers 0 → 10)
// ---------------------------------------------------------------------------

function useTieredMergeSound() {
  const { muted } = useSoundSettings();
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  useEffect(() => {
    const source = SOUND_REGISTRY["cascade.fruitMerge"];
    if (!source) return;
    const player = createAudioPlayer(source);
    playerRef.current = player;
    return () => {
      player.remove();
      playerRef.current = null;
    };
  }, []);

  return useCallback(
    (tier: number) => {
      if (mutedRef.current || !playerRef.current) return;
      const volume = Math.min(1, 0.35 + tier * 0.065);
      try {
        (playerRef.current as unknown as { volume: number }).volume = volume;
        playerRef.current.seekTo(0);
        playerRef.current.play();
      } catch {
        /* expo-audio may throw if audio context is suspended */
      }
    },
    [] // stable — reads only refs
  );
}

function CascadeGame() {
  const { t } = useTranslation(["cascade", "common"]);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { activeFruitSet } = useFruitSet();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList, "Cascade">>();

  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [, setQueueVersion] = useState(0);

  // Animation state
  const [mergeBursts, setMergeBursts] = useState<MergeBurstData[]>([]);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);
  const comboOpacity = useSharedValue(0);
  const comboAnimStyle = useAnimatedStyle(() => ({ opacity: comboOpacity.value }));
  const nextBurstId = useId();

  // Sounds
  const playFruitMerge = useTieredMergeSound();
  const { play: playCascadeCombo } = useSound("cascade.cascadeCombo");
  const { play: playGameOver } = useSound("cascade.gameOver");

  const canvasRef = useRef<GameCanvasHandle>(null);
  const queueRef = useRef(new FruitQueue());
  const droppingRef = useRef(false);
  const lastDropTimeRef = useRef<number>(Date.now());
  const dropCountRef = useRef<number>(0);
  const prevFruitSetId = useRef(activeFruitSet.id);

  // Refs used by test hooks to read latest state without closure staleness
  const scoreRef = useRef(0);
  const gameOverRef = useRef(false);
  const activeFruitSetRef = useRef(activeFruitSet);

  // Instrumentation session state (#371 / #549). One session spans from mount
  // until handleGameOver, a fruit-set switch, New Game, or unmount.
  const {
    start: syncStart,
    markStarted: syncMarkStarted,
    enqueue: syncEnqueue,
    complete: syncComplete,
    getGameId,
  } = useGameSync("cascade");
  const { setSnapshot: setScoreboardSnapshot } = useCascadeScoreboard();
  const bestScoreRef = useRef(0);
  const bestFruitTierRef = useRef(-1);
  const bestFruitNameRef = useRef("—");
  const gamesPlayedRef = useRef(0);

  // Holds the game ID captured at game-over so GameOverOverlay can PATCH /cascade/score/{id}.
  const completedGameIdRef = useRef<string | null>(null);
  const gameStartTimeRef = useRef<number>(Date.now());
  const mergeCountRef = useRef(0);
  const comboCountRef = useRef(0);

  // Reload persistence state (#216).
  const lastSaveTimeRef = useRef<number>(0);
  // Holds a loaded snapshot until the canvas signals ready via onReady,
  // at which point we restore fruits onto the physics world.
  const pendingLoadRef = useRef<CascadeGameSnapshot | null>(null);
  // One-shot guard — load runs exactly once per screen mount, even if
  // onReady fires multiple times because of canvas re-init.
  const hasLoadedRef = useRef(false);

  const startInstrumentedSession = useCallback(
    (themeId: string) => {
      gameStartTimeRef.current = Date.now();
      mergeCountRef.current = 0;
      syncStart({ fruit_set: themeId, theme: themeId, seed: null });
    },
    [syncStart]
  );

  const endInstrumentedSession = useCallback(
    (outcome: "completed" | "abandoned") => {
      const durationMs = Date.now() - gameStartTimeRef.current;
      syncComplete(
        { finalScore: scoreRef.current, outcome, durationMs },
        {
          final_score: scoreRef.current,
          duration_ms: durationMs,
          theme: activeFruitSetRef.current.id,
          total_drops: dropCountRef.current,
          total_merges: mergeCountRef.current,
          outcome,
        }
      );
    },
    [syncComplete]
  );

  const pushScoreboardSnapshot = useCallback(() => {
    setScoreboardSnapshot({
      score: scoreRef.current,
      bestScore: bestScoreRef.current,
      bestFruitName: bestFruitNameRef.current,
      mergeCount: mergeCountRef.current,
      gamesPlayed: gamesPlayedRef.current,
      hasGame: true,
    });
  }, [setScoreboardSnapshot]);

  // Start session on mount. Unmount cleanup is handled by useGameSync.
  useEffect(() => {
    startInstrumentedSession(activeFruitSetRef.current.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // #216 — Load any saved game on mount. The snapshot is held in
  // `pendingLoadRef` until the canvas signals ready, at which point
  // `handleCanvasReady` restores the fruits. Score + game-over state
  // restore synchronously here so the HUD updates immediately.
  useEffect(() => {
    let active = true;
    loadCascadeGame().then((snapshot) => {
      if (!active || !snapshot) return;
      // Don't restore a snapshot from a different theme — switching
      // fruit sets should show a fresh board, not the previous skin's
      // physics state.
      if (snapshot.fruitSetId !== activeFruitSetRef.current.id) {
        clearCascadeGame().catch(() => {});
        return;
      }
      scoreRef.current = snapshot.score;
      setScore(snapshot.score);
      if (snapshot.gameOver) {
        gameOverRef.current = true;
        setGameOver(true);
      }
      pendingLoadRef.current = snapshot;
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fired by GameCanvas once the physics engine has finished init.
  // At this point it's safe to call canvasRef.current.restoreFruits().
  const handleCanvasReady = useCallback(() => {
    if (hasLoadedRef.current) return;
    const snapshot = pendingLoadRef.current;
    if (!snapshot) return;
    hasLoadedRef.current = true;
    pendingLoadRef.current = null;
    // Rebuild the queue so [current, next] match what the player saw.
    // queueTiers is stored as plain numbers in the snapshot; cast back
    // to the narrower FruitTier union (0..10) — the storage loader
    // already validated these are finite numbers from a trusted save.
    const [cur, nxt] = snapshot.queueTiers as [FruitTier, FruitTier];
    queueRef.current = new FruitQueue(new ControlledSpawnSelector(), [cur, nxt]);
    setQueueVersion((v) => v + 1);
    // Restore fruits to the physics world. Web supports this; native
    // no-ops and the board stays empty (score is still preserved).
    canvasRef.current?.restoreFruits?.(snapshot.fruits, activeFruitSetRef.current);
  }, []);

  /** Build a snapshot from the current refs + canvas engine state. */
  const buildSnapshot = useCallback((): CascadeGameSnapshot => {
    const engineState = canvasRef.current?.getEngineState?.();
    const fruits = engineState?.fruits ?? [];
    return {
      version: 1,
      score: scoreRef.current,
      gameOver: gameOverRef.current,
      fruitSetId: activeFruitSetRef.current.id,
      queueTiers: [queueRef.current.peek(), queueRef.current.peekNext()],
      fruits: fruits.map((f) => ({ tier: f.tier, x: f.x, y: f.y })),
      savedAt: Date.now(),
    };
  }, []);

  /** Throttled save — called from gameplay triggers (merge, drop, etc). */
  const saveGameThrottled = useCallback(() => {
    const now = Date.now();
    if (now - lastSaveTimeRef.current < SAVE_THROTTLE_MS) return;
    lastSaveTimeRef.current = now;
    if (gameOverRef.current) return;
    saveCascadeGame(buildSnapshot()).catch(() => {});
  }, [buildSnapshot]);

  // Refs are updated synchronously at mutation sites (handleMerge,
  // handleGameOver, handleRestart, and test hooks) so that Playwright reads
  // see the latest value without waiting for a React commit to flush.
  // Only activeFruitSetRef tracks a prop and is safe to sync via effect.
  useEffect(() => {
    activeFruitSetRef.current = activeFruitSet;
  }, [activeFruitSet]);

  // Reset the engine when the player switches fruit set skin
  useEffect(() => {
    if (prevFruitSetId.current !== activeFruitSet.id) {
      prevFruitSetId.current = activeFruitSet.id;
      // Close out the previous session and open a fresh one for the new theme.
      endInstrumentedSession(gameOverRef.current ? "completed" : "abandoned");
      queueRef.current = new FruitQueue();
      scoreRef.current = 0;
      gameOverRef.current = false;
      dropCountRef.current = 0;
      setScore(0);
      setGameOver(false);
      setQueueVersion((v) => v + 1);
      canvasRef.current?.reset();
      // Drop any saved snapshot from the old theme — switching skins
      // starts fresh, per the "different theme" guard in the load effect.
      clearCascadeGame().catch(() => {});
      startInstrumentedSession(activeFruitSet.id);
    }
  }, [activeFruitSet.id, endInstrumentedSession, startInstrumentedSession]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainerWidth(Math.floor(width));
    setContainerHeight(Math.floor(height));
    containerWidthRef.current = Math.floor(width);
  }, []);

  const handleMerge = useCallback(
    (event: { tier: number; x: number; y: number }) => {
      const delta = scoreForMerge(event.tier);
      scoreRef.current += delta;
      setScore((s) => s + delta);
      mergeCountRef.current += 1;
      syncEnqueue({
        type: "merge",
        data: {
          from_tier: event.tier - 1,
          to_tier: event.tier,
          x: event.x,
          y: event.y,
          score_after: scoreRef.current,
        },
      });
      const merged = activeFruitSet.fruits[event.tier];
      if (merged) {
        canvasRef.current?.announceEvent(t("cascade:event.merged", { fruit: merged.name }));
        if (event.tier > bestFruitTierRef.current) {
          bestFruitTierRef.current = event.tier;
          bestFruitNameRef.current = merged.name;
        }
      }
      pushScoreboardSnapshot();
      // #216 — merges are the highest-value save trigger. A player who
      // just merged up a tier definitely wants that progress preserved
      // across an accidental reload.
      saveGameThrottled();
    },
    [activeFruitSet, t, saveGameThrottled, syncEnqueue, pushScoreboardSnapshot]
  );

  const handleGameOver = useCallback(() => {
    canvasRef.current?.announceEvent(t("cascade:event.gameOver"));
    gameOverRef.current = true;
    setGameOver(true);
    // Capture game ID before complete() nulls it out — overlay needs it for PATCH /cascade/score/:id.
    completedGameIdRef.current = getGameId();
    endInstrumentedSession("completed");
    // #216 — game over: clear the saved snapshot so the next mount
    // starts with a fresh board instead of resuming a lost game.
    clearCascadeGame().catch(() => {});
    gamesPlayedRef.current += 1;
    if (scoreRef.current > bestScoreRef.current) {
      bestScoreRef.current = scoreRef.current;
    }
    pushScoreboardSnapshot();
  }, [t, endInstrumentedSession, getGameId, pushScoreboardSnapshot]);

  // Refs used inside handleEvents to avoid stale closure issues
  const scaleRef2 = useRef(0);
  const containerWidthRef = useRef(0);

  const handleEvents = useCallback(
    (events: GameEvent[]) => {
      for (const evt of events) {
        if (evt.type === "fruitMerge") {
          handleMerge(evt);
          playFruitMerge(evt.tier);
          if (!reduceMotion) {
            const canvasScale = scaleRef2.current;
            const canvasOffsetX = (containerWidthRef.current - WORLD_W * canvasScale) / 2;
            const dispX = canvasOffsetX + evt.x * canvasScale;
            const dispY = evt.y * canvasScale;
            const fruitColor = activeFruitSet.fruits[evt.tier]?.color ?? "#fff";
            const burstId = `${nextBurstId}-${Date.now()}-${evt.x.toFixed(0)}`;
            setMergeBursts((prev) => [
              ...prev,
              { id: burstId, x: dispX, y: dispY, color: fruitColor },
            ]);
          }
        } else if (evt.type === "cascadeCombo") {
          comboCountRef.current += 1;
          playCascadeCombo();
          if (!reduceMotion) {
            comboOpacity.value = 0.4;
            comboOpacity.value = withTiming(0, { duration: 700 });
          }
        } else if (evt.type === "gameOver") {
          playGameOver();
          handleGameOver();
        }
      }
    },
    [
      handleMerge,
      handleGameOver,
      playFruitMerge,
      playCascadeCombo,
      playGameOver,
      reduceMotion,
      activeFruitSet,
      nextBurstId,
      comboOpacity,
    ]
  );

  const handleTap = useCallback(
    (x: number) => {
      const now = Date.now();
      const interval = now - lastDropTimeRef.current;

      if (gameOver || droppingRef.current) {
        console.log(
          `[Cascade] drop BLOCKED — gameOver=${gameOver} cooling=${droppingRef.current} intervalMs=${interval}`
        );
        return;
      }
      droppingRef.current = true;
      lastDropTimeRef.current = now;
      dropCountRef.current += 1;
      syncMarkStarted();

      const tier = queueRef.current.consume();
      setQueueVersion((v) => v + 1);

      console.log(
        `[Cascade] drop #${dropCountRef.current} tier=${tier} x=${Math.round(x)} intervalMs=${interval}`
      );

      syncEnqueue({
        type: "drop",
        data: {
          drop_index: dropCountRef.current,
          fruit_tier: tier,
          x,
          score_before: scoreRef.current,
        },
      });

      const def = activeFruitSet.fruits[tier];
      if (def === undefined) return;
      canvasRef.current?.drop(def, x);

      // #216 — throttled save on drop. Merges already save on their own,
      // but a player who drops a run of fruit without a merge should also
      // have their board captured every couple of seconds.
      saveGameThrottled();

      setTimeout(() => {
        droppingRef.current = false;
      }, 200);
    },
    [gameOver, activeFruitSet, saveGameThrottled, syncEnqueue, syncMarkStarted]
  );

  const handleSetSeed = useCallback((seed: number) => {
    queueRef.current = new FruitQueue(new ControlledSpawnSelector(createSeededRng(seed)));
    setQueueVersion((v) => v + 1);
  }, []);

  // -------------------------------------------------------------------------
  // Test seam — window.__cascade_* hooks (only when EXPO_PUBLIC_TEST_HOOKS=1)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (process.env.EXPO_PUBLIC_TEST_HOOKS !== "1") return;
    const g = globalThis as Record<string, unknown>;
    g.__cascade_getState = () => ({
      score: scoreRef.current,
      gameOver: gameOverRef.current,
      nextFruitTier: queueRef.current.peek(),
      comboCount: comboCountRef.current,
      ...canvasRef.current?.getEngineState?.(),
    });
    g.__cascade_setSeed = handleSetSeed;
    g.__cascade_dropAt = (x: number) => {
      if (gameOverRef.current) return;
      const tier = queueRef.current.consume();
      setQueueVersion((v) => v + 1);
      const def = activeFruitSetRef.current.fruits[tier];
      if (def === undefined) return;
      canvasRef.current?.drop(def, x);
    };
    g.__cascade_fastForward = (ms: number) => {
      canvasRef.current?.fastForward?.(ms);
    };
    g.__cascade_triggerGameOver = () => {
      completedGameIdRef.current = getGameId();
      gameOverRef.current = true;
      setGameOver(true);
    };
    g.__cascade_isReady = () => canvasRef.current?.isReady?.() === true;
    g.__cascade_spawnTierAt = (tier: number, x: number) => {
      if (gameOverRef.current) return;
      const def = activeFruitSetRef.current.fruits[tier];
      if (!def) return;
      canvasRef.current?.drop(def, x);
    };
    return () => {
      delete g.__cascade_getState;
      delete g.__cascade_setSeed;
      delete g.__cascade_dropAt;
      delete g.__cascade_fastForward;
      delete g.__cascade_triggerGameOver;
      delete g.__cascade_spawnTierAt;
      delete g.__cascade_isReady;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleRestart() {
    // Close out the existing session (abandoned if mid-game, completed if
    // the user landed on game-over already — in that case endSession is a
    // no-op via completedRef).
    endInstrumentedSession(gameOverRef.current ? "completed" : "abandoned");
    queueRef.current = new FruitQueue();
    scoreRef.current = 0;
    gameOverRef.current = false;
    dropCountRef.current = 0;
    comboCountRef.current = 0;
    setScore(0);
    setGameOver(false);
    setQueueVersion((v) => v + 1);
    canvasRef.current?.reset();
    // #216 — user-initiated restart clears the saved snapshot and
    // resets the throttle so the next drop saves immediately.
    clearCascadeGame().catch(() => {});
    lastSaveTimeRef.current = 0;
    hasLoadedRef.current = true; // prevent onReady from re-applying any stale pending load
    pendingLoadRef.current = null;
    startInstrumentedSession(activeFruitSetRef.current.id);
    pushScoreboardSnapshot();
  }

  const queue = queueRef.current;
  const currentDef = activeFruitSet.fruits[queue.peek()];
  const nextDef = activeFruitSet.fruits[queue.peekNext()];

  // Uniform scale so the fixed physics world fits the available container.
  // Uses the smaller of the two axes so the canvas always letterboxes cleanly.
  const scale =
    containerWidth > 0 && containerHeight > 0
      ? Math.min(containerWidth / WORLD_W, containerHeight / WORLD_H)
      : 0;
  scaleRef2.current = scale;

  return (
    <GameShell
      title={t("game.title")}
      requireBack
      onBack={() => navigation.popToTop()}
      onNewGame={handleRestart}
      onOpenScoreboard={() => navigation.navigate("Scoreboard", { gameKey: "cascade" })}
      style={{
        paddingBottom: Math.max(insets.bottom, 16),
        paddingLeft: Math.max(insets.left, 16),
        paddingRight: Math.max(insets.right, 16),
      }}
    >
      {/* Combined HUD: score + drop/next previews + high, all one row */}
      <ScoreDisplay score={score}>
        {currentDef !== undefined && nextDef !== undefined && (
          <NextFruitPreview current={currentDef} next={nextDef} />
        )}
      </ScoreDisplay>

      <ThemeSelector />

      {/* Canvas — portrait-constrained, centered */}
      <View style={styles.canvasWrapper}>
        <View
          style={[
            styles.canvasOuter,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
          onLayout={onLayout}
        >
          {scale > 0 && currentDef !== undefined && (
            <GameCanvas
              ref={canvasRef}
              fruitSet={activeFruitSet}
              nextDef={currentDef}
              onEvents={handleEvents}
              onTap={handleTap}
              onReady={handleCanvasReady}
              onSetSeed={process.env.EXPO_PUBLIC_TEST_HOOKS === "1" ? handleSetSeed : undefined}
              width={WORLD_W}
              height={WORLD_H}
              scale={scale}
            />
          )}
        </View>

        {/* Animation overlay — covers the canvas area, not clipped by canvasOuter */}
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          {/* Cascade combo pulse */}
          <Animated.View
            style={[StyleSheet.absoluteFillObject, styles.comboFlash, comboAnimStyle]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
          {/* Per-merge burst particles */}
          {mergeBursts.map((burst) => (
            <MergeBurst
              key={burst.id}
              {...burst}
              onDone={() => setMergeBursts((prev) => prev.filter((b) => b.id !== burst.id))}
            />
          ))}
        </View>
      </View>

      {/* Game over: fade-out overlay then the score/restart panel */}
      <AnimationOverlay visible={gameOver} onDismiss={() => {}} />
      {gameOver && (
        <GameOverOverlay
          score={score}
          gameId={completedGameIdRef.current}
          onRestart={handleRestart}
        />
      )}
    </GameShell>
  );
}

export default function CascadeScreen() {
  return (
    <FruitSetProvider>
      <CascadeGame />
    </FruitSetProvider>
  );
}

const styles = StyleSheet.create({
  canvasWrapper: {
    flex: 1,
  },
  canvasOuter: {
    flex: 1,
    alignItems: "center",
    marginHorizontal: 8,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderBottomLeftRadius: 48,
    borderBottomRightRadius: 48,
    borderWidth: 1,
    opacity: 0.95,
    overflow: "hidden",
  },
  comboFlash: {
    backgroundColor: "rgba(255, 165, 0, 1)",
    zIndex: 1,
  },
});
