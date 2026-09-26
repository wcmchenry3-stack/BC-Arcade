import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import type { AppStateStatus } from "react-native";

/** The part of a screen's navigation object this hook listens to. */
export interface FocusEventSource {
  addListener(type: "focus" | "blur", callback: () => void): () => void;
  /** Read at mount, so a screen that opens already covered starts paused. */
  isFocused?(): boolean;
}

/**
 * Whether an `AppState` status means the app isn't in the foreground. iOS can
 * report `unknown` (or nothing) before its first transition: that counts as
 * the foreground, so a clock is never held by a state no event will clear.
 */
function isAwayStatus(status: AppStateStatus | null | undefined): boolean {
  return status === "background" || status === "inactive";
}

/**
 * Pauses a game's play clock while the player is away from it, for either of
 * two independent reasons:
 *
 * - another screen (Stats, Leaderboard, Scoreboard) is pushed over this one
 *   and blurs it without unmounting it (#2735);
 * - the app leaves the foreground: `AppState` is `background`, or `inactive`
 *   on iOS (#2750).
 *
 * `onPause` runs when the first reason starts, including at mount when the
 * app is already in the background or the screen already covered; `onResume`
 * runs once both have ended. So returning to the foreground while another
 * screen still covers the game doesn't resume the clock, and neither does
 * closing that screen while the app is still in the background.
 *
 * The returned ref is `true` while the player is away. Screens use it to hold
 * work they schedule themselves (an Auto-Complete step, a queued move) that
 * would otherwise restart a paused clock.
 *
 * The handlers are read from a ref, so they may change on every render
 * without re-subscribing. On web, React Native Web maps `AppState` to the page
 * visibility API, so the same code covers a hidden browser tab.
 *
 * Games that keep their clock in React state use `usePausableClock`, which
 * builds on this hook.
 */
export function usePauseWhileAway(
  navigation: FocusEventSource,
  onPause: () => void,
  onResume: () => void
): { readonly current: boolean } {
  const handlersRef = useRef({ onPause, onResume });
  handlersRef.current = { onPause, onResume };

  const blurredRef = useRef(false);
  const backgroundedRef = useRef(false);
  const awayRef = useRef(false);

  const update = useCallback(() => {
    const away = blurredRef.current || backgroundedRef.current;
    if (away === awayRef.current) return;
    awayRef.current = away;
    if (away) handlersRef.current.onPause();
    else handlersRef.current.onResume();
  }, []);

  useEffect(() => {
    // A screen can mount while the app isn't active (a launch into the
    // background, say): pause from the start, or the later switch to
    // `active` would look like no change.
    backgroundedRef.current = isAwayStatus(AppState.currentState);
    update();
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      backgroundedRef.current = isAwayStatus(next);
      update();
    });
    return () => sub?.remove();
  }, [update]);

  useEffect(() => {
    if (navigation.isFocused) {
      blurredRef.current = !navigation.isFocused();
      update();
    }
    const offBlur = navigation.addListener("blur", () => {
      blurredRef.current = true;
      update();
    });
    const offFocus = navigation.addListener("focus", () => {
      blurredRef.current = false;
      update();
    });
    return () => {
      offBlur?.();
      offFocus?.();
    };
  }, [navigation, update]);

  return awayRef;
}
