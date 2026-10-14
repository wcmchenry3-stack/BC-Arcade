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

  it("is a sliding window: 9 sends at t=59min, then t=61min is still capped at 10", () => {
    let now = 0;
    const t = new SentryThrottle({ now: () => now, maxPerHour: 10 });
    expect(t.allow("first")).toBe(true); // t=0
    now = 59 * 60 * 1000;
    for (let i = 0; i < 9; i += 1) expect(t.allow(`k${i}`)).toBe(true);
    // t=61min: the t=0 send has left the window, 9 remain, so one more fits and then it is full.
    now = 61 * 60 * 1000;
    expect(t.allow("a")).toBe(true);
    expect(t.allow("b")).toBe(false);
    expect(t.allow("c")).toBe(false);
  });

  it("gives error/fatal their own budget, so warnings cannot starve an error", () => {
    const t = new SentryThrottle({ now: () => 0, maxPerHour: 2 });
    expect(t.allow("w1", "warning")).toBe(true);
    expect(t.allow("w2", "info")).toBe(true);
    expect(t.allow("w3", "warning")).toBe(false);
    expect(t.allow("e1", "error")).toBe(true);
    expect(t.allow("e2", "fatal")).toBe(true);
    expect(t.allow("e3", "error")).toBe(false);
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

  async function run(
    eventsRes: SyncResponse,
    completeRes?: SyncResponse,
    gamesRes?: SyncResponse,
    bugRes?: SyncResponse,
    clearMock = true
  ): Promise<void> {
    await AsyncStorage.clear();
    resetLogConfig();
    const store = new EventStore();
    const games = new PendingGamesStore();
    const client = new GameEventClientImpl(store, games, new BugReportLimiter());
    await client.init();
    const api = {
      request: async (_m: string, p: string): Promise<SyncResponse> => {
        if (p === "/games" && gamesRes) return gamesRes;
        if (p === "/logs/bug" && bugRes) return bugRes;
        if (p.endsWith("/events")) return eventsRes;
        if (p.endsWith("/complete") && completeRes) return completeRes;
        return ok();
      },
    } as unknown as SyncApi;
    const worker = new SyncWorker(store, games, api);
    if (clearMock) Sentry.captureMessage.mockClear();
    try {
      for (let i = 0; i < FLUSHES; i += 1) {
        for (let j = 0; j < GAMES / FLUSHES; j += 1) {
          const gid = client.startGame("yacht");
          client.markStarted(gid);
          client.enqueueEvent(gid, { type: "roll" });
          if (bugRes && j === 0) client.reportBug("warn", `src${i}`, "x");
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
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("POST /games 403 for 100 games reports once", async () => {
    await run(ok(), undefined, { status: 403, ok: false, retryAfterMs: null, body: null });
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expectBounded();
  });

  it("single-row events 413 for 100 games reports once", async () => {
    await run({ status: 413, ok: false, retryAfterMs: null, body: null });
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expectBounded();
  });

  it("events 404 for 100 games reports once", async () => {
    await run({ status: 404, ok: false, retryAfterMs: null, body: null });
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expectBounded();
  });

  it("logs/bug 400 reports once", async () => {
    await run(ok(), undefined, undefined, {
      status: 400,
      ok: false,
      retryAfterMs: null,
      body: null,
    });
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expectBounded();
  });

  it("400 unknown_event_type and 400 other can each report once in the same window", async () => {
    await run({
      status: 400,
      ok: false,
      retryAfterMs: null,
      body: { detail: { error: "unknown_event_type" } },
    });
    await run(
      { status: 400, ok: false, retryAfterMs: null, body: { detail: "bad" } },
      undefined,
      undefined,
      undefined,
      false
    );
    const fps = Sentry.captureMessage.mock.calls.map(
      (c: [string, { fingerprint: string[] }]) => c[1].fingerprint[0]
    );
    expect(fps).toEqual(["syncWorker.events.unknown_event_type", "syncWorker.events.400"]);
  });

  it("counts the dropped repeats instead of sending them", async () => {
    await run({ status: 403, ok: false, retryAfterMs: null, body: { detail: "no" } });
    expect(sentryThrottle.droppedCount).toBeGreaterThan(0);
  });
});

describe("unknown-game breadcrumb", () => {
  it("is fixed text with the id in data, once per game id", async () => {
    await AsyncStorage.clear();
    const client = new GameEventClientImpl(
      new EventStore(),
      new PendingGamesStore(),
      new BugReportLimiter()
    );
    await client.init();
    Sentry.addBreadcrumb.mockClear();
    for (let i = 0; i < 5; i += 1) client.enqueueEvent("not-a-game-1", { type: "roll" });
    client.enqueueEvent("not-a-game-2", { type: "roll" });
    const calls = Sentry.addBreadcrumb.mock.calls.filter(
      (c: [{ category: string }]) => c[0].category === "gameEventClient.dropped"
    );
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toMatchObject({
      message: "enqueueEvent on unknown game",
      data: { gameId: "not-a-game-1" },
    });
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

  // Placeholders known to be low cardinality (or text we do not control per game).
  const SAFE =
    /^(res\.status|status|method|routeTemplate\(path\)|route|apiTag|source|level|event|reason|BASE_URL|platform|subsystem|op)$/;
  const ID_LIKE = /(game_?id|session_?id|uuid|\bid\b|path|url)/i;

  /** Placeholders in Sentry message templates that are neither allowlisted nor id-free. */
  function badPlaceholders(text: string): string[] {
    const re = /(captureMessage\(|captureThrottledMessage\([^,]+,|message:)\s*`([^`]*)`/g;
    const out: string[] = [];
    for (const m of text.matchAll(re)) {
      for (const p of (m[2] ?? "").matchAll(/\$\{([^}]*)\}/g)) {
        const expr = (p[1] ?? "").trim();
        if (!SAFE.test(expr) && ID_LIKE.test(expr)) out.push(`${m[1]} ... \${${expr}}`);
      }
    }
    return out;
  }

  it("catches the old gameEventClient breadcrumb and the old syncWorker messages", () => {
    expect(
      badPlaceholders("Sentry.addBreadcrumb({ message: `enqueueEvent on unknown game ${gameId}` })")
    ).toHaveLength(1);
    expect(
      badPlaceholders("Sentry.captureMessage(`syncWorker: 404 on ${gameId}; x`, {})")
    ).toHaveLength(1);
    expect(
      badPlaceholders("captureThrottledMessage(k, `x ${res.status} on ${game.id}`, {})")
    ).toHaveLength(1);
    expect(badPlaceholders("addBreadcrumb({ message: `${method} ${path} -> x` })")).toHaveLength(1);
    expect(
      badPlaceholders("addBreadcrumb({ message: `${method} ${routeTemplate(path)}` })")
    ).toEqual([]);
  });

  it("no Sentry message template in frontend/src interpolates an id", () => {
    const root = path.resolve(__dirname, "../../..");
    const offenders: string[] = [];
    for (const file of sourceFiles(root)) {
      // httpClient's request breadcrumbs carry the route being called (no quota cost, and
      // its routes hold no game ids); every other file is held to the allowlist.
      if (file.endsWith("httpClient.ts")) continue;
      for (const b of badPlaceholders(fs.readFileSync(file, "utf8"))) {
        offenders.push(`${path.relative(root, file)}: ${b}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
