/**
 * useFlushOnBackground — run a game's recording flush the moment the app
 * leaves the foreground (#3289, epic #3273).
 *
 * The recorder saves at an idle moment, which may never come before the OS
 * kills a backgrounded app; so the screen hands its pending actions to the
 * recorder and saves them, synchronously, on the transition. "inactive" counts
 * too: iOS's app switcher only makes the app inactive, and a swipe-away there
 * kills it without it ever reaching "background" (the same reading as
 * `isAppInterrupted`). The handler is read from a ref, so it may change on
 * every render without re-subscribing.
 */

import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import type { AppStateStatus } from "react-native";

import { isAppInterrupted } from "./appInterrupted";

export function useFlushOnBackground(flush: () => void): void {
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (isAppInterrupted(next)) flushRef.current();
    });
    return () => sub?.remove();
  }, []);
}
