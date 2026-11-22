/**
 * Cascade's test and demo seams (moved out of `CascadeScreen.tsx` in #3701 to keep the screen
 * under 800 lines; the behaviour is unchanged): the `__cascade_*` hooks of E2E builds
 * (`registerCascadeTestHooks`, #3693) and the demo set-ups the test controls run (#3719).
 *
 * Every hook goes through the screen's own refs and callbacks, so it runs the path the screen does.
 * Replays (#3858): `dropAt` and `spawnTierAt` drop through the screen's recording (`recordDrop`,
 * the same tenth-of-a-pixel x), and `setSeed` replaces the game's seeds, so `game_started` names
 * the real ones (`reseeded`: before the first drop the game restarts with them; after it the next
 * unit is marked as not re-simulable). The demo set-ups restore a pile, which the recording does
 * not see: a game played from one is not re-simulable either.
 */
import { useCallback, useEffect, type MutableRefObject } from "react";
import type { CascadeEngine, EngineEvent, GameState } from "./engine";
import { DANGER_STACK_MARGIN, OVERFLOW_LINE_Y } from "./constants";
import { DROUGHT_WINDOW } from "./spawnSelector";
import { createSeededRng, makeQueue, type PieceQueue } from "./pieceQueue";
import type { CascadeSeeds } from "./replay";
import { cascadeSetup, registerCascadeTestHooks, type CascadeSetupId } from "./testHooks";
import type { FrameState } from "./render/frame";

/** The fixed step the fast-forward hook advances by. */
const FAST_FORWARD_STEP_MS = 16.67;

export interface CascadeTestSeamDeps {
  readonly engineRef: MutableRefObject<CascadeEngine | null>;
  readonly queueRef: MutableRefObject<PieceQueue>;
  readonly queueHistoryRef: MutableRefObject<number[]>;
  readonly queueRngRef: MutableRefObject<(() => number) | undefined>;
  readonly queueScriptRef: MutableRefObject<number[]>;
  readonly scoreRef: MutableRefObject<number>;
  readonly gameOverRef: MutableRefObject<boolean>;
  readonly settlingTicksLeftRef: MutableRefObject<number>;
  readonly droppingRef: MutableRefObject<boolean>;
  readonly resumeLoopRef: MutableRefObject<() => void>;
  /** Handles a step's events as the loop does (`quiet`: no haptics). */
  readonly handleEventsRef: MutableRefObject<
    (events: readonly EngineEvent[], quiet: boolean) => void
  >;
  readonly queueChanged: () => void;
  readonly publishBoard: (board: FrameState) => void;
  readonly setScore: (score: number) => void;
  readonly noteTier: (tier: number) => void;
  readonly consumeFromQueue: (isInDanger: boolean) => number;
  /** Ends the game now, without the engine (the `triggerGameOver` hook and its button). */
  readonly forceGameOver: () => void;
  /** The screen's recorded drop (#3858): logs it and returns the x to drop at. */
  readonly recordDrop: (tier: number, x: number) => number;
  /** The game's seeds (#3858), replaced by `setSeed`. */
  readonly seedsRef: MutableRefObject<CascadeSeeds>;
  /** Called after `setSeed` replaced the seeds (#3858). */
  readonly reseeded: () => void;
}

/** True when a piece is close to the lid: the queue then favours small pieces. */
export function isInDanger(state: GameState | undefined): boolean {
  return (state?.pieces ?? []).some((p) => p.y < OVERFLOW_LINE_Y + DANGER_STACK_MARGIN);
}

export function useCascadeTestSeams(d: CascadeTestSeamDeps) {
  const {
    engineRef,
    queueRef,
    queueHistoryRef,
    queueRngRef,
    queueScriptRef,
    scoreRef,
    gameOverRef,
    handleEventsRef,
    queueChanged,
    publishBoard,
    setScore,
    seedsRef,
    reseeded,
  } = d;

  const handleSetSeed = useCallback(
    (seed: number) => {
      const rng = createSeededRng(seed);
      queueRngRef.current = rng;
      engineRef.current?.seed(seed);
      const seeded = makeQueue(rng);
      queueRef.current = seeded.queue;
      queueHistoryRef.current = seeded.history;
      // The game's recorded seeds are these now (#3858): one value seeds both, as above.
      seedsRef.current = { queue: seed, engine: seed };
      reseeded();
      queueChanged();
    },
    [queueChanged, engineRef, queueRef, queueHistoryRef, queueRngRef, seedsRef, reseeded]
  );

  /** Steps the physics by `ms` without waiting for frames (the `fastForward` hook). */
  const fastForward = useCallback(
    (ms: number) => {
      const engine = engineRef.current;
      if (!engine) return;
      let remaining = ms;
      while (remaining > 0) {
        const result = engine.step(Math.min(remaining, FAST_FORWARD_STEP_MS));
        scoreRef.current = engine.getState().score;
        handleEventsRef.current(result.events, true);
        remaining -= FAST_FORWARD_STEP_MS;
      }
      const state = engine.getState();
      setScore(state.score);
      publishBoard(state);
    },
    [setScore, publishBoard, engineRef, scoreRef, handleEventsRef]
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
    [queueChanged, queueRef, queueScriptRef, queueHistoryRef]
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
      for (const p of setup.pieces) d.noteTier(p.tier);
      d.resumeLoopRef.current(); // after a win the loop had stopped: the restore starts play again
      d.settlingTicksLeftRef.current = 0;
      d.droppingRef.current = false;
      if (setup.queue) seedQueue(setup.queue);
      fastForward(setup.settleMs);
      publishBoard(engine.getState());
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fastForward, seedQueue, publishBoard]
  );

  // The __cascade_* hooks (EXPO_PUBLIC_TEST_HOOKS=1 builds only, #3693). Mounted once: every hook
  // reads the screen's refs.
  useEffect(() => {
    return registerCascadeTestHooks({
      getState: () => {
        const state = engineRef.current?.getState();
        return {
          score: scoreRef.current,
          gameOver: gameOverRef.current,
          won: engineRef.current?.hasWon() === true,
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
        const tier = d.consumeFromQueue(isInDanger(engineRef.current?.getState()));
        queueChanged();
        engineRef.current?.drop(tier, d.recordDrop(tier, x));
      },
      fastForward,
      triggerGameOver: d.forceGameOver,
      isReady: () => engineRef.current !== null,
      spawnTierAt: (tier: number, x: number) => {
        if (gameOverRef.current) return;
        d.noteTier(tier);
        engineRef.current?.drop(tier, d.recordDrop(tier, x));
      },
      seedQueue,
      setupChain: () => applySetup("chain"),
      setupNearLid: () => applySetup("nearLid"),
      fillBin: () => applySetup("fillBin"),
      setupWin: () => applySetup("win"),
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { applySetup };
}
