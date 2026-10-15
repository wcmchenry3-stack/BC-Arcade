/**
 * The E2E test-hook build and the replay dial (#3279).
 *
 * A test-hook build has no backend to serve the catalog, so without this every
 * session would get the production 10 % default and most hook-started
 * sessions would keep their gameplay rows on the device — what the logstore
 * E2E specs (#481 scenarios 9 and 11) caught. Registering the hooks makes
 * such sessions upload in full; a production build is unchanged.
 */

import { REPLAY_DEFAULT_SAMPLE_RATE } from "../eventQueueConfig";
import { __resetReplayDialForTests, acceptCatalog, decideReplay, dialFor } from "../replayDial";
import { registerLogstoreTestHooks } from "../testHooks";
import { generateUUID } from "../uuid";

describe("test hooks pin the replay dial's default (#3279)", () => {
  const originalEnv = process.env.EXPO_PUBLIC_TEST_HOOKS;

  beforeEach(() => {
    __resetReplayDialForTests(); // the production default
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_TEST_HOOKS = originalEnv;
  });

  it("a test-hook build: every session uploads in full", () => {
    process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
    const cleanup = registerLogstoreTestHooks();
    try {
      expect(dialFor("yacht")).toEqual({ enabled: true, rate: 1 });
      for (let i = 0; i < 200; i += 1) expect(decideReplay("yacht", generateUUID())).toBe("full");
    } finally {
      cleanup();
    }
  });

  it("a fetched catalog still wins in a test-hook build", async () => {
    process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
    const cleanup = registerLogstoreTestHooks();
    try {
      await acceptCatalog(
        { items: [{ name: "yacht", replay: { enabled: false, sample_rate: 0 } }] },
        Date.now()
      );
      expect(dialFor("yacht")).toEqual({ enabled: false, rate: 0 });
    } finally {
      cleanup();
    }
  });

  it("a production build keeps the 10 % default", () => {
    process.env.EXPO_PUBLIC_TEST_HOOKS = undefined;
    registerLogstoreTestHooks();
    expect(dialFor("yacht")).toEqual({ enabled: true, rate: REPLAY_DEFAULT_SAMPLE_RATE });
  });
});
