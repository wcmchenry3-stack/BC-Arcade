/**
 * CascadeScreen: Cascade (a Suika-style merge game) wired to `CascadeEngine` (#1751, #1754).
 *
 * Concerns:
 *   1. Game logic: the engine (`game/cascade/engine.ts`, Matter.js) is stepped from a RAF loop
 *      recreated on `gameKey`; the screen drops pieces from the queue and reads state back
 *      each frame. The engine owns the physics, scoring and game over; the screen owns none.
 *   2. Layout: `calculateCascadeLayout` (`game/cascade/layout.ts`) scales the fixed world into
 *      the measured board area (#3693).
 *   3. Persistence: the board, queue, score and play time are throttle-saved
 *      (`game/cascade/storage.ts`, `SAVE_THROTTLE_MS`), restored on mount and saved on pause.
 *   4. Session: `useGameSync("cascade")`; drops and merges are enqueued as events, the session
 *      completes at game over and abandons on a theme switch, restart or unmount (#2450, #2619).
 *   5. Clock: a `PlayClock` stopped while another screen covers the board or the app is in
 *      the background, through `usePauseWhileAway` (#2735, #2750).
 *   6. Result (#2515, #2632): the shared `GameResultModal`; the card shows the rank from
 *      `useGameRank` through `toSubmission`.
 *   7. Audio and animation: tier-scaled merge sound, game-over sound, merge bursts
 *      (reanimated; skipped under reduce motion).
 *   8. The lid (#3694): the engine decides game over; the board draws the lid line, the
 *      spawner's clock ring from `dangerRatio`, the red wash on pieces over the lid, and the
 *      waiting ghost while `canDrop()` is false (`components/cascade/LidOverlay.tsx`). A tap
 *      drops only when the engine allows it.
 *   9. Test and dev seams: `registerCascadeTestHooks` (`game/cascade/testHooks.ts`) for E2E
 *      builds, `CascadeDevPanel` for dev builds (#3693).
 */
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  StyleSheet,
  View,
  LayoutChangeEvent,
  Pressable,
} from "react-native";
import { Canvas, Circle, Group, Image as SkiaImage } from "@shopify/react-native-skia";
import type { SkImage } from "@shopify/react-native-skia";
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
import { useLeaderboardLink } from "../hooks/useLeaderboardLink";
import { usePauseWhileAway } from "../hooks/usePauseWhileAway";
import { bestOf } from "../game/_shared/bestOf";
import { clockElapsedMs, pauseClock, resumeClock, type PlayClock } from "../game/_shared/playClock";
import GameResultModal from "../components/shared/GameResultModal";
import { toSubmission } from "../components/shared/toSubmission";
import { FruitSetProvider, useFruitSet } from "../theme/FruitSetContext";
import type { FruitDefinition, FruitTier } from "../theme/fruitSets";
import { useFruitImages, getImagesForSet } from "../theme/useFruitImages";
import { useAssetsReady } from "../game/_shared/useAssetsReady";
import { CascadeEngine, type PieceSnapshot } from "../game/cascade/engine";
import {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  OVERFLOW_LINE_Y,
  DANGER_STACK_MARGIN,
} from "../game/cascade/constants";
import { PIECE_DEFS } from "../game/cascade/pieceDefs";
import { spriteHalfSize, tierRadius } from "../game/cascade/tiers";
import { calculateCascadeLayout, tapToWorldX } from "../game/cascade/layout";
import { registerCascadeTestHooks } from "../game/cascade/testHooks";
import { DROUGHT_WINDOW } from "../game/cascade/spawnSelector";
import { PieceQueue, createPieceQueue, advanceQueue } from "../game/cascade/pieceQueue";
import NextFruitPreview from "../components/cascade/NextFruitPreview";
import ScoreDisplay from "../components/cascade/ScoreDisplay";
import ThemeSelector from "../components/cascade/ThemeSelector";
import CascadeDevPanel from "../components/cascade/CascadeDevPanel";
import { LidLine, OverLidWash, Spawner } from "../components/cascade/LidOverlay";
import { CASCADE_LID_PALETTE, type CascadeLidPalette } from "../theme/theme.cascade";
import { useGameSync } from "../game/_shared/useGameSync";
import { useGameRank } from "../game/_shared/useGameRank";
import {
  saveGame as saveCascadeGame,
  loadGame as loadCascadeGame,
  SAVE_VERSION,
  clearGame as clearCascadeGame,
  loadBestScore,
  saveBestScore,
  type SavedState,
} from "../game/cascade/storage";

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
import { GAME_AUDIO_PLAYER_OPTIONS, retainAudioSession } from "../game/_shared/audioSession";
import { useSoundSettings } from "../game/_shared/SoundContext";
import { CASCADE_SOUNDS } from "../game/cascade/sounds";
import { useReduceMotion } from "../components/shared/useReduceMotion";

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
    scale.value = withSpring(2.2, { damping: 9, stiffness: 25 });
    opacity.value = withTiming(0, { duration: 1100 }, (finished) => {
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
// Tier-scaled merge sound (volume 0.35 → 1.0 across tiers 0 → 11)
// ---------------------------------------------------------------------------

function useTieredMergeSound() {
  const { muted } = useSoundSettings();
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  useEffect(() => {
    const source = CASCADE_SOUNDS["cascade.fruitMerge"];
    if (!source) return;
    // Same session handling as useSound: see GAME_AUDIO_PLAYER_OPTIONS in audioSession.ts.
    const player = createAudioPlayer(source, GAME_AUDIO_PLAYER_OPTIONS);
    playerRef.current = player;
    const releaseSession = retainAudioSession();
    return () => {
      try {
        player.pause();
      } catch {
        // audio cleanup, failure is safe
      }
      player.remove();
      releaseSession();
      playerRef.current = null;
    };
  }, []);

  return useCallback((tier: number) => {
    if (mutedRef.current || !playerRef.current) return;
    const volume = 0.35 + (tier * 0.65) / 11;
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
  fruitDefs,
  images,
  dangerRatio,
  canDrop,
  lidPalette,
  spawnerTier,
}: {
  pieces: PieceSnapshot[];
  scale: number;
  /** The engine's lid countdown, 0..1 (#3694). */
  dangerRatio: number;
  /** False while the last dropped piece is still over the lid: the spawner shows the ghost. */
  canDrop: boolean;
  lidPalette: CascadeLidPalette;
  /** The queue's current tier, shown in the spawner. */
  spawnerTier: number;
  /** Active fruit set's definitions, indexed by tier — supplies bakedClipR for sprite sizing. */
  fruitDefs: FruitDefinition[];
  /** Decoded sprites for the active fruit set, indexed by tier. null = not yet loaded. */
  images: (SkImage | null)[];
}) {
  // Freeze the rendered position of sleeping pieces to prevent sub-pixel physics
  // drift from causing visible jitter on settled pieces.
  const { t } = useTranslation("cascade");
  const frozenPositions = useRef<Map<number, { x: number; y: number }>>(new Map());

  // Evict stale entries when pieces are removed (merge, game-over reset).
  useEffect(() => {
    const activeIds = new Set(pieces.map((p) => p.id));
    for (const id of frozenPositions.current.keys()) {
      if (!activeIds.has(id)) frozenPositions.current.delete(id);
    }
  }, [pieces]);

  return (
    <Canvas
      style={{ width: WORLD_WIDTH * scale, height: WORLD_HEIGHT * scale }}
      accessibilityRole="image"
      accessibilityLabel={t("a11y.board")}
    >
      <Group transform={[{ scale }]}>
        {pieces.map((piece) => {
          const def = PIECE_DEFS[piece.tier];
          if (!def) return null;
          const r = tierRadius(piece.tier);

          if (piece.isSleeping) {
            if (!frozenPositions.current.has(piece.id)) {
              frozenPositions.current.set(piece.id, { x: piece.x, y: piece.y });
            }
          } else {
            frozenPositions.current.delete(piece.id);
          }
          const pos = frozenPositions.current.get(piece.id) ?? piece;

          const sprite = images[piece.tier];
          let body: React.ReactNode;
          if (sprite) {
            // Baked sprites carry padding beyond the visible fruit: bakedClipR scales the
            // ladder radius (the collider's) to the canvas half-size, so the visible fruit is
            // exactly the collider size (#3695).
            const half = spriteHalfSize(piece.tier, fruitDefs[piece.tier]?.bakedClipR);
            body = (
              <SkiaImage
                image={sprite}
                x={pos.x - half}
                y={pos.y - half}
                width={half * 2}
                height={half * 2}
                fit="contain"
              />
            );
          } else {
            body = <Circle cx={pos.x} cy={pos.y} r={r} color={def.color} />;
          }

          // The lid (#3694): a piece over the lid is washed red while the count runs.
          return (
            <React.Fragment key={piece.id}>
              {body}
              <OverLidWash
                x={pos.x}
                y={pos.y}
                radius={r}
                dangerRatio={dangerRatio}
                palette={lidPalette}
              />
            </React.Fragment>
          );
        })}
        {/* The lid line, then the spawner and its clock ring on top. */}
        <LidLine dangerRatio={dangerRatio} palette={lidPalette} />
        <Spawner
          dangerRatio={dangerRatio}
          canDrop={canDrop}
          palette={lidPalette}
          piece={
            PIECE_DEFS[spawnerTier]
              ? {
                  radius: tierRadius(spawnerTier),
                  image: images[spawnerTier] ?? null,
                  imageScale: fruitDefs[spawnerTier]?.bakedClipR ?? 1,
                  color: PIECE_DEFS[spawnerTier]!.color,
                }
              : null
          }
        />
      </Group>
    </Canvas>
  );
}

// ---------------------------------------------------------------------------
// Main game component
// ---------------------------------------------------------------------------

function CascadeGame() {
  const { t } = useTranslation(["cascade", "common"]);
  const { t: tResult } = useTranslation("result");
  const { colors, theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { activeFruitSet } = useFruitSet();
  // decoded images will be forwarded to the Skia canvas renderer in a follow-up
  const fruitImages = useFruitImages();
  const assetsReady = useAssetsReady([...fruitImages.fruits, ...fruitImages.cosmos]);
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList, "Cascade">>();

  const [devPanelOpen, setDevPanelOpen] = useState(false);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  // What the result card shows, captured at game over (#2515).
  const [result, setResult] = useState<{
    score: number;
    bestScore: number;
    isNewBest: boolean;
    merges: number;
    /** False when the game had no sync id, so nothing could be submitted. */
    submittable: boolean;
  } | null>(null);
  const leaderboard = useGameRank("cascade");
  const { lookup: lookupRank, reset: resetScore } = leaderboard;
  // The card's "View leaderboard" link and the ⋯ menu item (#2633).
  const openLeaderboard = useLeaderboardLink(navigation, "cascade");
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [, setQueueVersion] = useState(0);
  const [pieces, setPieces] = useState<PieceSnapshot[]>([]);
  // The lid (#3694), read from the engine every frame.
  const [dangerRatio, setDangerRatio] = useState(0);
  const [canDrop, setCanDrop] = useState(true);
  const [gameKey, setGameKey] = useState(0);

  // Animation state
  const [mergeBursts, setMergeBursts] = useState<MergeBurstData[]>([]);
  const reduceMotion = useReduceMotion();
  const nextBurstId = useId();

  // Sounds
  const playFruitMerge = useTieredMergeSound();
  const { play: playGameOver } = useSound("cascade.gameOver", CASCADE_SOUNDS);

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
    resume: syncResume,
    markStarted: syncMarkStarted,
    enqueue: syncEnqueue,
    complete: syncComplete,
    getGameId,
    setProgressSnapshot: syncSetProgressSnapshot,
  } = useGameSync("cascade");
  // The cached best, for the result card's "New best" badge only (#2636): the
  // player's history is the Stats screen, fed by the server.
  const bestScoreRef = useRef(0);

  const completedGameIdRef = useRef<string | null>(null);

  // The best score persists across app launches (#2515).
  useEffect(() => {
    let active = true;
    loadBestScore().then((best) => {
      if (active && best > bestScoreRef.current) bestScoreRef.current = best;
    });
    return () => {
      active = false;
    };
  }, []);
  // The game's play clock (#2750), on the shared PlayClock model: it runs from
  // the session's start and stops while the player is away (another screen
  // covers the board, #2735, or the app is in the background), through
  // usePauseWhileAway below. A ref, not state: the loop and the session
  // callbacks read it outside a render.
  const clockRef = useRef<PlayClock>({ startedAt: Date.now(), accumulatedMs: 0 });
  /**
   * Start the clock over with `accumulatedMs` banked, keeping it paused if
   * the player is away: a session can open, or a save load land, while the
   * app is in the background or another screen covers the board.
   */
  const restartClock = useCallback((accumulatedMs: number) => {
    clockRef.current =
      clockRef.current.paused === true
        ? { accumulatedMs, startedAt: null, paused: true }
        : { accumulatedMs, startedAt: Date.now() };
  }, []);
  /** Play time so far. */
  const playedMs = useCallback(() => clockElapsedMs(clockRef.current), []);
  const mergeCountRef = useRef(0);

  // #2450 / #2619 — the result block. The hook's own abandon (unmount) and
  // endInstrumentedSession build it here, so completed and abandoned rows
  // store the same metadata keys. `outcome` is left out: it is its own column.
  const progressResult = useCallback(
    () => ({
      final_score: scoreRef.current,
      duration_ms: playedMs(),
      theme: activeFruitSetRef.current.id,
      total_drops: dropCountRef.current,
      total_merges: mergeCountRef.current,
    }),
    [playedMs]
  );
  useEffect(() => {
    syncSetProgressSnapshot(() => ({ result: progressResult() }));
  }, [syncSetProgressSnapshot, progressResult]);

  const lastSaveTimeRef = useRef<number>(0);
  const settlingTicksLeftRef = useRef<number>(0);

  // For merge burst position calculation
  const scaleRef = useRef(0);
  const containerWidthRef = useRef(0);
  const piecesRef = useRef<PieceSnapshot[]>([]);

  const startInstrumentedSession = useCallback(
    (themeId: string) => {
      restartClock(0);
      mergeCountRef.current = 0;
      syncStart({ fruit_set: themeId, theme: themeId, seed: null });
    },
    [syncStart, restartClock]
  );

  const endInstrumentedSession = useCallback(
    (outcome: "completed" | "abandoned") => {
      // Built once: the analytics payload is the result plus its outcome. An
      // abandon's result is the same block as the unmount snapshot; a
      // completion's keeps `outcome`, as it always has.
      const result = progressResult();
      const payload = { ...result, outcome };
      return syncComplete(
        {
          finalScore: scoreRef.current,
          outcome,
          durationMs: result.duration_ms,
          result: outcome === "abandoned" ? result : payload,
        },
        payload
      );
    },
    [syncComplete, progressResult]
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
      // The play before the app was closed carries on (#2750); the time it
      // was closed doesn't count. A save from an older build has no
      // playedMs: its earlier play is unknown, so the clock starts at the load.
      restartClock(snapshot.playedMs ?? 0);
      // The restored game continues the session a killed app left open (#2654),
      // in place of the untouched one opened at mount.
      syncResume();
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
  }, [syncResume, restartClock]);

  const buildSnapshot = useCallback((): SavedState => {
    return {
      version: SAVE_VERSION,
      pieces: piecesRef.current.map((p) => ({ tier: p.tier, x: p.x, y: p.y })),
      score: scoreRef.current,
      savedAt: Date.now(),
      queue: queueRef.current,
      playedMs: playedMs(),
    };
  }, [playedMs]);

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
      // A new game: the next game over must be able to submit again.
      setResult(null);
      resetScore();
      setPieces([]);
      setQueueVersion((v) => v + 1);
      clearCascadeGame().catch(() => {});
      settlingTicksLeftRef.current = 0;
      setGameKey((k) => k + 1);
      startInstrumentedSession(activeFruitSet.id);
    }
  }, [activeFruitSet.id, endInstrumentedSession, startInstrumentedSession, resetScore]);

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
          t("cascade:event.merged", {
            fruit: t(`cascade:pieces.${merged.i18nKey}`, { defaultValue: merged.name }),
          })
        );
      }
      saveGameThrottled();
    },
    [activeFruitSet, t, saveGameThrottled, syncEnqueue]
  );

  /**
   * Captures what the result card shows and looks up where the synced game
   * ranks (#2632). The card itself announces the result, so there is no
   * separate screen-reader announcement here.
   */
  const showResult = useCallback(
    (gameId: string | null) => {
      const finalScore = scoreRef.current;
      const previousBest = bestScoreRef.current;
      const { improved, isNewBest } = bestOf(previousBest, finalScore, false);
      // bestOf counts any result as improving on no best; a 0 score never set one.
      if (improved && finalScore > 0) {
        bestScoreRef.current = finalScore;
        saveBestScore(finalScore).catch(() => {});
      }
      setResult({
        score: finalScore,
        bestScore: bestScoreRef.current,
        isNewBest,
        merges: mergeCountRef.current,
        submittable: gameId !== null,
      });
      if (gameId) void lookupRank(gameId);
    },
    [lookupRank]
  );

  const handleGameOver = useCallback(() => {
    gameOverRef.current = true;
    setGameOver(true);
    const gameId = endInstrumentedSession("completed");
    clearCascadeGame().catch(() => {});
    showResult(gameId);
  }, [endInstrumentedSession, showResult]);

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
      const fruit = activeFruitSet.fruits[tier];
      if (fruit) {
        const burstId = `${nextBurstId}-${Date.now()}-${x.toFixed(0)}`;
        setMergeBursts((prev) => [
          ...prev,
          { id: burstId, x: dispX, y: dispY, color: fruit.color },
        ]);
      }
    }
  };

  onGameOverRef.current = () => {
    playGameOver();
    handleGameOver();
  };
  // Lets the (mount-once) e2e test hook reach the latest showResult.
  const showResultRef = useRef(showResult);
  showResultRef.current = showResult;

  // Another screen covering the game (⋯ → Stats, Leaderboard, Scoreboard,
  // #2735) or the app going to the background (#2750) stops the loop below,
  // so the physics and the reported duration count only play. The pause saves
  // the board, so a kill while backgrounded keeps the play so far. Refs, not
  // state: the loop effect below reads them every frame and must not be
  // recreated when `navigation` re-renders (it isn't guaranteed to be a
  // stable reference), only when `gameKey` changes.
  //
  // Set by the loop effect below to its own "start scheduling frames again";
  // called on resume, which otherwise has no way to reach a `tick`/`rafId`
  // recreated on every gameKey change.
  const resumeLoopRef = useRef<() => void>(() => {});
  const awayRef = usePauseWhileAway(
    navigation,
    () => {
      clockRef.current = pauseClock(clockRef.current);
      if (!gameOverRef.current && piecesRef.current.length > 0) {
        saveCascadeGame(buildSnapshot()).catch(() => {});
      }
    },
    () => {
      clockRef.current = resumeClock(clockRef.current);
      resumeLoopRef.current();
    }
  );

  // RAF game loop — recreated on gameKey change (restart / theme switch)
  useEffect(() => {
    const engine = new CascadeEngine({});
    engineRef.current = engine;
    engine.start();

    // Every frame carries the loop generation that scheduled it. iOS and
    // Android hold frames while the app is away, so one queued before a pause
    // can still arrive after the resume has started the loop again, and one
    // can arrive after cleanup: both belong to an older generation and do
    // nothing. So there is only ever one loop, and none once this effect is
    // cleaned up.
    let generation = 0;
    let rafId: number | null = null;
    let last = performance.now();

    function schedule() {
      const scheduledFor = generation;
      rafId = requestAnimationFrame((now) => tick(now, scheduledFor));
    }

    function tick(now: number, scheduledFor: number) {
      if (scheduledFor !== generation) return; // a superseded loop's frame
      rafId = null;
      if (awayRef.current) return; // resumed by resumeLoopRef below

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
          if (__DEV__) console.log(`[Cascade] guard rail: ${ev.reason} body=${ev.bodyId}`);
        }
        // "score" event — score is read from state above; no separate handling needed.
      }

      setScore(state.score);
      piecesRef.current = state.pieces;
      setPieces(state.pieces);
      setDangerRatio(state.dangerRatio);
      setCanDrop(state.canDrop);

      if (!gameOverRef.current) schedule();
    }

    resumeLoopRef.current = () => {
      if (gameOverRef.current) return;
      if (rafId !== null) cancelAnimationFrame(rafId);
      generation++;
      last = performance.now();
      schedule();
    };

    schedule();

    return () => {
      generation++;
      if (rafId !== null) cancelAnimationFrame(rafId);
      engine.destroy();
      engineRef.current = null;
      setPieces([]);
      setDangerRatio(0);
      setCanDrop(true);
      resumeLoopRef.current = () => {};
    };
  }, [gameKey, awayRef]);

  const handleTap = useCallback(
    (x: number) => {
      const now = Date.now();
      const interval = now - lastDropTimeRef.current;

      // The lid (#3694): no drop until the last piece has fallen below the lid.
      const lidOpen = engineRef.current?.canDrop() ?? false;
      if (gameOver || droppingRef.current || settlingTicksLeftRef.current > 0 || !lidOpen) {
        if (__DEV__) {
          console.log(
            `[Cascade] drop BLOCKED — gameOver=${gameOver} cooling=${droppingRef.current} settling=${settlingTicksLeftRef.current} lidOpen=${lidOpen} intervalMs=${interval}`
          );
        }
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

      if (__DEV__) {
        console.log(
          `[Cascade] drop #${dropCountRef.current} tier=${tier} x=${Math.round(x)} intervalMs=${interval}`
        );
      }

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
  // Test seam: __cascade_* hooks (EXPO_PUBLIC_TEST_HOOKS=1 builds only, #3693)
  // -------------------------------------------------------------------------
  useEffect(() => {
    return registerCascadeTestHooks({
      getState: () => {
        const state = engineRef.current?.getState();
        return {
          score: scoreRef.current,
          gameOver: gameOverRef.current,
          nextFruitTier: queueRef.current.current,
          comboCount: 0,
          fruitCount: state?.pieces.length ?? 0,
          dangerRatio: state?.dangerRatio ?? 0,
          fruits:
            state?.pieces.map((p) => ({
              id: p.id,
              tier: p.tier,
              x: p.x,
              y: p.y,
              angle: p.angle,
            })) ?? [],
        };
      },
      setSeed: handleSetSeed,
      dropAt: (x: number) => {
        if (gameOverRef.current) return;
        const dangerPieces = engineRef.current?.getState().pieces ?? [];
        const isInDanger = dangerPieces.some((p) => p.y < OVERFLOW_LINE_Y + DANGER_STACK_MARGIN);
        const tier = consumeFromQueue(isInDanger);
        setQueueVersion((v) => v + 1);
        engineRef.current?.drop(tier, x);
      },
      fastForward: (ms: number) => {
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
        setDangerRatio(state.dangerRatio);
        setCanDrop(state.canDrop);
      },
      triggerGameOver: () => {
        completedGameIdRef.current = getGameId();
        gameOverRef.current = true;
        setGameOver(true);
        showResultRef.current(completedGameIdRef.current);
      },
      isReady: () => engineRef.current !== null,
      spawnTierAt: (tier: number, x: number) => {
        if (gameOverRef.current) return;
        engineRef.current?.drop(tier, x);
      },
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleRestart() {
    endInstrumentedSession(gameOverRef.current ? "completed" : "abandoned");
    setResult(null);
    resetScore();
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
  }

  const queue = queueRef.current;
  const currentDef = activeFruitSet.fruits[queue.current];
  const nextDef = activeFruitSet.fruits[queue.next];

  const { scale, boardWidth, boardHeight } = calculateCascadeLayout({
    containerWidth,
    containerHeight,
  });
  scaleRef.current = scale;

  return (
    <GameShell
      gameType="cascade"
      title={t("game.title")}
      requireBack
      onBack={() => navigation.popToTop()}
      onNewGame={handleRestart}
      onOpenLeaderboard={openLeaderboard}
      style={{
        paddingBottom: 16,
        paddingLeft: Math.max(insets.left, 16),
        paddingRight: Math.max(insets.right, 16),
      }}
    >
      {!assetsReady ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" accessibilityLabel={t("common:loading")} />
        </View>
      ) : (
        <>
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
                  onPress={(e) => handleTap(tapToWorldX(e.nativeEvent.locationX, scale))}
                  style={{ width: boardWidth, height: boardHeight }}
                >
                  <PieceRenderer
                    pieces={pieces}
                    scale={scale}
                    dangerRatio={dangerRatio}
                    canDrop={canDrop}
                    lidPalette={CASCADE_LID_PALETTE[theme]}
                    spawnerTier={queue.current}
                    fruitDefs={activeFruitSet.fruits}
                    images={getImagesForSet(fruitImages, activeFruitSet.id)}
                  />
                </Pressable>
              )}
            </View>

            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              {mergeBursts.map((burst) => (
                <MergeBurst
                  key={burst.id}
                  {...burst}
                  onDone={() => setMergeBursts((prev) => prev.filter((b) => b.id !== burst.id))}
                />
              ))}
            </View>
          </View>

          <GameResultModal
            visible={gameOver}
            outcome="ended"
            eyebrow={t("cascade:game.title")}
            hero={{
              kind: "score",
              label: tResult("stat.score"),
              value: result?.score ?? score,
            }}
            isNewBest={result?.isNewBest ?? false}
            stats={
              result
                ? [
                    { label: tResult("stat.best"), value: result.bestScore },
                    { label: tResult("stat.merges"), value: result.merges },
                  ]
                : []
            }
            submission={
              result && !result.submittable
                ? // No game id: nothing can reach the leaderboard, and there is
                  // nothing to retry — say so instead of showing no line.
                  { status: "error" }
                : toSubmission(leaderboard)
            }
            onViewLeaderboard={openLeaderboard}
            onPlayAgain={handleRestart}
            onHome={() => navigation.popToTop()}
            testID="cascade-result"
          />
        </>
      )}

      <CascadeDevPanel
        enabled={__DEV__}
        open={devPanelOpen}
        onOpen={() => setDevPanelOpen(true)}
        onClose={() => setDevPanelOpen(false)}
        activeFruitSet={activeFruitSet}
        onSpawn={(tier) => {
          engineRef.current?.drop(tier, WORLD_WIDTH / 2);
        }}
      />
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
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
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
