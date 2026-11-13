import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Whether a screen reader (VoiceOver, TalkBack) is on, kept live. False until the OS answers.
 * Sort skips its win cascade for it (#3660): the card, and its announcement, come at once.
 */
export function useScreenReaderEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.resolve(AccessibilityInfo.isScreenReaderEnabled())
      .then((value) => {
        if (alive && typeof value === "boolean") setEnabled(value);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("screenReaderChanged", (value) => {
      if (alive) setEnabled(value);
    });
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);
  return enabled;
}
