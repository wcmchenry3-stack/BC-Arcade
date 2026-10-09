/** One step of a timed animation sequence: `run` fires `at` ms after the start. */
export interface TimedPhase {
  readonly at: number;
  readonly run: () => void;
}

export interface PhaseTimeline {
  /** Steps after the start, in the order they were declared. */
  readonly phases: readonly TimedPhase[];
  /** When the sequence is over and `onEnd` fires. */
  readonly endAt: number;
}

/**
 * Plays a timed sequence: each phase's `run` at its `at`, then `onEnd` at
 * `endAt`. Returns a cancel function — return it (or call it) from the effect
 * cleanup that started the sequence, so `onEnd` never fires for a sequence cut
 * short by the overlay hiding, the reduce-motion setting changing, or unmount.
 *
 * A plain function rather than a hook on purpose: the overlays start their
 * sequence from the same effect that starts the animations, so the shared
 * values are only ever written from effects and timers (which is what the
 * React Compiler lint and Reanimated both expect).
 */
export function playTimedPhases(timeline: PhaseTimeline, onEnd: () => void): () => void {
  const timers = timeline.phases.map((phase) => setTimeout(phase.run, phase.at));
  timers.push(setTimeout(onEnd, timeline.endAt));
  return () => timers.forEach(clearTimeout);
}
