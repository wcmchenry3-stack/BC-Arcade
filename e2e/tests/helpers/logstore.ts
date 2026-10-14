/**
 * Shared harness for the #373 logstore e2e suite.
 *
 * Requires EXPO_PUBLIC_TEST_HOOKS=1 in the frontend build. All hooks used
 * here are installed by `frontend/src/game/_shared/testHooks.ts` inside
 * NetworkContext's mount effect. In a production build they don't exist
 * and `waitForLogstoreReady` will fail fast.
 *
 * Scope of this file (per #479):
 *   - waitForLogstoreReady: pre-test readiness sentinel
 *   - clearLogstore / resetLogConfig: teardown hooks
 *   - inspectQueue: typed stats getter
 *   - seedEvents / seedBugLogs / seedEvictionFixture: bulk fixture helpers
 *   - withLogConfigOverride: scoped runtime config override
 *   - latencyProbe: p50/p99/max sampler around enqueueEvent
 *   - memorySampler: page.metrics() JSHeapUsedSize baseline/growth tracker
 *   - frameCadenceMeter: rAF delta sampler (for non-blocking tests)
 *   - mockSyncEndpoints: scripted backend responder for /games/** and /logs/**
 */

import { Page, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Types (mirror frontend/src/game/_shared/{eventStore,eventQueueConfig}.ts)
// ---------------------------------------------------------------------------

export type Priority = 0 | 1 | 2 | 3;

export interface QueueStats {
  totalRows: number;
  sizeBytes: number;
  byLogType: { game_event: number; bug_log: number };
  byPriority: Record<Priority, number>;
  oldestAt: number | null;
}

export interface SeedEventSpec {
  count: number;
  priority?: Priority;
  eventType?: string;
  gameId?: string;
  createdAt?: number;
  startIndex?: number;
}

export interface SeedBugLogSpec {
  count: number;
  level?: "warn" | "error" | "fatal";
  source?: string;
  createdAt?: number;
  message?: string;
}

export interface LatencyStats {
  p50: number;
  p99: number;
  max: number;
  min: number;
  mean: number;
  samples: number;
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

/**
 * Wait until every logstore test hook is mounted on `window`. Page must
 * already be navigated — call after `page.goto(...)`.
 */
export async function waitForLogstoreReady(
  page: Page,
  timeout = 10_000,
): Promise<void> {
  await page.waitForFunction(
    () =>
      (globalThis as unknown as { __logstoreHooks_ready?: true })
        .__logstoreHooks_ready === true,
    undefined,
    { timeout },
  );
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

export async function clearLogstore(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const g = globalThis as unknown as {
      __gameEventClient_clearAll: () => Promise<void>;
    };
    await g.__gameEventClient_clearAll();
  });
}

export async function resetLogConfig(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = globalThis as unknown as { __logConfig_reset: () => void };
    g.__logConfig_reset();
  });
}

// ---------------------------------------------------------------------------
// Inspection
// ---------------------------------------------------------------------------

export async function inspectQueue(page: Page): Promise<QueueStats> {
  return page.evaluate(async () => {
    const g = globalThis as unknown as {
      __gameEventClient_getQueueStats: () => Promise<unknown>;
    };
    return (await g.__gameEventClient_getQueueStats()) as unknown;
  }) as Promise<QueueStats>;
}

export async function getBackoffUntil(page: Page): Promise<number> {
  return page.evaluate(() => {
    const g = globalThis as unknown as {
      __syncWorker_getBackoffUntil: () => number;
    };
    return g.__syncWorker_getBackoffUntil();
  });
}

/** Drive gameEventClient.reportBug from the test runner. */
export async function reportBug(
  page: Page,
  args: {
    level?: "warn" | "error" | "fatal";
    source?: string;
    message?: string;
    context?: Record<string, unknown>;
  } = {},
): Promise<void> {
  const {
    level = "warn",
    source = "e2e",
    message = "test bug",
    context = {},
  } = args;
  await page.evaluate(
    (a: {
      level: "warn" | "error" | "fatal";
      source: string;
      message: string;
      context: Record<string, unknown>;
    }) => {
      const g = globalThis as unknown as {
        __gameEventClient_reportBug: (
          lvl: "warn" | "error" | "fatal",
          src: string,
          m: string,
          c?: Record<string, unknown>,
        ) => void;
      };
      g.__gameEventClient_reportBug(a.level, a.source, a.message, a.context);
    },
    { level, source, message, context },
  );
}

/** Run the TTL sweep. Optionally pass an override `now` to pin the cutoff. */
export async function sweepTTL(page: Page, now?: number): Promise<number> {
  return page.evaluate(async (nowArg: number | undefined) => {
    const g = globalThis as unknown as {
      __eventStore_sweepTTL: (n?: number) => Promise<number>;
    };
    return await g.__eventStore_sweepTTL(nowArg);
  }, now);
}

/**
 * Inject a synthetic delay (ms) into every EventStore enqueue call.
 * Used by scenario 8 (non-blocking proof) to prove gameplay stays
 * responsive when AsyncStorage writes are slow. Pass 0 to clear.
 */
export async function setSyntheticDelay(page: Page, ms: number): Promise<void> {
  await page.evaluate((delay: number) => {
    const g = globalThis as unknown as {
      __eventStore_setSyntheticDelay: (n: number) => void;
    };
    g.__eventStore_setSyntheticDelay(delay);
  }, ms);
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

export async function seedEvents(
  page: Page,
  spec: SeedEventSpec,
): Promise<void> {
  await page.evaluate(async (s: SeedEventSpec) => {
    const g = globalThis as unknown as {
      __gameEventClient_seedEvents: (s: SeedEventSpec) => Promise<void>;
    };
    await g.__gameEventClient_seedEvents(s);
  }, spec);
}

export async function seedBugLogs(
  page: Page,
  spec: SeedBugLogSpec,
): Promise<void> {
  await page.evaluate(async (s: SeedBugLogSpec) => {
    const g = globalThis as unknown as {
      __gameEventClient_seedBugLogs: (s: SeedBugLogSpec) => Promise<void>;
    };
    await g.__gameEventClient_seedBugLogs(s);
  }, spec);
}

/**
 * Seed a mix of rows across all four priority tiers in a single batch.
 * Used by eviction scenarios (#480, #486) that need to compose large
 * fixtures.
 *
 * Timestamps are explicitly staggered across tiers so ordering is
 * deterministic under the #486 age-based eviction policy: P3 rows are
 * the oldest, then P2, then P1, then P0 (newest). Each tier reserves a
 * 10,000,000 ms slot, which is wider than any plausible fixture size,
 * so within-tier FIFO offsets can't leak into the next tier's slot.
 * Base time is anchored far enough in the past that TTL sweeps don't
 * accidentally expire the rows.
 */
export async function seedEvictionFixture(
  page: Page,
  counts: { p0?: number; p1?: number; p2?: number; p3?: number },
): Promise<void> {
  const { p0 = 0, p1 = 0, p2 = 0, p3 = 0 } = counts;
  // Anchor all seeded rows ~11 h in the past so every staggered slot
  // still lands before Date.now() and comfortably inside TTL_MS (7 d).
  const TIER_SLOT = 10_000_000;
  const base = Date.now() - 4 * TIER_SLOT;
  if (p3)
    await seedEvents(page, {
      count: p3,
      priority: 3,
      eventType: "move",
      createdAt: base,
    });
  if (p2)
    await seedEvents(page, {
      count: p2,
      priority: 2,
      eventType: "score",
      createdAt: base + TIER_SLOT,
    });
  if (p1)
    await seedEvents(page, {
      count: p1,
      priority: 1,
      eventType: "game_started",
      createdAt: base + 2 * TIER_SLOT,
    });
  if (p0)
    await seedBugLogs(page, {
      count: p0,
      createdAt: base + 3 * TIER_SLOT,
    });
}

// ---------------------------------------------------------------------------
// logConfig scoped override
// ---------------------------------------------------------------------------

export async function withLogConfigOverride<T>(
  page: Page,
  overrides: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  await page.evaluate((o: Record<string, unknown>) => {
    const g = globalThis as unknown as {
      __logConfig_override: (p: Record<string, unknown>) => void;
    };
    g.__logConfig_override(o);
  }, overrides);
  try {
    return await fn();
  } finally {
    await resetLogConfig(page);
  }
}

// ---------------------------------------------------------------------------
// Latency probe
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, idx)];
}

/**
 * Run `count` synchronous enqueue calls inside the page and capture
 * per-call latency via `performance.now()`. Returns p50/p99/max/mean.
 * Used by scenario 2 — latency budget.
 */
export async function latencyProbe(
  page: Page,
  { count, gameType = "yacht" }: { count: number; gameType?: string },
): Promise<LatencyStats> {
  const samples = await page.evaluate(
    async (args: { count: number; gameType: string }) => {
      const g = globalThis as unknown as {
        __gameEventClient_startGame: (gt: string) => string;
        __gameEventClient_enqueueEvent: (
          id: string,
          ev: { type: string; data?: Record<string, unknown> },
        ) => void;
      };
      const gameId = g.__gameEventClient_startGame(args.gameType);
      const out: number[] = new Array(args.count);
      for (let i = 0; i < args.count; i += 1) {
        const t0 = performance.now();
        g.__gameEventClient_enqueueEvent(gameId, { type: "move", data: { i } });
        out[i] = performance.now() - t0;
      }
      return out;
    },
    { count, gameType },
  );
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length);
  return {
    p50: percentile(sorted, 50),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? 0,
    min: sorted[0] ?? 0,
    mean,
    samples: samples.length,
  };
}

// ---------------------------------------------------------------------------
// Memory sampling via page.metrics() — JSHeapUsedSize is the best proxy we
// have in desktop Chromium. Mobile native-memory coverage is a separate
// follow-up (tracked in #482's description).
// ---------------------------------------------------------------------------

interface MemorySample {
  jsHeapUsedBytes: number;
  layoutCount: number;
}

export interface MemorySampler {
  baseline(): Promise<MemorySample>;
  growthBytes(): Promise<number>;
  currentMB(): Promise<number>;
}

export function createMemorySampler(page: Page): MemorySampler {
  let base: MemorySample | null = null;
  return {
    async baseline() {
      base = await readMetrics(page);
      return base;
    },
    async growthBytes() {
      if (!base) throw new Error("memorySampler: call baseline() first");
      const now = await readMetrics(page);
      return now.jsHeapUsedBytes - base.jsHeapUsedBytes;
    },
    async currentMB() {
      const now = await readMetrics(page);
      return now.jsHeapUsedBytes / (1024 * 1024);
    },
  };
}

async function readMetrics(page: Page): Promise<MemorySample> {
  // page.metrics() is Chromium-only. Guard so the harness doesn't crash in
  // hypothetical Firefox runs — just returns zeros.
  interface ChromiumPage {
    metrics?: () => Promise<{ JSHeapUsedSize?: number; LayoutCount?: number }>;
  }
  const maybe = page as unknown as ChromiumPage;
  if (typeof maybe.metrics !== "function") {
    return { jsHeapUsedBytes: 0, layoutCount: 0 };
  }
  const m = await maybe.metrics();
  return {
    jsHeapUsedBytes: m.JSHeapUsedSize ?? 0,
    layoutCount: m.LayoutCount ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Frame cadence meter — samples requestAnimationFrame deltas.
// ---------------------------------------------------------------------------

export interface FrameCadence {
  medianDeltaMs: number;
  p99DeltaMs: number;
  dropped: number;
  samples: number;
}

export async function frameCadenceMeter(
  page: Page,
  durationMs: number,
): Promise<FrameCadence> {
  const deltas = await page.evaluate(async (ms: number) => {
    return await new Promise<number[]>((resolve) => {
      const out: number[] = [];
      let last = performance.now();
      const end = last + ms;
      function tick(now: number) {
        out.push(now - last);
        last = now;
        if (now < end) requestAnimationFrame(tick);
        else resolve(out);
      }
      requestAnimationFrame(tick);
    });
  }, durationMs);
  const sorted = [...deltas].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const p99 = percentile(sorted, 99);
  // A dropped frame = delta > 32ms (two frames at 60fps).
  const dropped = deltas.filter((d) => d > 32).length;
  return {
    medianDeltaMs: median,
    p99DeltaMs: p99,
    dropped,
    samples: deltas.length,
  };
}

// ---------------------------------------------------------------------------
// Mock sync endpoints — Playwright route() scripted responder
// ---------------------------------------------------------------------------

export interface MockResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Abort the request as a network failure. */
  abort?: boolean;
}

export interface MockMatcher {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  pathRegex: RegExp;
  response: MockResponse;
}

/**
 * Script backend responses for /games/** and /logs/** so tests can simulate
 * 500s, 429s, 413s, etc. Each entry matches once per FIFO order; unmatched
 * requests fall through to `defaultResponse`.
 */
export function mockSyncEndpoints(
  page: Page,
  opts: {
    defaultResponse?: MockResponse;
    apiBase?: string;
  } = {},
) {
  const apiBase = opts.apiBase ?? "http://localhost:8000";
  const script: MockMatcher[] = [];
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  // Boxed so `setDefaultResponse` can swap it mid-test. Used by scenarios
  // that need to flip offline → online without tearing down the route.
  const state = {
    defaultResponse: (opts.defaultResponse ?? {
      status: 200,
      body: { accepted: 0, duplicates: 0, rejected: [] },
    }) as MockResponse,
  };

  const handler = async (
    route: Parameters<Parameters<Page["route"]>[1]>[0],
  ) => {
    const request = route.request();
    const url = request.url();
    const method = request.method() as MockMatcher["method"];
    let body: unknown = null;
    try {
      body = JSON.parse(request.postData() ?? "null");
    } catch {
      body = request.postData();
    }
    calls.push({ method, url, body });

    const idx = script.findIndex(
      (m) => m.method === method && m.pathRegex.test(url),
    );
    const entry = idx !== -1 ? script.splice(idx, 1)[0] : null;
    const resp = entry ? entry.response : state.defaultResponse;
    if (resp.abort) {
      await route.abort("failed");
      return;
    }
    // Playwright's `fulfill({ headers })` only propagates headers that
    // aren't implicitly set by contentType. Merge Content-Type into the
    // headers map instead of passing contentType separately so custom
    // headers like Retry-After reach the response.
    await route.fulfill({
      status: resp.status,
      headers: { "content-type": "application/json", ...(resp.headers ?? {}) },
      body: JSON.stringify(resp.body ?? {}),
    });
  };

  return {
    install: async () => {
      // Regex patterns so we catch both the collection endpoint (POST
      // /games with no suffix — game creation) and item endpoints
      // (POST /games/:id/events, PATCH /games/:id/complete, POST /logs/bug).
      // A glob like `/games/**` wouldn't match `/games` itself.
      const escaped = apiBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      await page.route(new RegExp(`^${escaped}/games(/.*)?$`), handler);
      await page.route(new RegExp(`^${escaped}/logs(/.*)?$`), handler);
    },
    onNext: (
      matcher: Omit<MockMatcher, "response">,
      response: MockResponse,
    ) => {
      script.push({ ...matcher, response });
    },
    /** Replace the fallback response returned when no `onNext` entry matches. */
    setDefaultResponse: (response: MockResponse) => {
      state.defaultResponse = response;
    },
    calls,
  };
}

// ---------------------------------------------------------------------------
// CPU throttling — Chromium DevTools Protocol. Mid-tier mobile ≈ 4×.
// ---------------------------------------------------------------------------

/**
 * Apply CPU throttling via CDP. Playwright doesn't expose
 * Emulation.setCPUThrottlingRate as a first-class API yet, so we drop to
 * CDPSession. Safe no-op in non-Chromium.
 */
export async function applyCpuThrottle(page: Page, rate = 4): Promise<void> {
  interface ChromiumContext {
    newCDPSession?: (p: Page) => Promise<{
      send: (
        method: string,
        params: Record<string, unknown>,
      ) => Promise<unknown>;
      detach: () => Promise<void>;
    }>;
  }
  const ctx = page.context() as unknown as ChromiumContext;
  if (typeof ctx.newCDPSession !== "function") return;
  const client = await ctx.newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate });
}

// ---------------------------------------------------------------------------
// Flush helper
// ---------------------------------------------------------------------------

/**
 * Run one SyncWorker flush. By default it releases the gameplay rows an open
 * session holds (#3275), like a trip to the background; pass
 * `{ releaseHeld: false }` to flush as the foreground interval does.
 */
export async function triggerFlush(
  page: Page,
  opts?: { releaseHeld?: boolean },
): Promise<void> {
  await page.evaluate(async (o) => {
    const g = globalThis as unknown as {
      __syncWorker_flush: (opts?: {
        releaseHeld?: boolean;
      }) => Promise<unknown>;
    };
    await g.__syncWorker_flush(o);
  }, opts);
}

// ---------------------------------------------------------------------------
// Re-export expect for convenience so specs only import from one place
// ---------------------------------------------------------------------------

export { expect };
