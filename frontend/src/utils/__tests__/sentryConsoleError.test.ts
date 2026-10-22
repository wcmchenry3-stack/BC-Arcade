import * as Sentry from "@sentry/react-native";
import {
  CONSOLE_ERROR_EXTRA_MAX_CHARS,
  CONSOLE_ERROR_MAX_PER_HOUR,
  consoleErrorKey,
  installSentryConsoleErrorCapture,
  _resetConsoleErrorThrottleForTests,
  _resetSentryConsoleErrorCaptureForTests,
} from "../sentryConsoleError";
import { resetSentryThrottle, sentryThrottle } from "../../game/_shared/sentryThrottle";

jest.mock("@sentry/react-native", () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

describe("installSentryConsoleErrorCapture", () => {
  const originalError = console.error;

  afterEach(() => {
    _resetSentryConsoleErrorCaptureForTests();
    console.error = originalError;
    jest.clearAllMocks();
  });

  it("forwards plain-string console.error calls to Sentry.captureMessage", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    installSentryConsoleErrorCapture();

    console.error("duplicate key", "warning");

    // #3313: the title is the first (template) argument; the full text is in extra.
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      "console.error: duplicate key",
      expect.objectContaining({
        level: "error",
        tags: expect.objectContaining({ source: "console.error" }),
        extra: expect.objectContaining({ message: "duplicate key warning" }),
      })
    );
    expect(Sentry.captureException).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("forwards Error instances via Sentry.captureException", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    installSentryConsoleErrorCapture();

    const err = new Error("boom");
    console.error("prefix:", err);

    expect(Sentry.captureException).toHaveBeenCalledWith(
      err,
      expect.objectContaining({
        tags: expect.objectContaining({ source: "console.error" }),
      })
    );
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("still calls the original console.error so output is preserved", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    installSentryConsoleErrorCapture();

    console.error("hello");

    expect(spy).toHaveBeenCalledWith("hello");
    spy.mockRestore();
  });

  it("is idempotent — calling install twice does not double-wrap", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    installSentryConsoleErrorCapture();
    installSentryConsoleErrorCapture();

    console.error("once");

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("does not swallow the original log when Sentry.captureMessage throws", () => {
    (Sentry.captureMessage as jest.Mock).mockImplementation(() => {
      throw new Error("sentry down");
    });
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    installSentryConsoleErrorCapture();

    expect(() => console.error("still logs")).not.toThrow();
    expect(spy).toHaveBeenCalledWith("still logs");
    spy.mockRestore();
  });
});

// #3313: varying text must not mint one Sentry issue per message, and the
// forwarder must have a ceiling.
describe("installSentryConsoleErrorCapture throttle (#3313)", () => {
  const originalError = console.error;
  let spy: jest.SpyInstance;

  beforeEach(() => {
    (Sentry.captureMessage as jest.Mock).mockReset();
    spy = jest.spyOn(console, "error").mockImplementation(() => {});
    installSentryConsoleErrorCapture();
  });

  afterEach(() => {
    _resetSentryConsoleErrorCaptureForTests();
    resetSentryThrottle();
    spy.mockRestore();
    console.error = originalError;
    jest.clearAllMocks();
  });

  const messageCalls = () =>
    (Sentry.captureMessage as jest.Mock).mock.calls as Array<
      [string, { fingerprint: string[]; extra: Record<string, unknown> }]
    >;

  it("groups messages that differ only by numbers or ids under one title and fingerprint", () => {
    expect(consoleErrorKey(["fetch failed for game 1234 after 87ms"])).toBe(
      consoleErrorKey(["fetch failed for game 98 after 3ms"])
    );
    expect(consoleErrorKey(["session 3f2a9c1e-77aa-4b2e-9d10-aa00bb11cc22 lost"])).toBe(
      consoleErrorKey(["session 0b0b0b0b-1111-4222-8333-444455556666 lost"])
    );

    console.error("fetch failed for game 1234 after 87ms");
    _resetConsoleErrorThrottleForTests();
    console.error("fetch failed for game 98 after 3ms");

    const calls = messageCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe(calls[1][0]);
    expect(calls[0][1].fingerprint).toEqual(calls[1][1].fingerprint);
    expect(calls[0][0]).not.toMatch(/\d/);
    expect(calls[1][1].extra.message).toBe("fetch failed for game 98 after 3ms");
  });

  it("keeps the printf template as the title and moves the varying args to extra", () => {
    console.error('Warning: Each child in a list should have a unique "key" prop.%s', "Row 42");

    const [title, ctx] = messageCalls()[0];
    expect(title).toBe(
      'console.error: Warning: Each child in a list should have a unique "key" prop.%s'
    );
    expect(ctx.extra.message).toContain("Row 42");
    expect(ctx.fingerprint).toEqual([
      consoleErrorKey(['Warning: Each child in a list should have a unique "key" prop.%s']),
    ]);
  });

  it("sends one event per key per session, while every call still reaches the console", () => {
    for (let i = 0; i < 50; i++) console.error(`render loop warning ${i}`);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(50);
  });

  it("caps distinct messages at the hourly budget and reports the drops on the next event", () => {
    let now = 0;
    _resetConsoleErrorThrottleForTests(() => now);
    const letters = "abcdefghijklmnopqrstuvwxyz";
    for (const w of letters) console.error(`distinct failure ${w}${w}${w}`);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(CONSOLE_ERROR_MAX_PER_HOUR);

    now += 60 * 60 * 1000;
    console.error("after the hour");
    const last = messageCalls().at(-1)!;
    expect(last[1].extra.sentryThrottleDropped).toBe(letters.length - CONSOLE_ERROR_MAX_PER_HOUR);
  });

  it("caps Error arguments per error name and normalised message", () => {
    for (let i = 0; i < 20; i++) console.error(new Error(`fetch ${i} cancelled`));
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it("does not format the arguments of a throttled call", () => {
    console.error("same thing");
    const toJSON = jest.fn(() => "x");
    console.error("same thing", { toJSON });
    expect(toJSON).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  it("truncates the forwarded text so one event stays small", () => {
    console.error("big", "y".repeat(10_000));
    const [title, ctx] = messageCalls()[0];
    expect(String(ctx.extra.message).length).toBeLessThanOrEqual(CONSOLE_ERROR_EXTRA_MAX_CHARS);
    console.error("z".repeat(10_000));
    expect(messageCalls()[1][0].length).toBeLessThan(200);
    expect(title).toBe("console.error: big");
  });

  it("keys non-message first arguments by type and the next argument, not one shared key", () => {
    // An object first argument: its key names (never values) tell call sites apart.
    expect(consoleErrorKey([{ code: 1, reason: "x" }])).not.toBe(consoleErrorKey([{ status: 2 }]));
    expect(consoleErrorKey([{ code: 1 }])).toBe(consoleErrorKey([{ code: 999 }]));
    // A bare format template takes the second argument into the key.
    expect(consoleErrorKey(["%s", "Sync failed for game 12"])).not.toBe(
      consoleErrorKey(["%s", "Audio load failed"])
    );
    expect(consoleErrorKey(["%s", "Sync failed for game 12"])).toBe(
      consoleErrorKey(["%s", "Sync failed for game 77"])
    );
    expect(consoleErrorKey(["%o", 1])).not.toBe(consoleErrorKey(["%o", { a: 1 }]));
    expect(consoleErrorKey([42, "a"])).toBe("console.error:number a");

    console.error({ code: 1 });
    console.error({ status: 2 });
    console.error("%s", "first");
    console.error("%s", "second");
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(4);
  });

  it("keeps an HTTP status code in the key, but masks other numbers", () => {
    expect(consoleErrorKey(["HTTP 404 on fetch"])).not.toBe(consoleErrorKey(["HTTP 500 on fetch"]));
    expect(consoleErrorKey(["request failed, status: 503"])).toBe(
      "console.error:request failed, status: 503"
    );
    expect(consoleErrorKey(["retry 404 of 500"])).toBe("console.error:retry # of #");
    expect(consoleErrorKey(["HTTP 1234"])).toBe("console.error:HTTP #");
  });

  it("bounds every key, whatever the arguments", () => {
    const huge = { [`k${"x".repeat(5000)}`]: 1 };
    expect(consoleErrorKey([huge, huge]).length).toBeLessThan(200);
    expect(consoleErrorKey(["%s", "y".repeat(100_000)]).length).toBeLessThan(200);
    expect(consoleErrorKey(["w".repeat(100_000)]).length).toBeLessThan(200);
  });

  it("never runs a regex pass over more than a bounded slice of the arguments", () => {
    const replace = jest.spyOn(String.prototype, "replace");
    try {
      consoleErrorKey(["q1 ".repeat(50_000)]);
      consoleErrorKey(["%s", "r2 ".repeat(50_000)]);
      consoleErrorKey([new Error("e3 ".repeat(50_000))]);
      const scanned = replace.mock.contexts.map((s) => String(s).length);
      expect(scanned.length).toBeGreaterThan(0);
      expect(Math.max(...scanned)).toBeLessThanOrEqual(512);
    } finally {
      replace.mockRestore();
    }
  });

  it("uses its own budget, so console noise cannot starve the shared error budget", () => {
    const letters = "abcdefghijklmnopqrstuvwxyz";
    for (const w of letters) console.error(`noise ${w}${w}`);
    expect(sentryThrottle.allow("syncWorker.complete.500", "error")).toBe(true);
  });
});
