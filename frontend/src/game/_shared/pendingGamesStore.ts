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
 * still open was left behind when that process was killed;
 * `previousProcessOpenGames()` lists them for gameEventClient's startup sweep.
 * Origin, not a clock comparison, decides this, so a device clock change can
 * never sweep a session the current process opened.
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
   * A record saved by an older build has no `started` field and is loaded as
   * `true` — see `normalizeLoaded`.
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
}

/**
 * Fill in fields an older build's record lacks (#2654). An older build sent
 * every game to the server as soon as it opened, so a record without `started`
 * is treated as started whether or not it reached the server: it is sent and,
 * if left open by a killed process, closed as abandoned — never dropped.
 */
function normalizeLoaded(game: PendingGame): PendingGame {
  if (typeof game.started !== "boolean") game.started = true;
  return game;
}

export class PendingGamesStore {
  private games: Map<string, PendingGame> = new Map();
  private ready: Promise<void> | null = null;
  /** Ids read from disk at init() that this process did not create (#2654). */
  private fromPreviousProcess: Set<string> = new Set();

  /**
   * Load persisted state. Safe to call multiple times; only the first
   * call actually reads AsyncStorage. Must complete before any other
   * method is called, although the class will lazy-init if needed.
   */
  async init(): Promise<void> {
    if (!this.ready) {
      this.ready = this.loadFromStorage();
    }
    return this.ready;
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
    }
  }

  private async persist(): Promise<void> {
    try {
      // Never write before the saved games are loaded: the write would replace
      // them on disk with only this process's games.
      await this.init();
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
    if (!this.games.delete(gameId)) return Promise.resolve();
    return this.persist();
  }

  /** Iterate pending games in insertion order (what SyncWorker walks). */
  all(): Array<[string, PendingGame]> {
    return Array.from(this.games.entries());
  }

  /**
   * Games an earlier app process left open (#2654): read from disk at init(),
   * not created by this process, and not completed. Empty until init()
   * resolves. Never includes a game this process opened.
   */
  previousProcessOpenGames(): Array<[string, PendingGame]> {
    const out: Array<[string, PendingGame]> = [];
    for (const id of this.fromPreviousProcess) {
      const game = this.games.get(id);
      if (game && !game.completed) out.push([id, game]);
    }
    return out;
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
