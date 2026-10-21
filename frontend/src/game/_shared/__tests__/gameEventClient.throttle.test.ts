import * as Sentry from "@sentry/react-native";

import { BugReportLimiter } from "../bugReportLimiter";
import { EventStore } from "../eventStore";
import { GameEventClientImpl } from "../gameEventClient";
import { PendingGamesStore } from "../pendingGamesStore";
import { DEFAULT_MAX_PER_HOUR, resetSentryThrottle, sentryThrottle } from "../sentryThrottle";

const captureException = Sentry.captureException as jest.Mock;
const flush = () => new Promise((r) => setTimeout(r, 10));

type Forgetful = { fireAndForget(p: Promise<unknown>, label: string, gameId?: string): void };

describe("gameEventClient fireAndForget throttle (#3351)", () => {
  let client: GameEventClientImpl;

  beforeEach(async () => {
    resetSentryThrottle();
    captureException.mockReset();
    client = new GameEventClientImpl(
      new EventStore(),
      new PendingGamesStore(),
      new BugReportLimiter()
    );
    await client.init();
  });

  const fail = (op: string, gameId?: string) =>
    (client as unknown as Forgetful).fireAndForget(
      Promise.reject(new Error("disk full")),
      op,
      gameId
    );

  it("reports the first failure with game.id, the error and a fixed fingerprint", async () => {
    fail("enqueueEvents", "game-abc");
    await flush();
    expect(captureException).toHaveBeenCalledTimes(1);
    const [err, ctx] = captureException.mock.calls[0];
    expect((err as Error).message).toBe("disk full");
    expect(ctx).toEqual({
      fingerprint: ["gameEventClient", "enqueueEvents"],
      tags: { subsystem: "gameEventClient", op: "enqueueEvents", "game.id": "game-abc" },
    });
  });

  it("1,000 rejections in an hour stay within the hourly budget", async () => {
    for (let i = 0; i < 1000; i++) fail("enqueueEvents", `g${i}`);
    await flush();
    expect(captureException.mock.calls.length).toBeLessThanOrEqual(DEFAULT_MAX_PER_HOUR);
    expect(captureException).toHaveBeenCalledTimes(1);
    for (const c of captureException.mock.calls) {
      expect(c[1].fingerprint).toEqual(["gameEventClient", "enqueueEvents"]);
    }
    expect(sentryThrottle.droppedCount).toBe(999);
  });

  it("a different op has its own key", async () => {
    fail("enqueueEvents", "g1");
    fail("markStarted", "g1");
    fail("enqueueEvents", "g2");
    await flush();
    expect(captureException.mock.calls.map((c) => c[1].tags.op)).toEqual([
      "enqueueEvents",
      "markStarted",
    ]);
  });

  it("never throws", () => {
    expect(() => fail("x")).not.toThrow();
  });
});
