/**
 * The replay dial (#3279): which dial a game gets, the per-session sample, and
 * the fail-safe — a bad or missing response keeps the last-known dial, else
 * the default (enabled, 10 %), and a last-known dial older than 30 days is
 * not trusted (owner decision D4-B, #3353).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import {
  REPLAY_DEFAULT_SAMPLE_RATE,
  REPLAY_DIAL_MAX_AGE_MS,
  REPLAY_DIAL_REFRESH_MS,
} from "../eventQueueConfig";
import {
  __resetReplayDialForTests,
  decideReplay,
  dialFor,
  hydrate,
  isRecordingEnabled,
  replayBucket,
  type ReplayDial,
} from "../replayDial";
import {
  __resetReplayDialSyncForTests,
  refresh,
  refreshIfStale,
  startReplayDial,
} from "../replayDialSync";
import type { SyncApi, SyncResponse } from "../syncApi";
import { generateUUID } from "../uuid";

/** Both modules' state: the dial held (and its fallback) and the fetch's API. */
function reset(options: { fallback?: ReplayDial; api?: Pick<SyncApi, "request"> } = {}): void {
  __resetReplayDialForTests({ fallback: options.fallback });
  __resetReplayDialSyncForTests({ api: options.api });
}

const KEY = "replayDial.v1";
const DEFAULT = { enabled: true, rate: REPLAY_DEFAULT_SAMPLE_RATE };

/** A scripted catalog endpoint: each call takes the next response (or throws). */
function catalogApi(...responses: (SyncResponse | Error)[]) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  return {
    calls,
    async request(method: string, path: string, body: unknown): Promise<SyncResponse> {
      calls.push({ method, path, body });
      const next = responses.shift();
      if (next === undefined) throw new Error("no scripted response");
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

const ok = (body: unknown): SyncResponse => ({ status: 200, ok: true, retryAfterMs: null, body });
const status = (code: number): SyncResponse => ({
  status: code,
  ok: false,
  retryAfterMs: null,
  body: null,
});

function catalog(dials: Record<string, { enabled: boolean; sample_rate: unknown }>) {
  return {
    items: Object.entries(dials).map(([name, replay]) => ({
      id: 1,
      name,
      display_name: name,
      is_active: true,
      replay,
    })),
  };
}

const ids = (n: number) => Array.from({ length: n }, () => generateUUID());

describe("replay dial (#3279)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    reset();
    jest.clearAllMocks();
  });

  describe("the sample", () => {
    it("0 % never uploads in full and 100 % always does", () => {
      const games = ids(500);
      reset({ fallback: { enabled: true, rate: 0 } });
      expect(games.every((id) => decideReplay("yacht", id) === "local")).toBe(true);
      reset({ fallback: { enabled: true, rate: 1 } });
      expect(games.every((id) => decideReplay("yacht", id) === "full")).toBe(true);
    });

    it("10 % of 10,000 ids land in full, within 1 %", () => {
      const full = ids(10_000).filter((id) => decideReplay("yacht", id) === "full").length;
      expect(full / 10_000).toBeGreaterThanOrEqual(0.09);
      expect(full / 10_000).toBeLessThanOrEqual(0.11);
    });

    it("the same id always gets the same result", () => {
      for (const id of ids(200)) {
        const first = decideReplay("hearts", id);
        for (let i = 0; i < 3; i += 1) expect(decideReplay("hearts", id)).toBe(first);
        expect(replayBucket(id)).toBe(replayBucket(id));
      }
      expect(replayBucket("00000000-0000-4000-8000-000000000000")).toBe(
        replayBucket("00000000-0000-4000-8000-000000000000")
      );
    });

    it("a bucket is in range", () => {
      for (const id of ids(1_000)) {
        const b = replayBucket(id);
        expect(Number.isInteger(b) && b >= 0 && b < 10_000).toBe(true);
      }
    });

    it("the flag off is off whatever the rate", () => {
      reset({ fallback: { enabled: false, rate: 1 } });
      expect(decideReplay("yacht", generateUUID())).toBe("off");
      expect(isRecordingEnabled("yacht")).toBe(false);
    });
  });

  describe("which dial a game gets", () => {
    it("with nothing stored and nothing fetched: the default, enabled at 10 %", async () => {
      await hydrate();
      expect(dialFor("yacht")).toEqual(DEFAULT);
      expect(isRecordingEnabled("yacht")).toBe(true);
    });

    it("a fresh fetch wins, and a game the catalog does not list gets the default", async () => {
      reset({
        api: catalogApi(ok(catalog({ yacht: { enabled: false, sample_rate: 0.5 } }))),
      });
      expect(await refresh()).toBe(true);
      expect(dialFor("yacht")).toEqual({ enabled: false, rate: 0.5 });
      expect(dialFor("hearts")).toEqual(DEFAULT);
    });

    it("the fetch is a GET of the catalog with no body", async () => {
      const api = catalogApi(ok(catalog({ yacht: { enabled: true, sample_rate: 0.2 } })));
      reset({ api });
      await refresh();
      expect(api.calls).toEqual([{ method: "GET", path: "/games/catalog", body: undefined }]);
    });

    it("a stored dial younger than 30 days is used; an older one falls back to the default", async () => {
      const now = Date.now();
      const games = { yacht: { e: true, r: 1 } };
      await AsyncStorage.setItem(KEY, JSON.stringify({ fetchedAt: now - 1000, games }));
      await hydrate();
      expect(dialFor("yacht", now)).toEqual({ enabled: true, rate: 1 });
      expect(dialFor("yacht", now - 1000 + REPLAY_DIAL_MAX_AGE_MS - 1)).toEqual({
        enabled: true,
        rate: 1,
      });
      // An old "100 %" never sticks.
      expect(dialFor("yacht", now - 1000 + REPLAY_DIAL_MAX_AGE_MS)).toEqual(DEFAULT);
    });

    it("a stored dial is read once, and a fetch made meanwhile is not overwritten by it", async () => {
      const stale = { fetchedAt: Date.now(), games: { yacht: { e: false, r: 0 } } };
      await AsyncStorage.setItem(KEY, JSON.stringify(stale));
      reset({
        api: catalogApi(ok(catalog({ yacht: { enabled: true, sample_rate: 0.3 } }))),
      });
      await refresh();
      await hydrate();
      await hydrate();
      expect(dialFor("yacht")).toEqual({ enabled: true, rate: 0.3 });
      expect(
        (AsyncStorage.getItem as jest.Mock).mock.calls.filter((c) => c[0] === KEY)
      ).toHaveLength(1);
    });

    it("a stored dial dated in the future (clock moved back) is stale: the default (N2)", async () => {
      const now = Date.now();
      const games = { yacht: { e: true, r: 1 } };
      await AsyncStorage.setItem(KEY, JSON.stringify({ fetchedAt: now + 60_000, games }));
      await hydrate();
      expect(dialFor("yacht", now)).toEqual(DEFAULT);
      // Once the clock reaches it, it is an ordinary stored dial again.
      expect(dialFor("yacht", now + 60_000)).toEqual({ enabled: true, rate: 1 });
    });

    it("a corrupt stored dial is ignored", async () => {
      for (const raw of [
        "not json",
        JSON.stringify({ fetchedAt: "x", games: {} }),
        JSON.stringify({ fetchedAt: 1, games: { yacht: { e: true, r: 2 } } }),
        JSON.stringify({ fetchedAt: Date.now(), games: { yacht: { e: "yes", r: 0.5 } } }),
      ]) {
        reset();
        await AsyncStorage.setItem(KEY, raw);
        await hydrate();
        expect(dialFor("yacht")).toEqual(DEFAULT);
      }
    });

    it("startReplayDial hydrates, then fetches once", async () => {
      const stored = { fetchedAt: Date.now(), games: { yacht: { e: true, r: 0.7 } } };
      await AsyncStorage.setItem(KEY, JSON.stringify(stored));
      const api = catalogApi(ok(catalog({ yacht: { enabled: true, sample_rate: 0.2 } })));
      reset({ api });
      expect(await startReplayDial()).toBe(true);
      expect(api.calls).toHaveLength(1);
      expect(dialFor("yacht")).toEqual({ enabled: true, rate: 0.2 });
    });
  });

  describe("fail-safe: a bad response keeps the last-known dial", () => {
    const good = { fetchedAt: 0, games: { yacht: { e: true, r: 0.4 } } };

    it.each([
      ["offline (network error)", status(0)],
      ["a 5xx", status(503)],
      ["a 404", status(404)],
      ["a thrown error", new Error("boom")],
      ["a body that is not a catalog", ok({ detail: "nope" })],
      ["no items", ok({ items: [] })],
      ["an item without a dial (an older backend)", ok({ items: [{ name: "yacht" }] })],
      ["a rate over 1", ok(catalog({ yacht: { enabled: true, sample_rate: 1.5 } }))],
      ["a negative rate", ok(catalog({ yacht: { enabled: true, sample_rate: -0.1 } }))],
      ["a rate that is not a number", ok(catalog({ yacht: { enabled: true, sample_rate: "1" } }))],
      [
        "one bad item among good ones",
        ok(
          catalog({
            hearts: { enabled: true, sample_rate: 0.9 },
            yacht: { enabled: true, sample_rate: Number.NaN },
          })
        ),
      ],
    ])("%s", async (_label, response) => {
      await AsyncStorage.setItem(KEY, JSON.stringify({ ...good, fetchedAt: Date.now() }));
      const before = await AsyncStorage.getItem(KEY);
      reset({ api: catalogApi(response) });
      await hydrate();
      expect(await refresh()).toBe(false);
      expect(dialFor("yacht")).toEqual({ enabled: true, rate: 0.4 });
      expect(dialFor("hearts")).toEqual(DEFAULT);
      expect(await AsyncStorage.getItem(KEY)).toBe(before); // nothing stored
      // And nothing reported: a failed fetch is no Sentry event.
      expect(Sentry.captureException).not.toHaveBeenCalled();
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it("with nothing stored, a bad response leaves the default", async () => {
      reset({ api: catalogApi(status(500)) });
      await hydrate();
      expect(await refresh()).toBe(false);
      expect(dialFor("yacht")).toEqual(DEFAULT);
    });

    it("a valid response is stored for the next launch", async () => {
      reset({
        api: catalogApi(ok(catalog({ yacht: { enabled: false, sample_rate: 0 } }))),
      });
      await refresh(5_000);
      expect(JSON.parse((await AsyncStorage.getItem(KEY)) ?? "null")).toEqual({
        fetchedAt: 5_000,
        games: { yacht: { e: false, r: 0 } },
      });
    });

    it("an unwritable store still applies the fetched dial for this process", async () => {
      (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error("disk full"));
      reset({
        api: catalogApi(ok(catalog({ yacht: { enabled: true, sample_rate: 0.6 } }))),
      });
      expect(await refresh()).toBe(true);
      expect(dialFor("yacht").rate).toBe(0.6);
    });
  });

  describe("how often it fetches", () => {
    it("on foreground only once REPLAY_DIAL_REFRESH_MS has passed since the last attempt", async () => {
      const body = ok(catalog({ yacht: { enabled: true, sample_rate: 0.1 } }));
      const api = catalogApi(body, body, body);
      reset({ api });
      const t0 = 1_000_000;
      await refresh(t0); // the launch
      expect(await refreshIfStale(t0 + 1)).toBe(false);
      expect(await refreshIfStale(t0 + REPLAY_DIAL_REFRESH_MS - 1)).toBe(false);
      expect(api.calls).toHaveLength(1);
      expect(await refreshIfStale(t0 + REPLAY_DIAL_REFRESH_MS)).toBe(true);
      expect(api.calls).toHaveLength(2);
    });

    it("a failed attempt also waits the hour (no retry storm while offline)", async () => {
      const api = catalogApi(status(0), status(0));
      reset({ api });
      await refresh(0);
      for (let t = 1; t < 10; t += 1) await refreshIfStale(t * 60_000);
      expect(api.calls).toHaveLength(1);
    });

    it("a last attempt dated in the future (the clock moved back) does not block refreshes", async () => {
      const body = ok(catalog({ yacht: { enabled: true, sample_rate: 0.3 } }));
      const api = catalogApi(body, body);
      reset({ api });
      const t0 = 10 * REPLAY_DIAL_REFRESH_MS;
      await refresh(t0);
      // The clock is set back a day: elapsed time is negative.
      expect(await refreshIfStale(t0 - 24 * REPLAY_DIAL_REFRESH_MS)).toBe(true);
      expect(api.calls).toHaveLength(2);
    });
  });
});
