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
 *   7. The replay dial (#3279, replayDial.ts): every session's replay mode is
 *      decided once, at `startGame`, and stored on its pending game. An `off`
 *      session queues only lifecycle events. A `local` (sampled-out) session
 *      keeps its gameplay rows on the device — SyncWorker never sends them —
 *      and they are deleted when it ends, except the keep-list types
 *      (`RETENTION_KEEP_TYPES`, D5), which it uploads like lifecycle rows; its `game_ended` carries a summary
 *      instead. An error or a bug report upgrades it to `full`
 *      (`upgradeReplay`): a flag set in memory, persisted fire-and-forget.
 *
 * Errors in the fire-and-forget persistence path go to Sentry, not
 * back to the caller (the caller long forgot about the call).
 */

import * as Sentry from "@sentry/react-native";

import { eventStore, EventStore, QueueStats } from "./eventStore";
import { sentryThrottle } from "./sentryThrottle";
import { bugReportLimiter, BugReportLimiter } from "./bugReportLimiter";
import {
  BugLevel,
  Priority,
  REPLAY_UPGRADE_ORPHANS,
  logConfig,
  uploadsWhenSampledOut,
  type EventTypeOf,
} from "./eventQueueConfig";
import type { GameType } from "./types";
import {
  pendingGamesStore,
  PendingGamesStore,
  CompleteSummary,
  PendingGame,
  isOrphanResumable,
  isPlainRecord,
  replayModeOf,
} from "./pendingGamesStore";
import { decideReplay, type ReplayMode, type ReplayUpgradeReason } from "./replayDial";
import { generateUUID } from "./uuid";
import { onSentryThrottleReset } from "./sentryThrottle";
import { assertOutcomeAllowed } from "./outcomeGuard";
import {
  clearSessionTags,
  forceClearSessionTags,
  setSessionTags,
  taggedSessionGameId,
} from "./sessionTags";

export interface EnqueueEventInput<G extends GameType = GameType> {
  type: EventTypeOf<G>;
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
   * Queue several events at once (#3274): they take contiguous `event_index`
   * values, in the order given, and cost one eventStore write per priority
   * tier they touch (`EventStore.enqueueMany`). GameRecorder saves a closed
   * unit through this. Dropped, like `enqueueEvent`, for an unknown or
   * completed game.
   */
  enqueueEvents(gameId: string, events: readonly EnqueueEventInput[]): void;
  /**
   * Record the outcome override a killed-process sweep should use for this
   * game in place of `abandoned` (#2682), from the game's registered progress
   * snapshot. Only "win" is honored; pass null to clear it. `result` is the
   * snapshot's result block, if it has one: the sweep attaches it to the win
   * (#2745).
   */
  setProgressOutcome(
    gameId: string,
    outcome: "win" | null,
    result?: Record<string, unknown> | null
  ): void;
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
  /**
   * The session hit an error (#3279): a `local` (sampled-out) session becomes
   * `full`, so its replay uploads after all, and `reason` is kept for its
   * `game_ended` summary. Nothing for an `off` or `full` session, a completed
   * one, an unknown id or null. Synchronous and cheap — safe in Sentry's
   * `beforeSend`: one map lookup, and on the first upgrade one fire-and-forget
   * write. It never reports to Sentry.
   */
  upgradeReplay(gameId: string | null | undefined, reason: ReplayUpgradeReason): void;
  getQueueStats(): Promise<QueueStats>;
  clearAll(): Promise<void>;
}

// One breadcrumb per unknown game id per session (#3293); cleared with the Sentry throttle.
const unknownGameBreadcrumbed = new Set<string>();
// Hard cap: a long session that keeps hitting new unknown ids must not grow this Set
// without bound. Once full, new ids are no longer breadcrumbed (breadcrumbs are best-effort).
const UNKNOWN_GAME_BREADCRUMB_MAX = 500;
onSentryThrottleReset(() => unknownGameBreadcrumbed.clear());

/** How long the startup sweep waits for `crashedLastRun()` before treating it as unknown. */
const CRASH_CHECK_TIMEOUT_MS = 2000;

function isLifecycle(eventType: string): boolean {
  return logConfig.priorityForEvent("game_event", eventType) === Priority.LIFECYCLE;
}

/** Where the client gets a new session's replay mode and the last run's crash state (#3279). */
export interface ReplayHooks {
  decide(gameType: string, gameId: string): ReplayMode;
  /** `Sentry.crashedLastRun()`: true when the previous process crashed, null when unknown. */
  crashedLastRun(): Promise<boolean | null>;
}

const defaultReplayHooks: ReplayHooks = {
  decide: decideReplay,
  crashedLastRun: async () => {
    // Absent where Sentry is not native (web, tests): unknown, so no upgrade.
    const crashed = (Sentry as { crashedLastRun?: () => Promise<boolean | null> }).crashedLastRun;
    return typeof crashed === "function" ? crashed() : null;
  },
};

/** The `game_ended` data with the session's replay summary merged in (#3279). */
function withReplaySummary(
  game: PendingGame | undefined,
  data: Record<string, unknown>
): Record<string, unknown> {
  const mode = game ? replayModeOf(game) : "off";
  if (!game || mode === "off") return data;
  // The recorder's counts (`useGameRecorder.complete`), when the game records.
  const counts = isPlainRecord(data.replay) ? data.replay : {};
  const block: Record<string, unknown> = { ...counts, m: mode === "local" ? "s" : "f" };
  if (game.replayUpgrade) block.up = game.replayUpgrade;
  return { ...data, replay: block };
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
    private readonly limiter: BugReportLimiter = bugReportLimiter,
    private readonly replay: ReplayHooks = defaultReplayHooks
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
    // counter being correct the moment startGame returns. The replay mode is
    // decided here, once, from the dial held now (#3279).
    const replay = this.replay.decide(gameType, gameId);
    this.fireAndForget(this.games.create(gameId, gameType, metadata, replay), "startGame.create");
    // Reserve event_index 0 for a game_started event. Like the create, it
    // stays on the device until the player starts the game (#2654).
    this.enqueueEventInternal(gameId, {
      type: "game_started",
      data: eventData ?? { game_type: gameType, metadata },
    });
    setSessionTags(gameId, gameType, metadata);
    return gameId;
  }

  resumeGame(gameType: string, match?: Record<string, unknown>): string | null {
    const gameId = this.games.adoptOrphan(gameType, Date.now(), match);
    // The player can continue only one; any other orphan of the type is over.
    if (gameId !== null) {
      this.abandonOrphans(gameType);
      setSessionTags(gameId, gameType, this.games.get(gameId)?.metadata);
    }
    return gameId;
  }

  markStarted(gameId: string): void {
    this.onStarting(gameId);
    this.fireAndForget(this.games.markStarted(gameId), "markStarted", gameId);
  }

  enqueueEvent(gameId: string, event: EnqueueEventInput): void {
    this.enqueueEventInternal(gameId, event);
  }

  enqueueEvents(gameId: string, all: readonly EnqueueEventInput[]): void {
    // An `off` session (#3279) queues lifecycle events only.
    const events = this.isReplayOff(gameId) ? all.filter((e) => isLifecycle(e.type)) : all;
    if (events.length === 0) return;
    // Reserved synchronously, one after another, so nothing can take an index
    // between two of them: the batch's indexes are contiguous.
    // `batch` runs its callback synchronously and writes the counter once.
    const rows: Parameters<EventStore["enqueueMany"]>[0][number][] = [];
    let known = true;
    const counted = this.games.batch(() => {
      for (const event of events) {
        const idx = this.games.nextEventIndex(gameId);
        if (idx === null) {
          // Unknown or completed game: the first reservation already fails,
          // so nothing was taken.
          known = false;
          return;
        }
        rows.push({
          game_id: gameId,
          event_index: idx,
          event_type: event.type,
          payload: event.data ?? {},
        });
      }
    });
    this.fireAndForget(counted, "enqueueEvents.counter");
    if (!known) {
      // As enqueueEvent: one breadcrumb per unknown game id per session (#3293).
      if (
        !unknownGameBreadcrumbed.has(gameId) &&
        unknownGameBreadcrumbed.size < UNKNOWN_GAME_BREADCRUMB_MAX
      ) {
        unknownGameBreadcrumbed.add(gameId);
        Sentry.addBreadcrumb({
          category: "gameEventClient.dropped",
          message: "enqueueEvents on unknown game",
          data: { gameId },
          level: "warning",
        });
      }
      return;
    }
    this.fireAndForget(this.store.enqueueMany(rows), "enqueueEvents", gameId);
  }

  setProgressOutcome(
    gameId: string,
    outcome: "win" | null,
    result?: Record<string, unknown> | null
  ): void {
    this.fireAndForget(
      this.games.setProgressOutcome(gameId, outcome, result),
      "setProgressOutcome"
    );
  }

  completeGame(
    gameId: string,
    summary: CompleteSummary,
    eventData?: Record<string, unknown>,
    options: CompleteOptions = {}
  ): void {
    try {
      // Every completion goes through here, the killed-session sweep's
      // included (#2654): a game with no winner never records a result (#2642).
      const game = this.games.get(gameId);
      const gameType = game?.gameType;
      if (gameType !== undefined)
        assertOutcomeAllowed(gameType, summary.outcome, "client.completeGame");
      this.onStarting(gameId);
      // Event first: its enqueue is on the event store's lock before the game is
      // marked completed, so SyncWorker's outstanding-events check sees it and
      // the PATCH waits for it.
      this.enqueueEventInternal(gameId, {
        type: "game_ended",
        data: withReplaySummary(game, eventData ?? (summary as Record<string, unknown>)),
      });
      this.fireAndForget(
        this.games.complete(gameId, summary, options.completedAt),
        "completeGame.mark",
        gameId
      );
      // A sampled-out session's gameplay rows were never going to be sent
      // (#3279): drop them now, behind every enqueue already queued. Its
      // lifecycle rows (game_ended included) and keep-list rows (D5) stay and
      // sync. A failed delete is left to the queue's TTL sweep.
      if (game && replayModeOf(game) === "local") {
        this.fireAndForget(
          this.store.deleteByGameIds([gameId], uploadsWhenSampledOut),
          "completeGame.dropLocalReplay",
          gameId
        );
      }
    } finally {
      // Even when the above throws, the session is over for the tags.
      clearSessionTags(gameId);
    }
  }

  discardGame(gameId: string): void {
    clearSessionTags(gameId);
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
    // The open game hit a bug (#3279): its replay uploads in full, whether or
    // not this report gets past the limiter below.
    this.upgradeReplay(taggedSessionGameId(), "bug");
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
    // The open game, if any, so a bug report leads to its events (#3277).
    // A game_id the caller passed wins.
    const openGameId = taggedSessionGameId();
    let payload: Record<string, unknown> = { message, context };
    if (openGameId) {
      // Only if it still fits the store's bug-log cap: the id must never push
      // a record that fit over it (that would store a truncation stub).
      const merged = { message, context: { game_id: openGameId, ...context } };
      try {
        if (JSON.stringify(merged).length <= logConfig.MAX_BUG_CONTEXT_BYTES) payload = merged;
      } catch {
        // Unserializable context (a cycle, a BigInt): leave it to the store,
        // whose enqueue handles and reports it as before.
      }
    }
    this.fireAndForget(
      this.store.enqueueBugLog({
        bug_uuid: bugUuid,
        bug_level: level,
        bug_source: source,
        payload,
      }),
      "reportBug.enqueue"
    );
  }

  upgradeReplay(gameId: string | null | undefined, reason: ReplayUpgradeReason): void {
    if (!gameId) return;
    const game = this.games.get(gameId);
    if (!game || game.completed || replayModeOf(game) !== "local") return;
    // `update` changes the record synchronously; only the write is deferred.
    // pendingGamesStore reports a failed write itself, so nothing is caught here.
    void this.games.update(gameId, { replay: "full", replayUpgrade: reason });
  }

  getQueueStats(): Promise<QueueStats> {
    return this.store.stats();
  }

  async clearAll(): Promise<void> {
    // Pending games first: their clear runs init(), whose startup sweep can
    // enqueue a `game_ended` for a killed process's game. Those enqueues are
    // queued on the event store's lock ahead of the clear below, so it drops
    // them too (#3325 review). And a failure between the two leaves only
    // events with no game, never a game that still syncs.
    await this.games.clearAll();
    // The tagged game was just deleted: untag it now, before the fallible
    // event-store clear below (#3277).
    forceClearSessionTags();
    await this.store.clearAll();
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
      // Before anything below abandons one: an upgraded orphan keeps its rows.
      await this.upgradeCrashedOrphans();
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
   * Upgrade to `full` the sampled-out session the previous process was in when
   * it crashed (#3279, owner decision D2 = `REPLAY_UPGRADE_ORPHANS`): with
   * `"after_crash"`, only when `crashedLastRun()` is true, and only the most
   * recently active `local` orphan; with `"every_kill"`, every `local` orphan.
   * The crash state is read only when there is such an orphan, so a normal
   * launch makes no native call. Unknown (null, or the call fails) is no crash.
   */
  private async upgradeCrashedOrphans(): Promise<void> {
    const local = this.games
      .previousProcessOpenGames()
      .filter(([, game]) => game.started && replayModeOf(game) === "local");
    if (local.length === 0) return;
    if (REPLAY_UPGRADE_ORPHANS === "every_kill") {
      for (const [gameId] of local) this.upgradeReplay(gameId, "crash");
      return;
    }
    // Bounded: init() (and so every flush) waits on this sweep.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), CRASH_CHECK_TIMEOUT_MS);
    });
    let crashed: boolean | null = null;
    try {
      crashed = await Promise.race([this.replay.crashedLastRun(), timeout]);
    } catch {
      crashed = null;
    } finally {
      clearTimeout(timer);
    }
    if (crashed !== true) return;
    const lastSeen = (game: PendingGame) => game.lastEventAt ?? game.startedAt;
    const latest = local.reduce((a, b) => (lastSeen(b[1]) > lastSeen(a[1]) ? b : a));
    this.upgradeReplay(latest[0], "crash");
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
   * state) falls back to `abandoned`. A win carries the result block persisted
   * with it, when the game kept one (#2745: Blackjack's closing chips, which
   * the server scores); a plain object only, else no result. An abandon
   * carries none, as before.
   * Its `completedAt` is the last time the device saw the session alive — its
   * last event, else its start (older records have no `lastEventAt`) — not the
   * time of this launch, which could be days later. No `durationMs` is known,
   * so none is sent and the row's duration stays null (#2619).
   */
  private abandonOrphan(gameId: string, game: PendingGame): void {
    const completedAt = game.lastEventAt ?? game.startedAt;
    const outcome = game.progressOutcome === "win" ? "win" : "abandoned";
    const summary: CompleteSummary = { outcome };
    if (outcome === "win" && isPlainRecord(game.progressResult)) {
      summary.result = { ...game.progressResult };
    }
    this.completeGame(gameId, summary, undefined, { completedAt });
  }

  /** The game's replay is off (#3279): its gameplay events are not even queued. */
  private isReplayOff(gameId: string): boolean {
    const game = this.games.get(gameId);
    return game !== undefined && replayModeOf(game) === "off";
  }

  private enqueueEventInternal(gameId: string, event: EnqueueEventInput): void {
    if (!isLifecycle(event.type) && this.isReplayOff(gameId)) return;
    const idx = this.games.nextEventIndex(gameId);
    if (idx === null) {
      // Game not registered (or already completed) — treat as a drop and
      // breadcrumb for visibility. Not a bug log; bug logs are reserved for
      // caller-reported issues.
      if (
        !unknownGameBreadcrumbed.has(gameId) &&
        unknownGameBreadcrumbed.size < UNKNOWN_GAME_BREADCRUMB_MAX
      ) {
        unknownGameBreadcrumbed.add(gameId);
        Sentry.addBreadcrumb({
          category: "gameEventClient.dropped",
          message: "enqueueEvent on unknown game",
          data: { gameId },
          level: "warning",
        });
      }
      return;
    }
    this.fireAndForget(
      this.store.enqueueEvent({
        game_id: gameId,
        event_index: idx,
        event_type: event.type,
        payload: event.data ?? {},
      }),
      "enqueueEvent",
      gameId
    );
  }

  /**
   * `gameId` is the game the operation belongs to, captured now: the failure
   * is reported later, when the scope's `game.id` tag may already be cleared
   * or name another game (#3277). It rides as a tag, never in a message.
   */
  private fireAndForget(op: Promise<unknown>, label: string, gameId?: string): void {
    op.catch((e) => {
      // Throttled (#3351): a store that keeps failing would otherwise send one
      // event per enqueue. One per op per session, within the shared hourly
      // error budget; the id is a tag only, never in the key or fingerprint.
      if (!sentryThrottle.allow(`gameEventClient.${label}`, "error")) return;
      Sentry.captureException(e, {
        fingerprint: ["gameEventClient", label],
        tags: gameId
          ? { subsystem: "gameEventClient", op: label, "game.id": gameId }
          : { subsystem: "gameEventClient", op: label },
      });
    });
  }
}

export const gameEventClient: GameEventClient = new GameEventClientImpl();
