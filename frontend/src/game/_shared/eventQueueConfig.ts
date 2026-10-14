/**
 * Tunable thresholds for the local event log queue (#367).
 *
 * This file is the single source of truth for every cap, interval, and
 * backoff used by eventStore, gameEventClient, syncWorker and gameRecorder
 * (the per-game recording caps, at the end of the file). Keep any new
 * cap, interval or backoff here rather than as a literal elsewhere.
 *
 * Note (issue 367): originally specified expo-sqlite, but we chose AsyncStorage
 * (sharded by priority tier) to avoid a native-module rebuild and keep
 * parity with the score queue of the time (removed in #2644). The acceptance
 * criteria target behavior, not storage engine, so the "SQLite LogStore"
 * label is historical.
 */

import type { GameType } from "../../api/vocab";

export type LogType = "game_event" | "bug_log";
export type BugLevel = "warn" | "error" | "fatal";

/**
 * Priority tiers used by the sync/batching path.
 *
 * Capacity eviction does NOT walk these tiers in numeric order. eventStore
 * protects P1 lifecycle rows first, then FIFO-evicts by age across the
 * combined P0/P2/P3 pool; P1 is used only after that pool is empty.
 *
 *   P0: bug logs
 *   P1: lifecycle — game_started, game_ended, hand_resolved, etc.
 *   P2: mid-tier — score, bet_placed, hand_dealt, merge
 *   P3: granular — move, drop, roll, player_action
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
  /** Hard cap on queued rows. Exceeding triggers eventStore capacity eviction. */
  MAX_ROWS: number;
  /** Hard cap on queued payload bytes. Exceeding triggers eventStore capacity eviction. */
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

// ---------------------------------------------------------------------------
// Gameplay recording caps (#3274, epic #3273)
// ---------------------------------------------------------------------------
//
// The caps `GameRecorder` (gameRecorder.ts) applies before it saves anything:
// one per event type and one per session, per game. A recorded event never
// reaches eventStore's `{_truncated: true}` stub: the recorder chunks it (when
// its type is chunkable) or drops and reports it first, and every per-event
// cap is held under `logConfig.MAX_EVENT_PAYLOAD_BYTES` (`recordingEventCap`).
// Every size here is a JSON length (UTF-16 code units),
// `JSON.stringify(data).length` — the measure eventStore caps by. For ASCII
// payloads that is the byte count. Star Swarm's own server-side check
// (`backend/starswarm/models.py`) measures `ensure_ascii` bytes, so a non-ASCII
// character counts more there (one `\uXXXX` escape is 6); the replay caps
// (`backend/games/replay_caps.py`) measure raw UTF-8. Recorded payloads should
// therefore be ASCII (compact codes).
//
// This is the minimal shape the recorder reads; the per-game event registry
// (#3278) and priority from it (#3276) build on it.

/**
 * The `timeout` the recorder's idle save passes to React Native's
 * `requestIdleCallback` (`scheduleIdle`): RN runs the save by then even when
 * the JS thread never idles. RN's own deadline — the recorder keeps no timer.
 * @internal Only the GameRecorder uses it, and the recorder has no production caller until a game adopts it (#3280; knip --production, #3126).
 */
export const RECORDER_IDLE_TIMEOUT_MS = 2000;

/**
 * A long open unit (a real-time chunk) hands its events so far to the idle
 * measuring every this many `record()` calls, keeping its unit number, so its
 * raw events do not pile up until `closeUnit()`.
 * @internal Only the GameRecorder uses it, and the recorder has no production caller until a game adopts it (#3280; knip --production, #3126).
 */
export const RECORDER_MEASURE_EVERY = 64;

/**
 * The most unmeasured events the recorder holds at once. Past it (idle never
 * came to measure the backlog), `record()` drops events, counted as
 * `dropped_memory`, until idle has measured what is held.
 * @internal Only the GameRecorder uses it, and the recorder has no production caller until a game adopts it (#3280; knip --production, #3126).
 */
export const RECORDER_MAX_RAW_EVENTS = 256;

/** How one recorded event type is capped. */
export interface RecordedEventConfig {
  /** Most JSON length (UTF-16 code units) one event's `data`, envelope included, may have. */
  readonly maxBytes: number;
  /**
   * Set when the type may be split: the name of the array field in `data`
   * that is spread across parts. Each part carries the rest of `data`, the
   * envelope, `part` (0-based) and `parts`. Unset: an oversized event is
   * dropped and reported.
   */
  readonly chunkField?: string;
  /** Schema version written as the envelope's `v`. Defaults to 1. */
  readonly v?: number;
}

/** One game's recording caps. */
export interface GameRecordingConfig {
  /** Most JSON length (UTF-16 code units) one session's recorded events add up to. */
  readonly sessionMaxBytes: number;
  /** Per-event cap (JSON length, UTF-16 code units) for a type with no entry in `events`. */
  readonly defaultEventMaxBytes: number;
  readonly events: Readonly<Record<string, RecordedEventConfig>>;
}

/**
 * Star Swarm (#3251): the serialized size cap for one `wave_completed`
 * payload — the backend drops anything larger.
 */
export const WAVE_STATS_MAX_BYTES = 4096;
/** Star Swarm: the most a run's `wave_completed` payloads add up to (the sum of their JSON lengths). */
export const WAVE_STATS_RUN_MAX_BYTES = 64 * 1024;

/** The caps of a game with no entry in `gameRecordingConfigs`. */
export const DEFAULT_RECORDING_CONFIG: GameRecordingConfig = {
  sessionMaxBytes: 64 * 1024,
  defaultEventMaxBytes: 2 * 1024,
  events: {},
};

/** Per-game recording caps. A game without an entry gets `DEFAULT_RECORDING_CONFIG`. */
export const gameRecordingConfigs: Readonly<Partial<Record<GameType, GameRecordingConfig>>> = {
  starswarm: {
    sessionMaxBytes: WAVE_STATS_RUN_MAX_BYTES,
    defaultEventMaxBytes: DEFAULT_RECORDING_CONFIG.defaultEventMaxBytes,
    events: { wave_completed: { maxBytes: WAVE_STATS_MAX_BYTES } },
  },
};

/**
 * @internal Only the GameRecorder uses it, and the recorder has no production caller until a game adopts it (#3280; knip --production, #3126).
 */
export function recordingConfigFor(gameType: GameType): GameRecordingConfig {
  return gameRecordingConfigs[gameType] ?? DEFAULT_RECORDING_CONFIG;
}

/**
 * The cap one event of `eventType` is held to: never over the queue's per-row cap.
 * @internal Only the GameRecorder uses it, and the recorder has no production caller until a game adopts it (#3280; knip --production, #3126).
 */
export function recordingEventCap(config: GameRecordingConfig, eventType: string): number {
  const own = config.events[eventType]?.maxBytes ?? config.defaultEventMaxBytes;
  return Math.min(own, logConfig.MAX_EVENT_PAYLOAD_BYTES);
}

/**
 * Whether a session of `gameType` records at all, read once per session.
 * Always true for now: the server-controlled kill switch / sample rate
 * (#3279) plugs in here.
 * @internal Only the GameRecorder uses it, and the recorder has no production caller until a game adopts it (#3280; knip --production, #3126).
 */
export function isRecordingEnabled(_gameType: GameType): boolean {
  return true;
}
