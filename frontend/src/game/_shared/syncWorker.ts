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
 *   1. For each pending game with startedSynced=false:
 *        POST /games { id, game_type, metadata }
 *        - 2xx → markStartedSynced
 *        - 404 → should not happen (we created the id); dead-letter + log
 *        - 4xx → dead-letter the pending game
 *        - 429/5xx/network → set global backoff and stop this flush
 *
 *   2. For each pending game with startedSynced=true, batch its events
 *      from the queue and POST /games/:id/events:
 *        - 2xx → delete the sent rows
 *        - 404 → game got lost on the server; re-flip startedSynced=false
 *          and preserve events (they'll retry on the next flush)
 *        - 413 → split batch in half, retry halves; single-row 413 →
 *          dead-letter that row
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
 *
 *   4. Batch pending bug logs and POST /logs/bug:
 *        Same mapping as step 2 (no 404 applies).
 *
 * Backoff:
 *   - Global backoff after 5xx/network: exponential 1s→30min, reset on
 *     next 2xx. Set via `this.backoffUntil` and checked at entry.
 *   - Per-row next_retry_at after 429: honors Retry-After header.
 */

import * as Sentry from "@sentry/react-native";

import { logConfig } from "./eventQueueConfig";
import { BugLogRow, EventStore, GameEventRow, eventStore } from "./eventStore";
import { PendingGamesStore, pendingGamesStore } from "./pendingGamesStore";
import { SyncApi, syncApi } from "./syncApi";

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
 * Longest play time the SyncWorker will derive from `completedAt − startedAt`
 * (24 h). Matches the server's stale-session threshold (#2621): a session open
 * longer than that was left in the background, not played.
 */
export const MAX_DERIVED_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * The `duration_ms` sent on PATCH /complete (#2619). A real duration from the
 * game is kept as-is. When the game sent none, or 0, it is derived from the
 * pending game's own `startedAt` / `completedAt` timestamps, capped at
 * `MAX_DERIVED_DURATION_MS`. Returns the game's value unchanged (null, or 0)
 * when the timestamps can't give a positive duration.
 */
export function resolveDurationMs(
  durationMs: number | null | undefined,
  startedAt: number | null | undefined,
  completedAt: number | null | undefined
): number | null {
  const reported = durationMs ?? null;
  if (reported !== null && reported !== 0) return reported;
  if (typeof startedAt !== "number" || typeof completedAt !== "number") return reported;
  const elapsed = completedAt - startedAt;
  if (!Number.isFinite(elapsed) || elapsed <= 0) return reported;
  return Math.min(Math.round(elapsed), MAX_DERIVED_DURATION_MS);
}

const EMPTY: FlushResult = {
  attempted: 0,
  accepted: 0,
  duplicates: 0,
  deadLettered: 0,
  parked: 0,
  backoffMs: 0,
};

export class SyncWorker {
  private flushInProgress = false;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
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

  start(): void {
    if (this.intervalHandle !== null) return;
    this.intervalHandle = setInterval(() => {
      this.flush().catch((e) => {
        Sentry.captureException(e, {
          tags: { subsystem: "syncWorker", op: "interval.flush" },
        });
      });
    }, logConfig.SYNC_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /** Inspect the current global backoff deadline (epoch ms). 0 = no backoff. */
  getBackoffUntil(): number {
    return this.backoffUntil;
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

      if (!(await this.flushGameCreations(result, now))) return result;
      if (!(await this.flushEvents(result, now))) return result;
      if (!(await this.flushCompletions(result, now))) return result;
      if (!(await this.flushBugLogs(result, now))) return result;

      // Successful flush — reset backoff exponent.
      this.backoffExponent = 0;
      this.backoffUntil = 0;
      return result;
    } finally {
      this.flushInProgress = false;
    }
  }

  // -------------------------------------------------------------------------
  // Step 1 — POST /games for every un-started game.
  // -------------------------------------------------------------------------

  private async flushGameCreations(result: FlushResult, now: number): Promise<boolean> {
    for (const [gameId, game] of this.games.all()) {
      if (game.startedSynced) continue;
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
      if (res.status === 429) {
        this.scheduleBackoff(now, res.retryAfterMs);
        result.backoffMs = this.backoffUntil - now;
        return false;
      }
      if (res.status === 0 || res.status >= 500) {
        this.scheduleBackoff(now, null);
        result.backoffMs = this.backoffUntil - now;
        return false;
      }
      // 4xx terminal — something's wrong with this game payload. Forget
      // it so the queue makes progress. The event rows for it will be
      // dead-lettered on the next pass (no matching game_id), but really
      // they should be dead-lettered now to match behavior.
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

  private async flushEvents(result: FlushResult, now: number): Promise<boolean> {
    // Gather live event rows grouped by game_id. We peek() with a big
    // limit and then bucket client-side because batches are capped per
    // game by the backend.
    const batchSize = logConfig.GAME_EVENT_BATCH_SIZE;
    const rows = (await this.store.peek(5000, { now })) as Array<GameEventRow | BugLogRow>;
    const byGame = new Map<string, GameEventRow[]>();
    for (const row of rows) {
      if (row.log_type !== "game_event") continue;
      const list = byGame.get(row.game_id) ?? [];
      list.push(row);
      byGame.set(row.game_id, list);
    }

    for (const [gameId, events] of byGame) {
      const game = this.games.get(gameId);
      if (!game) {
        // Game isn't tracked locally any more (forgotten or never started).
        // Dead-letter the orphan events so they don't loop forever.
        await this.markDeadLettered(events.map((e) => e.id));
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
    if (res.status === 429) {
      await this.applyPerRowBackoff(chunk, res.retryAfterMs, now);
      this.scheduleBackoff(now, res.retryAfterMs);
      result.backoffMs = this.backoffUntil - now;
      return false;
    }
    if (res.status === 0 || res.status >= 500) {
      await this.applyPerRowBackoff(chunk, null, now);
      this.scheduleBackoff(now, null);
      result.backoffMs = this.backoffUntil - now;
      return false;
    }
    if (res.status === 413) {
      if (chunk.length === 1) {
        const first = chunk[0];
        if (first === undefined) return false;
        await this.markDeadLettered([first.id]);
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
      const g = this.games.get(gameId);
      if (g) g.startedSynced = false;
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
    await this.markDeadLettered(chunk.map((r) => r.id));
    result.deadLettered += chunk.length;
    return true;
  }

  // -------------------------------------------------------------------------
  // Step 3 — PATCH /games/:id/complete.
  // -------------------------------------------------------------------------

  private async flushCompletions(result: FlushResult, now: number): Promise<boolean> {
    for (const [gameId, game] of this.games.all()) {
      if (!game.completed || game.completeSynced || !game.startedSynced) continue;

      // Only complete after all live events for this game have been delivered.
      // If any remain in the queue (not dead-lettered, not future-retry), wait.
      const outstanding = await this.hasOutstandingEvents(gameId, now);
      if (outstanding) continue;

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
        duration_ms: resolveDurationMs(summary.durationMs, game.startedAt, game.completedAt),
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
      if (res.status === 429) {
        this.scheduleBackoff(now, res.retryAfterMs);
        result.backoffMs = this.backoffUntil - now;
        return false;
      }
      if (res.status === 0 || res.status >= 500) {
        this.scheduleBackoff(now, null);
        result.backoffMs = this.backoffUntil - now;
        return false;
      }
      if (res.status === 404) {
        const g = this.games.get(gameId);
        if (g) g.startedSynced = false;
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

  private async flushBugLogs(result: FlushResult, now: number): Promise<boolean> {
    const batchSize = logConfig.BUG_LOG_BATCH_SIZE;
    const rows = (await this.store.peek(5000, { now })).filter(
      (r): r is BugLogRow => r.log_type === "bug_log"
    );
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
      if (res.status === 429) {
        await this.applyPerRowBackoff(chunk, res.retryAfterMs, now);
        this.scheduleBackoff(now, res.retryAfterMs);
        result.backoffMs = this.backoffUntil - now;
        return false;
      }
      if (res.status === 0 || res.status >= 500) {
        await this.applyPerRowBackoff(chunk, null, now);
        this.scheduleBackoff(now, null);
        result.backoffMs = this.backoffUntil - now;
        return false;
      }
      // 400/403/413 on bug logs — dead-letter the chunk. Bug logs don't
      // have a 404 story.
      Sentry.captureMessage(`syncWorker: ${res.status} on POST /logs/bug`, { level: "warning" });
      await this.markDeadLettered(chunk.map((r) => r.id));
      result.deadLettered += chunk.length;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async hasOutstandingEvents(gameId: string, now: number): Promise<boolean> {
    const rows = await this.store.peek(5000, { now });
    return rows.some((r) => r.log_type === "game_event" && r.game_id === gameId);
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
    rows: Array<GameEventRow | BugLogRow>,
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
      await this.markDeadLettered(terminal.map((r) => r.id));
    }
  }

  private async markDeadLettered(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    // Peek everything and flip the flag for matching rows. Cheap at our
    // scale (<5k rows).
    const all = await this.store.peek(10_000, { includeDeadLettered: true });
    const set = new Set(ids);
    const updated = all.filter((r) => set.has(r.id)).map((r) => ({ ...r, dead_lettered: true }));
    if (updated.length > 0) await this.store.updateRows(updated);
  }

  private async deadLetterGameAndEvents(gameId: string): Promise<void> {
    const all = await this.store.peek(10_000, { includeDeadLettered: true });
    const toMark = all
      .filter((r) => r.log_type === "game_event" && r.game_id === gameId)
      .map((r) => ({ ...r, dead_lettered: true }));
    if (toMark.length > 0) await this.store.updateRows(toMark);
  }

  // -------------------------------------------------------------------------
  // Test introspection
  // -------------------------------------------------------------------------

  _getBackoffUntil(): number {
    return this.backoffUntil;
  }
}

export const syncWorker = new SyncWorker();
