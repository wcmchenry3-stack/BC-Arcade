/**
 * Tracks in-flight game state for the write-side client (367b).
 *
 * Each game has lifecycle state that lives outside the event queue:
 *   - gameType / metadata — needed by SyncWorker to POST /games
 *   - startedSynced — has POST /games returned 2xx?
 *   - nextEventIndex — monotonic counter used when enqueueing events
 *   - completed / completeSummary / completeSynced / completeAttempts — for PATCH /complete
 *
 * Storage: in-memory map is authoritative; AsyncStorage persists the same
 * map under `pending_games_v1`. On init() we rehydrate from disk. The
 * in-memory copy lets enqueueEvent increment nextEventIndex synchronously,
 * which is what lets gameEventClient return a correct event_index without
 * awaiting storage.
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
  startedSynced: boolean;
  nextEventIndex: number;
  completed: boolean;
  completedAt: number | null;
  completeSummary: CompleteSummary | null;
  completeSynced: boolean;
}

export class PendingGamesStore {
  private games: Map<string, PendingGame> = new Map();
  private ready: Promise<void> | null = null;

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
      this.games = new Map(Object.entries(parsed));
    } catch (e) {
      Sentry.captureException(e, {
        tags: { subsystem: "pendingGamesStore", op: "load" },
      });
      this.games = new Map();
    }
  }

  private async persist(): Promise<void> {
    try {
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
    // Fire and forget — persistence lag is acceptable here because the
    // event itself gets a durable write from eventStore.
    this.persist().catch(() => undefined);
    return idx;
  }

  /** Mark a game as completed. Idempotent. */
  complete(gameId: string, summary: CompleteSummary): Promise<void> {
    const game = this.games.get(gameId);
    if (!game) return Promise.resolve();
    if (game.completed) return Promise.resolve();
    game.completed = true;
    game.completedAt = Date.now();
    game.completeSummary = summary;
    return this.persist();
  }

  get(gameId: string): PendingGame | undefined {
    return this.games.get(gameId);
  }

  /** SyncWorker calls this once the game is fully synced (started + events + completed). */
  forget(gameId: string): Promise<void> {
    if (!this.games.delete(gameId)) return Promise.resolve();
    return this.persist();
  }

  /** Iterate pending games in insertion order (what SyncWorker walks). */
  all(): Array<[string, PendingGame]> {
    return Array.from(this.games.entries());
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
    this.games.clear();
    await AsyncStorage.removeItem(STORAGE_KEY);
  }
}

export const pendingGamesStore = new PendingGamesStore();
