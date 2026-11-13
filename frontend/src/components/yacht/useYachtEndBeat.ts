/**
 * useYachtEndBeat (#3749): the beat between the game's last score and its result card, as 2048's
 * `useTwenty48Beat` (#3689).
 *
 * - The beat: a win holds the card `WIN_BEAT_MS` (1.0 s), a loss or a tie `LOSS_BEAT_MS` /
 *   `TIE_BEAT_MS` (0.6 s). In vs the outcome is the totals'; in solo a new personal best is a
 *   win, anything else a tie (owner).
 * - A celebration first (audit bug 1): when the last score is a Yacht or a Joker, or one is still
 *   showing, `start(outcome, { afterCelebration: true })` holds the card with no timer until the
 *   screen calls `celebrationDone()`; then the beat runs. The card never covers a celebration. A
 *   safety net (`JACKPOT_WAIT_MAX_MS`) starts the beat if the celebration never reports it is done.
 *   A Reduce Motion change restarts the celebration (`useCelebration`), so it re-arms the net.
 * - An outcome not known yet (the solo best still loading): `start` takes a promise and holds the
 *   card until it settles, so the beat (and #3750's sound) always has the right outcome.
 * - Reduce Motion: no beat; the card shows as soon as the game ends (after a celebration, which
 *   is itself still and short under Reduce Motion). Read live: turning it on mid-beat cancels the
 *   timer and shows the card, and turning it off again never replays the beat.
 *
 * `holding` is the gate: the screen shows the card when the game is over `&& !holding`, and calls
 * `start` in the same handler as the `setState` of the game's last score, so both land in one
 * render and the card never flashes before the beat. A game reopened on the computer's last turn
 * never calls `start`, so its card shows at once, with no beat and no end sound.
 *
 * For the end sounds (#3750): `onStart(outcome, beatMs)` is called at the moment the beat starts
 * (after any celebration), once per game, never on a restore; the card shows `beatMs` later (0
 * under Reduce Motion). `outcome` is the last game's outcome until a new game.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { JACKPOT_WAIT_MAX_MS, endBeatMs, type YachtEndOutcome } from "../../game/yacht/motion";
import { useReduceMotion } from "../shared/useReduceMotion";

type Phase = "idle" | "waiting" | "celebration" | "beat";

export interface YachtEndBeatOptions {
  /** The beat starts (the moment #3750's end sound plays): the card shows `beatMs` later. */
  onStart?: (outcome: YachtEndOutcome, beatMs: number) => void;
}

export interface YachtEndBeat {
  /** The card waits: a celebration is still showing, or the beat is running. */
  holding: boolean;
  /** The outcome of the game whose beat has started (or is waiting for a celebration). */
  outcome: YachtEndOutcome | null;
  /** The game's last score has landed: begin the beat (after the celebration, if there is one). */
  start: (
    outcome: YachtEndOutcome | Promise<YachtEndOutcome>,
    options?: { afterCelebration?: boolean }
  ) => void;
  /** The celebration has finished: a beat waiting for it starts now. */
  celebrationDone: () => void;
  /** A new game: no beat, wait or outcome left over. */
  clear: () => void;
}

export function useYachtEndBeat({ onStart }: YachtEndBeatOptions = {}): YachtEndBeat {
  const reduceMotion = useReduceMotion();
  const [phase, setPhase] = useState<Phase>("idle");
  const [outcome, setOutcome] = useState<YachtEndOutcome | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The outcome whose beat waits for a celebration.
  const waiting = useRef<YachtEndOutcome | null>(null);
  // While the outcome is not known yet: whether its beat still waits for a celebration. A
  // celebration done meanwhile clears it, so the beat doesn't wait for one already gone.
  const pendingAfter = useRef(false);
  // Read live: `start` is called from handlers that closed over an older render.
  const reduceMotionRef = useRef(reduceMotion);
  const onStartRef = useRef(onStart);
  useEffect(() => {
    onStartRef.current = onStart;
  }, [onStart]);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const toPhase = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };
  const generation = useRef(0);
  // Unmounting ends any wait for an outcome: its beat never starts (and plays no sound).
  useEffect(() => {
    return () => {
      generation.current += 1;
      clearTimer();
    };
  }, []);

  /** The beat itself, now: the card waits `endBeatMs(kind)`, or nothing under Reduce Motion. */
  const begin = useCallback((kind: YachtEndOutcome) => {
    clearTimer();
    waiting.current = null;
    const ms = reduceMotionRef.current ? 0 : endBeatMs(kind);
    setOutcome(kind);
    if (ms === 0) {
      toPhase("idle");
    } else {
      toPhase("beat");
      timer.current = setTimeout(() => {
        timer.current = null;
        toPhase("idle");
      }, ms);
    }
    onStartRef.current?.(kind, ms);
  }, []);

  /** A celebration that never reports it is done must not hold the card for good. */
  const armNet = useCallback(() => {
    clearTimer();
    timer.current = setTimeout(() => {
      timer.current = null;
      if (waiting.current) begin(waiting.current);
    }, JACKPOT_WAIT_MAX_MS);
  }, [begin]);

  // Each start (and clear) is a new game end: a promise from an older one is ignored.

  /** The outcome is known: the beat now, or a wait for the celebration first. */
  const startKnown = useCallback(
    (kind: YachtEndOutcome, afterCelebration: boolean) => {
      if (!afterCelebration) {
        begin(kind);
        return;
      }
      waiting.current = kind;
      setOutcome(kind);
      toPhase("celebration");
      armNet();
    },
    [begin, armNet]
  );

  const start = useCallback(
    (
      kind: YachtEndOutcome | Promise<YachtEndOutcome>,
      options?: { afterCelebration?: boolean }
    ) => {
      clearTimer();
      const gen = ++generation.current;
      const after = options?.afterCelebration === true;
      if (typeof kind === "string") {
        startKnown(kind, after);
        return;
      }
      // Not known yet: hold the card (no timer) until it is.
      pendingAfter.current = after;
      toPhase("waiting");
      void kind.then((k) => {
        if (gen === generation.current) startKnown(k, pendingAfter.current);
      });
    },
    [startKnown]
  );

  const celebrationDone = useCallback(() => {
    // Done before the outcome is known: its beat starts as soon as it is (Codex, PR #3772).
    if (phaseRef.current === "waiting") pendingAfter.current = false;
    const kind = waiting.current;
    if (kind && phaseRef.current === "celebration") begin(kind);
  }, [begin]);

  const clear = useCallback(() => {
    clearTimer();
    generation.current += 1;
    waiting.current = null;
    setOutcome(null);
    toPhase("idle");
  }, []);

  // Reduce Motion turned on mid-beat (docs/ACCESSIBILITY.md section 3): stop the beat and show the
  // card now. Cleared, not just hidden (below, for the render before this runs), so turning it
  // off again doesn't replay the beat under the card. A wait for a celebration stays, and its
  // safety net is re-armed: a change either way restarts the celebration (`useCelebration`).
  const firstRun = useRef(true);
  useEffect(() => {
    reduceMotionRef.current = reduceMotion;
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (phaseRef.current === "celebration") {
      armNet();
      return;
    }
    if (!reduceMotion || phaseRef.current !== "beat") return;
    clearTimer();
    toPhase("idle");
  }, [reduceMotion, armNet]);

  const holding =
    phase === "waiting" || phase === "celebration" || (phase === "beat" && !reduceMotion);
  return { holding, outcome, start, celebrationDone, clear };
}
