/**
 * Public facade for game event + bug log logging (367b).
 *
 * Goals:
 *   1. Never block gameplay — startGame returns the id synchronously;
 *      all other mutators return void and persist asynchronously.
 *   2. Monotonic, gap-free event_index per game — tracked in the
 *      in-memory PendingGamesStore. SyncWorker relies on this when
 *      sending POST /games/:id/events.
 *   3. Runaway caller protection — reportBug is gated by a per-source
 *      token bucket before anything touches the queue.
 *
 * Errors in the fire-and-forget persistence path go to Sentry, not
 * back to the caller (the caller long forgot about the call).
 */

import * as Sentry from "@sentry/react-native";

import { eventStore, EventStore, QueueStats } from "./eventStore";
import { bugReportLimiter, BugReportLimiter } from "./bugReportLimiter";
import { BugLevel } from "./eventQueueConfig";
import { pendingGamesStore, PendingGamesStore, CompleteSummary } from "./pendingGamesStore";
import { generateUUID } from "./uuid";

export interface EnqueueEventInput {
  type: string;
  data?: Record<string, unknown>;
}

export interface GameEventClient {
  init(): Promise<void>;
  startGame(
    gameType: string,
    metadata?: Record<string, unknown>,
    eventData?: Record<string, unknown>
  ): string;
  enqueueEvent(gameId: string, event: EnqueueEventInput): void;
  completeGame(gameId: string, summary: CompleteSummary, eventData?: Record<string, unknown>): void;
  /**
   * Throw away a game the player never started (#2619): forget its pending
   * record and drop its queued events, so it is neither completed nor left
   * pending. Later events for the id are dropped like any unknown game's.
   */
  discardGame(gameId: string): void;
  reportBug(
    level: BugLevel,
    source: string,
    message: string,
    context?: Record<string, unknown>
  ): void;
  getQueueStats(): Promise<QueueStats>;
  clearAll(): Promise<void>;
}

export class GameEventClientImpl implements GameEventClient {
  constructor(
    private readonly store: EventStore = eventStore,
    private readonly games: PendingGamesStore = pendingGamesStore,
    private readonly limiter: BugReportLimiter = bugReportLimiter
  ) {}

  async init(): Promise<void> {
    await this.games.init();
  }

  /** Returns the new game id synchronously. */
  startGame(
    gameType: string,
    metadata: Record<string, unknown> = {},
    eventData?: Record<string, unknown>
  ): string {
    const gameId = generateUUID();
    // Persist pending-game state synchronously in-memory, async to disk.
    // The event below grabs event_index 0 and we rely on the in-memory
    // counter being correct the moment startGame returns.
    this.fireAndForget(this.games.create(gameId, gameType, metadata), "startGame.create");
    // Reserve event_index 0 for a game_started event so the SyncWorker
    // can tell when a game was opened even before any play happened.
    this.enqueueEventInternal(gameId, {
      type: "game_started",
      data: eventData ?? { game_type: gameType, metadata },
    });
    return gameId;
  }

  enqueueEvent(gameId: string, event: EnqueueEventInput): void {
    this.enqueueEventInternal(gameId, event);
  }

  completeGame(
    gameId: string,
    summary: CompleteSummary,
    eventData?: Record<string, unknown>
  ): void {
    this.enqueueEventInternal(gameId, {
      type: "game_ended",
      data: eventData ?? (summary as Record<string, unknown>),
    });
    this.fireAndForget(this.games.complete(gameId, summary), "completeGame.mark");
  }

  discardGame(gameId: string): void {
    // forget() drops the in-memory record synchronously, so nothing new can be
    // enqueued for this game; deleteByGameId() runs behind any enqueue already
    // queued on the store's lock, so it also removes game_started.
    this.fireAndForget(this.games.forget(gameId), "discardGame.forget");
    this.fireAndForget(this.store.deleteByGameId(gameId), "discardGame.events");
  }

  reportBug(
    level: BugLevel,
    source: string,
    message: string,
    context: Record<string, unknown> = {}
  ): void {
    if (!this.limiter.tryConsume(source)) {
      // Dropped — emit a Sentry counter so we can see runaway sources.
      Sentry.addBreadcrumb({
        category: "reportBug.dropped",
        message: `rate-limited: ${source}`,
        level: "warning",
      });
      return;
    }
    const bugUuid = generateUUID();
    this.fireAndForget(
      this.store.enqueueBugLog({
        bug_uuid: bugUuid,
        bug_level: level,
        bug_source: source,
        payload: { message, context },
      }),
      "reportBug.enqueue"
    );
  }

  getQueueStats(): Promise<QueueStats> {
    return this.store.stats();
  }

  async clearAll(): Promise<void> {
    await this.store.clearAll();
    await this.games.clearAll();
    this.limiter.reset();
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private enqueueEventInternal(gameId: string, event: EnqueueEventInput): void {
    const idx = this.games.nextEventIndex(gameId);
    if (idx === null) {
      // Game not registered (or already completed) — treat as a drop and
      // breadcrumb for visibility. Not a bug log; bug logs are reserved for
      // caller-reported issues.
      Sentry.addBreadcrumb({
        category: "gameEventClient.dropped",
        message: `enqueueEvent on unknown game ${gameId}`,
        level: "warning",
      });
      return;
    }
    this.fireAndForget(
      this.store.enqueueEvent({
        game_id: gameId,
        event_index: idx,
        event_type: event.type,
        payload: event.data ?? {},
      }),
      "enqueueEvent"
    );
  }

  private fireAndForget(op: Promise<unknown>, label: string): void {
    op.catch((e) => {
      Sentry.captureException(e, {
        tags: { subsystem: "gameEventClient", op: label },
      });
    });
  }
}

export const gameEventClient: GameEventClient = new GameEventClientImpl();
