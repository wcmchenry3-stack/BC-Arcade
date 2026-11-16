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
 *   4. Persistence (`useCascadeSave`): the board, queue, score and play time are throttle-saved
 *      (`game/cascade/storage.ts`), restored on mount and saved on pause.
 *   5. Session: `useGameSync("cascade")`; drops and merges are enqueued as events, the session
 *      completes at the end (outcome `win` for the capstone, `loss` at the lid, #3699) and
 *      abandons on a theme switch, restart or unmount (#2450, #2619).
 *   6. Clock: a `PlayClock` started by the first piece (#3700), stopped while another screen
 *      covers the board or the app is in the background, through `usePauseWhileAway` (#2735,
 *      #2750), and for good at the game's end.
 *   7. Result (#2515, #2632): the shared `GameResultModal` (`CascadeResultModal`); the card shows
 *      the rank from `useGameRank` through `toSubmission`. A win (#3699) plays the celebration
 *      first: `CascadeCelebration` animates `celebrationClock`, the board draws it, then the card.
 *      The score is the merge score plus a win's time bonus (`game/cascade/timeBonus.ts`, #3700),
 *      sent in the result block (`game/cascade/resultBlock.ts`); the server recomputes it.
 *   8. Audio, motion and haptics: tier-scaled merge sound (`useTieredMergeSound`), game-over
 *      sound, merge bursts (`components/cascade/MergeBurst`; skipped under reduce motion, and for
 *      the winning merge, which the celebration replaces). #3701: the engine's land / merge /
 *      drop moments and the game over go to the board's motion (`useBoardMotion`, drawn on the
 *      UI thread) and to the paced haptics (`game/cascade/haptics.ts`); the loss card waits for
 *      the game-over sequence (`useLossCard`). All timings: `game/cascade/motion.ts`.
 *   9. The lid (#3694): the engine decides game over; the board draws the lid line, the
 *      spawner's clock ring from `dangerRatio`, the red wash on pieces over the lid, and the
 *      waiting ghost while `canDrop()` is false. A tap drops only when the engine allows it.
 *  10. Test and dev seams: `useCascadeTestSeams` (the `__cascade_*` hooks and demo set-ups) for
 *      E2E builds, `CascadeDevPanel` (with the frame readout, #2960) for dev builds (#3693).
 *      Session, clock and best: `useCascadeSession`.
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
import { useCascadeClock } from "../game/cascade/useCascadeClock";
import { FruitSetProvider, useFruitSet } from "../theme/FruitSetContext";
import type { FruitTier } from "../theme/fruitSets";
import { CascadeEngine, type EngineEvent, type PieceSnapshot } from "../game/cascade/engine";
import { WORLD_WIDTH } from "../game/cascade/constants";
import { CAPSTONE_TIER } from "../game/cascade/tiers";
import { calculateCascadeLayout, tapToWorldX, type BoardPressPoint } from "../game/cascade/layout";
import { isInDanger, useCascadeTestSeams } from "../game/cascade/useCascadeTestSeams";
import { useCascadeSession } from "../game/cascade/useCascadeSession";
import { areTestHooksEnabled } from "../game/_shared/envFlags";
import CascadeTestControls from "../components/cascade/CascadeTestControls";
import { DROUGHT_WINDOW } from "../game/cascade/spawnSelector";
import { PieceQueue, advanceQueue, makeQueue } from "../game/cascade/pieceQueue";
import { NO_PIECES, useBoardFrame } from "../game/cascade/useBoardFrame";
import { useCascadeSave } from "../game/cascade/useCascadeSave";
import { createScoreStore } from "../game/cascade/scoreStore";
import { useTieredMergeSound } from "../game/cascade/useTieredMergeSound";
import { createLoopGate } from "../game/cascade/winTail";
import { recordLoopFrame } from "../game/starswarm/render/frameStats";
import { FRAME_STATS_ENABLED, useFrameReadout } from "../game/cascade/useFrameReadout";
import NextFruitPreview from "../components/cascade/NextFruitPreview";
import ScoreDisplay from "../components/cascade/ScoreDisplay";
import ThemeSelector from "../components/cascade/ThemeSelector";
import CascadeDevPanel from "../components/cascade/CascadeDevPanel";
import CascadeBoard from "../components/cascade/CascadeBoard";
import MergeBurst, { type MergeBurstData } from "../components/cascade/MergeBurst";
import CascadeResultModal, {
  cardResult,
  type CascadeResult,
} from "../components/cascade/CascadeResultModal";
import { CASCADE_LID_PALETTE } from "../theme/theme.cascade";
import { useGameRank } from "../game/_shared/useGameRank";
import { clearGame as clearCascadeGame } from "../game/cascade/storage";
import { useSound } from "../game/_shared/useSound";
import { CASCADE_SOUNDS } from "../game/cascade/sounds";
import { useReduceMotion } from "../components/shared/useReduceMotion";
import { useBoardMotion } from "../components/cascade/useBoardMotion";
import { useLossCard } from "../components/cascade/useLossCard";
import { useCascadeHaptics } from "../game/cascade/haptics";
import { MOTION_KIND } from "../game/cascade/motionLog";

// ---------------------------------------------------------------------------
// Main game component
// ---------------------------------------------------------------------------

function CascadeGame() {
  const { t } = useTranslation(["cascade", "common"]);
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { activeFruitSet } = useFruitSet();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList, "Cascade">>();

  const [devPanelOpen, setDevPanelOpen] = useState(false);
  // The live score, outside React state (#2960): ScoreDisplay subscribes to it.
  const [scoreStore] = useState(() => createScoreStore());
  const [gameOver, setGameOver] = useState(false);
  // The game ended in the win (#3699): the celebration, then the win card.
  const [won, setWon] = useState(false);
  // The celebration's clock (ms since the win, -1: none), animated by CascadeCelebration and
  // drawn by the board on the UI thread.
  const celebrationClock = useSharedValue(-1);
  // A tier-9 piece is on the board: the board builds the celebration ahead, in idle time. Ready:
  // the game is won and the board can draw it, so its clock may start (#3699, iOS demo on #3924).
  const [nearWin, setNearWin] = useState(false);
  const [celebrationReady, setCelebrationReady] = useState(false);
  // The game's play clock (#2750, `useCascadeClock`): paused while the player is away
  // (usePauseWhileAway below), stopped at the game's end.
  const clock = useCascadeClock();
  // The highest tier on the board this game (the result's `max_tier`, #3700).
  const maxTierRef = useRef(0);
  // A piece of `tier` is on the board (a drop, a merge, a restore, a test or dev placement). A new
  // game's first piece starts the play clock (#3700): idle time before it costs no time bonus.
  const noteTier = useCallback(
    (tier: number) => {
      clock.start();
      if (tier > maxTierRef.current) maxTierRef.current = tier;
      if (tier === CAPSTONE_TIER - 1) setNearWin(true);
    },
    [clock]
  );
  const markCelebrationReady = useCallback(() => setCelebrationReady(true), []);
  // What the result card shows, captured at game over (#2515).
  const [result, setResult] = useState<CascadeResult | null>(null);
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
  // #3701: the board's motion (UI thread) and the paced haptics, fed from the engine's events.
  const motion = useBoardMotion(reduceMotion);
  const haptics = useCascadeHaptics();
  // The current drop's chain: merges since the last drop (1 = a plain merge).
  const chainLinkRef = useRef(0);

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

  // The board's frame (#2960, `useBoardFrame`): published by the loop, drawn on the UI thread.
  const { frameSV, publishBoard, engineStateRef, lastBoardRef } = useBoardFrame(queueRef);

  /** The queue moved on: re-render the preview and show the new piece in the spawner. */
  const queueChanged = useCallback(() => {
    setQueueVersion((v) => v + 1);
    publishBoard(lastBoardRef.current);
  }, [publishBoard, lastBoardRef]);

  // Frame time and React commits for the dev panel's readout (#2960, dev builds only).
  const { frameStatsRef, onCommit, readFrameStats } = useFrameReadout();
  const droppingRef = useRef(false);
  const lastDropTimeRef = useRef<number>(Date.now());
  const dropCountRef = useRef<number>(0);
  const prevFruitSetId = useRef(activeFruitSet.id);

  // Refs used by test hooks and RAF to read latest state without closure staleness
  const scoreRef = useRef(0);
  const gameOverRef = useRef(false);
  const activeFruitSetRef = useRef(activeFruitSet);

  const themeIdRef = useRef(activeFruitSet.id);
  const {
    sync: { resume: syncResume, markStarted: syncMarkStarted, enqueue: syncEnqueue, getGameId },
    mergeCountRef,
    judgeEnd,
    startSession: startInstrumentedSession,
    endSession: endInstrumentedSession,
  } = useCascadeSession({ scoreRef, dropCountRef, maxTierRef, themeIdRef, clock });

  const completedGameIdRef = useRef<string | null>(null);
  const settlingTicksLeftRef = useRef<number>(0);

  // The latest layout (`calculateCascadeLayout`), for the merge bursts in the RAF loop.
  const layoutRef = useRef({ scale: 0, offsetX: 0, offsetY: 0 });
  const piecesRef = useRef<PieceSnapshot[]>([]);

  // Pops queue.current, advances the queue, updates history. Returns the dropped tier.
  const consumeFromQueue = useCallback(
    (isInDanger: boolean): FruitTier => {
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
      // #3701: a new chain starts, and the next piece drops into the spawner.
      chainLinkRef.current = 0;
      motion.push(MOTION_KIND.drop, 0, 0, tier, 0, 0);
      motion.publish();
      noteTier(tier); // the piece dropped: the first one starts the play clock (#3700)
      return tier;
    },
    [motion, noteTier]
  );

  useEffect(() => {
    startInstrumentedSession(activeFruitSetRef.current.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { saveGameThrottled, saveNow, lastSaveTimeRef } = useCascadeSave({
    engineRef,
    piecesRef,
    scoreRef,
    queueRef,
    queueHistoryRef,
    gameOverRef,
    settlingTicksLeftRef,
    playedMs: clock.elapsed,
    restartClock: clock.restore,
    resumeSession: syncResume,
    setScore: scoreStore.set,
    queueChanged,
    noteTier,
  });

  useEffect(() => {
    activeFruitSetRef.current = activeFruitSet;
    themeIdRef.current = activeFruitSet.id;
  }, [activeFruitSet]);

  /** A new game (New Game, Play Again or a piece-set switch): the old session ends first. */
  const startNewGame = useCallback(
    (themeId: string) => {
      endInstrumentedSession(gameOverRef.current ? "completed" : "abandoned");
      // A new game: the next game over must be able to submit again.
      setResult(null);
      resetScore();
      queueRngRef.current = undefined;
      const fresh = makeQueue();
      queueRef.current = fresh.queue;
      queueHistoryRef.current = fresh.history;
      scoreRef.current = 0;
      gameOverRef.current = false;
      dropCountRef.current = 0;
      scoreStore.set(0);
      setGameOver(false);
      setWon(false);
      setNearWin(false);
      setCelebrationReady(false);
      celebrationClock.set(-1);
      setQueueVersion((v) => v + 1);
      publishBoard(NO_PIECES);
      clearCascadeGame().catch(() => {});
      lastSaveTimeRef.current = 0;
      settlingTicksLeftRef.current = 0;
      chainLinkRef.current = 0;
      motion.clear();
      haptics.reset();
      setGameKey((k) => k + 1);
      startInstrumentedSession(themeId);
    },
    [
      endInstrumentedSession,
      startInstrumentedSession,
      resetScore,
      scoreStore,
      publishBoard,
      celebrationClock,
      motion,
      haptics,
      lastSaveTimeRef,
    ]
  );

  // Reset on fruit-set switch
  useEffect(() => {
    if (prevFruitSetId.current === activeFruitSet.id) return;
    prevFruitSetId.current = activeFruitSet.id;
    startNewGame(activeFruitSet.id);
  }, [activeFruitSet.id, startNewGame]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainerWidth(Math.floor(width));
    setContainerHeight(Math.floor(height));
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
    [activeFruitSet, t, saveGameThrottled, syncEnqueue, mergeCountRef]
  );

  /**
   * Captures what the result card shows and looks up where the synced game
   * ranks (#2632). The card itself announces the result, so there is no
   * separate screen-reader announcement here.
   */
  const showResult = useCallback(
    (gameId: string | null, end: "win" | "loss") => {
      const { block, best } = judgeEnd(end); // from the stopped clock (`endPlay`)
      setResult(cardResult(block, best, gameId !== null));
      if (gameId) void lookupRank(gameId);
    },
    [lookupRank, judgeEnd]
  );

  // `isWin`: the capstone was made (#3920). The engine reports no game over after a win, so the
  // win ends the game here too: the session completes as a `win` (a `loss` at the lid, #3699),
  // the best and the result are recorded and the save is cleared. The card waits for the
  // celebration (`CascadeResultModal`).
  /**
   * The game ends: the clock stops first, so the session, the card and its 1 s delay (#3701,
   * `useLossCard`) all read the same time and bonus; a loss dims the pile and flashes the lid.
   */
  const endPlay = useCallback(
    (isWin: boolean) => {
      gameOverRef.current = true;
      clock.stop();
      if (!isWin) motion.push(MOTION_KIND.gameOver, 0, 0, 0, 0, 0);
      motion.setDanger(0);
      motion.publish();
    },
    [clock, motion]
  );
  const handleGameOver = useCallback(
    (isWin = false) => {
      endPlay(isWin);
      const end = isWin ? "win" : "loss";
      const gameId = endInstrumentedSession(end);
      clearCascadeGame().catch(() => {});
      setWon(isWin);
      setGameOver(true);
      showResult(gameId, end);
    },
    [endInstrumentedSession, showResult, endPlay]
  );

  // Always-fresh refs for the RAF loop — updated every render so the loop
  // never captures stale closures for merge/gameOver handling.
  const onGameOverRef = useRef<(won?: boolean) => void>(() => {});
  const handleEventsRef = useRef<(events: readonly EngineEvent[], quiet: boolean) => void>(
    () => {}
  );

  const onMerge = (tier: FruitTier, x: number, y: number, id: number, quiet: boolean) => {
    handleMerge({ tier, x, y });
    noteTier(tier);
    playFruitMerge(tier);
    // The winning merge has no burst, pop or pulse: the celebration replaces them (#3699).
    if (tier === CAPSTONE_TIER) return;
    const link = ++chainLinkRef.current;
    motion.push(MOTION_KIND.merge, x, y, tier, id, link);
    if (!quiet) haptics.merge(tier, link);
    const fruit = activeFruitSet.fruits[tier];
    if (!reduceMotion && fruit) {
      const { scale: s, offsetX, offsetY } = layoutRef.current;
      const burstId = `${nextBurstId}-${Date.now()}-${x.toFixed(0)}`;
      setMergeBursts((prev) => [
        ...prev,
        { id: burstId, x: offsetX + x * s, y: offsetY + y * s, color: fruit.color },
      ]);
    }
  };

  /**
   * A step's events, from the loop or a test fast-forward (`quiet`: no haptics, as while a
   * restored game settles). Motion is pushed here and drawn on the UI thread (#3701).
   */
  handleEventsRef.current = (events, quiet) => {
    for (const ev of events) {
      if (ev.type === "merge") {
        onMerge(ev.result as FruitTier, ev.x, ev.y, ev.id, quiet);
      } else if (ev.type === "land") {
        motion.push(MOTION_KIND.land, ev.x, ev.y, ev.tier, ev.id, ev.speed);
        if (!quiet) haptics.land(ev.tier);
      } else if (ev.type === "gameOver" || ev.type === "win") {
        onGameOverRef.current(ev.type === "win"); // the win ends the game too (#3904, #3920)
      } else if (ev.type === "guardRailFired" && __DEV__) {
        console.log(`[Cascade] guard rail: ${ev.reason} body=${ev.bodyId}`);
      }
      // "score" event — score is read from state; no separate handling needed.
    }
    motion.publish();
  };

  onGameOverRef.current = (isWin = false) =>
    isWin ? handleGameOver(true) : (playGameOver(), handleGameOver());
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
      clock.pause();
      saveNow();
    },
    () => {
      clock.resume();
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
    // After the win the loop runs on until the capstone has grown in (#3920, `winTail.ts`).
    const gate = createLoopGate(engine, () => gameOverRef.current);

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

      // A restored game settling fires no haptics (#3701).
      const quiet = settlingTicksLeftRef.current > 0;
      handleEventsRef.current(result.events, quiet);
      const danger = gameOverRef.current ? 0 : state.dangerRatio;
      motion.setDanger(danger);
      if (!quiet) haptics.danger(danger);

      // No React state per frame (#2960): the score store notifies only on a new integer, and
      // the board is published to the shared value only when it draws something new.
      scoreStore.set(state.score);
      piecesRef.current = state.pieces;
      publishBoard(state);

      if (gate.afterFrame(delta, state.pieces)) schedule();
    }

    resumeLoopRef.current = () => {
      if (!gate.runs()) return;
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
  }, [gameKey, awayRef, scoreStore, publishBoard, motion, haptics, engineStateRef, frameStatsRef]);

  const handleTap = useCallback(
    (x: number | null) => {
      if (x === null) return; // a press with no usable x (`tapToWorldX`)
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

      // isInDanger shapes the piece added to the back of the queue (2 drops ahead)
      const tier = consumeFromQueue(isInDanger(engineRef.current?.getState()));
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

  const forceGameOver = useCallback(() => {
    completedGameIdRef.current = getGameId();
    endPlay(false);
    setGameOver(true);
    showResultRef.current(completedGameIdRef.current, "loss");
  }, [getGameId, endPlay]);

  // Test seams: the __cascade_* hooks (EXPO_PUBLIC_TEST_HOOKS=1 builds only, #3693) and the demo
  // set-ups of the test controls (#3719).
  const { applySetup } = useCascadeTestSeams({
    engineRef,
    queueRef,
    queueHistoryRef,
    queueRngRef,
    queueScriptRef,
    scoreRef,
    gameOverRef,
    settlingTicksLeftRef,
    droppingRef,
    resumeLoopRef,
    handleEventsRef,
    queueChanged,
    publishBoard,
    setScore: scoreStore.set,
    noteTier,
    consumeFromQueue,
    forceGameOver,
  });

  const handleRestart = () => startNewGame(activeFruitSetRef.current.id);

  const cardVisible = useLossCard(gameOver, won, gameKey);
  const queue = queueRef.current;
  const currentDef = activeFruitSet.fruits[queue.current];
  const nextDef = activeFruitSet.fruits[queue.next];

  const { scale, boardWidth, boardHeight, offsetX, offsetY } = calculateCascadeLayout({
    containerWidth,
    containerHeight,
  });
  layoutRef.current = { scale, offsetX, offsetY };

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
    (e: GestureResponderEvent) => handleTap(tapToWorldX(e.nativeEvent as BoardPressPoint, scale)),
    [handleTap, scale]
  );
  // The bin is the card: the board rect, bottom-anchored in the measured area.
  const boardAreaStyle = useMemo(
    () => ({
      position: "absolute" as const,
      left: offsetX,
      top: offsetY,
      width: boardWidth,
      height: boardHeight,
    }),
    [offsetX, offsetY, boardWidth, boardHeight]
  );
  const removeBurst = useCallback(
    (id: string) => setMergeBursts((prev) => prev.filter((b) => b.id !== id)),
    []
  );
  const openDevPanel = useCallback(() => setDevPanelOpen(true), []);
  const closeDevPanel = useCallback(() => setDevPanelOpen(false), []);
  const devSpawn = useCallback(
    (tier: number) => {
      noteTier(tier);
      engineRef.current?.drop(tier, WORLD_WIDTH / 2);
    },
    [noteTier]
  );

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

        <View style={styles.canvasWrapper} onLayout={onLayout}>
          {scale > 0 && (
            <Pressable testID="cascade-game-area" onPress={onBoardPress} style={boardAreaStyle}>
              <CascadeBoard
                frame={frameSV}
                scale={scale}
                lidPalette={CASCADE_LID_PALETTE[theme]}
                theme={theme}
                setId={activeFruitSet.id}
                prepareCelebration={nearWin}
                won={won}
                onCelebrationReady={markCelebrationReady}
                reduceMotion={reduceMotion}
                celebration={celebrationClock}
                motion={motion.values}
              />
            </Pressable>
          )}

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
            onWin={() => applySetup("win")}
            onForceGameOver={forceGameOver}
          />
        )}

        <CascadeResultModal
          visible={cardVisible}
          won={won}
          result={result}
          liveScore={scoreStore.get()}
          leaderboard={leaderboard}
          celebrationClock={celebrationClock}
          celebrationReady={celebrationReady}
          reduceMotion={reduceMotion}
          onViewLeaderboard={openLeaderboard}
          onPlayAgain={handleRestart}
          onHome={goHome}
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
  // The measured board area; the bin (the card) is drawn bottom-anchored inside it.
  canvasWrapper: {
    flex: 1,
    marginHorizontal: 8,
  },
});
