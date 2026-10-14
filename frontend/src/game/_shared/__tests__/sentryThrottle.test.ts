/**
 * Sentry throttle (#3293): unit behaviour, SyncWorker volume under a
 * sustained outage, and a source scan that keeps ids out of message text.
 */

import * as fs from "fs";
import * as path from "path";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { EventStore } from "../eventStore";
import { GameEventClientImpl } from "../gameEventClient";
import { PendingGamesStore } from "../pendingGamesStore";
import { BugReportLimiter } from "../bugReportLimiter";
import { resetLogConfig } from "../eventQueueConfig";
import {
  HOUR_MS,
  SentryThrottle,
  captureThrottledMessage,
  sentryThrottle,
} from "../sentryThrottle";
import { SyncWorker } from "../syncWorker";
import type { SyncApi, SyncResponse } from "../syncApi";
import { flushMicro, ok } from "./helpers/syncWorkerFixtures";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Sentry = require("@sentry/react-native");

describe("SentryThrottle", () => {
  it("passes the first call and drops repeats of the same key", () => {
    const t = new SentryThrottle({ now: () => 0 });
    expect(t.allow("a")).toBe(true);
    expect(t.allow("a")).toBe(false);
    expect(t.allow("a")).toBe(false);
    expect(t.allow("b")).toBe(true);
    expect(t.droppedCount).toBe(2);
  });

  it("resets the per-key window when perKeyWindowMs has passed", () => {
    let now = 0;
    const t = new SentryThrottle({ now: () => now, perKeyWindowMs: 1000 });
    expect(t.allow("a")).toBe(true);
    now = 999;
    expect(t.allow("a")).toBe(false);
    now = 1000;
    expect(t.allow("a")).toBe(true);
  });

  it("caps events per hour across keys and resets the hour window", () => {
    let now = 0;
    const t = new SentryThrottle({ now: () => now, maxPerHour: 3 });
    expect(["a", "b", "c", "d"].map((k) => t.allow(k))).toEqual([true, true, true, false]);
    now = HOUR_MS - 1;
    expect(t.allow("e")).toBe(false);
    now = HOUR_MS;
    expect(t.allow("f")).toBe(true);
  });

  it("reports drops as a counter on the next event that gets through", () => {
    let now = 0;
    const t = new SentryThrottle({ now: () => now, perKeyWindowMs: 10 });
    Sentry.captureMessage.mockClear();
    expect(captureThrottledMessage("k", "m", { level: "warning" }, t)).toBe(true);
    expect(captureThrottledMessage("k", "m", { level: "warning" }, t)).toBe(false);
    expect(captureThrottledMessage("k", "m", { level: "warning" }, t)).toBe(false);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    now = 10;
    captureThrottledMessage("k", "m", { level: "warning", extra: { x: 1 } }, t);
    expect(Sentry.captureMessage).toHaveBeenLastCalledWith(
      "m",
      expect.objectContaining({
        fingerprint: ["k"],
        extra: { x: 1, sentryThrottleDropped: 2 },
      })
    );
  });
});

describe("SyncWorker Sentry volume under a sustained outage", () => {
  const GAMES = 100;
  const FLUSHES = 50;

  async function run(eventsRes: SyncResponse, completeRes?: SyncResponse): Promise<void> {
    await AsyncStorage.clear();
    resetLogConfig();
    const store = new EventStore();
    const games = new PendingGamesStore();
    const client = new GameEventClientImpl(store, games, new BugReportLimiter());
    await client.init();
    const api = {
      request: async (_m: string, p: string): Promise<SyncResponse> => {
        if (p.endsWith("/events")) return eventsRes;
        if (p.endsWith("/complete") && completeRes) return completeRes;
        return ok();
      },
    } as unknown as SyncApi;
    const worker = new SyncWorker(store, games, api);
    Sentry.captureMessage.mockClear();
    try {
      for (let i = 0; i < FLUSHES; i += 1) {
        for (let j = 0; j < GAMES / FLUSHES; j += 1) {
          const gid = client.startGame("yacht");
          client.markStarted(gid);
          client.enqueueEvent(gid, { type: "roll" });
          if (completeRes) client.completeGame(gid, { finalScore: 1, outcome: "completed" });
        }
        await flushMicro();
        await worker.flush();
      }
    } finally {
      worker.stop();
    }
  }

  function expectBounded(): void {
    const calls = Sentry.captureMessage.mock.calls as Array<
      [string, { fingerprint?: string[]; extra?: { gameId?: string } }]
    >;
    expect(calls.length).toBeLessThanOrEqual(3);
    expect(new Set(calls.map((c) => c[1].fingerprint?.join("|"))).size).toBe(calls.length ? 1 : 0);
    for (const [msg] of calls) expect(msg).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  }

  it("400 unknown_event_type for 100 games over 50 flushes", async () => {
    await run({
      status: 400,
      ok: false,
      retryAfterMs: null,
      body: { detail: { error: "unknown_event_type" } },
    });
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expectBounded();
  });

  it("403 on events for 100 games over 50 flushes", async () => {
    await run({ status: 403, ok: false, retryAfterMs: null, body: { detail: "no" } });
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expectBounded();
  });

  it("403 on PATCH /complete for 100 games over 50 flushes", async () => {
    await run(ok(), { status: 403, ok: false, retryAfterMs: null, body: { detail: "no" } });
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expectBounded();
  });

  it("500 on events for 100 games over 50 flushes", async () => {
    await run({ status: 500, ok: false, retryAfterMs: null, body: null });
    expectBounded();
  });

  it("counts the dropped repeats instead of sending them", async () => {
    await run({ status: 403, ok: false, retryAfterMs: null, body: { detail: "no" } });
    expect(sentryThrottle.droppedCount).toBeGreaterThan(0);
  });
});

describe("no interpolated ids in Sentry message text", () => {
  function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === "__tests__" ? [] : sourceFiles(full);
      return /\.(ts|tsx)$/.test(e.name) ? [full] : [];
    });
  }

  it("no captureMessage / breadcrumb message template interpolates an id", () => {
    const root = path.resolve(__dirname, "../../..");
    const offenders: string[] = [];
    for (const file of sourceFiles(root)) {
      const text = fs.readFileSync(file, "utf8");
      // First argument of captureMessage, second of captureThrottledMessage, or a
      // `message:` field, written as a template literal with an id-like placeholder.
      const re = /(captureMessage\(|captureThrottledMessage\([^,]+,|message:)\s*`([^`]*)`/g;
      for (const m of text.matchAll(re)) {
        // Breadcrumb `message:` is only checked in syncWorker (gameEventClient is the recorder's).
        if (m[1] === "message:" && !file.endsWith("syncWorker.ts")) continue;
        if (/\$\{[^}]*(gameId|game_id|sessionId|session_id|\bid\b|uuid)[^}]*\}/i.test(m[2] ?? "")) {
          offenders.push(`${path.relative(root, file)}: ${m[0].slice(0, 80)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
