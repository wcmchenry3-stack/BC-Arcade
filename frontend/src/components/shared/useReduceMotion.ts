import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { useReducedMotion as useLaunchReducedMotion } from "react-native-reanimated";

/**
 * The OS "Reduce Motion" setting, kept live.
 *
 * Starts from Reanimated's synchronous value so the first frame never animates
 * before the setting is known. That value is fixed at app launch, so the hook
 * then reads the current setting and subscribes to changes, which lets a
 * player toggle Reduce Motion mid-session (docs/ACCESSIBILITY.md §3).
 *
 * Use this rather than Reanimated's `useReducedMotion()` or a one-off
 * `AccessibilityInfo` read, so every animation agrees on one source.
 */
export function useReduceMotion(): boolean {
  const atLaunch = useLaunchReducedMotion();
  const [enabled, setEnabled] = useState(atLaunch);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (alive) setEnabled(value);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      setEnabled(value);
    });
    return () => {
      alive = false;
      subscription?.remove();
    };
  }, []);

  return enabled;
}
