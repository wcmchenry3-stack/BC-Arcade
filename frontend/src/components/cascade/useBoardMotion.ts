/**
 * #3701: the board's motion state, shared with the UI thread.
 *
 * The JS loop pushes the engine's moments (`push`) and publishes them once per frame (`publish`):
 * one small copy of the ring buffer (`motionLog.ts`), only when something was pushed. A UI-thread
 * frame callback stamps each new moment with the motion clock, advances that clock (at most
 * `MOTION.maxFrameStepMs` a frame, so a stalled frame only delays the motion) and the danger
 * blink's phase, and switches itself off when nothing plays: no frame callback runs on an idle
 * board. The board's Picture closes over these shared values, so it re-records on each step.
 *
 * Nothing here touches the physics step. Reduce Motion comes in as a prop (the screen reads it
 * once, through the shared `useReduceMotion`); it only shortens lifetimes here, the calm drawing is
 * `drawMotion.ts`.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  runOnJS,
  useFrameCallback,
  useSharedValue,
  type FrameCallback,
  type FrameInfo,
  type SharedValue,
} from "react-native-reanimated";
import {
  DANGER_IDLE_PHASE,
  MOTION,
  dangerBlinkOn,
  stepDangerPhase,
} from "../../game/cascade/motion";
import {
  clearMotion,
  createMotionLog,
  emptyStamps,
  lastSeq,
  MOTION_SLOTS,
  MOTION_STRIDE,
  motionLive,
  pushMotion,
  stampSlots,
  type MotionKind,
  type MotionLog,
} from "../../game/cascade/motionLog";

/** The shared values the board draws from. */
export interface BoardMotionValues {
  readonly events: SharedValue<Float64Array>;
  readonly stamps: SharedValue<Float64Array>;
  readonly clock: SharedValue<number>;
  readonly dangerPhase: SharedValue<number>;
  /** The lid count (0..1) while play goes on; 0 once the game is over. */
  readonly danger: SharedValue<number>;
}

export interface BoardMotion {
  readonly values: BoardMotionValues;
  push(kind: MotionKind, x: number, y: number, tier: number, id: number, aux: number): void;
  /** Hands this frame's pushes to the UI thread (call once, after the step's events). */
  publish(): void;
  /** The lid count after this step (0 at game over): the danger blink runs while it is > 0. */
  setDanger(ratio: number): void;
  /** A new game: forget every moment. */
  clear(): void;
}

/** The screen's motion log, made on first use (never read during a render). */
function logOf(ref: { current: MotionLog | null }): MotionLog {
  return (ref.current ??= createMotionLog());
}

export function useBoardMotion(reduceMotion: boolean): BoardMotion {
  const logRef = useRef<MotionLog | null>(null);
  // An empty ring: what an unwritten log publishes.
  const events = useSharedValue<Float64Array>(new Float64Array(MOTION_SLOTS * MOTION_STRIDE));
  const stamps = useSharedValue<Float64Array>(emptyStamps());
  const clock = useSharedValue(0);
  const dangerPhase = useSharedValue<number>(DANGER_IDLE_PHASE);
  const danger = useSharedValue(0);
  const calm = useSharedValue(reduceMotion);
  const activeRef = useRef(false);
  const dangerRef = useRef(0);
  const reduceRef = useRef(reduceMotion);
  // The last sequence number handed to the UI thread (0 for an empty ring, e.g. after `clear`).
  const publishedSeqRef = useRef(0);

  useEffect(() => {
    reduceRef.current = reduceMotion;
    calm.set(reduceMotion);
  }, [calm, reduceMotion]);

  // The UI thread found nothing playing: stop, unless a newer ring was published since (the UI
  // thread has not seen it yet) or danger runs. Compared with what was published, not with the
  // log's own counter: a cleared ring publishes 0 while the log keeps counting (#3701 review B1).
  const frameRef = useRef<FrameCallback | null>(null);
  const onIdle = useCallback((seenSeq: number) => {
    if (seenSeq !== publishedSeqRef.current) return;
    if (dangerRef.current > 0 && !reduceRef.current) return;
    activeRef.current = false;
    frameRef.current?.setActive(false);
  }, []);

  const step = useCallback(
    (info: FrameInfo) => {
      "worklet";
      const dt = Math.min(MOTION.maxFrameStepMs, Math.max(0, info.timeSincePreviousFrame ?? 0));
      const now = clock.get() + dt;
      const ev = events.get();
      const fresh = stampSlots(ev, stamps.get(), now);
      if (fresh) stamps.set(fresh);
      const ratio = danger.get();
      const reduce = calm.get();
      const phase = reduce ? DANGER_IDLE_PHASE : stepDangerPhase(dangerPhase.get(), dt, ratio);
      dangerPhase.set(phase);
      clock.set(now);
      // The danger blink keeps the clock running while the count runs and while an on-beat it
      // latched finishes.
      const blinking = !reduce && (ratio > 0 || dangerBlinkOn(phase));
      if (!motionLive(ev, fresh ?? stamps.get(), now, reduce) && !blinking) {
        runOnJS(onIdle)(lastSeq(ev));
      }
    },
    [calm, clock, danger, dangerPhase, events, onIdle, stamps]
  );
  const frame = useFrameCallback(step, false);
  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);

  const wake = useCallback(() => {
    if (activeRef.current) return;
    activeRef.current = true;
    frame.setActive(true);
  }, [frame]);

  useEffect(
    () => () => {
      activeRef.current = false;
      frame.setActive(false);
    },
    [frame]
  );

  const push = useCallback(
    (kind: MotionKind, x: number, y: number, tier: number, id: number, aux: number) =>
      pushMotion(logOf(logRef), kind, x, y, tier, id, aux),
    []
  );
  const publish = useCallback(() => {
    const l = logOf(logRef);
    if (!l.dirty) return;
    l.dirty = false;
    const buf = l.buf.slice();
    publishedSeqRef.current = lastSeq(buf);
    events.set(buf);
    wake();
  }, [events, wake]);
  const setDanger = useCallback(
    (ratio: number) => {
      const r = ratio > 0 ? ratio : 0;
      if (r === dangerRef.current) return;
      dangerRef.current = r;
      danger.set(r);
      if (r > 0) wake();
    },
    [danger, wake]
  );
  const clear = useCallback(() => {
    clearMotion(logOf(logRef));
    dangerRef.current = 0;
    danger.set(0);
    dangerPhase.set(DANGER_IDLE_PHASE);
    publish();
  }, [danger, dangerPhase, publish]);

  const values = useMemo(
    () => ({ events, stamps, clock, dangerPhase, danger }),
    [events, stamps, clock, dangerPhase, danger]
  );
  return useMemo(
    () => ({ values, push, publish, setDanger, clear }),
    [values, push, publish, setDanger, clear]
  );
}
