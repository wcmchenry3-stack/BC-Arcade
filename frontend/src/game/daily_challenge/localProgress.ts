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
 *  - the premium games (Blackjack, Hearts, Star Swarm, Cascade) send no `won` /
 *    `is_complete`: the server writes them into the result block from the completion's
 *    `outcome` (`backend/games/result_flags.py`, #3996), so `SERVER_FLAGGED` applies the
 *    same rule here, before the metadata merge (#4032). Free games keep their own;
 *  - the predicates mirror `definitions.py` (`completed`, `won`, `solved`,
 *    `chips_gained`, `<measure>_at_least`, `won_<measure>_at_most`). A kind this
 *    build does not know is never met locally;
 *  - Bottle Sort's relative `new_levels_at_least` (#4028) counts levels above the
 *    highest solved before the day started, as `definitions.facts_for` does: the
 *    baseline is the day-start best Sort records on the day's first solve
 *    (`game/sort/dayStart.ts`). With no baseline for the day it is never met here.
 *    Builds from before #4028 read the kind as `new_levels` "at least", a fact no
 *    game sends, so they never mark it done either.
 *
 * This is a preview only. The server re-checks every completion when the queue
 * uploads, and its `/status` replaces whatever this computed once back online.
 */

import { isPlainRecord, pendingGamesStore, type PendingGame } from "../_shared/pendingGamesStore";
import { resolveDurationMs } from "../_shared/syncWorker";
import { wireTarget, type ChallengeGoal, type DailyChallenge } from "./api";
import { localDayKey } from "./localDay";
import { readSortDayStart } from "../sort/dayStart";

type Facts = Readonly<Record<string, unknown>>;

/** A finished, non-abandoned game: its backend game type and its measures. */
export interface EndedGame {
  readonly gameType: string;
  readonly facts: Facts;
}

/**
 * How the server derives `won` / `is_complete` from the completion's `outcome`, per
 * backend game type. Keep in step with `backend/games/result_flags.py` and each
 * game's result model (`hearts`, `starswarm`, `blackjack`, `cascade` `models.py`).
 * The app's own copy of either flag is always dropped for these games.
 *  - `hasWin: false` (Star Swarm): only `is_complete`, never `won`.
 *  - `legacyChipsWin` (Blackjack): outcome `completed` with `final_chips` > 0 is a win.
 *  - `alwaysWon` (Cascade): `won` is written even with no outcome (then false);
 *    `is_complete` still needs an outcome.
 */
interface FlagRule {
  readonly hasWin?: boolean;
  readonly legacyChipsWin?: boolean;
  readonly alwaysWon?: boolean;
}
const SERVER_FLAGGED: Readonly<Record<string, FlagRule>> = {
  blackjack: { legacyChipsWin: true },
  hearts: {},
  starswarm: { hasWin: false },
  cascade: { alwaysWon: true },
};

/** `block` with the app's flags replaced by the ones the server writes for `gameType`. */
export function withServerFlags(
  gameType: string,
  block: Record<string, unknown>,
  outcome: unknown
): Record<string, unknown> {
  if (!Object.prototype.hasOwnProperty.call(SERVER_FLAGGED, gameType)) return block;
  const rule = SERVER_FLAGGED[gameType]!;
  const out = { ...block };
  delete out.won;
  delete out.is_complete;
  const has = typeof outcome === "string";
  if (has) out.is_complete = outcome !== "abandoned";
  if (rule.hasWin !== false && (has || rule.alwaysWon)) out.won = outcome === "win";
  if (rule.legacyChipsWin && outcome === "completed") {
    const chips = out.final_chips;
    if (typeof chips === "number" && chips > 0) out.won = true;
  }
  return out;
}

/** The measures the server would evaluate for this game, or null if it can't count. */
export function factsOf(game: PendingGame): Facts | null {
  if (!game.completed || game.completedAt === null) return null;
  const summary = game.completeSummary ?? {};
  if (summary.outcome === "abandoned") return null;
  const facts = withServerFlags(
    game.gameType,
    isPlainRecord(summary.result) ? { ...summary.result } : {},
    summary.outcome
  );
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

/** The relative kind (#4028), mirroring `definitions.NEW_LEVELS_KIND`. */
export const NEW_LEVELS_KIND = "new_levels_at_least";
const NEW_LEVELS_MEASURE = "new_levels";
/** Per game with a relative goal, the measure the baseline is the best of (`DAY_START_MEASURES`). */
const DAY_START_MEASURES: Readonly<Record<string, string>> = { sort: "final_score" };

/** `{ gameSlug: the best measure before the local day started }`, for relative goals. */
export type DayStart = Readonly<Record<string, number>>;

function dayStartMeasure(goal: ChallengeGoal): string | null {
  if (goal.kind !== NEW_LEVELS_KIND) return null;
  return Object.prototype.hasOwnProperty.call(DAY_START_MEASURES, goal.gameSlug)
    ? DAY_START_MEASURES[goal.gameSlug]!
    : null;
}

/**
 * The facts `goal` is checked against, as `definitions.facts_for`: unchanged for every
 * goal but a relative one, which gets `new_levels` = the game's measure minus the
 * day-start best. Null (never met) without a baseline or a measure.
 */
export function factsFor(goal: ChallengeGoal, facts: Facts, dayStart?: DayStart): Facts | null {
  const measure = dayStartMeasure(goal);
  if (measure === null) return facts;
  const baseline = dayStart?.[goal.gameSlug];
  const value = numberIn(facts, measure);
  if (typeof baseline !== "number" || value === null) return null;
  return { ...facts, [NEW_LEVELS_MEASURE]: value - baseline };
}

/** True when the game these `facts` describe meets `goal` (see the header). */
export function goalMetBy(goal: ChallengeGoal, gameFacts: Facts, dayStart?: DayStart): boolean {
  const facts = factsFor(goal, gameFacts, dayStart);
  if (facts === null) return false;
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
 * The day-start bests known on this device for local day `day`: Sort's, when its
 * stored standing was taken at the start of that day (`game/sort/dayStart.ts`). Any
 * other day's standing says nothing about `day`, so it is left out. Never rejects.
 */
export async function dayStartOn(day: string): Promise<DayStart> {
  const sort = await readSortDayStart().catch(() => null);
  return sort?.day === day ? { sort: sort.best } : {};
}

/**
 * `challenge` with every goal a game in `ended` meets marked done, the bonus goal
 * (#3995) included, the same way. A goal already done stays done: it came from the
 * last `/status` of the day, which counted the games that had already synced.
 */
export function withLocalProgress(
  challenge: DailyChallenge,
  ended: readonly EndedGame[],
  dayStart?: DayStart
): DailyChallenge {
  const mark = (goal: ChallengeGoal): ChallengeGoal =>
    goal.completed ||
    !ended.some((g) => g.gameType === goal.gameSlug && goalMetBy(goal, g.facts, dayStart))
      ? goal
      : { ...goal, completed: true };
  return {
    ...challenge,
    goals: challenge.goals.map(mark),
    ...(challenge.bonus ? { bonus: mark(challenge.bonus) } : {}),
  };
}
