import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import type { AppStateStatus } from "react-native";
import { isAppOverlayOpen, subscribeAppOverlay } from "./appOverlay";

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
export function isAwayStatus(status: AppStateStatus | null | undefined): boolean {
  return status === "background" || status === "inactive";
}

/**
 * One event that takes the player away, as `onLeave` reports it: a blur, an
 * app overlay opening over the game (`appOverlay`, #2944), or a change of
 * `AppState` to an away status (`isAwayStatus`). `previous` is the status of
 * the change event before this one: `null` for the first, since the status at
 * mount isn't a change.
 */
export type LeaveEvent =
  | { readonly reason: "blur" }
  | { readonly reason: "overlay" }
  | {
      readonly reason: "appState";
      readonly status: "background" | "inactive";
      readonly previous: AppStateStatus | null;
    };

export interface PauseWhileAwayOptions {
  /**
   * Called on every leave event, whether or not the player was already away,
   * after `onPause` (if this event started the absence). Never at mount. For
   * work a screen does on each departure rather than once per absence: Star
   * Swarm pauses a run the player resumed while the app stayed inactive, and
   * Sort and Hearts save on the app's move to the background.
   */
  onLeave?: (event: LeaveEvent) => void;
}

/**
 * Pauses a game's play clock while the player is away from it, for any of
 * three independent reasons:
 *
 * - another screen (Stats, Leaderboard, Scoreboard) is pushed over this one
 *   and blurs it without unmounting it (#2735);
 * - the app leaves the foreground: `AppState` is `background`, or `inactive`
 *   on iOS (#2750);
 * - an app overlay is open over the game: the header's ⋯ menu, the feedback
 *   sheet or the New Game confirmation (`appOverlay`, #2944). A native
 *   `Modal` neither blurs the screen nor changes `AppState`.
 *
 * `onPause` runs when the first reason starts, including at mount when the
 * app is already in the background or the screen already covered; `onResume`
 * runs once all have ended. So returning to the foreground while another
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
  onResume: () => void,
  options: PauseWhileAwayOptions = {}
): { readonly current: boolean } {
  const { onLeave } = options;
  const handlersRef = useRef({ onPause, onResume, onLeave });
  handlersRef.current = { onPause, onResume, onLeave };

  const blurredRef = useRef(false);
  const backgroundedRef = useRef(false);
  const overlaidRef = useRef(false);
  const awayRef = useRef(false);

  const update = useCallback(() => {
    const away = blurredRef.current || backgroundedRef.current || overlaidRef.current;
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
    let previous: AppStateStatus | null = null;
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      const last = previous;
      previous = next;
      backgroundedRef.current = isAwayStatus(next);
      update();
      if (next === "background" || next === "inactive") {
        handlersRef.current.onLeave?.({ reason: "appState", status: next, previous: last });
      }
    });
    return () => sub?.remove();
  }, [update]);

  // An app overlay (#2944) counts as away: the clock stops while the player
  // is in the ⋯ menu or the feedback sheet, and `onLeave` lets a real-time
  // game (Star Swarm) pause its run so it doesn't go on unseen.
  useEffect(() => {
    overlaidRef.current = isAppOverlayOpen();
    update();
    return subscribeAppOverlay(() => {
      const open = isAppOverlayOpen();
      if (open === overlaidRef.current) return;
      overlaidRef.current = open;
      update();
      if (open) handlersRef.current.onLeave?.({ reason: "overlay" });
    });
  }, [update]);

  useEffect(() => {
    if (navigation.isFocused) {
      blurredRef.current = !navigation.isFocused();
      update();
    }
    const offBlur = navigation.addListener("blur", () => {
      blurredRef.current = true;
      update();
      handlersRef.current.onLeave?.({ reason: "blur" });
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
