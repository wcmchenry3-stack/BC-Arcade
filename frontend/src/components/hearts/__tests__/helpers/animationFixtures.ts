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

/** Moves the fake clock forward by `ms`, committing what the timers change. */
export async function advanceBy(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}
