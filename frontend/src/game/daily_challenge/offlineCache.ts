import AsyncStorage from "@react-native-async-storage/async-storage";
import { offlineWindowExhausted } from "../_shared/lastConnected";
import type { DailyChallenge } from "./api";
import { queuedGamesEndedOn, type EndedGame } from "./localProgress";

/**
 * The Daily Challenge goals kept on the device for offline play (#3228, #3043).
 *
 * While online the hook saves two things, each under its own key so neither
 * write can clobber the other:
 *  - `UPCOMING_KEY`: `/upcoming`, the FREE goals for today and the next 2 local
 *    days, saved at most once per local day.
 *  - `STATUS_KEY`: the last `/status` answer of the day (this session's slate,
 *    free or premium, with the goals already met). A premium player's goals for
 *    today come from here; days 2 and 3 fall back to the free `/upcoming` goals,
 *    which the server re-checks on sync anyway.
 *
 * Days are keyed by their `challengeId` (the local date, `YYYY-MM-DD`). A day's
 * goals are frozen on the server, so a date has the same goals in every time
 * zone and travelling only changes which date "today" is. Local only; cleared
 * by Delete My Data.
 */

export const UPCOMING_KEY = "daily_challenge_upcoming_v1";
export const STATUS_KEY = "daily_challenge_status_v1";

interface StoredUpcoming {
  /** The local day `/upcoming` was read on. */
  readonly fetchedOn: string;
  readonly days: readonly DailyChallenge[];
}

interface StoredStatus {
  readonly day: string;
  readonly challenge: DailyChallenge;
}

async function read<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

async function write(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Best effort: the next online refresh writes it again.
  }
}

function isChallenge(value: unknown): value is DailyChallenge {
  const c = value as DailyChallenge | null;
  return typeof c?.challengeId === "string" && Array.isArray(c.goals);
}

/** The local day `/upcoming` was last saved on, or null. */
export async function upcomingFetchedOn(): Promise<string | null> {
  const stored = await read<StoredUpcoming>(UPCOMING_KEY);
  return typeof stored?.fetchedOn === "string" ? stored.fetchedOn : null;
}

export function saveUpcoming(fetchedOn: string, days: readonly DailyChallenge[]): Promise<void> {
  return write(UPCOMING_KEY, { fetchedOn, days } satisfies StoredUpcoming);
}

/** Save a `/status` answer for `day`. Never a `/today` fallback: it has no progress. */
export function saveStatus(day: string, challenge: DailyChallenge): Promise<void> {
  return write(STATUS_KEY, { day, challenge } satisfies StoredStatus);
}

/** Forget both (Delete My Data; tests). */
export async function clearDailyChallengeCache(): Promise<void> {
  await Promise.all([AsyncStorage.removeItem(UPCOMING_KEY), AsyncStorage.removeItem(STATUS_KEY)]);
}

/** What the hook needs to show `day` offline. */
export interface OfflineDay {
  readonly day: string;
  /** The cached goals for `day` (cached `/status` first, else `/upcoming`), or null. */
  readonly base: DailyChallenge | null;
  /** The queued games finished on `day`, for `withLocalProgress`. */
  readonly ended: readonly EndedGame[];
  /**
   * Show the shared "connect to get the latest puzzle" message: the 3-day
   * window is exhausted, or goals were cached but none cover `day`. False when
   * nothing was ever cached (a fresh install keeps the plain offline card).
   */
  readonly windowExhausted: boolean;
}

/** Read the cache and the queue for local day `day` at the device's `offsetMinutes`. */
export async function loadOfflineDay(
  day: string,
  offsetMinutes: number,
  now: number = Date.now()
): Promise<OfflineDay> {
  const [exhausted, status, upcoming] = await Promise.all([
    offlineWindowExhausted(now),
    read<StoredStatus>(STATUS_KEY),
    read<StoredUpcoming>(UPCOMING_KEY),
  ]);
  if (exhausted) return { day, base: null, ended: [], windowExhausted: true };

  const days = Array.isArray(upcoming?.days) ? upcoming.days.filter(isChallenge) : [];
  const cachedStatus =
    status?.day === day && isChallenge(status.challenge) ? status.challenge : null;
  // No catch-up (#3043): only the entry for `day` itself is ever used.
  const base = cachedStatus ?? days.find((c) => c.challengeId === day) ?? null;
  if (!base) {
    const hadCache = days.length > 0 || isChallenge(status?.challenge);
    return { day, base: null, ended: [], windowExhausted: hadCache };
  }
  return { day, base, ended: await queuedGamesEndedOn(day, offsetMinutes), windowExhausted: false };
}
