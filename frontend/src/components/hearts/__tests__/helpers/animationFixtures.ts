// The three Hearts event overlays (broken, moon shot, Queen of Spades) share one
// shape: they follow the OS reduce-motion setting through useReduceMotion,
// then run a timed sequence and call `onAnimationEnd` when it is over. These
// helpers drive that under fake timers.
/// <reference types="jest" />
import { AccessibilityInfo } from "react-native";
import { act } from "@testing-library/react-native";

/** Makes the OS report reduce-motion as `enabled`. Restore with `jest.restoreAllMocks()`. */
export function mockReduceMotion(enabled: boolean): jest.SpyInstance {
  return jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(enabled);
}

/** Lets the reduce-motion promise settle and its state update commit. */
export async function flushReduceMotion(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/**
 * The Jest mock of Reanimated lands a `withTiming` at once and drops its end callback. This
 * makes a timing with a callback report its end (`finished: true`) after its `duration` on the
 * fake clock instead, as the UI thread would: Hearts' trick sweep completes from that callback
 * (#3574). Restore with `jest.restoreAllMocks()`.
 */
export function timeReanimatedEnds(): jest.SpyInstance {
  const reanimated = jest.requireMock<Record<string, unknown>>("react-native-reanimated");
  return jest.spyOn(reanimated, "withTiming" as never).mockImplementation(((
    value: unknown,
    config?: { duration?: number },
    callback?: (finished: boolean) => void
  ) => {
    if (callback) setTimeout(() => callback(true), config?.duration ?? 300);
    return value;
  }) as never);
}

/** Moves the fake clock forward by `ms`, committing what the timers change. */
export async function advanceBy(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}
