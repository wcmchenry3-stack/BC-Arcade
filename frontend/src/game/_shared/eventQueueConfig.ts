/**
 * Tunable thresholds for the local event log queue (#367).
 *
 * This file is the single source of truth for every cap, interval, and
 * backoff used by eventStore, gameEventClient, and syncWorker. Any magic
 * number that lives elsewhere is a bug — tests grep for hardcoded caps.
 *
 * Note (issue 367): originally specified expo-sqlite, but we chose AsyncStorage
 * (sharded by priority tier) to avoid a native-module rebuild and keep
 * parity with the score queue of the time (removed in #2644). The acceptance
 * criteria target behavior, not storage engine, so the "SQLite LogStore"
 * label is historical.
 */

export type LogType = "game_event" | "bug_log";
export type BugLevel = "warn" | "error" | "fatal";

/**
 * Priority tiers (lower number = evicted last = preserved longest).
 *
 *   P0: bug logs — preserved longest, but still FIFO-evictable at the cap
 *   P1: lifecycle — game_started, game_ended, hand_resolved, etc.
 *   P2: mid-tier — score, bet_placed, hand_dealt, merge
 *   P3: granular — move, drop, roll, player_action (evicted first)
 */
export const Priority = {
  BUG_LOG: 0,
  LIFECYCLE: 1,
  MID: 2,
  GRANULAR: 3,
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

const LIFECYCLE_EVENTS = new Set(["game_started", "game_ended", "hand_resolved"]);
const MID_EVENTS = new Set(["score", "bet_placed", "hand_dealt", "merge"]);

export interface LogConfig {
  /** Hard cap on queued rows. Exceeding triggers priority eviction. */
  MAX_ROWS: number;
  /** Hard cap on queued payload bytes. Exceeding triggers priority eviction. */
  MAX_SIZE_BYTES: number;

  /** Show a capacity warning toast once queue hits this ratio. */
  CAPACITY_WARNING_RATIO: number;
  /** Suppress repeat warnings for this window after dismissal. */
  CAPACITY_WARNING_SUPPRESS_MS: number;

  /** Rows older than this are dropped on the TTL sweep. */
  TTL_MS: number;

  /** How often the SyncWorker flushes while online. */
  SYNC_INTERVAL_MS: number;

  /** Max events per POST /games/:id/events batch. Matches backend cap. */
  GAME_EVENT_BATCH_SIZE: number;
  /** Max bug logs per POST /logs/bug batch. Matches backend cap. */
  BUG_LOG_BATCH_SIZE: number;

  /** Exponential backoff floor and ceiling for 5xx/network retries. */
  BACKOFF_BASE_MS: number;
  BACKOFF_MAX_MS: number;

  /** Rows exceeding this retry count are dead-lettered. */
  MAX_RETRY_COUNT: number;

  /**
   * Fixed retry delay applied when the backend returns 400 unknown_event_type.
   * This is a server-side schema gap (missing event_types row), not a bad
   * client payload — the row should be retried after the migration lands.
   */
  UNKNOWN_EVENT_TYPE_BACKOFF_MS: number;

  /** Per-row payload caps — oversized payloads are truncated on enqueue. */
  MAX_EVENT_PAYLOAD_BYTES: number;
  MAX_BUG_CONTEXT_BYTES: number;

  /** reportBug client-side rate limit: per-source token bucket. */
  REPORT_BUG_MAX_PER_MINUTE_PER_SOURCE: number;
  REPORT_BUG_BURST_ALLOWANCE: number;

  /**
   * Resolve the priority tier for a given log type + optional event name.
   * Kept in config so tests can substitute their own mapping.
   */
  priorityForEvent(logType: LogType, eventType?: string): Priority;
}

export const logConfig: LogConfig = {
  MAX_ROWS: 5000,
  MAX_SIZE_BYTES: 5 * 1024 * 1024, // 5 MB
  CAPACITY_WARNING_RATIO: 0.8,
  CAPACITY_WARNING_SUPPRESS_MS: 24 * 60 * 60 * 1000, // 24 h
  TTL_MS: 7 * 24 * 60 * 60 * 1000, // 7 d
  SYNC_INTERVAL_MS: 30 * 1000, // 30 s
  GAME_EVENT_BATCH_SIZE: 200,
  BUG_LOG_BATCH_SIZE: 50,
  BACKOFF_BASE_MS: 1000,
  BACKOFF_MAX_MS: 30 * 60 * 1000, // 30 min
  MAX_RETRY_COUNT: 10,
  UNKNOWN_EVENT_TYPE_BACKOFF_MS: 24 * 60 * 60 * 1000, // 24 h
  MAX_EVENT_PAYLOAD_BYTES: 8 * 1024, // 8 KB
  MAX_BUG_CONTEXT_BYTES: 16 * 1024, // 16 KB
  REPORT_BUG_MAX_PER_MINUTE_PER_SOURCE: 10,
  REPORT_BUG_BURST_ALLOWANCE: 20,

  priorityForEvent(logType: LogType, eventType?: string): Priority {
    if (logType === "bug_log") return Priority.BUG_LOG;
    if (!eventType) return Priority.MID;
    if (LIFECYCLE_EVENTS.has(eventType)) return Priority.LIFECYCLE;
    if (MID_EVENTS.has(eventType)) return Priority.MID;
    return Priority.GRANULAR;
  },
};

/** For tests — reset the live config to the default values. */
export function resetLogConfig(): void {
  const fresh = {
    MAX_ROWS: 5000,
    MAX_SIZE_BYTES: 5 * 1024 * 1024,
    CAPACITY_WARNING_RATIO: 0.8,
    CAPACITY_WARNING_SUPPRESS_MS: 24 * 60 * 60 * 1000,
    TTL_MS: 7 * 24 * 60 * 60 * 1000,
    SYNC_INTERVAL_MS: 30 * 1000,
    GAME_EVENT_BATCH_SIZE: 200,
    BUG_LOG_BATCH_SIZE: 50,
    BACKOFF_BASE_MS: 1000,
    BACKOFF_MAX_MS: 30 * 60 * 1000,
    MAX_RETRY_COUNT: 10,
    UNKNOWN_EVENT_TYPE_BACKOFF_MS: 24 * 60 * 60 * 1000,
    MAX_EVENT_PAYLOAD_BYTES: 8 * 1024,
    MAX_BUG_CONTEXT_BYTES: 16 * 1024,
    REPORT_BUG_MAX_PER_MINUTE_PER_SOURCE: 10,
    REPORT_BUG_BURST_ALLOWANCE: 20,
  };
  Object.assign(logConfig, fresh);
}
