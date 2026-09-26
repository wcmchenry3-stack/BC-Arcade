/**
 * Tracks in-flight game state for the write-side client (367b).
 *
 * Each game has lifecycle state that lives outside the event queue:
 *   - gameType / metadata — needed by SyncWorker to POST /games
 *   - started — has the player acted in this session (#2654)? SyncWorker
 *     holds the POST /games create, and so every event, until it is true.
 *   - startedSynced — has POST /games returned 2xx?
 *   - nextEventIndex / lastEventAt — monotonic counter used when enqueueing
 *     events, and when the last one was enqueued
 *   - completed / completeSummary / completeSynced / completeAttempts — for PATCH /complete
 *
 * Storage: in-memory map is authoritative; AsyncStorage persists the same
 * map under `pending_games_v1`. On init() we rehydrate from disk and merge
 * the saved games under any this process already created. The in-memory copy
 * lets enqueueEvent increment nextEventIndex synchronously, which is what lets
 * gameEventClient return a correct event_index without awaiting storage.
 * Every write waits for that first read, so a game started before init()
 * resolves can neither be dropped by the load nor overwrite the saved games.
 *
 * Previous process (#2654): the games read from disk at init() — and not
 * created by this process — belong to an earlier app process. Any of them
 * still open was left behind when that process was killed (an "orphan");
 * `previousProcessOpenGames()` lists them. Origin, not a clock comparison,
 * decides this, so a device clock change can never sweep a session the
 * current process opened. A screen that restores the orphan's saved progress
 * adopts it (`adoptOrphan`), after which it is this process's game.
 *
 * Startup sweep: gameEventClient registers its sweep (`setStartupSweep`) and
 * `init()` resolves only after the load *and* the sweep. SyncWorker awaits
 * `init()` before every flush, so a flush never sees the store between the
 * two (#2654 review). Writes wait only for the load, never for the sweep —
 * the sweep's own writes would otherwise wait on themselves.
 *
 * Bounded maintenance: once SyncWorker confirms a game is fully synced
 * (started + completed + all events delivered), it calls `forget(gameId)`
 * to drop the row. No TTL is enforced here — the event queue's TTL
 * handles ancient events, and a fully-synced game should be dropped
 * promptly anyway.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import type { GameOutcome } from "../../api/vocab";

const STORAGE_KEY = "pending_games_v1";

export interface CompleteSummary {
  finalScore?: number | null;
  /** A backend `GameOutcome` (#2517) — see `recordedOutcome` for games with a winner. */
  outcome?: GameOutcome | null;
  durationMs?: number | null;
  /**
   * Per-game result block sent as `result` on PATCH /games/:id/complete (#2450).
   * Shape is owned by each game's backend `result_model` (e.g. Solitaire:
   * `{ won, moves }`). Omitted/empty is always accepted by the backend.
   */
  result?: Record<string, unknown>;
}

export interface PendingGame {
  gameType: string;
  metadata: Record<string, unknown>;
  startedAt: number;
  /**
   * The player acted in this session (`markStarted`), or finished it (#2654).
   * Until then the game stays on the device: no POST /games, no events.
   * A record saved by an older build has no `started` field; `normalizeLoaded`
   * derives it on load.
   */
  started: boolean;
  startedSynced: boolean;
  nextEventIndex: number;
  /**
   * Epoch ms of the last event enqueued for this game (#2654) — the last time
   * the device knows the session was alive. Absent on older builds' records.
   */
  lastEventAt?: number;
  completed: boolean;
  completedAt: number | null;
  completeSummary: CompleteSummary | null;
  completeSynced: boolean;
  /**
   * Outcome override for the killed-process sweep (#2682): when a game's
   * progress snapshot reports it already locked in a win (e.g. Blackjack's
   * run goal), the sweep records this instead of `abandoned` if the session
   * is never resumed. Only "win" is valid — `abandonOrphan` re-checks it, so
   * a corrupted or older-build value on disk is never trusted blindly.
   */
  progressOutcome?: "win" | null;
}

/**
 * A killed process's started session stays resumable this long after it
 * started; older, it is abandoned. Matches the server's stale-session sweep
 * (#2621, `STALE_GAME_AFTER`), which also measures from the start.
 */
export const ORPHAN_RESUMABLE_MS = 24 * 60 * 60 * 1000;

/** Still resumable at `now` — see ORPHAN_RESUMABLE_MS. */
export function isOrphanResumable(game: PendingGame, now: number): boolean {
  return now - game.startedAt < ORPHAN_RESUMABLE_MS;
}

/**
 * Fill in fields an older build's record lacks (#2654). An older build had no
 * `started` flag and created every game on the server as soon as it opened, so
 * a legacy record counts as started only if the player really played it:
 *   - its POST /games already succeeded (`startedSynced`), or
 *   - it has an event beyond `game_started` (index 0), or it was finished.
 * Anything else is an untouched session that never reached the server; it
 * loads as unstarted and the startup sweep discards it, so upgrading never
 * creates and abandons a server row for a game nobody played.
 */
function normalizeLoaded(game: PendingGame): PendingGame {
  if (typeof game.started !== "boolean") {
    const eventsBeyondStart = typeof game.nextEventIndex === "number" && game.nextEventIndex > 1;
    game.started = !!game.startedSynced || eventsBeyondStart || !!game.completed;
  }
  return game;
}

export class PendingGamesStore {
  private games: Map<string, PendingGame> = new Map();
  /** The disk read. Writes wait for this. */
  private loading: Promise<void> | null = null;
  private loaded = false;
  /** The disk read, then the startup sweep. `init()` returns this. */
  private ready: Promise<void> | null = null;
  private startupSweep: (() => Promise<void>) | null = null;
  /**
   * Ids read from disk at init() that this process did not create and has not
   * adopted (#2654). A game leaves the set when it is adopted or forgotten.
   */
  private fromPreviousProcess: Set<string> = new Set();
  /** >0 while `batch()` runs: writes are deferred to one at its end. */
  private batchDepth = 0;
  private batchDirty = false;

  /**
   * Load persisted state, then run the startup sweep if one is registered.
   * Safe to call multiple times; only the first call reads AsyncStorage.
   * Must complete before any other method is called, although the class
   * will lazy-load if needed.
   */
  init(): Promise<void> {
    if (!this.ready) {
      this.ready = this.load().then(() => this.runStartupSweep());
    }
    return this.ready;
  }

  /**
   * Register the sweep `init()` runs once, after the load (gameEventClient's
   * killed-session sweep, #2654). Registered after init() started, it still
   * runs, and init() waits for it.
   */
  setStartupSweep(sweep: () => Promise<void>): void {
    this.startupSweep = sweep;
    if (this.ready) this.ready = this.ready.then(() => this.runStartupSweep());
  }

  /** True once the disk read has finished (successfully or not). */
  isLoaded(): boolean {
    return this.loaded;
  }

  private load(): Promise<void> {
    if (!this.loading) this.loading = this.loadFromStorage();
    return this.loading;
  }

  private async runStartupSweep(): Promise<void> {
    const sweep = this.startupSweep;
    this.startupSweep = null;
    if (!sweep) return;
    try {
      await sweep();
    } catch (e) {
      Sentry.captureException(e, {
        tags: { subsystem: "pendingGamesStore", op: "startupSweep" },
      });
    }
  }

  private async loadFromStorage(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, PendingGame>;
      // Merge, don't replace: a game this process created while the read was
      // in flight is already in memory and wins.
      for (const [id, game] of Object.entries(parsed)) {
        if (this.games.has(id) || !game || typeof game !== "object") continue;
        this.games.set(id, normalizeLoaded(game));
        this.fromPreviousProcess.add(id);
      }
    } catch (e) {
      Sentry.captureException(e, {
        tags: { subsystem: "pendingGamesStore", op: "load" },
      });
    } finally {
      this.loaded = true;
    }
  }

  /**
   * Apply several changes with one write (#2654 review): every change `fn`
   * makes is persisted once, when it returns. `fn` must be synchronous.
   */
  batch(fn: () => void): Promise<void> {
    this.batchDepth += 1;
    try {
      fn();
    } finally {
      this.batchDepth -= 1;
    }
    if (this.batchDepth > 0 || !this.batchDirty) return Promise.resolve();
    this.batchDirty = false;
    return this.persist();
  }

  private async persist(): Promise<void> {
    if (this.batchDepth > 0) {
      this.batchDirty = true;
      return;
    }
    try {
      // Never write before the saved games are loaded: the write would replace
      // them on disk with only this process's games.
      await this.load();
      const obj: Record<string, PendingGame> = {};
      for (const [k, v] of this.games) obj[k] = v;
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch (e) {
      Sentry.captureException(e, {
        tags: { subsystem: "pendingGamesStore", op: "persist" },
      });
    }
  }

  /**
   * Register a new game. Returns a fire-and-forget persistence promise —
   * callers in production can ignore it; tests should await it.
   */
  create(gameId: string, gameType: string, metadata: Record<string, unknown>): Promise<void> {
    this.games.set(gameId, {
      gameType,
      metadata,
      startedAt: Date.now(),
      started: false,
      startedSynced: false,
      nextEventIndex: 0,
      completed: false,
      completedAt: null,
      completeSummary: null,
      completeSynced: false,
    });
    return this.persist();
  }

  /** Atomically grab and increment the next event index for a game. */
  nextEventIndex(gameId: string): number | null {
    const game = this.games.get(gameId);
    if (!game || game.completed) return null;
    const idx = game.nextEventIndex;
    game.nextEventIndex = idx + 1;
    game.lastEventAt = Date.now();
    // Fire and forget — persistence lag is acceptable here because the
    // event itself gets a durable write from eventStore.
    this.persist().catch(() => undefined);
    return idx;
  }

  /**
   * The player acted in this session (#2654): SyncWorker may now create it on
   * the server and send its events. Idempotent.
   */
  markStarted(gameId: string): Promise<void> {
    const game = this.games.get(gameId);
    if (!game || game.started) return Promise.resolve();
    game.started = true;
    return this.persist();
  }

  /**
   * Mark a game as completed. Idempotent. Finishing is real activity, so an
   * unstarted game is marked started too (#2654) — a game that ends on its
   * first action still reaches the server. `completedAt` defaults to now.
   */
  complete(
    gameId: string,
    summary: CompleteSummary,
    completedAt: number = Date.now()
  ): Promise<void> {
    const game = this.games.get(gameId);
    if (!game) return Promise.resolve();
    if (game.completed) return Promise.resolve();
    game.started = true;
    game.completed = true;
    game.completedAt = completedAt;
    game.completeSummary = summary;
    return this.persist();
  }

  get(gameId: string): PendingGame | undefined {
    return this.games.get(gameId);
  }

  /**
   * Drop a game's record. SyncWorker calls this once the game is fully synced
   * (started + events + completed); `gameEventClient.discardGame` calls it for
   * a game the player never started — on `restart()` (#2619) and for a killed
   * process's unstarted games at startup (#2654). The in-memory delete is
   * synchronous.
   */
  forget(gameId: string): Promise<void> {
    this.fromPreviousProcess.delete(gameId);
    if (!this.games.delete(gameId)) return Promise.resolve();
    return this.persist();
  }

  /** Iterate pending games in insertion order (what SyncWorker walks). */
  all(): Array<[string, PendingGame]> {
    return Array.from(this.games.entries());
  }

  /**
   * Games an earlier app process left open (#2654): read from disk at init(),
   * not created or adopted by this process, and not completed. Empty until
   * the load resolves. Never includes a game this process opened.
   */
  previousProcessOpenGames(): Array<[string, PendingGame]> {
    const out: Array<[string, PendingGame]> = [];
    for (const id of this.fromPreviousProcess) {
      const game = this.games.get(id);
      if (game && !game.completed) out.push([id, game]);
    }
    return out;
  }

  /**
   * Adopt the killed process's session of `gameType` that a screen is
   * restoring (#2654): the most recently active started, still-resumable
   * orphan of that type, optionally only one whose metadata has every
   * `match` value. It becomes this process's game — never swept again by
   * this process — and its id is returned. Null when there is none, or
   * before the load has finished.
   */
  adoptOrphan(gameType: string, now: number, match?: Record<string, unknown>): string | null {
    let bestId: string | null = null;
    let bestAt = -Infinity;
    for (const [id, game] of this.previousProcessOpenGames()) {
      if (game.gameType !== gameType || !game.started || !isOrphanResumable(game, now)) continue;
      if (match && !Object.entries(match).every(([k, v]) => game.metadata?.[k] === v)) continue;
      const at = game.lastEventAt ?? game.startedAt;
      if (at > bestAt) {
        bestAt = at;
        bestId = id;
      }
    }
    if (bestId !== null) this.fromPreviousProcess.delete(bestId);
    return bestId;
  }

  /**
   * Record the outcome override a killed-process sweep should use for this
   * game in place of `abandoned` (#2682) — set from the game's registered
   * progress snapshot while it plays, so it survives the process that set it.
   * No-op on a completed game (nothing left to sweep).
   */
  setProgressOutcome(gameId: string, outcome: "win" | null): Promise<void> {
    const game = this.games.get(gameId);
    if (!game || game.completed || game.progressOutcome === outcome) return Promise.resolve();
    game.progressOutcome = outcome;
    return this.persist();
  }

  /** SyncWorker marks the server-side game created. */
  markStartedSynced(gameId: string): Promise<void> {
    const game = this.games.get(gameId);
    if (!game || game.startedSynced) return Promise.resolve();
    game.startedSynced = true;
    return this.persist();
  }

  /** SyncWorker marks PATCH /complete confirmed. */
  markCompleteSynced(gameId: string): Promise<void> {
    const game = this.games.get(gameId);
    if (!game || game.completeSynced) return Promise.resolve();
    game.completeSynced = true;
    return this.persist();
  }

  /** For tests. */
  async clearAll(): Promise<void> {
    // Load first so the saved games can't be merged back in afterwards.
    await this.init();
    this.games.clear();
    this.fromPreviousProcess.clear();
    await AsyncStorage.removeItem(STORAGE_KEY);
  }
}

export const pendingGamesStore = new PendingGamesStore();
