/**
 * Test-only seams for the logstore (#479 — foundation for #373 acceptance
 * gate). When `EXPO_PUBLIC_TEST_HOOKS === "1"` is set at build time, this
 * module installs a handful of functions on `globalThis` that Playwright
 * specs can drive via `page.evaluate`. Otherwise it's a no-op.
 *
 * The seams never leak into production builds because the export step in
 * `registerLogstoreTestHooks` short-circuits on the env check; dead-code
 * elimination in the Metro bundler removes the rest.
 *
 * Hook naming convention: `__<subsystem>_<verb>`. Keeps the CascadeScreen
 * pattern consistent so Playwright's `waitForFunction` is easy to write.
 *
 * Available hooks (all return Promise unless noted):
 *
 *   __gameEventClient_getQueueStats()            → QueueStats
 *   __gameEventClient_clearAll()                 → void
 *   __gameEventClient_enqueueEvent(gameId, ev)   → void
 *   __gameEventClient_reportBug(lvl, src, m, c)  → void  (sync fire-and-forget)
 *   __gameEventClient_seedEvents(spec)           → void  (bulk insert)
 *   __gameEventClient_seedBugLogs(spec)          → void  (bulk insert)
 *   __gameEventClient_startGame(gameType, meta)  → string (game id)
 *   __gameEventClient_completeGame(id, summary)  → void
 *
 *   __syncWorker_flush()                         → FlushResult
 *   __syncWorker_getBackoffUntil()               → number (epoch ms, sync)
 *
 *   __logConfig_override(partial)                → void (sync)
 *   __logConfig_reset()                          → void (sync)
 *
 *   __logstoreHooks_ready                        → true (sync sentinel)
 */

import { eventStore, GameEventRow, BugLogRow, QueueStats } from "./eventStore";
import { logConfig, resetLogConfig, LogConfig, Priority } from "./eventQueueConfig";
import { gameEventClient } from "./gameEventClient";
import { syncWorker, FlushResult } from "./syncWorker";
import { generateUUID } from "./uuid";
import { areTestHooksEnabled } from "./envFlags";

interface SeedEventSpec {
  /** Number of rows to seed. */
  count: number;
  /** Explicit priority tier (P0–P3). Overrides eventType-based inference. */
  priority?: Priority;
  /** Event type string (e.g. "move", "game_started"). Used for priority if
   *  `priority` is omitted. Defaults to "move" (P3). */
  eventType?: string;
  /** Game id. Defaults to "__seed". All seeded events share one game id
   *  unless overridden per call. */
  gameId?: string;
  /** Fixed creation timestamp (epoch ms). If omitted, uses `Date.now()`. */
  createdAt?: number;
  /** Starting `event_index`. Defaults to 0. */
  startIndex?: number;
}

interface SeedBugLogSpec {
  count: number;
  level?: "warn" | "error" | "fatal";
  source?: string;
  createdAt?: number;
  message?: string;
}

interface LogstoreTestHooks {
  __gameEventClient_getQueueStats: () => Promise<QueueStats>;
  __gameEventClient_clearAll: () => Promise<void>;
  __gameEventClient_enqueueEvent: (
    gameId: string,
    event: { type: string; data?: Record<string, unknown> }
  ) => void;
  __gameEventClient_reportBug: (
    level: "warn" | "error" | "fatal",
    source: string,
    message: string,
    context?: Record<string, unknown>
  ) => void;
  __gameEventClient_seedEvents: (spec: SeedEventSpec) => Promise<void>;
  __gameEventClient_seedBugLogs: (spec: SeedBugLogSpec) => Promise<void>;
  __gameEventClient_startGame: (gameType: string, metadata?: Record<string, unknown>) => string;
  __gameEventClient_completeGame: (
    gameId: string,
    summary: { finalScore?: number | null; outcome?: string | null; durationMs?: number | null }
  ) => void;
  __eventStore_sweepTTL: (now?: number) => Promise<number>;
  __eventStore_setSyntheticDelay: (ms: number) => void;
  __syncWorker_flush: () => Promise<FlushResult>;
  __syncWorker_getBackoffUntil: () => number;
  __logConfig_override: (partial: Partial<LogConfig>) => void;
  __logConfig_reset: () => void;
  __logstoreHooks_ready: true;
}

// When no explicit createdAt is provided, anchor the seeded batch so the
// newest row equals Date.now() and older rows recede into the past by
// their per-row offset. Seeded rows must never be "in the future"
// relative to wall-clock time, otherwise real enqueues that happen right
// after the seed will look older than the fixture and get evicted first
// by the #486 age-based pool policy. Explicit createdAt (from fixtures
// like seedEvictionFixture) is honored as-is.
function seedBaseTime(createdAt: number | undefined, count: number): number {
  if (createdAt !== undefined) return createdAt;
  return Date.now() - Math.max(0, count - 1);
}

function buildSeedGameEvents(spec: SeedEventSpec): GameEventRow[] {
  const {
    count,
    priority,
    eventType = "move",
    gameId = "__seed",
    createdAt,
    startIndex = 0,
  } = spec;
  const baseTime = seedBaseTime(createdAt, count);
  const pri =
    priority !== undefined ? priority : logConfig.priorityForEvent("game_event", eventType);
  const rows: GameEventRow[] = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({
      id: generateUUID(),
      log_type: "game_event",
      game_id: gameId,
      event_index: startIndex + i,
      event_type: eventType,
      payload: { _seed: true, i },
      // Per-row offset keeps within-batch ordering stable and distinct.
      created_at: baseTime + i,
      priority: pri,
      retry_count: 0,
      next_retry_at: null,
    });
  }
  return rows;
}

function buildSeedBugLogs(spec: SeedBugLogSpec): BugLogRow[] {
  const { count, level = "warn", source = "__seed", createdAt, message = "seeded bug log" } = spec;
  const baseTime = seedBaseTime(createdAt, count);
  const rows: BugLogRow[] = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({
      id: generateUUID(),
      log_type: "bug_log",
      bug_uuid: generateUUID(),
      bug_level: level,
      bug_source: source,
      payload: { message, i },
      created_at: baseTime + i,
      priority: Priority.BUG_LOG,
      retry_count: 0,
      next_retry_at: null,
    });
  }
  return rows;
}

export { areTestHooksEnabled };

/**
 * Install logstore test hooks on `globalThis`. Idempotent.
 * Returns a cleanup function that removes every hook.
 */
export function registerLogstoreTestHooks(): () => void {
  if (!areTestHooksEnabled()) {
    return () => {};
  }

  const g = globalThis as unknown as Partial<LogstoreTestHooks> & Record<string, unknown>;

  g.__gameEventClient_getQueueStats = () => eventStore.stats();
  g.__gameEventClient_clearAll = () => gameEventClient.clearAll();
  g.__gameEventClient_enqueueEvent = (gameId, event) => gameEventClient.enqueueEvent(gameId, event);
  g.__gameEventClient_reportBug = (level, source, message, context) =>
    gameEventClient.reportBug(level, source, message, context);
  g.__gameEventClient_seedEvents = async (spec) => {
    await eventStore.seedRows(buildSeedGameEvents(spec));
  };
  g.__gameEventClient_seedBugLogs = async (spec) => {
    await eventStore.seedRows(buildSeedBugLogs(spec));
  };
  g.__gameEventClient_startGame = (gameType, metadata) =>
    gameEventClient.startGame(gameType, metadata);
  g.__gameEventClient_completeGame = (gameId, summary) =>
    gameEventClient.completeGame(gameId, summary);
  g.__eventStore_sweepTTL = (now?: number) => eventStore.sweepTTL(now);
  g.__eventStore_setSyntheticDelay = (ms: number) => eventStore.setSyntheticDelay(ms);

  g.__syncWorker_flush = () => syncWorker.flush();
  g.__syncWorker_getBackoffUntil = () => syncWorker.getBackoffUntil();

  g.__logConfig_override = (partial) => {
    Object.assign(logConfig, partial);
  };
  g.__logConfig_reset = () => {
    resetLogConfig();
  };

  g.__logstoreHooks_ready = true;

  return () => {
    delete g.__gameEventClient_getQueueStats;
    delete g.__gameEventClient_clearAll;
    delete g.__gameEventClient_enqueueEvent;
    delete g.__gameEventClient_reportBug;
    delete g.__gameEventClient_seedEvents;
    delete g.__gameEventClient_seedBugLogs;
    delete g.__gameEventClient_startGame;
    delete g.__gameEventClient_completeGame;
    delete g.__eventStore_sweepTTL;
    delete g.__eventStore_setSyntheticDelay;
    // Reset the synthetic delay so it doesn't leak across pages.
    eventStore.setSyntheticDelay(0);
    delete g.__syncWorker_flush;
    delete g.__syncWorker_getBackoffUntil;
    delete g.__logConfig_override;
    delete g.__logConfig_reset;
    delete g.__logstoreHooks_ready;
  };
}
