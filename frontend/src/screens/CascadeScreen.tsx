import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, View, LayoutChangeEvent, Pressable } from "react-native";
import Svg, { Circle, Line as SvgLine } from "react-native-svg";
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
import type { HomeStackParamList } from "../types/navigation";
import { useTheme } from "../theme/ThemeContext";
import { GameShell } from "../components/shared/GameShell";
import { AnimationOverlay } from "../components/shared/AnimationOverlay";
import { FruitSetProvider, useFruitSet } from "../theme/FruitSetContext";
import type { FruitTier } from "../theme/fruitSets";
import { CascadeEngine, type PieceSnapshot } from "../game/cascade/engine2";
import {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  OVERFLOW_LINE_Y,
  WALL_THICKNESS,
  DANGER_STACK_MARGIN,
} from "../game/cascade/constants";
import { PIECE_DEFS } from "../game/cascade/pieceDefs";
import { DROUGHT_WINDOW } from "../game/cascade/spawnSelector2";
import { PieceQueue, createPieceQueue, advanceQueue } from "../game/cascade/pieceQueue2";
import NextFruitPreview from "../components/cascade/NextFruitPreview";
import ScoreDisplay from "../components/cascade/ScoreDisplay";
import ThemeSelector from "../components/cascade/ThemeSelector";
import GameOverOverlay from "../components/cascade/GameOverOverlay";
import { useGameSync } from "../game/_shared/useGameSync";
import { useCascadeScoreboard } from "../game/cascade/CascadeScoreboardContext";
import {
  saveGame as saveCascadeGame,
  loadGame as loadCascadeGame,
  clearGame as clearCascadeGame,
  type SavedState,
} from "../game/cascade/storage2";

// ---------------------------------------------------------------------------
// Cascade v2 — screen wired to CascadeEngine (#1751, #1754).
// ---------------------------------------------------------------------------

const SETTLE_TICKS = 60;

function createSeededRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (Math.imul(48271, s) + (s >>> 16)) | 0;
    return (s >>> 0) / 0x100000000;
  };
}

function makeQueue(rng?: () => number): { queue: PieceQueue; history: number[] } {
  const queue = createPieceQueue([], rng);
  return { queue, history: [queue.current, queue.next] };
}
import { useSound } from "../game/_shared/useSound";
import { useSoundSettings } from "../game/_shared/SoundContext";
import { SOUND_REGISTRY } from "../game/_shared/sounds";

const SAVE_THROTTLE_MS = 2000;

// ---------------------------------------------------------------------------
// Merge burst animation (react-native-reanimated)
// ---------------------------------------------------------------------------

interface MergeBurstData {
  id: string;
  x: number;
  y: number;
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

  return useCallback((tier: number) => {
    if (mutedRef.current || !playerRef.current) return;
    const volume = Math.min(1, 0.35 + tier * 0.065);
    try {
      (playerRef.current as unknown as { volume: number }).volume = volume;
      playerRef.current.seekTo(0);
      playerRef.current.play();
    } catch {
      /* expo-audio may throw if audio context is suspended */
    }
  }, []);
}

// ---------------------------------------------------------------------------
// Piece renderer — SVG circles for each physics body
// ---------------------------------------------------------------------------

function PieceRenderer({
  pieces,
  scale,
  overflowLineColor,
}: {
  pieces: PieceSnapshot[];
  scale: number;
  overflowLineColor: string;
}) {
  return (
    <Svg
      width={WORLD_WIDTH * scale}
      height={WORLD_HEIGHT * scale}
      viewBox={`0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`}
      accessibilityRole="image"
      accessibilityLabel="Cascade game board"
    >
      {/* Overflow danger line */}
      <SvgLine
        x1={WALL_THICKNESS}
        y1={OVERFLOW_LINE_Y}
        x2={WORLD_WIDTH - WALL_THICKNESS}
        y2={OVERFLOW_LINE_Y}
        stroke={overflowLineColor}
        strokeOpacity={0.35}
        strokeWidth={1}
      />
      {pieces.map((piece) => {
        const def = PIECE_DEFS[piece.tier];
        if (!def) return null;
        const r = def.shape.kind === "circle" ? def.shape.radius : def.shape.boundingRadius;
        return <Circle key={piece.id} cx={piece.x} cy={piece.y} r={r} fill={def.color} />;
      })}
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Main game component
// ---------------------------------------------------------------------------

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
  const [pieces, setPieces] = useState<PieceSnapshot[]>([]);
  const [gameKey, setGameKey] = useState(0);

  // Animation state
  const [mergeBursts, setMergeBursts] = useState<MergeBurstData[]>([]);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);
  const nextBurstId = useId();

  // Sounds
  const playFruitMerge = useTieredMergeSound();
  const { play: playGameOver } = useSound("cascade.gameOver");

  const engineRef = useRef<CascadeEngine | null>(null);
  // Initialized lazily so queue and history come from the same makeQueue() call.
  const queueRef = useRef<PieceQueue>(null as unknown as PieceQueue);
  const queueHistoryRef = useRef<number[]>([]);
  const queueRngRef = useRef<(() => number) | undefined>(undefined);
  if (queueRef.current == null) {
    const init = makeQueue();
    queueRef.current = init.queue;
    queueHistoryRef.current = init.history;
  }
  const droppingRef = useRef(false);
  const lastDropTimeRef = useRef<number>(Date.now());
  const dropCountRef = useRef<number>(0);
  const prevFruitSetId = useRef(activeFruitSet.id);

  // Refs used by test hooks and RAF to read latest state without closure staleness
  const scoreRef = useRef(0);
  const gameOverRef = useRef(false);
  const activeFruitSetRef = useRef(activeFruitSet);

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

  const completedGameIdRef = useRef<string | null>(null);
  const gameStartTimeRef = useRef<number>(Date.now());
  const mergeCountRef = useRef(0);

  const lastSaveTimeRef = useRef<number>(0);
  const settlingTicksLeftRef = useRef<number>(0);

  // For merge burst position calculation
  const scaleRef = useRef(0);
  const containerWidthRef = useRef(0);
  const piecesRef = useRef<PieceSnapshot[]>([]);

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

  // Pops queue.current, advances the queue, updates history. Returns the dropped tier.
  const consumeFromQueue = useCallback((isInDanger: boolean): FruitTier => {
    const tier = queueRef.current.current as FruitTier;
    const newQueue = advanceQueue(
      queueRef.current,
      queueHistoryRef.current,
      isInDanger,
      queueRngRef.current
    );
    queueHistoryRef.current = [...queueHistoryRef.current, newQueue.next].slice(-DROUGHT_WINDOW);
    queueRef.current = newQueue;
    return tier;
  }, []); // reads/writes refs only — no reactive deps

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

  useEffect(() => {
    startInstrumentedSession(activeFruitSetRef.current.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load any saved game on mount and restore engine state.
  useEffect(() => {
    let active = true;
    loadCascadeGame().then((snapshot) => {
      if (!active || !snapshot || snapshot.pieces.length === 0) return;
      engineRef.current?.restore(snapshot.pieces, snapshot.score);
      scoreRef.current = snapshot.score;
      setScore(snapshot.score);
      queueRef.current = snapshot.queue;
      queueHistoryRef.current = [snapshot.queue.current, snapshot.queue.next];
      setQueueVersion((v) => v + 1);
      settlingTicksLeftRef.current = SETTLE_TICKS;
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildSnapshot = useCallback((): SavedState => {
    return {
      version: 3,
      pieces: piecesRef.current.map((p) => ({ tier: p.tier, x: p.x, y: p.y })),
      score: scoreRef.current,
      savedAt: Date.now(),
      queue: queueRef.current,
    };
  }, []);

  const saveGameThrottled = useCallback(() => {
    const now = Date.now();
    if (now - lastSaveTimeRef.current < SAVE_THROTTLE_MS) return;
    lastSaveTimeRef.current = now;
    if (gameOverRef.current) return;
    saveCascadeGame(buildSnapshot()).catch(() => {});
  }, [buildSnapshot]);

  useEffect(() => {
    activeFruitSetRef.current = activeFruitSet;
  }, [activeFruitSet]);

  // Reset on fruit-set switch
  useEffect(() => {
    if (prevFruitSetId.current !== activeFruitSet.id) {
      prevFruitSetId.current = activeFruitSet.id;
      endInstrumentedSession(gameOverRef.current ? "completed" : "abandoned");
      queueRngRef.current = undefined;
      const reset = makeQueue();
      queueRef.current = reset.queue;
      queueHistoryRef.current = reset.history;
      scoreRef.current = 0;
      gameOverRef.current = false;
      dropCountRef.current = 0;
      setScore(0);
      setGameOver(false);
      setPieces([]);
      setQueueVersion((v) => v + 1);
      clearCascadeGame().catch(() => {});
      settlingTicksLeftRef.current = 0;
      setGameKey((k) => k + 1);
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
    (event: { tier: FruitTier; x: number; y: number }) => {
      // Score is tracked by engine; scoreRef.current is kept current by the RAF loop.
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
        AccessibilityInfo.announceForAccessibility(
          t("cascade:event.merged", { fruit: merged.name })
        );
        if (event.tier > bestFruitTierRef.current) {
          bestFruitTierRef.current = event.tier;
          bestFruitNameRef.current = merged.name;
        }
      }
      pushScoreboardSnapshot();
      saveGameThrottled();
    },
    [activeFruitSet, t, saveGameThrottled, syncEnqueue, pushScoreboardSnapshot]
  );

  const handleGameOver = useCallback(() => {
    AccessibilityInfo.announceForAccessibility(t("cascade:event.gameOver"));
    gameOverRef.current = true;
    setGameOver(true);
    completedGameIdRef.current = getGameId();
    endInstrumentedSession("completed");
    clearCascadeGame().catch(() => {});
    gamesPlayedRef.current += 1;
    if (scoreRef.current > bestScoreRef.current) {
      bestScoreRef.current = scoreRef.current;
    }
    pushScoreboardSnapshot();
  }, [t, endInstrumentedSession, getGameId, pushScoreboardSnapshot]);

  // Always-fresh refs for the RAF loop — updated every render so the loop
  // never captures stale closures for merge/gameOver handling.
  const onMergeRef = useRef<(tier: FruitTier, x: number, y: number) => void>(() => {});
  const onGameOverRef = useRef<() => void>(() => {});

  onMergeRef.current = (tier, x, y) => {
    handleMerge({ tier, x, y });
    playFruitMerge(tier);
    if (!reduceMotion) {
      const s = scaleRef.current;
      const offsetX = (containerWidthRef.current - WORLD_WIDTH * s) / 2;
      const dispX = offsetX + x * s;
      const dispY = y * s;
      const color = activeFruitSet.fruits[tier]?.color ?? "#fff";
      const burstId = `${nextBurstId}-${Date.now()}-${x.toFixed(0)}`;
      setMergeBursts((prev) => [...prev, { id: burstId, x: dispX, y: dispY, color }]);
    }
  };

  onGameOverRef.current = () => {
    playGameOver();
    handleGameOver();
  };

  // RAF game loop — recreated on gameKey change (restart / theme switch)
  useEffect(() => {
    const engine = new CascadeEngine({});
    engineRef.current = engine;
    engine.start();

    let rafId: number;
    let last = performance.now();

    function tick(now: number) {
      const delta = Math.min(now - last, 100);
      last = now;

      if (settlingTicksLeftRef.current > 0) settlingTicksLeftRef.current--;

      const result = engine.step(delta);
      const state = engine.getState();

      // Update score ref before calling merge handlers so score_after is current.
      scoreRef.current = state.score;

      for (const ev of result.events) {
        if (ev.type === "merge") {
          onMergeRef.current(ev.result as FruitTier, ev.x, ev.y);
        } else if (ev.type === "gameOver") {
          onGameOverRef.current();
        } else if (ev.type === "guardRailFired") {
          console.log(`[Cascade] guard rail: ${ev.reason} body=${ev.bodyId}`);
        }
        // "score" event — score is read from state above; no separate handling needed.
      }

      setScore(state.score);
      piecesRef.current = state.pieces;
      setPieces(state.pieces);

      if (!gameOverRef.current) {
        rafId = requestAnimationFrame(tick);
      }
    }

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      engine.destroy();
      engineRef.current = null;
      setPieces([]);
    };
  }, [gameKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTap = useCallback(
    (x: number) => {
      const now = Date.now();
      const interval = now - lastDropTimeRef.current;

      if (gameOver || droppingRef.current || settlingTicksLeftRef.current > 0) {
        console.log(
          `[Cascade] drop BLOCKED — gameOver=${gameOver} cooling=${droppingRef.current} settling=${settlingTicksLeftRef.current} intervalMs=${interval}`
        );
        return;
      }
      droppingRef.current = true;
      lastDropTimeRef.current = now;
      dropCountRef.current += 1;
      syncMarkStarted();

      const pieces = engineRef.current?.getState().pieces ?? [];
      // isInDanger shapes the piece added to the back of the queue (2 drops ahead)
      const isInDanger = pieces.some((p) => p.y < OVERFLOW_LINE_Y + DANGER_STACK_MARGIN);
      const tier = consumeFromQueue(isInDanger);
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

      engineRef.current?.drop(tier, x);

      saveGameThrottled();

      setTimeout(() => {
        droppingRef.current = false;
      }, 200);
    },
    [consumeFromQueue, gameOver, saveGameThrottled, syncEnqueue, syncMarkStarted]
  );

  const handleSetSeed = useCallback((seed: number) => {
    const rng = createSeededRng(seed);
    queueRngRef.current = rng;
    const seeded = makeQueue(rng);
    queueRef.current = seeded.queue;
    queueHistoryRef.current = seeded.history;
    setQueueVersion((v) => v + 1);
  }, []);

  // -------------------------------------------------------------------------
  // Test seam — window.__cascade_* hooks (only when EXPO_PUBLIC_TEST_HOOKS=1)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (process.env.EXPO_PUBLIC_TEST_HOOKS !== "1") return;
    const g = globalThis as Record<string, unknown>;
    g.__cascade_getState = () => {
      const state = engineRef.current?.getState();
      return {
        score: scoreRef.current,
        gameOver: gameOverRef.current,
        nextFruitTier: queueRef.current.current,
        comboCount: 0,
        fruitCount: state?.pieces.length ?? 0,
        dangerRatio: 0,
        fruits:
          state?.pieces.map((p) => ({ id: p.id, tier: p.tier, x: p.x, y: p.y, angle: p.angle })) ??
          [],
      };
    };
    g.__cascade_setSeed = handleSetSeed;
    g.__cascade_dropAt = (x: number) => {
      if (gameOverRef.current) return;
      const dangerPieces = engineRef.current?.getState().pieces ?? [];
      const isInDanger = dangerPieces.some((p) => p.y < OVERFLOW_LINE_Y + DANGER_STACK_MARGIN);
      const tier = consumeFromQueue(isInDanger);
      setQueueVersion((v) => v + 1);
      engineRef.current?.drop(tier, x);
    };
    g.__cascade_fastForward = (ms: number) => {
      const engine = engineRef.current;
      if (!engine) return;
      const stepMs = 16.67;
      let remaining = ms;
      while (remaining > 0) {
        const result = engine.step(Math.min(remaining, stepMs));
        const state = engine.getState();
        scoreRef.current = state.score;
        for (const ev of result.events) {
          if (ev.type === "merge") {
            onMergeRef.current(ev.result as FruitTier, ev.x, ev.y);
          } else if (ev.type === "gameOver") {
            onGameOverRef.current();
          }
        }
        remaining -= stepMs;
      }
      const state = engine.getState();
      setScore(state.score);
      setPieces(state.pieces);
    };
    g.__cascade_triggerGameOver = () => {
      completedGameIdRef.current = getGameId();
      gameOverRef.current = true;
      setGameOver(true);
    };
    g.__cascade_isReady = () => engineRef.current !== null;
    g.__cascade_spawnTierAt = (tier: number, x: number) => {
      if (gameOverRef.current) return;
      engineRef.current?.drop(tier, x);
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
    endInstrumentedSession(gameOverRef.current ? "completed" : "abandoned");
    queueRngRef.current = undefined;
    const restarted = makeQueue();
    queueRef.current = restarted.queue;
    queueHistoryRef.current = restarted.history;
    scoreRef.current = 0;
    gameOverRef.current = false;
    dropCountRef.current = 0;
    setScore(0);
    setGameOver(false);
    setPieces([]);
    setQueueVersion((v) => v + 1);
    clearCascadeGame().catch(() => {});
    lastSaveTimeRef.current = 0;
    settlingTicksLeftRef.current = 0;
    setGameKey((k) => k + 1);
    startInstrumentedSession(activeFruitSetRef.current.id);
    pushScoreboardSnapshot();
  }

  const queue = queueRef.current;
  const currentDef = activeFruitSet.fruits[queue.current];
  const nextDef = activeFruitSet.fruits[queue.next];

  const scale =
    containerWidth > 0 && containerHeight > 0
      ? Math.min(containerWidth / WORLD_WIDTH, containerHeight / WORLD_HEIGHT)
      : 0;
  scaleRef.current = scale;

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
      <ScoreDisplay score={score}>
        {currentDef !== undefined && nextDef !== undefined && (
          <NextFruitPreview current={currentDef} next={nextDef} />
        )}
      </ScoreDisplay>

      <ThemeSelector />

      <View style={styles.canvasWrapper}>
        <View
          style={[
            styles.canvasOuter,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
          onLayout={onLayout}
        >
          {scale > 0 && (
            <Pressable
              testID="cascade-game-area"
              onPress={(e) => {
                const rawX = e.nativeEvent.locationX / scale;
                const worldX = Math.max(
                  WALL_THICKNESS,
                  Math.min(WORLD_WIDTH - WALL_THICKNESS, rawX)
                );
                handleTap(worldX);
              }}
              style={{ width: WORLD_WIDTH * scale, height: WORLD_HEIGHT * scale }}
            >
              <PieceRenderer pieces={pieces} scale={scale} overflowLineColor={colors.error} />
            </Pressable>
          )}
        </View>

        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          {mergeBursts.map((burst) => (
            <MergeBurst
              key={burst.id}
              {...burst}
              onDone={() => setMergeBursts((prev) => prev.filter((b) => b.id !== burst.id))}
            />
          ))}
        </View>
      </View>

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
});
