/**
 * SyncWorker — drains the local event queue to the backend (367c).
 *
 * ┌──────────────────────── server-confirmed deletion ────────────────────────┐
 * │ A row is only deleted from eventStore after the server returns 2xx       │
 * │ confirming acceptance. Tests assert this invariant by spying on          │
 * │ eventStore.deleteByIds during simulated 4xx/5xx responses.               │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Flush algorithm (one pass):
 *
 *   0. Wait for the pending games to load from disk, and for the startup
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
 *      from the snapshot and POST /games/:id/events:
 *        - 2xx → delete the sent rows
 *        - 404 → game got lost on the server; re-flip startedSynced=false
 *          and preserve events (they'll retry on the next flush)
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
 *        - 404 → re-flip startedSynced=false (like step 2)
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
 * is re-armed. NetworkContext also flushes on reconnect.
 */

import * as Sentry from "@sentry/react-native";
import { AppState, type AppStateStatus } from "react-native";

import { logConfig } from "./eventQueueConfig";
import { BugLogRow, EventStore, GameEventRow, Row, eventStore } from "./eventStore";
import { PendingGamesStore, pendingGamesStore } from "./pendingGamesStore";
import { SyncApi, SyncResponse, syncApi } from "./syncApi";

export interface FlushResult {
  attempted: number;
  accepted: number;
  duplicates: number;
  deadLettered: number;
  /** Rows parked for long-backoff retry (e.g. unknown_event_type). */
  parked: number;
  backoffMs: number;
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
 * row is already completed (`backend/games/service.py`, `append_events`).
 */
const GAME_ALREADY_COMPLETED_DETAIL = "Game is already completed.";

function isAlreadyCompleted(res: { status: number; body: unknown }): boolean {
  return (
    res.status === 409 &&
    (res.body as { detail?: unknown } | null)?.detail === GAME_ALREADY_COMPLETED_DETAIL
  );
}

/** Only `background` and `inactive` pause the schedule; any other state runs it. */
function isPaused(state: unknown): boolean {
  return state === "background" || state === "inactive";
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
}

export class SyncWorker {
  private flushInProgress = false;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private appStateSub: { remove: () => void } | null = null;
  private backoffUntil = 0;
  private backoffExponent = 0;

  constructor(
    private readonly store: EventStore = eventStore,
    private readonly games: PendingGamesStore = pendingGamesStore,
    private readonly api: SyncApi = syncApi
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
    if (!isPaused(AppState.currentState)) this.armInterval();
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
    if (isPaused(next)) {
      this.disarmInterval();
      return;
    }
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

  async flush(now: number = Date.now()): Promise<FlushResult> {
    if (this.flushInProgress) return { ...EMPTY };
    if (now < this.backoffUntil) return { ...EMPTY, backoffMs: this.backoffUntil - now };
    this.flushInProgress = true;
    try {
      const result: FlushResult = { ...EMPTY };
      // Load + startup sweep (see step 0 above).
      await this.games.init();

      if (!(await this.flushGameCreations(result, now))) return result;
      const snapshot = await this.snapshot(now);
      if (!(await this.flushEvents(snapshot, result, now))) return result;
      if (!(await this.flushCompletions(snapshot, result, now))) return result;
      if (!(await this.flushBugLogs(snapshot, result, now))) return result;

      // Successful flush — reset backoff exponent.
      this.backoffExponent = 0;
      this.backoffUntil = 0;
      return result;
    } finally {
      this.flushInProgress = false;
    }
  }

  /** The one `peek` of a pass, bucketed for steps 2–4. */
  private async snapshot(now: number): Promise<QueueSnapshot> {
    // Captured before the peek is queued on the store's lock: a game marked
    // completed by now had its `game_ended` enqueued ahead of this peek
    // (gameEventClient.completeGame), so the snapshot holds it.
    const completedAtSnapshot = new Set<string>();
    for (const [gameId, game] of this.games.all()) {
      if (game.completed) completedAtSnapshot.add(gameId);
    }
    // The store caps itself at MAX_ROWS, so this limit sees every live row.
    const rows = await this.store.peek(logConfig.MAX_ROWS, { now });
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
    return { byGame, bugLogs, outstanding: new Set(byGame.keys()), completedAtSnapshot };
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
      Sentry.captureMessage(`syncWorker: POST /games ${gameId} → ${res.status}`, {
        level: res.status === 403 ? "error" : "warning",
      });
      await this.deadLetterGameAndEvents(gameId);
      await this.games.forget(gameId);
      result.deadLettered += 1;
    }
    return true;
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

      // Chunk by batch size.
      for (let i = 0; i < events.length; i += batchSize) {
        const chunk = events.slice(i, i + batchSize);
        const ok = await this.postEventBatch(gameId, chunk, result, now);
        if (!ok) return false;
      }
      // Every chunk was accepted, dropped, parked or dead-lettered — unless a
      // 404 re-flipped startedSynced, in which case the rows are still live.
      if (this.games.get(gameId)?.startedSynced) snapshot.outstanding.delete(gameId);
    }
    return true;
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
        Sentry.captureMessage(
          `syncWorker: single-row 413 on ${gameId} event_index=${first.event_index}`,
          { level: "warning" }
        );
        return true;
      }
      const mid = Math.ceil(chunk.length / 2);
      const left = chunk.slice(0, mid);
      const right = chunk.slice(mid);
      const okLeft = await this.postEventBatch(gameId, left, result, now);
      if (!okLeft) return false;
      return this.postEventBatch(gameId, right, result, now);
    }
    if (res.status === 404) {
      // Server never saw this game — re-flip startedSynced so step 1
      // retries on the next flush. Events stay put.
      Sentry.captureMessage(`syncWorker: 404 on ${gameId}; re-flipping started_synced`, {
        level: "warning",
      });
      await this.games.update(gameId, { startedSynced: false });
      return true;
    }
    if (isAlreadyCompleted(res)) {
      // The row was completed before these events arrived — a completion that
      // got there first (a row the stale-session sweep closed still accepts
      // events, #2621). Nothing is wrong and retrying can't help: drop them
      // quietly.
      Sentry.addBreadcrumb({
        category: "syncWorker",
        message: `events for completed game ${gameId} dropped (409)`,
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
      Sentry.captureMessage(`syncWorker: unknown_event_type on ${gameId} event batch`, {
        level: "warning",
        extra: {
          gameId,
          eventTypes: chunk.map((r) => r.event_type),
          body: res.body,
        },
      });
      await this.applyPerRowBackoff(chunk, logConfig.UNKNOWN_EVENT_TYPE_BACKOFF_MS, now);
      result.parked += chunk.length;
      return true;
    }
    // 400 (other), 403, or other 4xx terminal — dead-letter the chunk.
    Sentry.captureMessage(`syncWorker: ${res.status} on ${gameId} event batch`, {
      level: "error",
      extra: {
        status: res.status,
        body: res.body,
        gameId,
        eventTypes: chunk.map((r) => r.event_type),
      },
    });
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
        await this.games.forget(gameId);
        result.accepted += 1;
        continue;
      }
      if (await this.transientFailure(res, [], result, now)) return false;
      if (res.status === 404) {
        await this.games.update(gameId, { startedSynced: false });
        continue;
      }
      if (res.status === 403) {
        // Session mismatch — permanent, never retryable.
        Sentry.captureMessage(`syncWorker: 403 on PATCH /complete ${gameId}`, {
          level: "error",
          extra: { body: res.body, gameId, sentOutcome: body.outcome },
        });
        await this.games.forget(gameId);
        result.deadLettered += 1;
        continue;
      }
      // 400 (and other non-403 4xx): permanent — dead-letter immediately.
      // The backend has accepted "completed" in _VALID_OUTCOMES since #514;
      // a 400 now means a genuine bad request that won't be fixed by retrying.
      Sentry.captureMessage(
        `syncWorker: ${res.status} on PATCH /complete ${gameId} (dead-lettered)`,
        {
          level: "error",
          extra: {
            status: res.status,
            body: res.body,
            gameId,
            sentOutcome: body.outcome,
          },
        }
      );
      await this.games.forget(gameId);
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
      Sentry.captureMessage(`syncWorker: ${res.status} on POST /logs/bug`, { level: "warning" });
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
    if (rows.length > 0) await this.applyPerRowBackoff(rows, retryAfterMs, now);
    this.scheduleBackoff(now, retryAfterMs);
    result.backoffMs = this.backoffUntil - now;
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

  /** Step 1's terminal 4xx: every queued row of the game is dead-lettered. */
  private async deadLetterGameAndEvents(gameId: string): Promise<void> {
    const all = await this.store.peek(logConfig.MAX_ROWS, { includeDeadLettered: true });
    const ids = all
      .filter((r) => r.log_type === "game_event" && r.game_id === gameId)
      .map((r) => r.id);
    await this.store.markDeadLettered(ids);
  }
}

export const syncWorker = new SyncWorker();
