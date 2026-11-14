/**
 * CascadeScreen: Cascade (a Suika-style merge game) wired to `CascadeEngine` (#1751, #1754).
 *
 * Concerns:
 *   1. Game logic: the engine (`game/cascade/engine.ts`, planck.js) is stepped from a RAF loop
 *      recreated on `gameKey`; the screen drops pieces from the queue and reads state back
 *      each frame. The engine owns the physics, scoring and game over; the screen owns none.
 *   2. Rendering (#2960): no per-frame React state. The loop reads the engine into a reused
 *      snapshot, packs it into a `Float64Array` (`game/cascade/render/frame.ts`) and publishes it
 *      to a shared value only when it changed; `CascadeBoard` records a Skia Picture from it on
 *      the UI thread. The score lives in a `ScoreStore` that `ScoreDisplay` subscribes to.
 *   3. Layout: `calculateCascadeLayout` (`game/cascade/layout.ts`) scales the fixed world into
 *      the measured board area (#3693).
 *   4. Persistence: the board, queue, score and play time are throttle-saved
 *      (`game/cascade/storage.ts`, `SAVE_THROTTLE_MS`), restored on mount and saved on pause.
 *   5. Session: `useGameSync("cascade")`; drops and merges are enqueued as events, the session
 *      completes at game over and abandons on a theme switch, restart or unmount (#2450, #2619).
 *   6. Clock: a `PlayClock` stopped while another screen covers the board or the app is in
 *      the background, through `usePauseWhileAway` (#2735, #2750).
 *   7. Result (#2515, #2632): the shared `GameResultModal`; the card shows the rank from
 *      `useGameRank` through `toSubmission`.
 *   8. Audio and animation: tier-scaled merge sound (`useTieredMergeSound`), game-over sound,
 *      merge bursts (`components/cascade/MergeBurst`; skipped under reduce motion).
 *   9. The lid (#3694): the engine decides game over; the board draws the lid line, the
 *      spawner's clock ring from `dangerRatio`, the red wash on pieces over the lid, and the
 *      waiting ghost while `canDrop()` is false. A tap drops only when the engine allows it.
 *  10. Test and dev seams: `registerCascadeTestHooks` (`game/cascade/testHooks.ts`) for E2E
 *      builds, `CascadeDevPanel` (with the frame readout, #2960) for dev builds (#3693).
 */
import React, { Profiler, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  LayoutChangeEvent,
  Pressable,
  type GestureResponderEvent,
} from "react-native";
import { useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { HomeStackParamList } from "../types/navigation";
import { useTheme } from "../theme/ThemeContext";
import { GameShell } from "../components/shared/GameShell";
import { useLeaderboardLink } from "../hooks/useLeaderboardLink";
import { usePauseWhileAway } from "../hooks/usePauseWhileAway";
import { clockElapsedMs, pauseClock, resumeClock, type PlayClock } from "../game/_shared/playClock";
import GameResultModal from "../components/shared/GameResultModal";
import { toSubmission } from "../components/shared/toSubmission";
import { FruitSetProvider, useFruitSet } from "../theme/FruitSetContext";
import type { FruitTier } from "../theme/fruitSets";
import { CascadeEngine, type PieceSnapshot } from "../game/cascade/engine";
import { WORLD_WIDTH, OVERFLOW_LINE_Y, DANGER_STACK_MARGIN } from "../game/cascade/constants";
import { calculateCascadeLayout, tapToWorldX } from "../game/cascade/layout";
import {
  registerCascadeTestHooks,
  cascadeSetup,
  type CascadeSetupId,
} from "../game/cascade/testHooks";
import { areTestHooksEnabled } from "../game/_shared/envFlags";
import CascadeTestControls from "../components/cascade/CascadeTestControls";
import { DROUGHT_WINDOW } from "../game/cascade/spawnSelector";
import { PieceQueue, createPieceQueue, advanceQueue } from "../game/cascade/pieceQueue";
import {
  createFramePacker,
  createGameState,
  emptyFrame,
  nextFrame,
  packFrame,
} from "../game/cascade/render/frame";
import type { FrameState } from "../game/cascade/render/frame";
import { createScoreStore } from "../game/cascade/scoreStore";
import { useTieredMergeSound } from "../game/cascade/useTieredMergeSound";
import {
  createFrameStats,
  recordCommit,
  recordLoopFrame,
  summarizeFrameStats,
} from "../game/starswarm/render/frameStats";
import NextFruitPreview from "../components/cascade/NextFruitPreview";
import ScoreDisplay from "../components/cascade/ScoreDisplay";
import ThemeSelector from "../components/cascade/ThemeSelector";
import CascadeDevPanel from "../components/cascade/CascadeDevPanel";
import CascadeBoard from "../components/cascade/CascadeBoard";
import MergeBurst, { type MergeBurstData } from "../components/cascade/MergeBurst";
import { CASCADE_LID_PALETTE } from "../theme/theme.cascade";
import { useGameSync } from "../game/_shared/useGameSync";
import { useGameRank } from "../game/_shared/useGameRank";
import {
  saveGame as saveCascadeGame,
  loadGame as loadCascadeGame,
  SAVE_VERSION,
  clearGame as clearCascadeGame,
  type SavedState,
} from "../game/cascade/storage";
import { getBest, judgeResult, recordResult } from "../game/_shared/personalBest";
import { useSound } from "../game/_shared/useSound";
import { CASCADE_SOUNDS } from "../game/cascade/sounds";
import { useReduceMotion } from "../components/shared/useReduceMotion";

const SETTLE_TICKS = 60;
const SAVE_THROTTLE_MS = 2000;

/**
 * Frame-time and commit sampling (#2960, Star Swarm's #2567 ring buffer) for the dev panel's
 * readout. Dev builds only, like the panel that shows it.
 */
const FRAME_STATS_ENABLED = __DEV__;

/** A board with no pieces, for a reset (the lid and spawner still draw). */
const NO_PIECES: FrameState = { pieces: [] };

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

// ---------------------------------------------------------------------------
// Main game component
// ---------------------------------------------------------------------------

function CascadeGame() {
  const { t } = useTranslation(["cascade", "common"]);
  const { t: tResult } = useTranslation("result");
  const { colors, theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { activeFruitSet } = useFruitSet();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList, "Cascade">>();

  const [devPanelOpen, setDevPanelOpen] = useState(false);
  // The live score, outside React state (#2960): ScoreDisplay subscribes to it.
  const [scoreStore] = useState(() => createScoreStore());
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
  // Test builds only (#3719): tiers the queue still has to offer, after `next`, before it goes random.
  const queueScriptRef = useRef<number[]>([]);
  if (queueRef.current == null) {
    const init = makeQueue();
    queueRef.current = init.queue;
    queueHistoryRef.current = init.history;
  }

  // The board's frame (#2960): what the loop last published, read by CascadeBoard's Picture on
  // the UI thread. The loop writes through refs; nothing per frame touches React state.
  // One empty frame, made once, seeds both the shared value and the publish gate, so a render
  // never reads `.value` (a synchronous UI-runtime read on device).
  const [initialFrame] = useState(() => emptyFrame(queueRef.current.current));
  const frameSV = useSharedValue<Float64Array>(initialFrame);
  const frameSVRef = useRef(frameSV);
  frameSVRef.current = frameSV;
  const publishedFrameRef = useRef<Float64Array>(initialFrame);
  const packerRef = useRef(createFramePacker());
  // The engine writes the board into this each frame (`getState(into)`), allocation-free.
  const engineStateRef = useRef(createGameState());
  // The board last read from the engine; a reset points it at an empty board.
  const lastBoardRef = useRef<FrameState>(NO_PIECES);

  /** Publishes `board` (with the queue's current piece in the spawner) if it draws anything new. */
  const publishBoard = useCallback((board: FrameState) => {
    lastBoardRef.current = board;
    const packer = packerRef.current;
    packFrame(packer, board, queueRef.current.current);
    const next = nextFrame(packer, publishedFrameRef.current);
    if (next) {
      publishedFrameRef.current = next;
      frameSVRef.current.value = next;
    }
  }, []);

  /** The queue moved on: re-render the preview and show the new piece in the spawner. */
  const queueChanged = useCallback(() => {
    setQueueVersion((v) => v + 1);
    publishBoard(lastBoardRef.current);
  }, [publishBoard]);

  // Frame time and React commits for the dev panel's readout (#2960). Commits are counted by a
  // Profiler around the whole screen body, so a commit of ScoreDisplay alone counts too, and a
  // commit that touches several components counts once.
  const frameStatsRef = useRef(FRAME_STATS_ENABLED ? createFrameStats() : null);
  const onCommit = useCallback(() => {
    if (frameStatsRef.current) recordCommit(frameStatsRef.current, performance.now());
  }, []);
  const readFrameStats = useCallback(() => {
    const stats = frameStatsRef.current;
    return stats ? summarizeFrameStats(stats, performance.now()) : null;
  }, []);
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

  // The best score persists across app launches (#2515): the shared personal best (#3757).
  useEffect(() => {
    let active = true;
    getBest("cascade").then((best) => {
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
    const scripted = queueScriptRef.current.shift();
    if (scripted !== undefined) newQueue.next = scripted;
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
      scoreStore.set(snapshot.score);
      queueRef.current = snapshot.queue;
      queueHistoryRef.current = [snapshot.queue.current, snapshot.queue.next];
      queueChanged();
      settlingTicksLeftRef.current = SETTLE_TICKS;
    });
    return () => {
      active = false;
    };
  }, [syncResume, restartClock, scoreStore, queueChanged]);

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
      scoreStore.set(0);
      setGameOver(false);
      // A new game: the next game over must be able to submit again.
      setResult(null);
      resetScore();
      setQueueVersion((v) => v + 1);
      publishBoard(NO_PIECES);
      clearCascadeGame().catch(() => {});
      settlingTicksLeftRef.current = 0;
      setGameKey((k) => k + 1);
      startInstrumentedSession(activeFruitSet.id);
    }
  }, [
    activeFruitSet.id,
    endInstrumentedSession,
    startInstrumentedSession,
    resetScore,
    scoreStore,
    publishBoard,
  ]);

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
      // A 0 score never sets a best (the game's rule in `personalBestGames.ts`).
      const { improved, isNewBest } = judgeResult("cascade", previousBest, finalScore);
      if (improved) {
        bestScoreRef.current = finalScore;
        void recordResult("cascade", finalScore);
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
    // Live play seeds the drop nudge from the clock; a test seed replaces it (`handleSetSeed`).
    const engine = new CascadeEngine({ seed: (Math.random() * 0x100000000) >>> 0 });
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

      const interval = now - last;
      const delta = Math.min(interval, 100);
      last = now;
      if (frameStatsRef.current) recordLoopFrame(frameStatsRef.current, now, interval);

      if (settlingTicksLeftRef.current > 0) settlingTicksLeftRef.current--;

      const result = engine.step(delta);
      // Written into the screen's reused snapshot: no allocation per frame (#2960).
      const state = engine.getState(engineStateRef.current);

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

      // No React state per frame (#2960): the score store notifies only on a new integer, and
      // the board is published to the shared value only when it draws something new.
      scoreStore.set(state.score);
      piecesRef.current = state.pieces;
      publishBoard(state);

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
      publishBoard(NO_PIECES);
      resumeLoopRef.current = () => {};
    };
  }, [gameKey, awayRef, scoreStore, publishBoard]);

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
      queueChanged();

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
    [consumeFromQueue, gameOver, saveGameThrottled, syncEnqueue, syncMarkStarted, queueChanged]
  );

  const handleSetSeed = useCallback(
    (seed: number) => {
      const rng = createSeededRng(seed);
      queueRngRef.current = rng;
      engineRef.current?.seed(seed);
      const seeded = makeQueue(rng);
      queueRef.current = seeded.queue;
      queueHistoryRef.current = seeded.history;
      queueChanged();
    },
    [queueChanged]
  );

  /** Steps the physics by `ms` without waiting for frames (the `fastForward` hook). */
  const fastForward = useCallback(
    (ms: number) => {
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
      scoreStore.set(state.score);
      publishBoard(state);
    },
    [scoreStore, publishBoard]
  );

  /** Scripts the queue (test builds, #3719): the next pieces are exactly `tiers`, then random. */
  const seedQueue = useCallback(
    (tiers: number[]) => {
      if (tiers.length === 0) return;
      const [current, next, ...rest] = tiers as [number, ...number[]];
      queueRef.current = { current, next: next ?? current };
      queueScriptRef.current = rest;
      queueHistoryRef.current = [current, next ?? current].slice(-DROUGHT_WINDOW);
      queueChanged();
    },
    [queueChanged]
  );

  /**
   * A demo set-up (test builds, #3719): restores the pile into the live engine (so its rules,
   * the lid included, decide what happens next), scripts the queue and lets the pile settle.
   */
  const applySetup = useCallback(
    (id: CascadeSetupId) => {
      const engine = engineRef.current;
      if (!engine || gameOverRef.current) return;
      const setup = cascadeSetup(id);
      engine.restore(setup.pieces, scoreRef.current);
      settlingTicksLeftRef.current = 0;
      droppingRef.current = false;
      if (setup.queue) seedQueue(setup.queue);
      fastForward(setup.settleMs);
      publishBoard(engine.getState());
    },
    [fastForward, seedQueue, publishBoard]
  );

  const forceGameOver = useCallback(() => {
    completedGameIdRef.current = getGameId();
    gameOverRef.current = true;
    setGameOver(true);
    showResultRef.current(completedGameIdRef.current);
  }, [getGameId]);

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
        queueChanged();
        engineRef.current?.drop(tier, x);
      },
      fastForward,
      triggerGameOver: forceGameOver,
      isReady: () => engineRef.current !== null,
      spawnTierAt: (tier: number, x: number) => {
        if (gameOverRef.current) return;
        engineRef.current?.drop(tier, x);
      },
      seedQueue,
      setupChain: () => applySetup("chain"),
      setupNearLid: () => applySetup("nearLid"),
      fillBin: () => applySetup("fillBin"),
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
    scoreStore.set(0);
    setGameOver(false);
    setQueueVersion((v) => v + 1);
    publishBoard(NO_PIECES);
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

  // Hoisted (#2960) so the memoized children see the same props until something real changes.
  const goHome = useCallback(() => navigation.popToTop(), [navigation]);
  const shellStyle = useMemo(
    () => ({
      paddingBottom: 16,
      paddingLeft: Math.max(insets.left, 16),
      paddingRight: Math.max(insets.right, 16),
    }),
    [insets.left, insets.right]
  );
  const preview = useMemo(
    () =>
      currentDef !== undefined && nextDef !== undefined ? (
        <NextFruitPreview current={currentDef} next={nextDef} />
      ) : null,
    [currentDef, nextDef]
  );
  const onBoardPress = useCallback(
    (e: GestureResponderEvent) => handleTap(tapToWorldX(e.nativeEvent.locationX, scale)),
    [handleTap, scale]
  );
  const boardAreaStyle = useMemo(
    () => ({ width: boardWidth, height: boardHeight }),
    [boardWidth, boardHeight]
  );
  const canvasOuterStyle = useMemo(
    () => [styles.canvasOuter, { backgroundColor: colors.surface, borderColor: colors.border }],
    [colors.surface, colors.border]
  );
  const removeBurst = useCallback(
    (id: string) => setMergeBursts((prev) => prev.filter((b) => b.id !== id)),
    []
  );
  const openDevPanel = useCallback(() => setDevPanelOpen(true), []);
  const closeDevPanel = useCallback(() => setDevPanelOpen(false), []);
  const devSpawn = useCallback((tier: number) => {
    engineRef.current?.drop(tier, WORLD_WIDTH / 2);
  }, []);

  const body = (
    <GameShell
      gameType="cascade"
      title={t("game.title")}
      requireBack
      onBack={goHome}
      onNewGame={handleRestart}
      onOpenLeaderboard={openLeaderboard}
      style={shellStyle}
    >
      <>
        <ScoreDisplay store={scoreStore}>{preview}</ScoreDisplay>

        <ThemeSelector />

        <View style={styles.canvasWrapper}>
          <View style={canvasOuterStyle} onLayout={onLayout}>
            {scale > 0 && (
              <Pressable testID="cascade-game-area" onPress={onBoardPress} style={boardAreaStyle}>
                <CascadeBoard
                  frame={frameSV}
                  scale={scale}
                  lidPalette={CASCADE_LID_PALETTE[theme]}
                  setId={activeFruitSet.id}
                />
              </Pressable>
            )}
          </View>

          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {mergeBursts.map((burst) => (
              <MergeBurst key={burst.id} {...burst} onDone={removeBurst} />
            ))}
          </View>
        </View>

        {areTestHooksEnabled() && (
          <CascadeTestControls
            onChain={() => applySetup("chain")}
            onNearLid={() => applySetup("nearLid")}
            onFillBin={() => applySetup("fillBin")}
            onForceGameOver={forceGameOver}
          />
        )}

        <GameResultModal
          visible={gameOver}
          outcome="ended"
          eyebrow={t("cascade:game.title")}
          hero={{
            kind: "score",
            label: tResult("stat.score"),
            value: result?.score ?? scoreStore.get(),
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
          onHome={goHome}
          testID="cascade-result"
        />
      </>

      <CascadeDevPanel
        enabled={__DEV__}
        open={devPanelOpen}
        onOpen={openDevPanel}
        onClose={closeDevPanel}
        activeFruitSet={activeFruitSet}
        onSpawn={devSpawn}
        readFrameStats={FRAME_STATS_ENABLED ? readFrameStats : undefined}
      />
    </GameShell>
  );
  return FRAME_STATS_ENABLED ? (
    <Profiler id="cascade" onRender={onCommit}>
      {body}
    </Profiler>
  ) : (
    body
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
