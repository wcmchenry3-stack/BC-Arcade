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
 *   3. Layout and input: `calculateCascadeLayout` scales the world into the board area (#3693);
 *      `CascadeAimArea` turns press, drag and release into a drop (#3928, UI thread).
 *   4. Persistence (`useCascadeSave`): the board, queue, score and play time are throttle-saved
 *      (`game/cascade/storage.ts`), restored on mount and saved on pause.
 *   5. Session: `useCascadeSession` (`useGameRecorder("cascade")`); the session completes at the
 *      end (outcome `win` for the capstone, `loss` at the lid, #3699) and abandons on a theme
 *      switch, restart or unmount (#2450, #2619). Its `rec` records the drops, merges and danger
 *      moments for replays (#3858, `game/cascade/replay.ts`); the queue is seeded per game.
 *   6. Clock: a `PlayClock` started by the first piece (#3700), stopped while another screen
 *      covers the board or the app is in the background, through `usePauseWhileAway` (#2735,
 *      #2750), and for good at the game's end.
 *   7. Result (#2515, #2632): the shared `GameResultModal` (`CascadeResultModal`); the card shows
 *      the rank from `useGameRank` through `toSubmission`. A win (#3699) plays the celebration
 *      first: `CascadeCelebration` animates `celebrationClock`, the board draws it, then the card.
 *      The score is the merge score plus a win's time bonus (`game/cascade/timeBonus.ts`, #3700),
 *      sent in the result block (`game/cascade/resultBlock.ts`); the server recomputes it.
 *   8. Audio, motion and haptics: merge bursts (`components/cascade/MergeBurst`; skipped under
 *      reduce motion, and for the winning merge, which the celebration replaces). #3701: the
 *      engine's land / merge / drop moments and the game over go to the board's motion
 *      (`useBoardMotion`, drawn on the UI thread), the paced haptics (`game/cascade/haptics.ts`)
 *      and the piece set's paced sounds (`useCascadeSounds`, #3702); the loss card waits for
 *      the game-over sequence (`useLossCard`). All timings: `game/cascade/motion.ts`.
 *   9. The lid (#3694): the board draws the lid, the clock ring from `dangerRatio`, the red wash
 *      and the waiting ghost. A drop happens only when the engine allows it (`canDrop()`).
 *  10. Test and dev seams: `useCascadeTestSeams` (the `__cascade_*` hooks and demo set-ups) for
 *      E2E builds, `CascadeDevPanel` (frame readout, #2960) for dev builds; `useCascadeSession`.
 */
import React, { Profiler, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, View, LayoutChangeEvent } from "react-native";
import { useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { HomeStackParamList } from "../types/navigation";
import { useTheme } from "../theme/ThemeContext";
import { GameShell } from "../components/shared/GameShell";
import { useLeaderboardLink } from "../hooks/useLeaderboardLink";
import { useReportAppOverlay } from "../hooks/appOverlay";
import { ConfirmModal } from "../components/shared/ConfirmModal";
import { usePauseWhileAway } from "../hooks/usePauseWhileAway";
import { useCascadeClock } from "../game/cascade/useCascadeClock";
import { FruitSetProvider, useFruitSet } from "../theme/FruitSetContext";
import type { FruitTier } from "../theme/fruitSets";
import { CascadeEngine, type EngineEvent, type PieceSnapshot } from "../game/cascade/engine";
import { WORLD_WIDTH } from "../game/cascade/constants";
import { CAPSTONE_TIER } from "../game/cascade/tiers";
import { calculateCascadeLayout } from "../game/cascade/layout";
import CascadeAimArea from "../components/cascade/CascadeAimArea";
import { isInDanger, useCascadeTestSeams } from "../game/cascade/useCascadeTestSeams";
import { useCascadeSession } from "../game/cascade/useCascadeSession";
import { areTestHooksEnabled } from "../game/_shared/envFlags";
import CascadeTestControls from "../components/cascade/CascadeTestControls";
import { DROUGHT_WINDOW } from "../game/cascade/spawnSelector";
import { advanceQueue } from "../game/cascade/pieceQueue";
import { useCascadeQueue } from "../game/cascade/useCascadeQueue";
import { NO_PIECES, useBoardFrame } from "../game/cascade/useBoardFrame";
import { useCascadeSave } from "../game/cascade/useCascadeSave";
import { createScoreStore } from "../game/cascade/scoreStore";
import { useCascadeSounds } from "../game/cascade/useCascadeSounds";
import { createLoopGate } from "../game/cascade/winTail";
import { recordLoopFrame } from "../game/starswarm/render/frameStats";
import { FRAME_STATS_ENABLED, useFrameReadout } from "../game/cascade/useFrameReadout";
import NextFruitPreview from "../components/cascade/NextFruitPreview";
import ScoreDisplay from "../components/cascade/ScoreDisplay";
import ThemeSelector from "../components/cascade/ThemeSelector";
import CascadeDevPanel from "../components/cascade/CascadeDevPanel";
import CascadeBoard from "../components/cascade/CascadeBoard";
import MergeBurst from "../components/cascade/MergeBurst";
import { useMergeBursts } from "../components/cascade/useMergeBursts";
import CascadeResultModal, {
  cardResult,
  type CascadeResult,
} from "../components/cascade/CascadeResultModal";
import { CASCADE_LID_PALETTE } from "../theme/theme.cascade";
import { useGameRank } from "../game/_shared/useGameRank";
import { clearGame as clearCascadeGame } from "../game/cascade/storage";
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
  const { activeFruitSet, setFruitSetById } = useFruitSet();
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
  const mergeBursts = useMergeBursts();
  const reduceMotion = useReduceMotion();
  // #3701: the board's motion (UI thread) and the paced haptics, fed from the engine's events.
  const sounds = useCascadeSounds(activeFruitSet.id, reduceMotion, nearWin); // #3702, paced
  const motion = useBoardMotion(reduceMotion, sounds.dangerOnset); // its blink times the tick
  const haptics = useCascadeHaptics();
  // The current drop's chain: merges since the last drop (1 = a plain merge); a quiet merge (a
  // restore settling, a test fast-forward) ends it. `drops` drives the chips' hop (one per drop).
  const chainLinkRef = useRef(0);
  const [drops, setDrops] = useState(0);

  const engineRef = useRef<CascadeEngine | null>(null);
  // The piece queue and the game's seeds (#3858): seeded per game, scriptable in test builds.
  const { queueRef, queueHistoryRef, queueRngRef, queueScriptRef, seedsRef, reseed } =
    useCascadeQueue();

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
    sync: { markStarted: syncMarkStarted, getGameId },
    mergeCountRef,
    judgeEnd,
    startSession: startInstrumentedSession,
    endSession: endInstrumentedSession,
    rec,
  } = useCascadeSession({
    scoreRef,
    dropCountRef,
    maxTierRef,
    themeIdRef,
    clock,
    engineRef,
    seedsRef,
  });

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
      setDrops((n) => n + 1);
      motion.push(MOTION_KIND.drop, 0, 0, tier, 0, 0);
      motion.publish();
      sounds.drop();
      noteTier(tier); // the piece dropped: the first one starts the play clock (#3700)
      return tier;
    },
    [motion, noteTier, sounds, queueRef, queueHistoryRef, queueRngRef, queueScriptRef]
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
    resumeSession: rec.resume,
    replayState: rec.saveState,
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
      reseed(); // new seeds and a fresh queue (#3858)
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
      piecesRef.current = []; // a switch tapped before the next frame sees a fresh board
      publishBoard(NO_PIECES);
      clearCascadeGame().catch(() => {});
      lastSaveTimeRef.current = 0;
      settlingTicksLeftRef.current = 0;
      chainLinkRef.current = 0;
      motion.clear();
      haptics.reset();
      sounds.reset();
      setGameKey((k) => k + 1);
      startInstrumentedSession(themeId);
    },
    [
      endInstrumentedSession,
      startInstrumentedSession,
      resetScore,
      reseed,
      scoreStore,
      publishBoard,
      celebrationClock,
      motion,
      haptics,
      sounds,
      lastSaveTimeRef,
    ]
  );

  // Reset on fruit-set switch
  useEffect(() => {
    if (prevFruitSetId.current === activeFruitSet.id) return;
    prevFruitSetId.current = activeFruitSet.id;
    startNewGame(activeFruitSet.id);
  }, [activeFruitSet.id, startNewGame]);

  // A piece-set switch waiting on the player's confirm (#3970): the set to switch to, or null.
  const [pendingSetId, setPendingSetId] = useState<string | null>(null);
  // The confirm is a native Modal over the board: report it, so the clock and loop pause under it.
  useReportAppOverlay(pendingSetId !== null);
  const requestFruitSet = useCallback(
    (id: string) => {
      if (id === activeFruitSetRef.current.id) return;
      // A game in progress (a piece on the board, not won or over) is lost by the switch: ask.
      if (piecesRef.current.length > 0 && !gameOverRef.current) setPendingSetId(id);
      else setFruitSetById(id);
    },
    [setFruitSetById]
  );
  const confirmFruitSet = useCallback(() => {
    if (pendingSetId !== null) setFruitSetById(pendingSetId); // the reset effect starts the new game
    setPendingSetId(null);
  }, [pendingSetId, setFruitSetById]);
  const cancelFruitSet = useCallback(() => setPendingSetId(null), []);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainerWidth(Math.floor(width));
    setContainerHeight(Math.floor(height));
  }, []);

  const handleMerge = useCallback(
    (event: { tier: FruitTier; x: number; y: number }) => {
      // Score is tracked by engine; scoreRef.current is kept current by the RAF loop.
      mergeCountRef.current += 1;
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
    [activeFruitSet, t, saveGameThrottled, mergeCountRef]
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

  // `isWin`: the capstone was made (#3920). The engine reports no game over after a win, so the win
  // ends the game here too: the session completes as a `win` (a `loss` at the lid, #3699), the best
  // and the result are recorded, the save is cleared, and the card waits for the celebration. The
  // clock stops first, so the session, the card and its 1 s delay (#3701, `useLossCard`) all read
  // the same time and bonus; a loss dims the pile and flashes the lid.
  const endPlay = useCallback(
    (isWin: boolean) => {
      if (!gameOverRef.current) (isWin ? sounds.win : sounds.gameOver)(); // once a game
      gameOverRef.current = true;
      clock.stop();
      if (!isWin) haptics.reset(); // pulses still queued stop at a loss
      if (!isWin) motion.push(MOTION_KIND.gameOver, 0, 0, 0, 0, 0);
      motion.setDanger(0);
      motion.publish();
    },
    [clock, motion, haptics, sounds]
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
    // The winning merge has no burst, pop or pulse: the celebration replaces them (#3699).
    if (tier === CAPSTONE_TIER) return;
    const link = quiet ? (chainLinkRef.current = 0) + 1 : ++chainLinkRef.current;
    motion.push(MOTION_KIND.merge, x, y, tier, id, link);
    if (!quiet) haptics.merge(tier, link);
    if (!quiet) sounds.merge(tier, link);
    const fruit = activeFruitSet.fruits[tier];
    if (!reduceMotion && fruit) {
      const { scale: s, offsetX, offsetY } = layoutRef.current;
      mergeBursts.add(offsetX + x * s, offsetY + y * s, fruit.color);
    }
  };

  /**
   * A step's events, from the loop or a test fast-forward (`quiet`: no haptics, as while a
   * restored game settles). Motion is pushed here and drawn on the UI thread (#3701).
   */
  handleEventsRef.current = (events, quiet) => {
    rec.events(events); // merges and danger moments, for replays (#3858)
    for (const ev of events) {
      if (ev.type === "merge") {
        onMerge(ev.result as FruitTier, ev.x, ev.y, ev.id, quiet);
      } else if (ev.type === "land") {
        motion.push(MOTION_KIND.land, ev.x, ev.y, ev.tier, ev.id, ev.speed);
        if (!quiet) haptics.land(ev.tier);
        if (!quiet) sounds.land(ev.tier);
      } else if (ev.type === "gameOver" || ev.type === "win") {
        onGameOverRef.current(ev.type === "win"); // the win ends the game too (#3904, #3920)
      } else if (ev.type === "guardRailFired" && __DEV__) {
        console.log(`[Cascade] guard rail: ${ev.reason} body=${ev.bodyId}`);
      }
      // "score" event — score is read from state; no separate handling needed.
    }
    motion.publish();
  };

  onGameOverRef.current = (isWin = false) => handleGameOver(isWin);
  // Lets the (mount-once) e2e test hook reach the latest showResult.
  const showResultRef = useRef(showResult);
  showResultRef.current = showResult;

  // Another screen covering the game (⋯ → Stats, Leaderboard, Scoreboard, #2735) or the app going
  // to the background (#2750) stops the loop below, so the physics and the reported duration count
  // only play. The pause saves the board, so a kill while backgrounded keeps the play so far. Refs,
  // not state: the loop effect reads them every frame and must not be recreated when `navigation`
  // re-renders (not a guaranteed-stable reference), only when `gameKey` changes.
  // `resumeLoopRef`: set by the loop effect to its own "start scheduling frames again"; called on
  // resume, which otherwise cannot reach a `tick`/`rafId` recreated on every gameKey change.
  const resumeLoopRef = useRef<() => void>(() => {});
  const awayRef = usePauseWhileAway(
    navigation,
    () => {
      clock.pause();
      sounds.setAway(true); // no danger ticks over a covered board (#3702)
      saveNow();
    },
    () => {
      clock.resume();
      sounds.setAway(false);
      resumeLoopRef.current();
    }
  );

  // RAF game loop — recreated on gameKey change (restart / theme switch)
  useEffect(() => {
    // The drop nudge's seed is the game's (#3858, recorded); a test seed replaces it (`handleSetSeed`).
    const engine = new CascadeEngine({ seed: seedsRef.current.engine });
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
      sounds.danger(danger, quiet); // the tick itself comes from the board's blink (#3702)

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
  }, [
    gameKey,
    awayRef,
    scoreStore,
    publishBoard,
    motion,
    haptics,
    sounds,
    engineStateRef,
    frameStatsRef,
    seedsRef,
  ]);

  const handleTap = useCallback(
    (x: number | null): boolean => {
      if (x === null || !Number.isFinite(x)) return false; // no usable x (#3922)
      const now = Date.now();
      const interval = now - lastDropTimeRef.current;
      // The lid (#3694): no drop until the last piece has fallen below the lid. Nor while away
      // (#3928 review B2: a backstop for a gesture that ends as another screen covers the board).
      const lidOpen = engineRef.current?.canDrop() ?? false;
      const away = awayRef.current;
      if (gameOver || away || droppingRef.current || settlingTicksLeftRef.current > 0 || !lidOpen) {
        if (__DEV__) {
          console.log(
            `[Cascade] drop BLOCKED — gameOver=${gameOver} away=${away} cooling=${droppingRef.current} settling=${settlingTicksLeftRef.current} lidOpen=${lidOpen} intervalMs=${interval}`
          );
        }
        return false;
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

      // Dropped at a tenth of a pixel, the x the replay records (#3858).
      engineRef.current?.drop(tier, rec.drop(tier, x));

      saveGameThrottled();

      setTimeout(() => {
        droppingRef.current = false;
      }, 200);
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- awayRef: a stable ref
    [consumeFromQueue, gameOver, saveGameThrottled, rec, syncMarkStarted, queueChanged]
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
    recordDrop: rec.drop,
    seedsRef,
    reseeded: rec.reseeded,
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
        <NextFruitPreview current={currentDef} next={nextDef} drops={drops} />
      ) : null,
    [currentDef, nextDef, drops]
  );
  const onDragStart = useCallback(() => haptics.dragStart(), [haptics]);
  // A screen reader's double-tap drops in the middle, as the old centre tap did (#3928 S3).
  const dropMiddle = useCallback(() => void handleTap(WORLD_WIDTH / 2), [handleTap]);
  // No iOS swipe-back over the board: a left drag aims, it must not leave (#3928 B2).
  useEffect(() => {
    navigation.setOptions?.({ gestureEnabled: false });
    return () => navigation.setOptions?.({ gestureEnabled: true });
  }, [navigation]);
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

        <ThemeSelector onRequestSelect={requestFruitSet} />

        <View style={styles.canvasWrapper} onLayout={onLayout}>
          {scale > 0 && (
            <CascadeAimArea
              style={boardAreaStyle}
              motion={motion}
              scale={scale}
              enabled={!gameOver}
              onDrop={handleTap}
              onDragStart={onDragStart}
            >
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
                onAccessibleDrop={dropMiddle}
              />
            </CascadeAimArea>
          )}

          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {mergeBursts.bursts.map((burst) => (
              <MergeBurst key={burst.id} {...burst} onDone={mergeBursts.remove} />
            ))}
          </View>
        </View>

        {areTestHooksEnabled() && (
          <CascadeTestControls
            drops={drops}
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

      <ConfirmModal
        visible={pendingSetId !== null}
        title={t("cascade:theme.switchConfirm.title")}
        body={t("cascade:theme.switchConfirm.body")}
        confirmLabel={t("cascade:theme.switchConfirm.confirm")}
        cancelLabel={t("cascade:theme.switchConfirm.cancel")}
        cancelFirst
        onConfirm={confirmFruitSet}
        onCancel={cancelFruitSet}
        testID="cascade-switch-confirm"
      />

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
