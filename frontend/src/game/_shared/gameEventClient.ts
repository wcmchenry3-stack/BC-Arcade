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
 *   4. Only sessions the player played reach the server (#2654) — a new
 *      game is held on the device until `markStarted()` (or a completion)
 *      marks it started; SyncWorker creates it on the server only then.
 *   5. Sessions a killed process left open are closed (#2654) — `init()`
 *      sweeps them once per process: a started one is completed as
 *      `abandoned`, an unstarted one is dropped from the device.
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
  /** Load pending games and sweep the ones a killed process left open. Once per process. */
  init(): Promise<void>;
  startGame(
    gameType: string,
    metadata?: Record<string, unknown>,
    eventData?: Record<string, unknown>
  ): string;
  /** The player acted in this session: it may now be sent to the server (#2654). */
  markStarted(gameId: string): void;
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
  private ready: Promise<void> | null = null;

  constructor(
    private readonly store: EventStore = eventStore,
    private readonly games: PendingGamesStore = pendingGamesStore,
    private readonly limiter: BugReportLimiter = bugReportLimiter
  ) {}

  init(): Promise<void> {
    if (!this.ready) {
      this.ready = this.games.init().then(() => this.sweepPreviousProcess());
    }
    return this.ready;
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
    // Reserve event_index 0 for a game_started event. Like the create, it
    // stays on the device until the player starts the game (#2654).
    this.enqueueEventInternal(gameId, {
      type: "game_started",
      data: eventData ?? { game_type: gameType, metadata },
    });
    return gameId;
  }

  markStarted(gameId: string): void {
    this.fireAndForget(this.games.markStarted(gameId), "markStarted");
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

  /**
   * Close the sessions an earlier, killed process left open (#2654). Runs once,
   * from init(), after the pending games are loaded. Only games read from disk
   * that this process did not create are touched (see
   * `PendingGamesStore.previousProcessOpenGames`), so a game started before
   * init() resolves is never swept.
   *
   * - Started (or already on the server): completed as a bare `abandoned`,
   *   the same as a useGameSync abandon with no progress snapshot. Its
   *   `completedAt` is the last time the device saw the session alive — its
   *   last event, else its start (older records have no `lastEventAt`) — not
   *   the time of this launch, which could be days later. No `durationMs` is
   *   known, so none is sent and the row's duration stays null (#2619).
   * - Unstarted: never reached the server, so it is discarded exactly like an
   *   untouched `restart()` (`discardGame`). Nothing is recorded as abandoned.
   *
   * Errors are reported, not thrown: a failed sweep must not fail init().
   */
  private async sweepPreviousProcess(): Promise<void> {
    try {
      for (const [gameId, game] of this.games.previousProcessOpenGames()) {
        if (!game.started && !game.startedSynced) {
          this.discardGame(gameId);
          continue;
        }
        const completedAt = game.lastEventAt ?? game.startedAt;
        this.enqueueEventInternal(gameId, {
          type: "game_ended",
          data: { outcome: "abandoned" },
        });
        await this.games.complete(gameId, { outcome: "abandoned" }, completedAt);
      }
    } catch (e) {
      Sentry.captureException(e, {
        tags: { subsystem: "gameEventClient", op: "sweepPreviousProcess" },
      });
    }
  }

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
