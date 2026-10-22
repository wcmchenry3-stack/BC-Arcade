/**
 * SyncWorker — drains the local event queue to the backend (367c).
 *
 * ┌──────────────────────── server-confirmed deletion ────────────────────────┐
 * │ A row leaves eventStore (deleteByIds) only when the server accepts it     │
 * │ (2xx), or on the one benign 409 "Game is already completed." Every other  │
 * │ terminal 4xx DEAD-LETTERS the row instead: markDeadLettered flags it, it  │
 * │ stays in the queue until eviction or TTL, and peek() skips it.            │
 * │ 429/5xx/network keep the row for a later retry. Tests spy on              │
 * │ eventStore.deleteByIds and markDeadLettered during simulated 4xx/5xx.     │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Flush algorithm (one pass):
 *
 *   0. Resolve the session id before anything is sent (#3325, ensureSession):
 *      a re-key of a legacy id, which drops the old player's queue, finishes
 *      before this pass sends any game or row read before it, so no old row
 *      goes out under the new id. No id (no CSPRNG, a failed re-key or a
 *      storage error) → global backoff, nothing sent.
 *      And wait for the pending games to load from disk, and for the startup
 *      sweep of a killed process's sessions (#2654) that runs inside the
 *      store's init(): no queued event is read as belonging to a game that
 *      simply isn't loaded yet, and no flush acts on a game the sweep is
 *      about to discard or abandon.
 *
 *   1. For each pending game with started=true and startedSynced=false:
 *        POST /games { id, game_type, metadata }
 *        A game the player hasn't started (#2654) is skipped: its create and
 *        events stay on the device until markStarted() or a completion.
 *        - 2xx → markStartedSynced
 *        - 404 → should not happen (we created the id); dead-letter + log
 *        - 4xx → dead-letter the pending game
 *        - 429/5xx/network → set global backoff and stop this flush
 *
 *   Then one snapshot of the queue (#2959): a single `peek` of every live
 *   row, bucketed by game, plus the bug logs. Steps 2–4 work from it — the
 *   queue is not re-read per game or per step.
 *
 *   2. For each pending game with startedSynced=true, batch its events
 *      from the snapshot and POST /games/:id/events. A session open in the
 *      foreground holds its gameplay events (#3275, see "Holding" below):
 *      only its lifecycle rows go out.
 *        - 2xx → delete the sent rows
 *        - 404 → game got lost on the server; re-flip startedSynced=false
 *          and preserve events (they'll retry on the next flush). At most
 *          `MAX_GAME_REFLIPS` times per game (#3492, count persisted, reset
 *          when an event batch is accepted); then the game and its rows are
 *          dead-lettered and forgotten.
 *        - 413 → split batch in half, retry halves; single-row 413 →
 *          dead-letter that row
 *        - 409 "Game is already completed." → the game was completed before
 *          these events arrived (a completion that got there first). Not the
 *          stale-session sweep: a swept row still accepts events (#2621).
 *          Expected: drop the rows quietly — no Sentry error, no dead-letter.
 *          The completion still goes out in step 3.
 *        - 400/403 → dead-letter those rows; Sentry with high severity
 *          for 403 (session mismatch shouldn't happen)
 *        - 429/5xx/network → set per-row backoff and stop
 *
 *   3. For each pending game with completed=true, completeSynced=false,
 *      and no remaining events in the queue:
 *        PATCH /games/:id/complete { ...summary }
 *        - 2xx → markCompleteSynced; forget() the game
 *        - 404 → re-flip startedSynced=false (like step 2, same cap)
 *        - other → same mapping as step 2
 *      "No remaining events" is read off the snapshot: every row of the game
 *      the snapshot held was resolved in step 2, and the game was already
 *      completed when the snapshot was taken (so its `game_ended`, queued
 *      ahead of the snapshot's peek on the store's lock, is in it). A game
 *      completed after the snapshot waits for the next pass.
 *
 *   4. Batch pending bug logs and POST /logs/bug:
 *        Same mapping as step 2 (no 404 applies).
 *
 * Backoff:
 *   - Global backoff after 5xx/network: exponential 1s→30min, reset on
 *     next 2xx. Set via `this.backoffUntil` and checked at entry.
 *   - Per-row next_retry_at after 429: honors Retry-After header.
 *   Every 429/5xx/network response goes through `transientFailure`.
 *
 * Schedule (#2959): `start()` runs a flush every SYNC_INTERVAL_MS while the
 * app is active. The interval is torn down when AppState becomes
 * `background` or `inactive` — nothing wakes the device to read an empty
 * queue — and on return to `active` one flush runs at once and the interval
 * is re-armed. NetworkContext also flushes on reconnect. Going to
 * `background` (not `inactive`: a notification-shade pull is no reason to
 * wake the radio) runs one releasing flush (#3275, below) as it pauses.
 *
 * Holding (#3275): radio wake-ups dominate network battery cost, so the
 * gameplay events of a session being played are not uploaded every 30 s.
 * While the app is in the foreground (`isAppInterrupted` false) a game that
 * is open — not completed, and this process's own (an earlier process's
 * game is played by nobody, so a killed session's rows go out at relaunch) —
 * sends only its lifecycle rows (`Priority.LIFECYCLE`: game_started,
 * hand_resolved, game_ended), at their usual time. The rest wait until:
 *   - the session completes (it is no longer open);
 *   - the app goes to the background (`flush({ releaseHeld: true })`);
 *   - its oldest held row is `GAMEPLAY_HOLD_MAX_MS` old (all its rows go).
 * Held rows are live rows: TTL, eviction, per-row backoff and dead-lettering
 * treat them as before, and the fallback keeps the hold far below TTL_MS.
 *
 * Sampling (#3279): a `local` session (the replay dial sampled it out,
 * replayDial.ts) sends only its lifecycle rows and its keep-list rows
 * (`RETENTION_KEEP_TYPES`, e.g. Star Swarm's `wave_completed`, D5; held
 * like any gameplay row while it is open, above), in every case — completed,
 * backgrounded, a previous process's — and its other rows never count as
 * outstanding, so they never block its PATCH /complete. They are deleted
 * just before that PATCH (step 3, so also for a session a killed process
 * completed), or, with no network needed, on any pass (a backoff included)
 * once the session completed `LATE_UPGRADE_GRACE_MS` ago, or when the
 * server refuses the game for good. Until then an error report, even one
 * that arrives after the game ended, can upgrade it to `full`, and they go
 * out as above. Every delete first marks the game `replayFinal` (persisted),
 * which refuses any later upgrade, so a `full` session's rows are never
 * deleted. A session upgraded between steps 2 and 3 of a pass completes on
 * the next pass, after its rows.
 */

import * as Sentry from "@sentry/react-native";

import { captureThrottledMessage, sentryThrottle } from "./sentryThrottle";
import { AppState, type AppStateStatus } from "react-native";

import { isAppInterrupted } from "./appInterrupted";
import {
  GAMEPLAY_HOLD_MAX_MS,
  LATE_UPGRADE_GRACE_MS,
  Priority,
  logConfig,
  uploadsWhenSampledOut,
} from "./eventQueueConfig";
import { BugLogRow, EventStore, GameEventRow, Row, eventStore } from "./eventStore";
import {
  PendingGame,
  PendingGamesStore,
  pendingGamesStore,
  replayModeOf,
} from "./pendingGamesStore";
import { getOrCreateSessionId } from "./session";
import { SyncApi, SyncResponse, syncApi } from "./syncApi";

/** No session id for this pass (#3303/#3325): backs off like a network failure. */
const NO_SESSION: SyncResponse = { status: 0, ok: false, retryAfterMs: null, body: null };

export interface FlushResult {
  attempted: number;
  accepted: number;
  duplicates: number;
  deadLettered: number;
  /** Rows parked for long-backoff retry (e.g. unknown_event_type). */
  parked: number;
  backoffMs: number;
}

export interface FlushOptions {
  /**
   * Send the gameplay events an open foreground session holds (#3275): the
   * app is leaving the foreground. Implied when AppState is already
   * interrupted at the time of the flush.
   */
  releaseHeld?: boolean;
}

/**
 * The `duration_ms` sent on PATCH /complete (#2619). Only the game's own
 * active-time measurement counts as play time: a reported duration > 0 is
 * sent (rounded to whole ms, since the server field is an int). Anything
 * else — 0, null, missing, negative or not finite — is sent as `null`,
 * meaning "unknown".
 *
 * The duration is never derived from the pending game's `startedAt` /
 * `completedAt`: wall-clock time counts idle and backgrounded time as play
 * (a Daily Word left open all day would record 12 h). A negative value must
 * never reach the server either — `duration_ms` is `Field(ge=0)`, so it would
 * 400 the whole completion and lose the score.
 */
export function resolveDurationMs(durationMs: number | null | undefined): number | null {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) return null;
  const ms = Math.round(durationMs);
  return ms > 0 ? ms : null;
}

/**
 * The detail of the backend's 409 on POST /games/:id/events for a game whose
 * row is already completed (`backend/games/sessions.py`, `append_events`).
 */
const GAME_ALREADY_COMPLETED_DETAIL = "Game is already completed.";

/** What a sampled-out session sends (#3279): lifecycle and keep-list rows (D5). */
function sampledOutRows(events: GameEventRow[]): GameEventRow[] {
  return events.filter(uploadsWhenSampledOut);
}

function isAlreadyCompleted(res: { status: number; body: unknown }): boolean {
  return (
    res.status === 409 &&
    (res.body as { detail?: unknown } | null)?.detail === GAME_ALREADY_COMPLETED_DETAIL
  );
}

const EMPTY: FlushResult = {
  attempted: 0,
  accepted: 0,
  duplicates: 0,
  deadLettered: 0,
  parked: 0,
  backoffMs: 0,
};

/** One pass's view of the queue (#2959): a single `peek`, bucketed. */
interface QueueSnapshot {
  byGame: Map<string, GameEventRow[]>;
  bugLogs: BugLogRow[];
  /** Games whose snapshot rows step 2 has not (yet) resolved. */
  outstanding: Set<string>;
  /** Games already completed when the snapshot was taken (see step 3). */
  completedAtSnapshot: Set<string>;
  /** Open foreground sessions hold their gameplay events this pass (#3275). */
  holding: boolean;
  /** Games sampled out (`local`, #3279) when the snapshot was taken: steps 2–3 treat them alike. */
  sampledOut: Set<string>;
}

export class SyncWorker {
  private flushInProgress = false;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private appStateSub: { remove: () => void } | null = null;
  private backoffUntil = 0;
  private backoffExponent = 0;
  /** A releasing flush was asked for while another flush ran (#3275). */
  private releasePending = false;
  /** The releasing flush of this trip to the background has run. */
  private backgroundFlushed = false;
  /** The session id was resolved once in this process (see ensureSession). */
  private sessionChecked = false;
  /** Sampled-out games whose gameplay rows this process deleted (#3279). */
  private readonly sampledOutDropped = new Set<string>();

  constructor(
    private readonly store: EventStore = eventStore,
    private readonly games: PendingGamesStore = pendingGamesStore,
    private readonly api: SyncApi = syncApi,
    private readonly sessionId: () => Promise<string> = getOrCreateSessionId
  ) {}

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Run the periodic flush while the app is active. Idempotent. Started in the
   * background, the interval waits for the next `active`.
   */
  start(): void {
    if (this.appStateSub === null) {
      this.appStateSub = AppState.addEventListener("change", this.onAppStateChange);
    }
    if (!isAppInterrupted(AppState.currentState)) this.armInterval();
  }

  stop(): void {
    this.disarmInterval();
    if (this.appStateSub !== null) {
      this.appStateSub.remove();
      this.appStateSub = null;
    }
  }

  /** Inspect the current global backoff deadline (epoch ms). 0 = no backoff. */
  getBackoffUntil(): number {
    return this.backoffUntil;
  }

  private readonly onAppStateChange = (next: AppStateStatus): void => {
    if (this.appStateSub === null) return; // stopped: a late event changes nothing
    if (isAppInterrupted(next)) {
      this.disarmInterval();
      // Once per trip to the background: send what open sessions hold.
      if (next === "background" && !this.backgroundFlushed) {
        this.backgroundFlushed = true;
        this.flush(Date.now(), { releaseHeld: true }).catch((e) => {
          Sentry.captureException(e, {
            tags: { subsystem: "syncWorker", op: "appState.background" },
          });
        });
      }
      return;
    }
    this.backgroundFlushed = false;
    if (this.intervalHandle !== null) return; // never paused: nothing to resume
    this.armInterval();
    this.flush().catch((e) => {
      Sentry.captureException(e, {
        tags: { subsystem: "syncWorker", op: "appState.flush" },
      });
    });
  };

  private armInterval(): void {
    if (this.intervalHandle !== null) return;
    this.intervalHandle = setInterval(() => {
      this.flush().catch((e) => {
        Sentry.captureException(e, {
          tags: { subsystem: "syncWorker", op: "interval.flush" },
        });
      });
    }, logConfig.SYNC_INTERVAL_MS);
  }

  private disarmInterval(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  // -------------------------------------------------------------------------
  // flush()
  // -------------------------------------------------------------------------

  async flush(now: number = Date.now(), opts: FlushOptions = {}): Promise<FlushResult> {
    if (this.flushInProgress) {
      // The running pass may already hold rows: run a releasing one after it.
      if (opts.releaseHeld) this.releasePending = true;
      return { ...EMPTY };
    }
    // A releasing flush in a global backoff sends nothing either (#3275): the
    // held rows stay live and go out on the first pass after the backoff
    // that finds the session completed, the app in the background, or the
    // oldest row GAMEPLAY_HOLD_MAX_MS old — or at the next launch, where a
    // killed session is no longer held. So the delay is bounded, never a loss.
    if (now < this.backoffUntil) {
      // Network-free upkeep still runs in a backoff (#3279), once loaded.
      if (this.games.isLoaded()) await this.dropFinishedSampledOut(now);
      return { ...EMPTY, backoffMs: this.backoffUntil - now };
    }
    this.flushInProgress = true;
    try {
      const result: FlushResult = { ...EMPTY };
      // Load + startup sweep (see step 0 above).
      await this.games.init();
      // Before anything that needs the network (or the session id), so an
      // offline device or one in a backoff never piles up rows that will
      // never upload (#3279).
      await this.dropFinishedSampledOut(now);

      // Step 0's session check, only when there is something to send, so an
      // empty pass reads nothing (#2959): before the creates when any game is
      // pending, else after the snapshot, which is then taken again — a
      // re-key may just have dropped the rows it holds.
      if (this.games.all().length > 0 && !(await this.ensureSession(result, now))) return result;
      if (!(await this.flushGameCreations(result, now))) return result;
      // Read once per pass (#3275), so both snapshots below hold alike.
      const holding = !opts.releaseHeld && !isAppInterrupted(AppState.currentState);
      let snapshot = await this.snapshot(now, holding);
      if (!this.sessionChecked && (snapshot.byGame.size > 0 || snapshot.bugLogs.length > 0)) {
        if (!(await this.ensureSession(result, now))) return result;
        snapshot = await this.snapshot(now, holding);
      }
      if (!(await this.flushEvents(snapshot, result, now))) return result;
      if (!(await this.flushCompletions(snapshot, result, now))) return result;
      if (!(await this.flushBugLogs(snapshot, result, now))) return result;

      // Successful flush — reset backoff exponent.
      this.backoffExponent = 0;
      this.backoffUntil = 0;
      return result;
    } finally {
      this.flushInProgress = false;
      if (this.releasePending) {
        this.releasePending = false;
        this.flush(Date.now(), { releaseHeld: true }).catch((e) => {
          Sentry.captureException(e, {
            tags: { subsystem: "syncWorker", op: "release.flush" },
          });
        });
      }
    }
  }

  /**
   * Resolve the session id before anything is sent (#3325): a re-key of a
   * legacy id drops the old player's queue before it resolves. Once per
   * process: after one success the stored id is a CSPRNG id, which is never
   * re-keyed. No id (no CSPRNG, a failed re-key, a storage error) → global
   * backoff and false, so the pass sends nothing; the next one retries.
   */
  private async ensureSession(result: FlushResult, now: number): Promise<boolean> {
    if (this.sessionChecked) return true;
    try {
      await this.sessionId();
    } catch {
      await this.transientFailure(NO_SESSION, [], result, now);
      return false;
    }
    this.sessionChecked = true;
    return true;
  }

  /** The one `peek` of a pass, bucketed for steps 2–4. */
  private async snapshot(now: number, holding: boolean): Promise<QueueSnapshot> {
    // Captured before the peek is queued on the store's lock: a game marked
    // completed by now had its `game_ended` enqueued ahead of this peek
    // (gameEventClient.completeGame), so the snapshot holds it.
    const completedAtSnapshot = new Set<string>();
    const sampledOut = new Set<string>();
    for (const [gameId, game] of this.games.all()) {
      if (game.completed) completedAtSnapshot.add(gameId);
      if (replayModeOf(game) === "local") sampledOut.add(gameId);
    }
    // Every live row: the peek is in memory, and the cap is no limit — it can
    // be lowered at runtime (or by a release) under a fuller queue on disk,
    // and a game's unseen rows would let its PATCH go out before them.
    const rows = await this.store.peek(Number.POSITIVE_INFINITY, { now });
    const byGame = new Map<string, GameEventRow[]>();
    const bugLogs: BugLogRow[] = [];
    for (const row of rows) {
      if (row.log_type === "bug_log") {
        bugLogs.push(row);
        continue;
      }
      const list = byGame.get(row.game_id) ?? [];
      list.push(row);
      byGame.set(row.game_id, list);
    }
    return {
      byGame,
      bugLogs,
      outstanding: new Set(byGame.keys()),
      completedAtSnapshot,
      holding,
      sampledOut,
    };
  }

  /**
   * Sampled-out sessions completed more than `LATE_UPGRADE_GRACE_MS` ago lose
   * their gameplay rows now (#3279), with no network needed: offline or in a
   * backoff, step 3 never comes, and the rows would otherwise sit at the
   * front of eviction's way until the TTL.
   */
  private async dropFinishedSampledOut(now: number): Promise<void> {
    for (const [gameId, game] of this.games.finishedSampledOut()) {
      if (this.sampledOutDropped.has(gameId)) continue;
      // Already final but not dropped by this process (killed between the mark
      // and the delete, or the delete failed): the delete is idempotent, so
      // run it again. Otherwise wait out the grace; a completion dated in the
      // future (the clock moved back) counts as past it.
      if (!game.replayFinal) {
        if (game.completedAt === null) continue;
        const elapsed = now - game.completedAt;
        if (elapsed >= 0 && elapsed < LATE_UPGRADE_GRACE_MS) continue;
      }
      await this.finalizeSampledOut(gameId);
    }
  }

  /** Forget a game SyncWorker is done with, and its entry in `sampledOutDropped`. */
  private async forgetGame(gameId: string): Promise<void> {
    this.sampledOutDropped.delete(gameId);
    await this.games.forget(gameId);
  }

  /**
   * Delete a sampled-out session's gameplay rows (lifecycle and keep-list
   * rows stay). Marked `replayFinal` first — in memory at once, then on disk —
   * so an upgrade that lands during the delete, or after a failed PATCH, is
   * refused: a `full` session's rows are never deleted. The rows go only once
   * the mark is on disk (#3369): deleted behind a mark that failed to write, a
   * restart would reload the game as an upgradeable `local` session with
   * nothing left to upload. A failed write or delete is tried again on the
   * next pass (and in the next process), the TTL behind it.
   *
   * Resolves to true when the rows are gone or there was nothing to do (the
   * game is unknown, or no longer sampled out), false when they are still
   * queued: step 3 completes, and so forgets, a game only on true.
   */
  private async finalizeSampledOut(gameId: string): Promise<boolean> {
    // Checked again here, synchronously: a caller's list may be stale (an
    // upgrade can land while another game's delete is awaited), and a `full`
    // session's rows are never deleted.
    const game = this.games.get(gameId);
    if (!game || replayModeOf(game) !== "local") return true;
    // Written on every attempt that gets here: an earlier write may have
    // failed and left the mark in memory only. The happy path writes once.
    if (!(await this.games.update(gameId, { replayFinal: true }))) return false;
    try {
      await this.store.deleteByGameIds([gameId], uploadsWhenSampledOut);
    } catch {
      return false; // left for the next pass
    }
    this.sampledOutDropped.add(gameId);
    return true;
  }

  // -------------------------------------------------------------------------
  // Step 1 — POST /games for every un-started game.
  // -------------------------------------------------------------------------

  private async flushGameCreations(result: FlushResult, now: number): Promise<boolean> {
    for (const [gameId, game] of this.games.all()) {
      if (game.startedSynced) continue;
      // Not started yet (#2654): the player never acted, so the server must
      // not hear of this session. Its events wait with it (step 2 skips a
      // game until startedSynced). A completion marks the game started.
      if (!game.started) continue;
      const res = await this.api.request(
        "POST",
        "/games",
        {
          id: gameId,
          game_type: game.gameType,
          metadata: game.metadata,
          started_at: new Date(game.startedAt).toISOString(),
        },
        now
      );
      result.attempted += 1;

      if (res.ok) {
        await this.games.markStartedSynced(gameId);
        result.accepted += 1;
        continue;
      }
      if (await this.transientFailure(res, [], result, now)) return false;
      // 4xx terminal — the server rejects this game for good. Dead-letter its
      // queued events and forget it so the queue makes progress.
      captureThrottledMessage(
        `syncWorker.post_games.${res.status}`,
        `syncWorker: POST /games → ${res.status}`,
        {
          level: res.status === 403 ? "error" : "warning",
          tags: { subsystem: "syncWorker", status: String(res.status) },
          extra: { gameId },
        }
      );
      // Parked rows included: the game is forgotten, so they must not come
      // back as orphans once their retry time passes.
      // A sampled-out session's gameplay rows go now, not at the TTL (#3279).
      if (replayModeOf(game) === "local" && !this.sampledOutDropped.has(gameId)) {
        await this.finalizeSampledOut(gameId);
      }
      await this.store.markDeadLetteredByGameIds([gameId]);
      await this.forgetGame(gameId);
      result.deadLettered += 1;
    }
    return true;
  }

  /** The server accepted events for the game: its re-create count starts over. */
  private async clearReflips(gameId: string): Promise<void> {
    if (this.games.get(gameId)?.reflipCount) await this.games.update(gameId, { reflipCount: 0 });
  }

  /**
   * The server 404'd a game it should hold (#3492): re-flip `startedSynced`
   * so step 1 re-creates it, at most `MAX_GAME_REFLIPS` times. Past the cap
   * the game is dead-lettered with its rows and forgotten, as for a terminal
   * 4xx on POST /games, so a server that creates a game and then 404s it
   * can't cost two requests per pass for ever. The count is persisted with the
   * game. The warning is throttled and carries the count.
   */
  private async reflipOrDeadLetter(
    gameId: string,
    source: "events" | "complete",
    result: FlushResult
  ): Promise<void> {
    const game = this.games.get(gameId);
    const reflips = (game?.reflipCount ?? 0) + 1;
    const capped = reflips > logConfig.MAX_GAME_REFLIPS;
    captureThrottledMessage(
      `syncWorker.${source}.404`,
      source === "events"
        ? "syncWorker: 404 on event batch; re-flipping started_synced"
        : "syncWorker: 404 on PATCH /complete; re-flipping started_synced",
      {
        level: "warning",
        tags: { subsystem: "syncWorker", status: "404" },
        extra: { gameId, reflipCount: reflips, maxReflips: logConfig.MAX_GAME_REFLIPS, capped },
      }
    );
    if (!capped) {
      this.games.setReflipCount(gameId, reflips); // persisted by the update below
      await this.games.update(gameId, { startedSynced: false });
      return;
    }
    if (game && replayModeOf(game) === "local" && !this.sampledOutDropped.has(gameId)) {
      await this.finalizeSampledOut(gameId);
    }
    await this.store.markDeadLetteredByGameIds([gameId]);
    await this.forgetGame(gameId);
    result.deadLettered += 1;
  }

  // -------------------------------------------------------------------------
  // Step 2 — POST /games/:id/events per game.
  // -------------------------------------------------------------------------

  private async flushEvents(
    snapshot: QueueSnapshot,
    result: FlushResult,
    now: number
  ): Promise<boolean> {
    // Batches are capped per game by the backend, hence the per-game buckets.
    const batchSize = logConfig.GAME_EVENT_BATCH_SIZE;
    for (const [gameId, events] of snapshot.byGame) {
      const game = this.games.get(gameId);
      if (!game) {
        // Game isn't tracked locally any more (forgotten or never started).
        // Dead-letter the orphan events so they don't loop forever.
        await this.store.markDeadLettered(events.map((e) => e.id));
        result.deadLettered += events.length;
        continue;
      }
      if (!game.startedSynced) continue; // step 1 still owes us a POST /games

      // A sampled-out session (#3279) sends its lifecycle and keep-list rows
      // only, ever (D5); the keep-list rows are held like any gameplay row
      // (#3275). Its other rows are never candidates, so they never count.
      const sendable = snapshot.sampledOut.has(gameId) ? sampledOutRows(events) : events;
      const due = snapshot.holding ? this.dueEvents(gameId, game, sendable, now) : sendable;
      // Chunk by batch size.
      for (let i = 0; i < due.length; i += batchSize) {
        const chunk = due.slice(i, i + batchSize);
        const ok = await this.postEventBatch(gameId, chunk, result, now);
        if (!ok) return false;
        // A 404 re-flipped startedSynced: the rest of the game's chunks would
        // only 404 too (and each re-flip is a write). Step 1 recreates it next pass.
        if (!this.games.get(gameId)?.startedSynced) break;
      }
      // Every chunk was accepted, dropped, parked or dead-lettered — unless a
      // 404 re-flipped startedSynced, in which case the rows are still live,
      // or rows were held. Defence in depth: a held game is open, and step 3
      // only completes a game completed at snapshot time (never held), so the
      // length check only keeps a future change from completing a game whose
      // rows are still on the device. A sampled-out session's other gameplay
      // rows never go, so they never hold its completion back (#3279).
      if (due.length === sendable.length && this.games.get(gameId)?.startedSynced) {
        snapshot.outstanding.delete(gameId);
      }
    }
    return true;
  }

  /**
   * The rows of one game that go out on a holding pass (#3275, see "Holding"
   * in the header): all of them unless the game is an open session of this
   * process, and then only its lifecycle rows until its oldest gameplay row
   * is GAMEPLAY_HOLD_MAX_MS old. `game.completed` is read live, so a game
   * completed since the snapshot sends everything.
   */
  private dueEvents(
    gameId: string,
    game: PendingGame,
    events: GameEventRow[],
    now: number
  ): GameEventRow[] {
    if (game.completed || this.games.isFromPreviousProcess(gameId)) return events;
    const lifecycle: GameEventRow[] = [];
    let oldestHeld = Number.POSITIVE_INFINITY;
    for (const row of events) {
      if (row.priority === Priority.LIFECYCLE) {
        lifecycle.push(row);
      } else if (row.created_at < oldestHeld) {
        oldestHeld = row.created_at;
      }
    }
    if (lifecycle.length === events.length) return events; // nothing to hold
    if (now - oldestHeld >= GAMEPLAY_HOLD_MAX_MS) return events; // the fallback
    return lifecycle;
  }

  private async postEventBatch(
    gameId: string,
    chunk: GameEventRow[],
    result: FlushResult,
    now: number
  ): Promise<boolean> {
    const body = {
      events: chunk.map((r) => ({
        event_index: r.event_index,
        event_type: r.event_type,
        data: r.payload,
      })),
    };
    const res = await this.api.request("POST", `/games/${gameId}/events`, body, now);
    result.attempted += chunk.length;

    if (res.ok) {
      await this.clearReflips(gameId);
      const accepted = (res.body as { accepted?: number } | null)?.accepted ?? chunk.length;
      const duplicates = (res.body as { duplicates?: number } | null)?.duplicates ?? 0;
      await this.store.deleteByIds(chunk.map((r) => r.id));
      result.accepted += accepted;
      result.duplicates += duplicates;
      return true;
    }
    if (await this.transientFailure(res, chunk, result, now)) return false;
    if (res.status === 413) {
      if (chunk.length === 1) {
        const first = chunk[0];
        if (first === undefined) return false;
        await this.store.markDeadLettered([first.id]);
        result.deadLettered += 1;
        captureThrottledMessage("syncWorker.events.413_single", "syncWorker: single-row 413", {
          level: "warning",
          tags: { subsystem: "syncWorker", status: "413" },
          extra: { gameId, eventIndex: first.event_index },
        });
        return true;
      }
      const mid = Math.ceil(chunk.length / 2);
      const left = chunk.slice(0, mid);
      const right = chunk.slice(mid);
      const okLeft = await this.postEventBatch(gameId, left, result, now);
      if (!okLeft) return false;
      if (!this.games.get(gameId)?.startedSynced) return true; // the left half 404'd
      return this.postEventBatch(gameId, right, result, now);
    }
    if (res.status === 404) {
      // Server never saw this game — re-flip startedSynced so step 1
      // retries on the next flush. Events stay put. Bounded (#3492).
      await this.reflipOrDeadLetter(gameId, "events", result);
      return true;
    }
    if (isAlreadyCompleted(res)) {
      // The row was completed before these events arrived — a completion that
      // got there first (a row the stale-session sweep closed still accepts
      // events, #2621). Nothing is wrong and retrying can't help: drop them
      // quietly.
      Sentry.addBreadcrumb({
        category: "syncWorker",
        message: "events for completed game dropped (409)",
        data: { gameId },
        level: "info",
      });
      await this.store.deleteByIds(chunk.map((r) => r.id));
      return true;
    }
    // 400 unknown_event_type — server-side schema gap (missing event_types row),
    // not a bad client payload. Park with a long backoff so the rows survive
    // until the migration lands rather than being silently dropped.
    if (
      res.status === 400 &&
      (res.body as { detail?: { error?: string } } | null)?.detail?.error === "unknown_event_type"
    ) {
      captureThrottledMessage(
        "syncWorker.events.unknown_event_type",
        "syncWorker: unknown_event_type on event batch",
        {
          level: "warning",
          tags: { subsystem: "syncWorker", status: "400" },
          extra: {
            gameId,
            eventTypes: chunk.map((r) => r.event_type),
            body: res.body,
          },
        }
      );
      await this.applyPerRowBackoff(chunk, logConfig.UNKNOWN_EVENT_TYPE_BACKOFF_MS, now);
      result.parked += chunk.length;
      return true;
    }
    // 400 (other), 403, or other 4xx terminal — dead-letter the chunk.
    captureThrottledMessage(
      `syncWorker.events.${res.status}`,
      `syncWorker: ${res.status} on event batch`,
      {
        level: "error",
        tags: { subsystem: "syncWorker", status: String(res.status) },
        extra: {
          status: res.status,
          body: res.body,
          gameId,
          eventTypes: chunk.map((r) => r.event_type),
        },
      }
    );
    await this.store.markDeadLettered(chunk.map((r) => r.id));
    result.deadLettered += chunk.length;
    return true;
  }

  // -------------------------------------------------------------------------
  // Step 3 — PATCH /games/:id/complete.
  // -------------------------------------------------------------------------

  private async flushCompletions(
    snapshot: QueueSnapshot,
    result: FlushResult,
    now: number
  ): Promise<boolean> {
    for (const [gameId, game] of this.games.all()) {
      if (!game.completed || game.completeSynced || !game.startedSynced) continue;

      // Only complete after all live events for this game have been delivered
      // (see the header): the snapshot must have seen the completion, and step
      // 2 must have resolved every row it held for the game.
      if (!snapshot.completedAtSnapshot.has(gameId) || snapshot.outstanding.has(gameId)) continue;
      if (snapshot.sampledOut.has(gameId)) {
        // Upgraded since step 2 (a late error report, #3279): its gameplay rows
        // were not sent this pass, so complete it on the next one, after them.
        if (replayModeOf(game) !== "local") continue;
        // The fast path, online: the last moment an upgrade could still need
        // them (lifecycle and keep-list rows are all sent by now). This also
        // covers a session completed by a process killed before it got here.
        // Not deleted yet (the mark's write or the delete failed): no PATCH
        // this pass, so the game is not forgotten with its rows still queued
        // (they would be dead-lettered as orphans); the next pass retries.
        if (!this.sampledOutDropped.has(gameId) && !(await this.finalizeSampledOut(gameId))) {
          continue;
        }
      }

      // Serialize summary with snake_case field names to match the
      // backend Pydantic schema (`final_score`, `duration_ms`). The
      // in-memory `CompleteSummary` is camelCase, and Pydantic's
      // default `extra="ignore"` silently dropped the camelCase keys —
      // every game prior to #514 landed with final_score = NULL and
      // duration_ms = NULL even when the PATCH succeeded. Transform
      // at the wire boundary so the in-memory type stays idiomatic TS.
      const summary = game.completeSummary ?? {};
      const body = {
        final_score: summary.finalScore ?? null,
        outcome: summary.outcome ?? null,
        duration_ms: resolveDurationMs(summary.durationMs),
        completed_at: game.completedAt != null ? new Date(game.completedAt).toISOString() : null,
        result: summary.result ?? {},
      };
      const res = await this.api.request("PATCH", `/games/${gameId}/complete`, body, now);
      result.attempted += 1;
      if (res.ok) {
        await this.games.markCompleteSynced(gameId);
        await this.forgetGame(gameId);
        result.accepted += 1;
        continue;
      }
      if (await this.transientFailure(res, [], result, now)) return false;
      if (res.status === 404) {
        await this.reflipOrDeadLetter(gameId, "complete", result);
        continue;
      }
      if (res.status === 403) {
        // Session mismatch — permanent, never retryable.
        captureThrottledMessage("syncWorker.complete.403", "syncWorker: 403 on PATCH /complete", {
          level: "error",
          tags: { subsystem: "syncWorker", status: "403" },
          extra: { body: res.body, gameId, sentOutcome: body.outcome },
        });
        await this.forgetGame(gameId);
        result.deadLettered += 1;
        continue;
      }
      // 400 (and other non-403 4xx): permanent — dead-letter immediately.
      // The backend has accepted "completed" in _VALID_OUTCOMES since #514;
      // a 400 now means a genuine bad request that won't be fixed by retrying.
      captureThrottledMessage(
        `syncWorker.complete.${res.status}`,
        `syncWorker: ${res.status} on PATCH /complete (dead-lettered)`,
        {
          level: "error",
          tags: { subsystem: "syncWorker", status: String(res.status) },
          extra: {
            status: res.status,
            body: res.body,
            gameId,
            sentOutcome: body.outcome,
          },
        }
      );
      await this.forgetGame(gameId);
      result.deadLettered += 1;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Step 4 — POST /logs/bug batches.
  // -------------------------------------------------------------------------

  private async flushBugLogs(
    snapshot: QueueSnapshot,
    result: FlushResult,
    now: number
  ): Promise<boolean> {
    const batchSize = logConfig.BUG_LOG_BATCH_SIZE;
    const rows = snapshot.bugLogs;
    if (rows.length === 0) return true;

    for (let i = 0; i < rows.length; i += batchSize) {
      const chunk = rows.slice(i, i + batchSize);
      const body = {
        logs: chunk.map((r) => ({
          id: r.bug_uuid,
          logged_at: new Date(r.created_at).toISOString(),
          level: r.bug_level,
          source: r.bug_source,
          message: ((r.payload as { message?: string }).message ?? "").toString(),
          context: (r.payload as { context?: Record<string, unknown> }).context ?? {},
        })),
      };
      const res = await this.api.request("POST", "/logs/bug", body, now);
      result.attempted += chunk.length;

      if (res.ok) {
        const accepted = (res.body as { accepted?: number } | null)?.accepted ?? chunk.length;
        const duplicates = (res.body as { duplicates?: number } | null)?.duplicates ?? 0;
        await this.store.deleteByIds(chunk.map((r) => r.id));
        result.accepted += accepted;
        result.duplicates += duplicates;
        continue;
      }
      if (await this.transientFailure(res, chunk, result, now)) return false;
      // 400/403/413 on bug logs — dead-letter the chunk. Bug logs don't
      // have a 404 story.
      captureThrottledMessage(
        `syncWorker.logs_bug.${res.status}`,
        `syncWorker: ${res.status} on POST /logs/bug`,
        { level: "warning", tags: { subsystem: "syncWorker", status: String(res.status) } }
      );
      await this.store.markDeadLettered(chunk.map((r) => r.id));
      result.deadLettered += chunk.length;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * The one handler for a 429, a 5xx or a network failure (status 0): the
   * refused `rows` (if any) get a per-row retry time, the global backoff is
   * set — from Retry-After on a 429, exponentially otherwise — and the pass
   * stops. Returns true when `res` was such a failure, so the caller returns
   * false; any other response returns false and the caller carries on.
   */
  private async transientFailure(
    res: SyncResponse,
    rows: Row[],
    result: FlushResult,
    now: number
  ): Promise<boolean> {
    const rateLimited = res.status === 429;
    if (!rateLimited && res.status !== 0 && res.status < 500) return false;
    const retryAfterMs = rateLimited ? res.retryAfterMs : null;
    // Global backoff first (#3433): the per-row write below can fail on broken
    // storage and must never leave the 30 s tick retrying with no backoff set.
    this.scheduleBackoff(now, retryAfterMs);
    result.backoffMs = this.backoffUntil - now;
    if (rows.length > 0) {
      // Non-fatal (#3433): a storage failure leaves the rows as they were, so
      // they are retried after the global backoff. Reported once per launch
      // under a fixed fingerprint. (The unknown_event_type path has no global
      // backoff, so there the failure still propagates.)
      try {
        await this.applyPerRowBackoff(rows, retryAfterMs, now);
      } catch (e) {
        const key = "syncWorker.perRowBackoff.storage";
        if (sentryThrottle.allow(key, "error")) {
          Sentry.captureException(e, {
            tags: { subsystem: "syncWorker", op: "perRowBackoff" },
            fingerprint: [key],
          });
        }
      }
    }
    return true;
  }

  private scheduleBackoff(now: number, retryAfterMs: number | null): void {
    if (retryAfterMs !== null) {
      this.backoffUntil = now + retryAfterMs;
      return;
    }
    this.backoffExponent = Math.min(this.backoffExponent + 1, 30);
    const ms = Math.min(
      logConfig.BACKOFF_BASE_MS * 2 ** (this.backoffExponent - 1),
      logConfig.BACKOFF_MAX_MS
    );
    this.backoffUntil = now + ms;
  }

  private async applyPerRowBackoff(
    rows: Row[],
    retryAfterMs: number | null,
    now: number
  ): Promise<void> {
    const delay =
      retryAfterMs !== null
        ? retryAfterMs
        : Math.min(
            logConfig.BACKOFF_BASE_MS * 2 ** Math.min((rows[0]?.retry_count ?? 0) + 1, 30),
            logConfig.BACKOFF_MAX_MS
          );
    const updated = rows.map((r) => ({
      ...r,
      retry_count: r.retry_count + 1,
      next_retry_at: now + delay,
    }));
    // Max retry → dead-letter instead of endlessly backing off.
    const terminal = updated.filter((r) => r.retry_count > logConfig.MAX_RETRY_COUNT);
    const live = updated.filter((r) => r.retry_count <= logConfig.MAX_RETRY_COUNT);
    if (live.length > 0) await this.store.updateRows(live);
    if (terminal.length > 0) {
      await this.store.markDeadLettered(terminal.map((r) => r.id));
    }
  }
}

export const syncWorker = new SyncWorker();
