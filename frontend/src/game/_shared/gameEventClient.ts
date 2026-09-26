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
 *   5. Sessions a killed process left open ("orphans") are resolved (#2654):
 *      an unstarted one is dropped from the device at startup; a started one
 *      is continued if its screen restores the game (`resumeGame`), and
 *      abandoned when the player starts a fresh game of that type instead,
 *      or at a later launch once it is 24 h old. See `sweepPreviousProcess`.
 *   6. An orphan the sweep abandons records `win`, not `abandoned`, when the
 *      game already reported one via `setProgressOutcome` (#2682) — e.g.
 *      Blackjack's run already reached its goal. See `abandonOrphan`.
 *
 * Errors in the fire-and-forget persistence path go to Sentry, not
 * back to the caller (the caller long forgot about the call).
 */

import * as Sentry from "@sentry/react-native";

import { eventStore, EventStore, QueueStats } from "./eventStore";
import { bugReportLimiter, BugReportLimiter } from "./bugReportLimiter";
import { BugLevel } from "./eventQueueConfig";
import {
  pendingGamesStore,
  PendingGamesStore,
  CompleteSummary,
  PendingGame,
  isOrphanResumable,
} from "./pendingGamesStore";
import { generateUUID } from "./uuid";
import { assertOutcomeAllowed } from "./outcomeGuard";

export interface EnqueueEventInput {
  type: string;
  data?: Record<string, unknown>;
}

export interface CompleteOptions {
  /** When the game ended, epoch ms. Defaults to now. */
  completedAt?: number;
}

export interface GameEventClient {
  /** Load pending games and sweep the ones a killed process left open. Once per process. */
  init(): Promise<void>;
  startGame(
    gameType: string,
    metadata?: Record<string, unknown>,
    eventData?: Record<string, unknown>
  ): string;
  /**
   * Continue the session a killed process left open for `gameType` (#2654),
   * for a screen restoring that game's saved progress. Returns its id — already
   * started and on its way to the server, so no new create and no
   * `game_started` — or null when there is none (or the pending games are not
   * loaded yet); the caller then starts a new session as usual. `match`
   * narrows it to a session whose metadata has those values.
   */
  resumeGame(gameType: string, match?: Record<string, unknown>): string | null;
  /**
   * The player acted in this session: it may now be sent to the server
   * (#2654). The first time, it also abandons the killed process's sessions of
   * this game type — the player chose a fresh game over resuming them.
   */
  markStarted(gameId: string): void;
  enqueueEvent(gameId: string, event: EnqueueEventInput): void;
  /**
   * Record the outcome override a killed-process sweep should use for this
   * game in place of `abandoned` (#2682), from the game's registered progress
   * snapshot. Only "win" is honored; pass null to clear it.
   */
  setProgressOutcome(gameId: string, outcome: "win" | null): void;
  /**
   * Finish a game: queue its `game_ended` event, then mark it completed, so
   * SyncWorker sends the event before the PATCH. An unstarted game is marked
   * started first (see `markStarted`).
   */
  completeGame(
    gameId: string,
    summary: CompleteSummary,
    eventData?: Record<string, unknown>,
    options?: CompleteOptions
  ): void;
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
  /**
   * Game types a fresh session was started for before the pending games were
   * loaded, when their orphans were not known yet; the sweep abandons those.
   */
  private readonly startedBeforeLoad = new Set<string>();

  constructor(
    private readonly store: EventStore = eventStore,
    private readonly games: PendingGamesStore = pendingGamesStore,
    private readonly limiter: BugReportLimiter = bugReportLimiter
  ) {
    // The store runs the sweep inside its own init(), which SyncWorker awaits
    // before flushing — so no flush runs between the load and the sweep.
    games.setStartupSweep(() => this.sweepPreviousProcess());
  }

  init(): Promise<void> {
    return this.games.init();
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

  resumeGame(gameType: string, match?: Record<string, unknown>): string | null {
    const gameId = this.games.adoptOrphan(gameType, Date.now(), match);
    // The player can continue only one; any other orphan of the type is over.
    if (gameId !== null) this.abandonOrphans(gameType);
    return gameId;
  }

  markStarted(gameId: string): void {
    this.onStarting(gameId);
    this.fireAndForget(this.games.markStarted(gameId), "markStarted");
  }

  enqueueEvent(gameId: string, event: EnqueueEventInput): void {
    this.enqueueEventInternal(gameId, event);
  }

  setProgressOutcome(gameId: string, outcome: "win" | null): void {
    this.fireAndForget(this.games.setProgressOutcome(gameId, outcome), "setProgressOutcome");
  }

  completeGame(
    gameId: string,
    summary: CompleteSummary,
    eventData?: Record<string, unknown>,
    options: CompleteOptions = {}
  ): void {
    // Every completion goes through here, the killed-session sweep's
    // included (#2654): a game with no winner never records a result (#2642).
    const gameType = this.games.get(gameId)?.gameType;
    if (gameType !== undefined)
      assertOutcomeAllowed(gameType, summary.outcome, "client.completeGame");
    this.onStarting(gameId);
    // Event first: its enqueue is on the event store's lock before the game is
    // marked completed, so SyncWorker's outstanding-events check sees it and
    // the PATCH waits for it.
    this.enqueueEventInternal(gameId, {
      type: "game_ended",
      data: eventData ?? (summary as Record<string, unknown>),
    });
    this.fireAndForget(
      this.games.complete(gameId, summary, options.completedAt),
      "completeGame.mark"
    );
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
   * Resolve the sessions an earlier, killed process left open (#2654). The
   * store runs this once, inside its init(), right after the load. Only games
   * read from disk that this process neither created nor adopted are touched
   * (`PendingGamesStore.previousProcessOpenGames`), so a game started before
   * init() resolves is never swept.
   *
   * - Unstarted: never reached the server, so it is discarded exactly like an
   *   untouched `restart()`. Nothing is recorded as abandoned.
   * - Started, under 24 h old: kept. Its screen may restore the game and
   *   continue the session (`resumeGame`); a fresh game of the type abandons
   *   it (`markStarted`); a later launch abandons it once it is 24 h old.
   * - Started, 24 h old or more (the server's own sweep age, #2621), or of a
   *   type the player already started a fresh game of: abandoned.
   *
   * Every change is written once (`batch`), and the discarded games' events
   * are deleted in one pass.
   */
  private async sweepPreviousProcess(): Promise<void> {
    const now = Date.now();
    const untouched: string[] = [];
    try {
      await this.games.batch(() => {
        for (const [gameId, game] of this.games.previousProcessOpenGames()) {
          if (!game.started) {
            untouched.push(gameId);
            void this.games.forget(gameId);
          } else if (!isOrphanResumable(game, now) || this.startedBeforeLoad.has(game.gameType)) {
            this.abandonOrphan(gameId, game);
          }
        }
      });
      this.startedBeforeLoad.clear();
      await this.store.deleteByGameIds(untouched);
    } catch (e) {
      Sentry.captureException(e, {
        tags: { subsystem: "gameEventClient", op: "sweepPreviousProcess" },
      });
    }
  }

  /**
   * A session is about to count as started (`markStarted`, or a completion).
   * If it is a fresh one, the player chose it over resuming the killed
   * process's sessions of this type, so those are abandoned — now, or by the
   * sweep if they are not loaded yet.
   */
  private onStarting(gameId: string): void {
    const game = this.games.get(gameId);
    if (!game || game.started) return;
    if (this.games.isLoaded()) this.abandonOrphans(game.gameType);
    else this.startedBeforeLoad.add(game.gameType);
  }

  /** Abandon every started orphan of `gameType`, with one write. */
  private abandonOrphans(gameType: string): void {
    const orphans = this.games
      .previousProcessOpenGames()
      .filter(([, game]) => game.gameType === gameType && game.started);
    if (orphans.length === 0) return;
    this.fireAndForget(
      this.games.batch(() => {
        for (const [gameId, game] of orphans) this.abandonOrphan(gameId, game);
      }),
      "abandonOrphans"
    );
  }

  /**
   * Close an orphan through the normal completion path: `abandoned`, unless
   * its progress snapshot already reported a win (#2682) — e.g. Blackjack's
   * run reached its goal before the process was killed — in which case it
   * records `win` instead, so the streak and stats it earned are not lost.
   * Only "win" is trusted; anything else on disk (an older build, corrupt
   * state) falls back to `abandoned`.
   * Its `completedAt` is the last time the device saw the session alive — its
   * last event, else its start (older records have no `lastEventAt`) — not the
   * time of this launch, which could be days later. No `durationMs` is known,
   * so none is sent and the row's duration stays null (#2619).
   */
  private abandonOrphan(gameId: string, game: PendingGame): void {
    const completedAt = game.lastEventAt ?? game.startedAt;
    const outcome = game.progressOutcome === "win" ? "win" : "abandoned";
    this.completeGame(gameId, { outcome }, undefined, { completedAt });
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
