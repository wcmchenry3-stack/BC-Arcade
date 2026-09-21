import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { isNetworkError } from "../_shared/httpClient";
import { useNetwork } from "../_shared/NetworkContext";
import { flushQueuedGames } from "../_shared/flushQueuedGames";
import { withRetry } from "../_shared/withRetry";
import { dailyChallengeApi, type DailyChallenge } from "./api";

/**
 * - `loading`: first fetch in flight, nothing to show yet.
 * - `ready`: have a challenge (possibly stale while a refetch runs or offline).
 * - `offline`: no challenge and the network is the reason.
 * - `unavailable`: no challenge and the server is the reason — not the player's to fix.
 */
export type DailyChallengePhase = "loading" | "ready" | "offline" | "unavailable";

export interface DailyChallengeResult {
  readonly phase: DailyChallengePhase;
  readonly challenge: DailyChallenge | null;
  readonly refresh: () => void;
}

function tzOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

/**
 * Loads today's challenge and keeps it current: on mount, whenever the app
 * returns to the foreground, when connectivity comes back, and when the
 * enclosing screen regains focus (which is how a just-finished game's
 * checkmark appears on the way back from it).
 *
 * Must be used inside a screen — it subscribes to that screen's `focus` event.
 * A failed refetch keeps the last known challenge rather than blanking it.
 */
export function useDailyChallenge(): DailyChallengeResult {
  const navigation = useNavigation();
  const { isOnline } = useNetwork();
  const [challenge, setChallenge] = useState<DailyChallenge | null>(null);
  const [failure, setFailure] = useState<"network" | "server" | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Skipped while known offline — a doomed request would only add Sentry
  // "network failure" noise (#2430); reconnecting re-runs it via `isOnline`.
  const refresh = useCallback(() => {
    if (!isOnline || inFlight.current) return;
    inFlight.current = true;
    // Push a just-finished game first or the server reports its goal as undone.
    flushQueuedGames()
      .then(() => withRetry(() => dailyChallengeApi.getDailyChallenge(tzOffsetMinutes())))
      .then((next) => {
        if (!mounted.current) return;
        setChallenge(next);
        setFailure(null);
      })
      .catch((e: unknown) => {
        // httpClient already reports what is worth reporting.
        if (mounted.current) setFailure(isNetworkError(e) ? "network" : "server");
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, [isOnline]);

  // On mount, and again whenever connectivity returns (`refresh` changes with `isOnline`).
  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  useEffect(() => navigation.addListener("focus", refresh), [navigation, refresh]);

  let phase: DailyChallengePhase;
  if (challenge) phase = "ready";
  else if (failure === "server") phase = "unavailable";
  else if (!isOnline || failure === "network") phase = "offline";
  else phase = "loading";

  return { phase, challenge, refresh };
}
