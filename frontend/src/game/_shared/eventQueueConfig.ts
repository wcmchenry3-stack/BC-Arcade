/**
 * Tunable thresholds for the local event log queue (#367).
 *
 * This file is the single source of truth for every cap, interval, and
 * backoff used by eventStore, gameEventClient, syncWorker and gameRecorder
 * (the per-game recording caps, at the end of the file). Keep any new
 * cap, interval or backoff here rather than as a literal elsewhere.
 *
 * Note (issue 367): originally specified expo-sqlite, but we chose AsyncStorage
 * (per priority tier, in fixed-size chunks since #3333) to avoid a native-module rebuild and keep
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
 * Capacity eviction does NOT walk these tiers in numeric order (#3276). The
 * order eventStore evicts in, first to last:
 *
 *   1. P0 bug logs, P2 mid and P3 granular, as one pool, oldest row first;
 *   2. P4 replay, a whole game at a time, the game whose latest row is oldest first;
 *   3. P1 lifecycle, oldest row first, only once everything above is empty.
 *
 *   P0: bug logs
 *   P1: lifecycle — game_started, game_ended, hand_resolved
 *   P2: mid — an event with no type, and rows already queued before #3276
 *   P3: granular — an event type no game registers (diagnostics)
 *   P4: replay — the gameplay events that rebuild a game (roll, score, move,
 *       wave_completed, bet_placed, ...), as the registry marks them
 *
 * The numbers are the on-disk tier ids: never renumber one.
 */
export const Priority = {
  BUG_LOG: 0,
  LIFECYCLE: 1,
  MID: 2,
  GRANULAR: 3,
  REPLAY: 4,
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

/**
 * How far over `MAX_ROWS` / `MAX_SIZE_BYTES` the queue may go while the
 * evicted-games marker cannot be written (#3276). With the marker unwritable
 * no replay row is evicted (a deletion without a durable marker could leave a
 * suffix with no start), so the queue is held over its cap; past this many
 * times either cap a save is rejected instead, and the games stay intact.
 * Once a marker write works again the backlog is evicted back under the cap.
 */
export const HELD_OVERAGE_FACTOR = 2;

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
    return registeredTier(eventType) ?? Priority.GRANULAR;
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

/**
 * How long SyncWorker holds the gameplay (non-lifecycle) events of a session
 * that is open in the foreground (#3275), measured from the oldest held row.
 * They go out sooner when the session completes or the app is backgrounded;
 * this fallback only makes a long session upload now and then. Every upload
 * wakes the cellular/Wi-Fi radio, which then stays in a high-power state for
 * several seconds, so a few large batches cost far less battery than one
 * every `SYNC_INTERVAL_MS`. 5 min keeps at most a few minutes of play on the
 * device — well inside the queue's caps and `TTL_MS`.
 */
export const GAMEPLAY_HOLD_MAX_MS = 5 * 60 * 1000;

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
// This is the shape the recorder reads. It is derived from the per-game event
// registry (#3278, below), which also decides every event's queue priority (#3276).

/**
 * The `timeout` the recorder's idle save passes to React Native's
 * `requestIdleCallback` (`scheduleIdle`): RN runs the save by then even when
 * the JS thread never idles. RN's own deadline — the recorder keeps no timer.
 */
export const RECORDER_IDLE_TIMEOUT_MS = 2000;

/**
 * A long open unit (a real-time chunk) hands its events so far to the idle
 * measuring every this many `record()` calls, keeping its unit number, so its
 * raw events do not pile up until `closeUnit()`.
 */
export const RECORDER_MEASURE_EVERY = 64;

/**
 * The most unmeasured events the recorder holds at once. Past it (idle never
 * came to measure the backlog), `record()` drops events, counted as
 * `dropped_memory`, until idle has measured what is held.
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
  /**
   * `false`: the event is sent as recorded, with no envelope (`v`, `unit`,
   * `t_ms`, `actor`), and measured exactly as sent. Never chunked (a
   * `chunkField` is ignored). See `EventTypeSpec.envelope`.
   */
  readonly envelope?: false;
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

/**
 * Hearts (#3283): the cap on one event's JSON length, per replay type. The worst
 * honest event (hand 60, a 10-digit `t_ms`) is 232 B (`hand_opened`) / 264 B (`hand_played`)
 * (frontend and backend tests pin both), so each cap leaves a third
 * spare and still bounds a bad one. The backend's `MAX_*_BYTES`
 * (hearts/events.py) hold the same figures.
 */
export const HEARTS_HAND_OPENED_MAX_BYTES = 384;
export const HEARTS_HAND_PLAYED_MAX_BYTES = 384;

/** The caps of a game with no entry in `gameRecordingConfigs`. */
export const DEFAULT_RECORDING_CONFIG: GameRecordingConfig = {
  sessionMaxBytes: 64 * 1024,
  defaultEventMaxBytes: 2 * 1024,
  events: {},
};

// ---------------------------------------------------------------------------
// Game event registry (#3278, epic #3273)
// ---------------------------------------------------------------------------
//
// THE one table of every gameplay event type each game sends: its priority
// tier, byte cap and whether it may be chunked. Three things read it:
//
//  - `gameRecordingConfigs` / `recordingConfigFor` (below) derive the
//    recorder's caps from it. There is no second table.
//  - the backend contract test (backend/tests/test_event_registry_contract.py)
//    PARSES THIS FILE as text, so keep the literal shape: a game key, an
//    `events` object, then `name: { tier: Priority.X, ... }` per type. Every
//    registered type must be seeded in `event_types` (an Alembic migration)
//    and be covered by the game module's `validate_event` or listed there as
//    "stored as sent"; every seeded type must be registered here.
//  - `tier` is each type's queue tier, and `logConfig.priorityForEvent` reads
//    it (#3276): `Priority.REPLAY` for a gameplay event that rebuilds a game
//    (evicted only after the granular and diagnostic data, a whole game at a
//    time), `Priority.LIFECYCLE` for game_started / game_ended / hand_resolved.
//    A new type must choose; there is no default.
//
// Adding an event type: docs/GAME-CONTRACT.md#adding-an-event-type.

/** How one event type of a game is sent. */
interface EventTypeSpecBase {
  /** Queue priority tier (see `Priority`). */
  readonly tier: Priority;
  /** Cap (JSON length) for one event; unset: the game's `defaultEventMaxBytes`. */
  readonly maxBytes?: number;
  /** Schema version written as the envelope's `v`. Defaults to 1. */
  readonly v?: number;
}

/**
 * How one event type of a game is sent. A type either uses the envelope
 * (the default; it may set `chunkField`) or sets `envelope: false`, which
 * rules out `chunkField` at the type level.
 */
export type EventTypeSpec = EventTypeSpecBase &
  (
    | {
        /** Set when the type may be split: the array field spread across parts. Unset: never chunked. */
        readonly chunkField?: string;
        readonly envelope?: undefined;
      }
    | {
        /**
         * `false`: the recorder sends `data` exactly as recorded (no `v`, `unit`,
         * `t_ms` or `actor`) and measures what it sends. For a type whose payload
         * is already a fixed, versioned wire contract (Star Swarm's `wave_completed`).
         * Such a type is never chunked. New types use the envelope (the default).
         */
        readonly envelope: false;
        readonly chunkField?: never;
      }
  );

/** One game's event types, plus any override of the default recording caps. */
export interface GameEventRegistryEntry {
  /** Unset: `DEFAULT_RECORDING_CONFIG.sessionMaxBytes`. */
  readonly sessionMaxBytes?: number;
  /** Unset: `DEFAULT_RECORDING_CONFIG.defaultEventMaxBytes`. */
  readonly defaultEventMaxBytes?: number;
  readonly events: Readonly<Record<string, EventTypeSpec>>;
}

/** Every game's event types. Keyed by `GameType`, so a new game cannot ship without an entry. */
export const gameEventRegistry = {
  yacht: {
    events: {
      game_started: { tier: Priority.LIFECYCLE },
      game_ended: { tier: Priority.LIFECYCLE },
      roll: { tier: Priority.REPLAY },
      score: { tier: Priority.REPLAY },
    },
  },
  twenty48: {
    events: {
      game_started: { tier: Priority.LIFECYCLE },
      game_ended: { tier: Priority.LIFECYCLE },
      move: { tier: Priority.REPLAY },
    },
  },
  blackjack: {
    events: {
      game_started: { tier: Priority.LIFECYCLE },
      game_ended: { tier: Priority.LIFECYCLE },
      bet_placed: { tier: Priority.REPLAY },
      hand_dealt: { tier: Priority.REPLAY },
      player_action: { tier: Priority.REPLAY },
      hand_resolved: { tier: Priority.LIFECYCLE },
    },
  },
  cascade: {
    events: {
      game_started: { tier: Priority.LIFECYCLE },
      game_ended: { tier: Priority.LIFECYCLE },
      drop: { tier: Priority.REPLAY },
      merge: { tier: Priority.REPLAY },
    },
  },
  solitaire: {
    events: {
      game_started: { tier: Priority.LIFECYCLE },
      game_ended: { tier: Priority.LIFECYCLE },
    },
  },
  hearts: {
    events: {
      game_started: { tier: Priority.LIFECYCLE },
      game_ended: { tier: Priority.LIFECYCLE },
      // Two events a hand (game/hearts/replay.ts); never chunked: a part is made by the game.
      hand_opened: { tier: Priority.REPLAY, maxBytes: HEARTS_HAND_OPENED_MAX_BYTES },
      hand_played: { tier: Priority.REPLAY, maxBytes: HEARTS_HAND_PLAYED_MAX_BYTES },
    },
  },
  sudoku: {
    events: {
      game_started: { tier: Priority.LIFECYCLE },
      game_ended: { tier: Priority.LIFECYCLE },
    },
  },
  mahjong: {
    events: {
      game_started: { tier: Priority.LIFECYCLE },
      game_ended: { tier: Priority.LIFECYCLE },
    },
  },
  starswarm: {
    sessionMaxBytes: WAVE_STATS_RUN_MAX_BYTES,
    events: {
      game_started: { tier: Priority.LIFECYCLE },
      game_ended: { tier: Priority.LIFECYCLE },
      wave_completed: {
        tier: Priority.REPLAY,
        maxBytes: WAVE_STATS_MAX_BYTES,
        // the payload is the backend's versioned wave-stats contract (#3250): sent as is
        envelope: false,
      },
    },
  },
  freecell: {
    events: {
      game_started: { tier: Priority.LIFECYCLE },
      game_ended: { tier: Priority.LIFECYCLE },
    },
  },
  sort: {
    events: {
      game_started: { tier: Priority.LIFECYCLE },
      game_ended: { tier: Priority.LIFECYCLE },
    },
  },
  daily_word: {
    events: {
      game_started: { tier: Priority.LIFECYCLE },
      game_ended: { tier: Priority.LIFECYCLE },
    },
  },
} as const satisfies Readonly<Record<GameType, GameEventRegistryEntry>>;

/** Every registered event type's tier, by name; built on first use. A name has the same tier in every game. */
let tierByType: Map<string, Priority> | null = null;

function registeredTier(eventType: string): Priority | undefined {
  if (tierByType === null) {
    tierByType = new Map();
    for (const entry of Object.values(gameEventRegistry) as GameEventRegistryEntry[]) {
      for (const [name, spec] of Object.entries(entry.events)) {
        if (!tierByType.has(name)) tierByType.set(name, spec.tier);
      }
    }
  }
  return tierByType.get(eventType);
}

/**
 * The event names `G` registers. Distributes over a union, so `EventTypeOf<GameType>`
 * is every game's names. A call typed with it (`useGameSync(G).enqueue`,
 * `GameRecorder<G>.record`) rejects a name the game does not register, which the
 * backend would refuse as `unknown_event_type`.
 */
export type EventTypeOf<G extends GameType = GameType> = G extends GameType
  ? Extract<keyof (typeof gameEventRegistry)[G]["events"], string>
  : never;

/**
 * Every event name some game registers: for the layers that do not know the game.
 */
export type RegisteredEventType = EventTypeOf;

/**
 * The recorder's caps for one registry entry, or undefined when it overrides
 * nothing (the game then gets `DEFAULT_RECORDING_CONFIG` itself).
 */
function recordingConfigOf(entry: GameEventRegistryEntry): GameRecordingConfig | undefined {
  const defaultEventMaxBytes =
    entry.defaultEventMaxBytes ?? DEFAULT_RECORDING_CONFIG.defaultEventMaxBytes;
  const events: Record<string, RecordedEventConfig> = {};
  for (const [name, spec] of Object.entries(entry.events)) {
    if (
      spec.maxBytes === undefined &&
      spec.chunkField === undefined &&
      spec.v === undefined &&
      spec.envelope === undefined
    ) {
      continue;
    }
    events[name] = {
      maxBytes: spec.maxBytes ?? defaultEventMaxBytes,
      ...(spec.chunkField !== undefined && { chunkField: spec.chunkField }),
      ...(spec.v !== undefined && { v: spec.v }),
      ...(spec.envelope === false && { envelope: false as const }),
    };
  }
  if (
    entry.sessionMaxBytes === undefined &&
    entry.defaultEventMaxBytes === undefined &&
    Object.keys(events).length === 0
  ) {
    return undefined;
  }
  return {
    sessionMaxBytes: entry.sessionMaxBytes ?? DEFAULT_RECORDING_CONFIG.sessionMaxBytes,
    defaultEventMaxBytes,
    events,
  };
}

function deriveRecordingConfigs(): Partial<Record<GameType, GameRecordingConfig>> {
  const out: Partial<Record<GameType, GameRecordingConfig>> = {};
  for (const game of Object.keys(gameEventRegistry) as GameType[]) {
    const config = recordingConfigOf(gameEventRegistry[game]);
    if (config) out[game] = config;
  }
  return out;
}

/**
 * Per-game recording caps, derived from `gameEventRegistry` (not a second
 * table). A game that overrides nothing gets `DEFAULT_RECORDING_CONFIG`.
 */
export const gameRecordingConfigs: Readonly<Partial<Record<GameType, GameRecordingConfig>>> =
  deriveRecordingConfigs();

/**
 * The recorder's caps for `gameType`: its derived entry, else `DEFAULT_RECORDING_CONFIG`.
 */
export function recordingConfigFor(gameType: GameType): GameRecordingConfig {
  return gameRecordingConfigs[gameType] ?? DEFAULT_RECORDING_CONFIG;
}

/**
 * The cap one event of `eventType` is held to: never over the queue's per-row cap.
 */
export function recordingEventCap(config: GameRecordingConfig, eventType: string): number {
  const own = config.events[eventType]?.maxBytes ?? config.defaultEventMaxBytes;
  return Math.min(own, logConfig.MAX_EVENT_PAYLOAD_BYTES);
}

/**
 * Whether a session of `gameType` records at all, read once per session.
 * Always true for now: the server-controlled kill switch / sample rate
 * (#3279) plugs in here.
 */
export function isRecordingEnabled(_gameType: GameType): boolean {
  return true;
}
