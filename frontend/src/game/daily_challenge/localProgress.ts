/**
 * Daily Challenge progress worked out on the device, for offline play (#3228).
 *
 * Online, `/status` says which goals are met: the server evaluates each goal
 * against the session's finished game rows for the local day
 * (`backend/daily_challenge/service.py`). Offline, the games finished since the
 * last sync are still in the device's queue (`pendingGamesStore`, uploaded by
 * `SyncWorker`), so this file runs the same per-goal checks against them:
 *
 *  - a goal is met when any one non-abandoned game of its type, finished inside
 *    the local day, meets it (nothing is summed across games);
 *  - a game's measures ("facts") are what the server would store: the result
 *    block, then the creation metadata (non-null keys win, as in
 *    `merge_result_metadata`), then `final_score` and `duration_ms`;
 *  - the predicates mirror `definitions.py` (`completed`, `won`, `solved`,
 *    `chips_gained`, `<measure>_at_least`, `won_<measure>_at_most`). A kind this
 *    build does not know is never met locally.
 *
 * This is a preview only. The server re-checks every completion when the queue
 * uploads, and its `/status` replaces whatever this computed once back online.
 */

import { isPlainRecord, pendingGamesStore, type PendingGame } from "../_shared/pendingGamesStore";
import { resolveDurationMs } from "../_shared/syncWorker";
import { wireTarget, type ChallengeGoal, type DailyChallenge } from "./api";
import { localDayKey } from "./localDay";

type Facts = Readonly<Record<string, unknown>>;

/** A finished, non-abandoned game: its backend game type and its measures. */
export interface EndedGame {
  readonly gameType: string;
  readonly facts: Facts;
}

/** The measures the server would evaluate for this game, or null if it can't count. */
export function factsOf(game: PendingGame): Facts | null {
  if (!game.completed || game.completedAt === null) return null;
  const summary = game.completeSummary ?? {};
  if (summary.outcome === "abandoned") return null;
  const facts: Record<string, unknown> = isPlainRecord(summary.result) ? { ...summary.result } : {};
  for (const [key, value] of Object.entries(game.metadata ?? {})) {
    if (value !== null && value !== undefined) facts[key] = value;
  }
  if (typeof summary.finalScore === "number") facts.final_score = summary.finalScore;
  const durationMs = resolveDurationMs(summary.durationMs);
  if (durationMs !== null) facts.duration_ms = durationMs;
  return facts;
}

function numberIn(facts: Facts, name: string): number | null {
  const value = facts[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** True when the game these `facts` describe meets `goal` (see the header). */
export function goalMetBy(goal: ChallengeGoal, facts: Facts): boolean {
  const { kind } = goal;
  const target = wireTarget(goal);
  if (kind === "completed") return facts.is_complete === true;
  if (kind === "won" || kind === "solved") return facts.won === true;
  if (kind === "chips_gained") {
    const start = numberIn(facts, "starting_chips");
    const end = numberIn(facts, "final_chips");
    return start !== null && end !== null && end > start;
  }
  if (target === null) return false;
  if (kind.startsWith("won_") && kind.endsWith("_at_most")) {
    const value = numberIn(facts, kind.slice("won_".length, -"_at_most".length));
    return facts.won === true && value !== null && value <= target;
  }
  if (kind.endsWith("_at_least")) {
    const value = numberIn(facts, kind.slice(0, -"_at_least".length));
    return value !== null && value >= target;
  }
  return false;
}

/**
 * The queued games finished on local day `day` (`YYYY-MM-DD`), by the device's
 * current UTC offset — the same offset `/status` is asked with, so a game near
 * midnight lands on the same day here as on the server.
 */
export async function queuedGamesEndedOn(day: string, offsetMinutes: number): Promise<EndedGame[]> {
  await pendingGamesStore.init();
  const ended: EndedGame[] = [];
  for (const [, game] of pendingGamesStore.all()) {
    if (game.completedAt === null || localDayKey(offsetMinutes, game.completedAt) !== day) {
      continue;
    }
    const facts = factsOf(game);
    if (facts) ended.push({ gameType: game.gameType, facts });
  }
  return ended;
}

/**
 * `challenge` with every goal a game in `ended` meets marked done. A goal
 * already done stays done: it came from the last `/status` of the day, which
 * counted the games that had already synced.
 */
export function withLocalProgress(
  challenge: DailyChallenge,
  ended: readonly EndedGame[]
): DailyChallenge {
  return {
    ...challenge,
    goals: challenge.goals.map((goal) =>
      goal.completed || !ended.some((g) => g.gameType === goal.gameSlug && goalMetBy(goal, g.facts))
        ? goal
        : { ...goal, completed: true }
    ),
  };
}
