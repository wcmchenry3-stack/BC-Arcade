/**
 * useFlushOnBackground — run a game's recording flush the moment the app goes
 * to the background, or the screen loses focus (#3289, epic #3273).
 *
 * The recorder saves at an idle moment, which may never come before the OS
 * kills a backgrounded app; so the screen hands its pending actions to the
 * recorder and saves them, synchronously, on the transition. Only `background`
 * and `blur` flush, not `inactive` (an incoming call or the iOS app switcher
 * would spend a row each time): every flush that cuts a chunk short is a row,
 * and a game's rows are bounded (`MAX_RECORDED_ROWS`). The handler is read from
 * a ref, so it may change on every render without re-subscribing.
 */

import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import type { AppStateStatus } from "react-native";

/** The part of a screen's navigation object this hook listens to. */
export interface BlurSource {
  addListener(type: "blur", callback: () => void): () => void;
}

export function useFlushOnBackground(flush: () => void, navigation?: BlurSource): void {
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "background") flushRef.current();
    });
    const unsubscribe = navigation?.addListener("blur", () => flushRef.current());
    return () => {
      sub?.remove();
      unsubscribe?.();
    };
  }, [navigation]);
}
