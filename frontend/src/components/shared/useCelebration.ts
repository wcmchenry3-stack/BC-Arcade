import { useEffect, useRef } from "react";
import {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type WithSpringConfig,
} from "react-native-reanimated";
import { useReduceMotion } from "./useReduceMotion";

/** What a celebration does when the OS "Reduce Motion" setting is on. */
export type CelebrationReducedMotion =
  /** Show the finished frame (badge and particles in place), then finish. */
  | { mode: "static"; doneAfterMs: number }
  /** Show nothing and finish at once. */
  | { mode: "skip" };

export interface CelebrationConfig {
  visible: boolean;
  /** Number of particles. Read once on mount; it must not change. */
  particleCount: number;
  /** Called when the celebration has finished. */
  onDone: () => void;
  badgeSpring: WithSpringConfig;
  particleSpring: WithSpringConfig;
  /** Delay between successive particles springing in. */
  particleStaggerMs: number;
  /** When the badge and particles start fading out. */
  exitAtMs: number;
  /** When `onDone` fires. */
  doneAtMs: number;
  badgeFadeOutMs: number;
  particleFadeOutMs: number;
  reducedMotion: CelebrationReducedMotion;
}

const BADGE_FADE_IN_MS = 300;

/**
 * The shared skeleton of a win / bonus celebration (#2606): a badge that
 * springs in, a ring of particles that spring in one after another, a fade
 * out, then `onDone`. Owns the shared values, the timers and their cleanup,
 * and the Reduce Motion rule from docs/ACCESSIBILITY.md §3 via the shared,
 * live `useReduceMotion` (the same source AnimationOverlay uses).
 *
 * Returns the animated styles; the caller lays out its own badge and glyphs.
 */
export function useCelebration(config: CelebrationConfig) {
  const { visible, reducedMotion: policy } = config;
  const reduceMotion = useReduceMotion();

  // Latest config for the timers, updated after commit (never during render).
  // Declared before the main effect, so it runs first.
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  });

  const countRef = useRef(config.particleCount);
  if (__DEV__ && config.particleCount !== countRef.current) {
    console.warn(
      `useCelebration: particleCount changed from ${countRef.current} to ${config.particleCount}; it is fixed at mount.`
    );
  }
  const badgeScale = useSharedValue(0);
  const badgeOpacity = useSharedValue(0);
  const particles = Array.from({ length: countRef.current }, () =>
    // Fixed count for the component's lifetime, so hook order is stable.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useSharedValue(0)
  );

  useEffect(() => {
    const c = configRef.current;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const all = [badgeScale, badgeOpacity, ...particles];

    const reset = () => {
      all.forEach((v) => {
        cancelAnimation(v);
        v.value = 0;
      });
    };

    if (!visible) {
      reset();
      return;
    }

    if (reduceMotion) {
      if (c.reducedMotion.mode === "skip") {
        c.onDone();
        return;
      }
      all.forEach((v) => {
        v.value = 1;
      });
      timers.push(setTimeout(() => configRef.current.onDone(), c.reducedMotion.doneAfterMs));
      return () => timers.forEach(clearTimeout);
    }

    badgeScale.value = withSpring(1, c.badgeSpring);
    badgeOpacity.value = withTiming(1, { duration: BADGE_FADE_IN_MS });
    particles.forEach((p, i) => {
      p.value = withDelay(i * c.particleStaggerMs, withSpring(1, c.particleSpring));
    });

    timers.push(
      setTimeout(() => {
        badgeOpacity.value = withTiming(0, { duration: c.badgeFadeOutMs });
        particles.forEach((p) => {
          p.value = withTiming(0, { duration: c.particleFadeOutMs });
        });
      }, c.exitAtMs),
      setTimeout(() => configRef.current.onDone(), c.doneAtMs)
    );

    return () => {
      timers.forEach(clearTimeout);
      all.forEach((v) => cancelAnimation(v));
    };
    // The shared values are stable; only visibility and the setting restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reduceMotion]);

  const badgeStyle = useAnimatedStyle(() => ({
    transform: [{ scale: badgeScale.value }],
    opacity: badgeOpacity.value,
  }));

  const particleStyles = particles.map((p) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useAnimatedStyle(() => ({ opacity: p.value, transform: [{ scale: p.value }] }))
  );

  return {
    /** True when Reduce Motion is on and the policy is to show nothing. */
    hidden: reduceMotion && policy.mode === "skip",
    badgeStyle,
    particleStyles,
  };
}
