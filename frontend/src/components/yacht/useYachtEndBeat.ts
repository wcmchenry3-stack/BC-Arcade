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

type Phase = "idle" | "celebration" | "beat";

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
  start: (outcome: YachtEndOutcome, options?: { afterCelebration?: boolean }) => void;
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
  useEffect(() => clearTimer, []);

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

  const start = useCallback(
    (kind: YachtEndOutcome, options?: { afterCelebration?: boolean }) => {
      clearTimer();
      if (!options?.afterCelebration) {
        begin(kind);
        return;
      }
      waiting.current = kind;
      setOutcome(kind);
      toPhase("celebration");
      // A celebration that never reports it is done must not hold the card for good.
      timer.current = setTimeout(() => {
        timer.current = null;
        if (waiting.current) begin(waiting.current);
      }, JACKPOT_WAIT_MAX_MS);
    },
    [begin]
  );

  const celebrationDone = useCallback(() => {
    const kind = waiting.current;
    if (kind && phaseRef.current === "celebration") begin(kind);
  }, [begin]);

  const clear = useCallback(() => {
    clearTimer();
    waiting.current = null;
    setOutcome(null);
    toPhase("idle");
  }, []);

  // Reduce Motion turned on mid-beat (docs/ACCESSIBILITY.md section 3): stop the beat and show the
  // card now. Cleared, not just hidden (below, for the render before this runs), so turning it
  // off again doesn't replay the beat under the card. A wait for a celebration stays: the
  // celebration goes still and ends itself.
  useEffect(() => {
    reduceMotionRef.current = reduceMotion;
    if (!reduceMotion || phaseRef.current !== "beat") return;
    clearTimer();
    toPhase("idle");
  }, [reduceMotion]);

  const holding = phase === "celebration" || (phase === "beat" && !reduceMotion);
  return { holding, outcome, start, celebrationDone, clear };
}
