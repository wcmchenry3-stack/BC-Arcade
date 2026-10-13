import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { isNetworkError } from "../_shared/httpClient";
import { useNetwork } from "../_shared/NetworkContext";
import { flushQueuedGames } from "../_shared/flushQueuedGames";
import { withRetry } from "../_shared/withRetry";
import { dailyChallengeApi, type DailyChallenge } from "./api";
import { localDayKey, msUntilLocalMidnight, tzOffsetMinutes } from "./localDay";
import { withLocalProgress } from "./localProgress";
import {
  loadOfflineDay,
  saveStatus,
  saveUpcoming,
  upcomingFetchedOn,
  type OfflineDay,
} from "./offlineCache";

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
  /**
   * Offline with no goals for today because the goals fetched ahead ran out
   * (#3228): the card shows the shared "connect to get the latest puzzle"
   * message instead of its plain offline one. Only ever true with `offline`.
   */
  readonly windowExhausted: boolean;
  readonly refresh: () => void;
}

const MAX_TICK_MS = 60_000;

/** A challenge together with the local day (`YYYY-MM-DD`) it was fetched for. */
interface HeldChallenge {
  readonly challenge: DailyChallenge;
  readonly day: string;
}

/**
 * Save `/upcoming` for offline play (#3228), at most once per local day. Best
 * effort and silent: the card never shows these goals online, so a failure
 * here only means an older cache stays.
 */
function cacheUpcoming(day: string): void {
  upcomingFetchedOn()
    .then(async (fetchedOn) => {
      if (fetchedOn === day) return;
      const days = await dailyChallengeApi.getUpcoming(tzOffsetMinutes());
      // A read that spanned local midnight is for the wrong "today": skip it.
      if (localDayKey() === day && days.some((c) => c.challengeId === day)) {
        await saveUpcoming(day, days);
      }
    })
    .catch(() => undefined);
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
 *
 * Offline play (#3228): every online answer is also saved on the device
 * (`offlineCache.ts`): today's `/status`, and `/upcoming`'s goals for today and
 * the next 2 days. Offline (or after a network failure), the card shows the
 * cached goals for the device's local day, with the games still queued on the
 * device that day counted locally (`localProgress.ts`). Those games upload
 * through `SyncWorker` as usual; once a `/status` answers again it replaces the
 * local progress. Past the cached days it reports `windowExhausted`. Online,
 * nothing here changes what is shown.
 */
export function useDailyChallenge(): DailyChallengeResult {
  const navigation = useNavigation();
  const { isOnline } = useNetwork();
  const [held, setHeld] = useState<HeldChallenge | null>(null);
  // Current local day, re-read on foreground / focus / midnight so a rollover re-renders.
  const [today, setToday] = useState(() => localDayKey());
  const [retryTick, setRetryTick] = useState(0);
  const [timerTick, setTimerTick] = useState(0);
  const [failure, setFailure] = useState<"network" | "server" | null>(null);
  // The cached goals and queued games for a local day, read while offline.
  const [offlineDay, setOfflineDay] = useState<OfflineDay | null>(null);
  const [offlineTick, setOfflineTick] = useState(0);
  // Set while offline; cleared only once the server answers again, so on
  // reconnecting the local progress stays up until `/status` replaces it.
  const [localView, setLocalView] = useState(false);
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
        // The request spanned local midnight, so which day the server answered for is
        // unknown (the flush and retries can outlast it). Don't stamp a guess; the
        // `finally` below goes again.
        if (localDayKey() !== requestDay) return;
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
        setLocalView(false);
        if (!next.isFallback) void saveStatus(requestDay, next);
        cacheUpcoming(requestDay);
      })
      .catch((e: unknown) => {
        // httpClient already reports what is worth reporting.
        if (!mounted.current) return;
        const network = isNetworkError(e);
        setFailure(network ? "network" : "server");
        if (!network) setLocalView(false);
      })
      .finally(() => {
        inFlight.current = false;
        if (mounted.current && localDayKey() !== requestDay) {
          setToday(localDayKey());
          setRetryTick((n) => n + 1);
        }
      });
  }, [isOnline]);

  // Re-read the day even when `refresh` cannot run (offline), so a held challenge
  // from yesterday stops reading as ready.
  const syncDay = useCallback(() => {
    setToday(localDayKey());
    setOfflineTick((n) => n + 1); // re-read the queue: a game may have just ended
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

  // A request that spanned midnight was discarded: run it again now `inFlight` is clear.
  useEffect(() => {
    if (retryTick > 0) refresh();
  }, [retryTick, refresh]);

  // Fires just after local midnight while the app stays open in the foreground. The
  // delay is capped and re-armed after every firing, so a UTC-offset change (DST,
  // travel) or clock adjustment can delay noticing midnight by at most a minute.
  useEffect(() => {
    const id = setTimeout(
      () => {
        syncDay();
        setTimerTick((n) => n + 1); // re-arm even if the day did not change (clock/offset drift)
      },
      Math.min(msUntilLocalMidnight() + 1000, MAX_TICK_MS)
    );
    return () => clearTimeout(id);
  }, [today, timerTick, syncDay]);

  const offline = !isOnline || failure === "network";
  const useLocal = offline || localView;

  // Adjusted during render (not in an effect), so the flag is set in the same pass.
  if (offline && !localView) setLocalView(true);

  // Offline only: read the cached goals and the day's queued games. Re-read on
  // every day change, focus and foreground (`offlineTick`).
  useEffect(() => {
    if (!useLocal) return;
    const day = today;
    loadOfflineDay(day, tzOffsetMinutes())
      .then((loaded) => {
        if (mounted.current) setOfflineDay(loaded);
      })
      .catch(() => undefined);
  }, [useLocal, today, offlineTick]);

  const heldToday = held && held.day === today ? held.challenge : null;
  const offlineToday = useLocal && offlineDay?.day === today ? offlineDay : null;
  let challenge = heldToday;
  if (offlineToday) {
    // Today's own `/status` beats the cache; either way the queued games count.
    const base = heldToday ?? offlineToday.base;
    challenge = base ? withLocalProgress(base, offlineToday.ended) : null;
  }

  let phase: DailyChallengePhase;
  if (challenge) phase = "ready";
  // Known-offline wins over an older server failure: once a held challenge expires
  // the player needs the retryable offline card, not a card that vanishes.
  else if (!isOnline || failure === "network") phase = "offline";
  else if (failure === "server") phase = "unavailable";
  else phase = "loading";

  const windowExhausted = phase === "offline" && offlineToday?.windowExhausted === true;

  return { phase, challenge, windowExhausted, refresh };
}
