/// <reference types="jest" />
import { AccessibilityInfo } from "react-native";
import { resetReduceMotionForTests } from "../components/shared/useReduceMotion";

type Listener = (enabled: boolean) => void;

/**
 * Captures the `reduceMotionChanged` listeners `useReduceMotion` registers and
 * returns a function that fires them, so a test can flip the OS Reduce Motion
 * setting mid-session. Call it before rendering. Every mounted subscriber hears
 * the change; a removed one does not. Also drops the hook's shared listener
 * and cached value, so the next consumer registers against this capture.
 */
export function captureReduceMotionChange(): (enabled: boolean) => void {
  resetReduceMotionForTests();
  const listeners = new Set<Listener>();
  // The handler's type depends on the event name; only this one's matters here.
  const spy = jest.spyOn(AccessibilityInfo, "addEventListener") as unknown as jest.Mock;
  spy.mockImplementation((event: string, handler: Listener) => {
    if (event === "reduceMotionChanged") listeners.add(handler);
    return { remove: () => listeners.delete(handler) };
  });
  return (enabled) => listeners.forEach((listener) => listener(enabled));
}
