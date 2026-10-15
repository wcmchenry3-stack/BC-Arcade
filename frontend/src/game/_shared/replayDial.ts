/**
 * The replay dial (#3279, epic #3273): the server's per-game kill switch and
 * sample rate, and the per-session decision made from them.
 *
 * Carrier (#3307): `GET /games/catalog` serves `replay: {enabled, sample_rate}`
 * per game (`game_types.replay_enabled` / `replay_sample_rate`, with
 * `REPLAY_RECORDING_ENABLED` folded into `enabled`). This module holds the
 * dial and decides; replayDialSync.ts fetches it (kept apart so the client,
 * which decides at every `startGame`, does not import the network layer):
 *  - `hydrate()`: the last-known dial from AsyncStorage (`replayDial.v1`), once
 *    per process, before the launch fetch (`startReplayDial`, started by
 *    NetworkContext before `gameEventClient.init()`);
 *  - `acceptCatalog(body)`: a fetched catalog is kept, and stored, only when
 *    it is valid — every item names a game and carries a boolean `enabled`
 *    and a finite `sample_rate` in [0, 1]. Anything else keeps the dial held.
 *
 * Which dial a game gets (`dialFor`), first that applies:
 *  1. the catalog's, fetched this process or stored, if younger than
 *     `REPLAY_DIAL_MAX_AGE_MS` (30 days, owner decision D4-B);
 *  2. the default: enabled, `REPLAY_DEFAULT_SAMPLE_RATE` (10 %). Never 100 %.
 * A game the catalog does not list, or a session started before the hydrate
 * finished, gets the default.
 *
 * Per session (`decideReplay`, called once by `gameEventClient.startGame` and
 * stored on the pending game, so a resume or a dial change never changes it):
 *  - `off`: the game's flag is off. The recorder records nothing and only
 *    lifecycle events are queued.
 *  - `full`: `replayBucket(gameId) < rate × 10,000` — FNV-1a of the id, so the
 *    same id always lands in the same bucket. The whole replay uploads.
 *  - `local`: the rest. Recorded and saved on the device as usual, but only
 *    the lifecycle rows, the keep-list types (`RETENTION_KEEP_TYPES`, D5) and
 *    a summary in `game_ended` are sent; an error or
 *    a bug report upgrades it to `full` (`gameEventClient.upgradeReplay`).
 *
 * Cost (CLAUDE.md): one AsyncStorage read per launch and one write per
 * accepted fetch. Nothing here is on the frame or gesture path, and nothing
 * reports to Sentry.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { REPLAY_DEFAULT_SAMPLE_RATE, REPLAY_DIAL_MAX_AGE_MS } from "./eventQueueConfig";

/** How a session's replay is uploaded (see the header). */
export type ReplayMode = "full" | "local" | "off";
/** What upgraded a `local` session to `full`. */
export type ReplayUpgradeReason = "bug" | "error" | "crash";

export interface ReplayDial {
  readonly enabled: boolean;
  /** Share of sessions that upload in full, 0..1. */
  readonly rate: number;
}

/** What `replayDial.v1` holds: when the catalog was fetched, and each game's `{e, r}`. */
interface StoredDial {
  readonly fetchedAt: number;
  readonly games: Readonly<Record<string, { readonly e: boolean; readonly r: number }>>;
}

const STORAGE_KEY = "replayDial.v1";
/** The bucket resolution: a rate is honoured to 1 in 10,000. */
const REPLAY_BUCKETS = 10_000;

const DEFAULT_DIAL: ReplayDial = { enabled: true, rate: REPLAY_DEFAULT_SAMPLE_RATE };

let fallback: ReplayDial = DEFAULT_DIAL;
let dial: StoredDial | null = null;
let hydrating: Promise<void> | null = null;

function isRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The catalog's dials, or null when the body is not a valid catalog (then nothing changes). */
function parseCatalog(body: unknown): StoredDial["games"] | null {
  if (!isRecord(body) || !Array.isArray(body.items) || body.items.length === 0) return null;
  const games: Record<string, { e: boolean; r: number }> = {};
  for (const item of body.items) {
    if (!isRecord(item) || typeof item.name !== "string" || !isRecord(item.replay)) return null;
    const { enabled, sample_rate } = item.replay;
    if (typeof enabled !== "boolean" || !isRate(sample_rate)) return null;
    games[item.name] = { e: enabled, r: sample_rate };
  }
  return games;
}

function parseStored(raw: string | null): StoredDial | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.fetchedAt !== "number" || !isRecord(parsed.games)) {
      return null;
    }
    for (const entry of Object.values(parsed.games)) {
      if (!isRecord(entry) || typeof entry.e !== "boolean" || !isRate(entry.r)) return null;
    }
    return parsed as unknown as StoredDial;
  } catch {
    return null;
  }
}

/**
 * Read the last-known dial once per process. A dial fetched meanwhile is
 * fresher and wins. Never throws.
 */
export function hydrate(): Promise<void> {
  if (!hydrating) {
    hydrating = (async () => {
      try {
        const stored = parseStored(await AsyncStorage.getItem(STORAGE_KEY));
        if (stored && dial === null) dial = stored;
      } catch {
        // Storage unreadable: the default until a fetch succeeds.
      }
    })();
  }
  return hydrating;
}

/**
 * Take a fetched catalog body (`GET /games/catalog`) as the dial, fetched at
 * `now`, and store it — only when it is valid (see the header). Returns
 * whether it was taken. Never throws.
 */
export async function acceptCatalog(body: unknown, now: number): Promise<boolean> {
  const games = parseCatalog(body);
  if (games === null) return false;
  dial = { fetchedAt: now, games };
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(dial));
  } catch {
    // Kept in memory for this process; the next launch fetches again.
  }
  return true;
}

/**
 * The dial a new session of `gameType` uses (see the header for the order).
 * @internal Exported for its tests; `decideReplay` and `isRecordingEnabled` are the callers.
 */
export function dialFor(gameType: string, now: number = Date.now()): ReplayDial {
  const entry = dial && now - dial.fetchedAt < REPLAY_DIAL_MAX_AGE_MS ? dial.games[gameType] : null;
  return entry ? { enabled: entry.e, rate: entry.r } : fallback;
}

/**
 * Whether a session of `gameType` records at all: the game's flag, read once
 * per recorder session by GameRecorder. Off, the recorder does no work.
 */
export function isRecordingEnabled(gameType: string): boolean {
  return dialFor(gameType).enabled;
}

/**
 * The session's bucket, 0..REPLAY_BUCKETS-1: FNV-1a (32-bit) of the id, so stable per id.
 * @internal Exported for its tests; `decideReplay` is the caller.
 */
export function replayBucket(gameId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < gameId.length; i += 1) {
    hash ^= gameId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % REPLAY_BUCKETS;
}

/** The session's mode, decided once when it is created (see the header). */
export function decideReplay(gameType: string, gameId: string): ReplayMode {
  const { enabled, rate } = dialFor(gameType);
  if (!enabled) return "off";
  return replayBucket(gameId) < Math.round(rate * REPLAY_BUCKETS) ? "full" : "local";
}

/**
 * Tests only: forget the held dial and the hydrate, and set the dial a game
 * with no catalog entry gets (the production default unless given).
 * @internal
 */
export function __resetReplayDialForTests(options: { fallback?: ReplayDial } = {}): void {
  fallback = options.fallback ?? DEFAULT_DIAL;
  dial = null;
  hydrating = null;
}
