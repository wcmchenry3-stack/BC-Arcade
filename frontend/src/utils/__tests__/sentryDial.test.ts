/**
 * The app's Sentry dial (#3437, epic #3273): the server's kill switch and
 * sample rate for frontend Sentry volume, read from `GET /games/catalog`.
 *
 * Fail-safes: a missing key, a malformed or out-of-range value, a failed
 * fetch and offline all keep the dial held (the last good one, else today's
 * behaviour: every event); `fatal` is always sent; the #3313 console.error cap
 * still holds under the dial.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import {
  __resetSentryDialForTests,
  acceptSentryDial,
  hydrateSentryDial,
  sentryDial,
  sentryDialAllows,
  sentryDialFilter,
} from "../sentryDial";
import {
  CONSOLE_ERROR_MAX_PER_HOUR,
  installSentryConsoleErrorCapture,
  _resetSentryConsoleErrorCaptureForTests,
} from "../sentryConsoleError";
import { __resetReplayDialForTests } from "../../game/_shared/replayDial";
import {
  __resetReplayDialSyncForTests,
  refresh,
  startReplayDial,
} from "../../game/_shared/replayDialSync";
import type { SyncApi, SyncResponse } from "../../game/_shared/syncApi";

jest.mock("@sentry/react-native", () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

const KEY = "sentryDial.v1";
const DEFAULT = { enabled: true, rate: 1 };

const ok = (body: unknown): SyncResponse => ({ status: 200, ok: true, retryAfterMs: null, body });
const status = (code: number): SyncResponse => ({
  status: code,
  ok: false,
  retryAfterMs: null,
  body: null,
});

/** A catalog with one valid replay item and the given `client_sentry` block (omitted when undefined). */
function catalog(clientSentry?: unknown) {
  const body: Record<string, unknown> = {
    items: [{ id: 1, name: "yacht", replay: { enabled: true, sample_rate: 0.1 } }],
  };
  if (clientSentry !== undefined) body.client_sentry = clientSentry;
  return body;
}

/** A scripted catalog endpoint: each call takes the next response (or throws). */
function catalogApi(...responses: (SyncResponse | Error)[]): Pick<SyncApi, "request"> {
  return {
    async request(): Promise<SyncResponse> {
      const next = responses.shift();
      if (next === undefined || next instanceof Error) throw next ?? new Error("none scripted");
      return next;
    },
  };
}

function reset(api?: Pick<SyncApi, "request">): void {
  __resetSentryDialForTests();
  __resetReplayDialForTests();
  __resetReplayDialSyncForTests({ api });
}

/** A fixed sequence of `random()` values. */
const rng = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length] as number;
};

describe("Sentry dial (#3437)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    reset();
  });

  describe("the default is today's behaviour", () => {
    it("with nothing stored or fetched: on, every event sent", () => {
      expect(sentryDial()).toEqual(DEFAULT);
      expect(sentryDialAllows(() => 0.999999)).toBe(true);
      expect(sentryDialFilter({ level: "error" }, () => 0.999999)).toEqual({ level: "error" });
    });
  });

  describe("off", () => {
    it("drops errors, messages and metrics but keeps fatal", async () => {
      expect(await acceptSentryDial(catalog({ enabled: false, sample_rate: 1 }))).toBe(true);
      const random = jest.fn(() => 0);
      for (const level of ["error", "warning", "info", "debug", undefined]) {
        expect(sentryDialFilter({ level }, random)).toBeNull();
      }
      expect(sentryDialAllows(random)).toBe(false); // metrics
      expect(sentryDialFilter({ level: "fatal" }, random)).toEqual({ level: "fatal" });
      expect(random).not.toHaveBeenCalled();
    });

    it("takes effect on the next launch from the stored value, before any fetch", async () => {
      await acceptSentryDial(catalog({ enabled: false, sample_rate: 1 }));
      __resetSentryDialForTests(); // a relaunch: memory gone, storage kept
      expect(sentryDial()).toEqual(DEFAULT);
      await hydrateSentryDial();
      expect(sentryDial()).toEqual({ enabled: false, rate: 1 });
      expect(sentryDialFilter({ level: "error" })).toBeNull();
    });
  });

  describe("the sample rate is honoured", () => {
    it("keeps an event only when random() < rate", async () => {
      await acceptSentryDial(catalog({ enabled: true, sample_rate: 0.25 }));
      expect(sentryDialFilter({ level: "error" }, () => 0.2499)).not.toBeNull();
      expect(sentryDialFilter({ level: "error" }, () => 0.25)).toBeNull();
      expect(sentryDialFilter({ level: "warning" }, () => 0.9)).toBeNull();
      expect(sentryDialAllows(() => 0.1)).toBe(true);
      expect(sentryDialAllows(() => 0.5)).toBe(false);
    });

    it("sends 25 of 100 events with an evenly spread RNG", async () => {
      await acceptSentryDial(catalog({ enabled: true, sample_rate: 0.25 }));
      const random = rng(...Array.from({ length: 100 }, (_, i) => i / 100));
      const sent = Array.from({ length: 100 }, () =>
        sentryDialFilter({ level: "error" }, random)
      ).filter(Boolean);
      expect(sent).toHaveLength(25);
    });

    it("0 sends nothing but fatal; fatal skips the sample", async () => {
      await acceptSentryDial(catalog({ enabled: true, sample_rate: 0 }));
      expect(sentryDialFilter({ level: "error" }, () => 0)).toBeNull();
      expect(sentryDialFilter({ level: "fatal" }, () => 0.99)).not.toBeNull();
    });

    it("1 sends every event without drawing a random number", async () => {
      await acceptSentryDial(catalog({ enabled: true, sample_rate: 1 }));
      const random = jest.fn(() => 0.99);
      expect(sentryDialFilter({ level: "error" }, random)).not.toBeNull();
      expect(random).not.toHaveBeenCalled();
    });
  });

  describe("fail-safe: anything but a valid block keeps the dial held", () => {
    const bad: [string, unknown][] = [
      ["missing key", undefined],
      ["null", null],
      ["an array", [false, 0]],
      ["enabled not a boolean", { enabled: "false", sample_rate: 0 }],
      ["rate missing", { enabled: false }],
      ["rate a string", { enabled: true, sample_rate: "0.5" }],
      ["rate above 1", { enabled: true, sample_rate: 1.5 }],
      ["rate below 0", { enabled: true, sample_rate: -0.1 }],
      ["rate NaN", { enabled: true, sample_rate: NaN }],
      ["rate Infinity", { enabled: true, sample_rate: Infinity }],
    ];

    it.each(bad)("%s: with nothing held, the default", async (_label, block) => {
      expect(await acceptSentryDial(catalog(block))).toBe(false);
      expect(sentryDial()).toEqual(DEFAULT);
    });

    it.each(bad)("%s: the last good value is kept", async (_label, block) => {
      await acceptSentryDial(catalog({ enabled: true, sample_rate: 0.5 }));
      expect(await acceptSentryDial(catalog(block))).toBe(false);
      expect(sentryDial()).toEqual({ enabled: true, rate: 0.5 });
    });

    it("a body that is not an object keeps the dial", async () => {
      for (const body of [null, "x", 3, []]) expect(await acceptSentryDial(body)).toBe(false);
      expect(sentryDial()).toEqual(DEFAULT);
    });

    it("a corrupt stored value is ignored (the default)", async () => {
      for (const raw of ["{not json", JSON.stringify({ e: "no", r: 2 }), "[]"]) {
        reset();
        await AsyncStorage.setItem(KEY, raw);
        await hydrateSentryDial();
        expect(sentryDial()).toEqual(DEFAULT);
      }
    });

    it("unreadable storage leaves the default", async () => {
      jest.spyOn(AsyncStorage, "getItem").mockRejectedValueOnce(new Error("disk"));
      await hydrateSentryDial();
      expect(sentryDial()).toEqual(DEFAULT);
    });

    it("unwritable storage still applies the fetched dial for this process", async () => {
      jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("full"));
      expect(await acceptSentryDial(catalog({ enabled: false, sample_rate: 0 }))).toBe(true);
      expect(sentryDial()).toEqual({ enabled: false, rate: 0 });
    });

    it("a fetch made while hydrating wins over the stored value", async () => {
      await AsyncStorage.setItem(KEY, JSON.stringify({ e: false, r: 0 }));
      const hydrating = hydrateSentryDial();
      await acceptSentryDial(catalog({ enabled: true, sample_rate: 0.5 }));
      await hydrating;
      expect(sentryDial()).toEqual({ enabled: true, rate: 0.5 });
    });

    it("an unchanged fetched dial is not written again", async () => {
      await acceptSentryDial(catalog({ enabled: true, sample_rate: 0.5 }));
      // The setup's AsyncStorage mock keeps its implementation; count calls, never restore it.
      const setItem = AsyncStorage.setItem as jest.Mock;
      const before = setItem.mock.calls.length;
      await acceptSentryDial(catalog({ enabled: true, sample_rate: 0.5 }));
      expect(setItem.mock.calls.length).toBe(before);
    });
  });

  describe("through the launch catalog fetch (replayDialSync)", () => {
    it("startReplayDial hydrates the stored Sentry dial, then the fetch replaces it", async () => {
      await AsyncStorage.setItem(KEY, JSON.stringify({ e: false, r: 0 }));
      reset(catalogApi(ok(catalog({ enabled: true, sample_rate: 0.3 }))));
      await startReplayDial();
      expect(sentryDial()).toEqual({ enabled: true, rate: 0.3 });
      expect(JSON.parse((await AsyncStorage.getItem(KEY)) as string)).toEqual({ e: true, r: 0.3 });
    });

    it.each([
      ["offline (the request throws)", new Error("Network request failed")],
      ["a 5xx", status(503)],
      ["a 2xx without client_sentry (an older backend)", ok(catalog())],
    ])("%s: the stored last good dial stays in force", async (_label, response) => {
      await AsyncStorage.setItem(KEY, JSON.stringify({ e: false, r: 0 }));
      reset(catalogApi(response));
      await startReplayDial();
      expect(sentryDial()).toEqual({ enabled: false, rate: 0 });
    });

    it("offline with nothing stored: today's behaviour", async () => {
      reset(catalogApi(new Error("Network request failed")));
      await startReplayDial();
      expect(sentryDial()).toEqual(DEFAULT);
    });

    it("an invalid replay catalog still delivers a valid Sentry dial", async () => {
      reset(
        catalogApi(
          ok({ items: [{ name: "yacht" }], client_sentry: { enabled: false, sample_rate: 0 } })
        )
      );
      expect(await refresh()).toBe(false); // the replay dial did not change
      expect(sentryDial()).toEqual({ enabled: false, rate: 0 });
    });
  });

  describe("the #3313 console.error cap still holds under the dial", () => {
    const originalError = console.error;
    afterEach(() => {
      _resetSentryConsoleErrorCaptureForTests();
      console.error = originalError;
      jest.clearAllMocks();
    });

    /** What Sentry would send: each captureMessage passed through the dial, as App.tsx's beforeSend does. */
    function sentEvents(random: () => number): number {
      jest.spyOn(console, "error").mockImplementation(() => {});
      installSentryConsoleErrorCapture();
      for (let i = 0; i < 50; i += 1) console.error(`distinct warning kind ${"x".repeat(i)}`);
      const calls = (Sentry.captureMessage as jest.Mock).mock.calls as [
        string,
        { level: string },
      ][];
      return calls.filter(([, ctx]) => sentryDialFilter({ level: ctx.level }, random)).length;
    }

    it("dial on (rate 1): no more than the hourly cap", () => {
      expect(sentEvents(() => 0.99)).toBe(CONSOLE_ERROR_MAX_PER_HOUR);
    });

    it("a rate only lowers it below the cap", async () => {
      await acceptSentryDial(catalog({ enabled: true, sample_rate: 0.5 }));
      expect(sentEvents(rng(0.1, 0.9))).toBe(CONSOLE_ERROR_MAX_PER_HOUR / 2);
    });

    it("dial off: none", async () => {
      await acceptSentryDial(catalog({ enabled: false, sample_rate: 1 }));
      expect(sentEvents(() => 0)).toBe(0);
    });
  });
});
