import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  LayoutChangeEvent,
  Pressable,
} from "react-native";
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
} from "../game/cascade/constants";
import { PIECE_DEFS } from "../game/cascade/pieceDefs";
import NextFruitPreview from "../components/cascade/NextFruitPreview";
import ScoreDisplay from "../components/cascade/ScoreDisplay";
import ThemeSelector from "../components/cascade/ThemeSelector";
import GameOverOverlay from "../components/cascade/GameOverOverlay";
import { useGameSync } from "../game/_shared/useGameSync";
import { useCascadeScoreboard } from "../game/cascade/CascadeScoreboardContext";

// ---------------------------------------------------------------------------
// Cascade v2 — screen wired to CascadeEngine (#1751).
// Storage stubs remain pending full persistence implementation.
// ---------------------------------------------------------------------------

interface CascadeGameSnapshot {
  version: number;
  score: number;
  gameOver: boolean;
  fruitSetId: string;
  queueTiers: [number, number];
  fruits: { tier: number; x: number; y: number }[];
  savedAt: number;
}

const saveCascadeGame: (snap: CascadeGameSnapshot) => Promise<void> = () => Promise.resolve();
const loadCascadeGame = (): Promise<CascadeGameSnapshot | null> => Promise.resolve(null);
const clearCascadeGame = (): Promise<void> => Promise.resolve();

class ControlledSpawnSelector {
  private readonly rng: () => number;
  constructor(rng?: () => number) {
    this.rng = rng ?? Math.random;
  }
  next(): FruitTier {
    return Math.floor(this.rng() * 5) as FruitTier;
  }
}

function createSeededRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (Math.imul(48271, s) + (s >>> 16)) | 0;
    return (s >>> 0) / 0x100000000;
  };
}

class FruitQueue {
  private queue: FruitTier[];
  private readonly selector: ControlledSpawnSelector;
  constructor(
    selector = new ControlledSpawnSelector(),
    initialQueue?: readonly [FruitTier, FruitTier]
  ) {
    this.selector = selector;
    this.queue = initialQueue
      ? [initialQueue[0], initialQueue[1]]
      : [this.selector.next(), this.selector.next()];
  }
  peek(): FruitTier {
    return this.queue[0] ?? 0;
  }
  peekNext(): FruitTier {
    return this.queue[1] ?? 0;
  }
  consume(): FruitTier {
    const tier = this.queue.shift()!;
    this.queue.push(this.selector.next());
    return tier;
  }
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
    []
  );
}

// ---------------------------------------------------------------------------
// Piece renderer — SVG circles for each physics body
// ---------------------------------------------------------------------------

function PieceRenderer({
  pieces,
  scale,
}: {
  pieces: PieceSnapshot[];
  scale: number;
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
        stroke="#FF5050"
        strokeOpacity={0.35}
        strokeWidth={1}
      />
      {pieces.map((piece) => {
        const def = PIECE_DEFS[piece.tier];
        if (!def) return null;
        const r =
          def.shape.kind === "circle" ? def.shape.radius : def.shape.boundingRadius;
        return (
          <Circle key={piece.id} cx={piece.x} cy={piece.y} r={r} fill={def.color} />
        );
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
  const comboOpacity = useSharedValue(0);
  const comboAnimStyle = useAnimatedStyle(() => ({ opacity: comboOpacity.value }));
  const nextBurstId = useId();

  // Sounds
  const playFruitMerge = useTieredMergeSound();
  const { play: playCascadeCombo } = useSound("cascade.cascadeCombo");
  const { play: playGameOver } = useSound("cascade.gameOver");

  const engineRef = useRef<CascadeEngine | null>(null);
  const queueRef = useRef(new FruitQueue());
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
  const comboCountRef = useRef(0);

  const lastSaveTimeRef = useRef<number>(0);

  // For merge burst position calculation
  const scaleRef = useRef(0);
  const containerWidthRef = useRef(0);

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

  useEffect(() => {
    startInstrumentedSession(activeFruitSetRef.current.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load any saved game on mount (stubs — always resolves null currently).
  useEffect(() => {
    let active = true;
    loadCascadeGame().then((snapshot) => {
      if (!active || !snapshot) return;
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
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildSnapshot = useCallback((): CascadeGameSnapshot => {
    return {
      version: 1,
      score: scoreRef.current,
      gameOver: gameOverRef.current,
      fruitSetId: activeFruitSetRef.current.id,
      queueTiers: [queueRef.current.peek(), queueRef.current.peekNext()],
      fruits: pieces.map((p) => ({ tier: p.tier, x: p.x, y: p.y })),
      savedAt: Date.now(),
    };
  }, [pieces]);

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
      queueRef.current = new FruitQueue();
      scoreRef.current = 0;
      gameOverRef.current = false;
      dropCountRef.current = 0;
      setScore(0);
      setGameOver(false);
      setPieces([]);
      setQueueVersion((v) => v + 1);
      clearCascadeGame().catch(() => {});
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
      setPieces(state.pieces);

      rafId = requestAnimationFrame(tick);
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

      engineRef.current?.drop(tier, x);

      saveGameThrottled();

      setTimeout(() => {
        droppingRef.current = false;
      }, 200);
    },
    [gameOver, saveGameThrottled, syncEnqueue, syncMarkStarted]
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
    g.__cascade_getState = () => {
      const state = engineRef.current?.getState();
      return {
        score: scoreRef.current,
        gameOver: gameOverRef.current,
        nextFruitTier: queueRef.current.peek(),
        comboCount: comboCountRef.current,
        fruitCount: state?.pieces.length ?? 0,
        dangerRatio: 0,
        fruits: state?.pieces.map((p) => ({ id: p.id, tier: p.tier, x: p.x, y: p.y, angle: p.angle })) ?? [],
      };
    };
    g.__cascade_setSeed = handleSetSeed;
    g.__cascade_dropAt = (x: number) => {
      if (gameOverRef.current) return;
      const tier = queueRef.current.consume();
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
    queueRef.current = new FruitQueue();
    scoreRef.current = 0;
    gameOverRef.current = false;
    dropCountRef.current = 0;
    comboCountRef.current = 0;
    setScore(0);
    setGameOver(false);
    setPieces([]);
    setQueueVersion((v) => v + 1);
    clearCascadeGame().catch(() => {});
    lastSaveTimeRef.current = 0;
    setGameKey((k) => k + 1);
    startInstrumentedSession(activeFruitSetRef.current.id);
    pushScoreboardSnapshot();
  }

  const queue = queueRef.current;
  const currentDef = activeFruitSet.fruits[queue.peek()];
  const nextDef = activeFruitSet.fruits[queue.peekNext()];

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
              <PieceRenderer pieces={pieces} scale={scale} />
            </Pressable>
          )}
        </View>

        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <Animated.View
            style={[StyleSheet.absoluteFillObject, styles.comboFlash, comboAnimStyle]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
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
  comboFlash: {
    backgroundColor: "rgba(255, 165, 0, 1)",
    zIndex: 1,
  },
});
