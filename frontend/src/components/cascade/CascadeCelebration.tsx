/**
 * #3699: the clock of Cascade's win celebration. Renders nothing: the celebration is drawn by the
 * board on the UI thread (`CascadeBoard`, `render/drawCelebration.ts`) from `clock`, ms of the
 * celebration's timeline (`celebration.ts`; the card at 2.1 s, 1.6 s under Reduce Motion).
 * `GameResultModal` mounts it as its `celebration` at the win and shows the card on `onDone`, so
 * the card never covers the animation (#2201).
 *
 * The clock is stepped on the UI thread, one frame at a time (`useFrameCallback`,
 * `stepCelebrationClock`), each frame moving it at most `MAX_FRAME_STEP_MS`. It was a wall-clock
 * `withTiming`: on the iOS simulator the first celebration frame stalled the UI thread (the first
 * draw of its new textures and shaders), the timing ran on through the stall, and the first frame
 * shown was already past the rise (iOS demos on #3924). Stepped, a stall only delays it. It is a
 * logical clock, not motion, so the OS Reduce Motion setting never shortens it (the calm visuals
 * come from `reduceMotion` through `celebrationPose`).
 *
 * - **Start.** Only once the board can draw the celebration (`ready`, from `useCelebrationStyle`),
 *   at the time since the win but never past the capstone's grow-in (`celebrationStartMs`). Until
 *   then the clock stays at -1.
 * - **End.** The frame that reaches the card's time calls `onDone` (on the JS thread) and stops.
 *   A JS timer, the card's time on the wall clock plus `FALLBACK_SLACK_MS`, calls it if frames
 *   never get there; `GameResultModal`'s 4 s safety net is the last resort.
 * - **Reduce Motion switched mid-way** moves the end; past it, the next frame ends the celebration.
 */
import { useCallback, useEffect, useRef } from "react";
import {
  runOnJS,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import {
  celebrationCardMs,
  celebrationRemainingMs,
  celebrationStartMs,
  stepCelebrationClock,
} from "../../game/cascade/celebration";

/** How long past the card's (wall-clock) time the JS fallback waits for the frames. */
export const FALLBACK_SLACK_MS = 1000;

export interface CascadeCelebrationProps {
  /** Ms of the celebration's timeline, read by the board (a Reanimated shared value; -1: none). */
  readonly clock: SharedValue<number>;
  readonly reduceMotion: boolean;
  /** The board can draw the celebration: the clock starts now (never before). */
  readonly ready: boolean;
  /** The celebration is over: show the card. */
  readonly onDone: () => void;
}

export default function CascadeCelebration({
  clock,
  reduceMotion,
  ready,
  onDone,
}: CascadeCelebrationProps) {
  // The modal hands a new `done` each render; only the latest is called, once.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);
  const doneRef = useRef(false);
  const mountedAtRef = useRef(0);
  const startedRef = useRef<{ wallMs: number; t: number } | null>(null);
  const endMs = useSharedValue(celebrationCardMs(reduceMotion));
  const ended = useSharedValue(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDoneRef.current();
  }, []);

  const frame = useFrameCallback((info) => {
    "worklet";
    const end = endMs.get();
    const next = stepCelebrationClock(clock.get(), info.timeSincePreviousFrame, end);
    clock.set(next);
    if (next >= end && !ended.get()) {
      ended.set(true);
      runOnJS(finish)();
    }
  }, false);

  // The win: the modal mounts this then.
  useEffect(() => {
    mountedAtRef.current = Date.now();
  }, []);

  useEffect(() => {
    endMs.set(celebrationCardMs(reduceMotion));
  }, [endMs, reduceMotion]);

  useEffect(() => {
    if (!ready) return;
    const now = Date.now();
    if (startedRef.current === null) {
      const t = celebrationStartMs(now - mountedAtRef.current);
      startedRef.current = { wallMs: now, t };
      clock.set(t);
      frame.setActive(true);
    }
    const { wallMs, t } = startedRef.current;
    const elapsed = t + (now - wallMs);
    const timer = setTimeout(
      finish,
      celebrationRemainingMs(elapsed, reduceMotion) + FALLBACK_SLACK_MS
    );
    return () => clearTimeout(timer);
  }, [ready, reduceMotion, clock, frame, finish]);

  // Stop stepping once the card is due (the modal unmounts this then) or on unmount.
  useEffect(() => () => frame.setActive(false), [frame]);

  return null;
}
