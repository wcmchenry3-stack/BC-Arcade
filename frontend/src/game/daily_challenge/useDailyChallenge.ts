import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { isNetworkError } from "../_shared/httpClient";
import { useNetwork } from "../_shared/NetworkContext";
import { flushQueuedGames } from "../_shared/flushQueuedGames";
import { withRetry } from "../_shared/withRetry";
import { dailyChallengeApi, type DailyChallenge } from "./api";
import { localDayKey, msUntilLocalMidnight, tzOffsetMinutes } from "./localDay";

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

/** A challenge together with the local day (`YYYY-MM-DD`) it was fetched for. */
interface HeldChallenge {
  readonly challenge: DailyChallenge;
  readonly day: string;
}

/**
 * Loads today's challenge and keeps it current: on mount, whenever the app
 * returns to the foreground, when connectivity comes back, and when the
 * enclosing screen regains focus (which is how a just-finished game's
 * checkmark appears on the way back from it).
 *
 * Must be used inside a screen — it subscribes to that screen's `focus` event.
 * A failed refetch, or one that only reaches the free-slate fallback, keeps the
 * last known challenge rather than blanking or downgrading it — but only within
 * the local day it was fetched for (#2924). Once the local day rolls over (checked
 * on foreground, focus and at local midnight) the held challenge is yesterday's:
 * it is never presented as today's, so offline the card drops to its retry state
 * and online it refetches.
 */
export function useDailyChallenge(): DailyChallengeResult {
  const navigation = useNavigation();
  const { isOnline } = useNetwork();
  const [held, setHeld] = useState<HeldChallenge | null>(null);
  // Current local day, re-read on foreground / focus / midnight so a rollover re-renders.
  const [today, setToday] = useState(() => localDayKey());
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
    const requestDay = localDayKey();
    // Push a just-finished game first or the server reports its goal as undone.
    flushQueuedGames()
      .then(() => withRetry(() => dailyChallengeApi.getDailyChallenge(tzOffsetMinutes())))
      .then((next) => {
        if (!mounted.current) return;
        setToday(localDayKey());
        // A degraded free-slate answer (no progress) must not overwrite a challenge we
        // already hold — a hiccup in /status would otherwise reset "2 of 3" to "0 of 3".
        // Only a same-day challenge is worth keeping: yesterday's goals are wrong today.
        setHeld((prev) =>
          next.isFallback && prev && prev.day === requestDay
            ? prev
            : { challenge: next, day: requestDay }
        );
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

  // Re-read the day even when `refresh` cannot run (offline), so a held challenge
  // from yesterday stops reading as ready.
  const syncDay = useCallback(() => {
    setToday(localDayKey());
    refresh();
  }, [refresh]);

  // On mount, and again whenever connectivity returns (`refresh` changes with `isOnline`).
  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") syncDay();
    });
    return () => sub.remove();
  }, [syncDay]);

  useEffect(() => navigation.addListener("focus", syncDay), [navigation, syncDay]);

  // Fires just after local midnight while the app stays open in the foreground.
  useEffect(() => {
    const id = setTimeout(syncDay, msUntilLocalMidnight() + 1000);
    return () => clearTimeout(id);
  }, [today, syncDay]);

  // The day rolled over while a request was in flight (it returned yesterday's), or
  // a held challenge went stale: fetch again. A no-op while offline or in flight;
  // reruns only when `held` or the day changes, so a failing refetch does not loop.
  const stale = held !== null && held.day !== today;
  useEffect(() => {
    if (stale) refresh();
  }, [stale, held, refresh]);

  const challenge = held && held.day === today ? held.challenge : null;

  let phase: DailyChallengePhase;
  if (challenge) phase = "ready";
  else if (failure === "server") phase = "unavailable";
  else if (!isOnline || failure === "network") phase = "offline";
  else phase = "loading";

  return { phase, challenge, refresh };
}
