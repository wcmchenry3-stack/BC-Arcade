import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { useReducedMotion as useLaunchReducedMotion } from "react-native-reanimated";

type Subscriber = (enabled: boolean) => void;

// One OS listener shared by every mounted consumer. While it is registered,
// `lastKnown` tracks the current setting, so a component that mounts later
// (a celebration shown at the moment of a win) starts from it rather than
// from the launch-time value. With no consumers the listener is removed and
// `lastKnown` is dropped, since nothing keeps it current any more.
const subscribers = new Set<Subscriber>();
let lastKnown: boolean | null = null;
let osSubscription: { remove: () => void } | null = null;

function publish(enabled: boolean) {
  lastKnown = enabled;
  subscribers.forEach((notify) => notify(enabled));
}

function subscribe(notify: Subscriber): () => void {
  subscribers.add(notify);
  osSubscription ??= AccessibilityInfo.addEventListener("reduceMotionChanged", publish) ?? null;
  return () => {
    subscribers.delete(notify);
    if (subscribers.size > 0) return;
    osSubscription?.remove();
    osSubscription = null;
    lastKnown = null;
  };
}

/** Test-only: forget the shared listener and the cached setting. */
export function resetReduceMotionForTests(): void {
  subscribers.clear();
  osSubscription = null;
  lastKnown = null;
}

export interface ReduceMotionStatus {
  readonly enabled: boolean;
  /**
   * Whether `enabled` is known to be current: true when another consumer was
   * already tracking the setting, or once this one's query has answered.
   * Until then `enabled` is the launch-time value, which may be stale.
   */
  readonly known: boolean;
}

/**
 * `useReduceMotion` plus whether the value is confirmed current. For an
 * animation that starts the moment it mounts and must not start on a stale
 * value — render nothing until `known`.
 */
export function useReduceMotionStatus(): ReduceMotionStatus {
  const atLaunch = useLaunchReducedMotion();
  const [status, setStatus] = useState<ReduceMotionStatus>(() =>
    lastKnown === null ? { enabled: atLaunch, known: false } : { enabled: lastKnown, known: true }
  );

  useEffect(() => {
    let alive = true;
    const unsubscribe = subscribe((enabled) => setStatus({ enabled, known: true }));
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (alive) publish(value);
      })
      .catch(() => {
        // No answer: carry on with what we have rather than wait forever.
        if (alive) setStatus((s) => (s.known ? s : { ...s, known: true }));
      });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return status;
}

/**
 * The OS "Reduce Motion" setting, kept live.
 *
 * Starts from the last value any mounted consumer saw, else from Reanimated's
 * synchronous launch-time value, so the first frame never animates before the
 * setting is known. It then reads the current setting and subscribes to
 * changes, which lets a player toggle Reduce Motion mid-session
 * (docs/ACCESSIBILITY.md §3).
 *
 * Use this rather than Reanimated's `useReducedMotion()` or a one-off
 * `AccessibilityInfo` read, so every animation agrees on one source.
 */
export function useReduceMotion(): boolean {
  return useReduceMotionStatus().enabled;
}
