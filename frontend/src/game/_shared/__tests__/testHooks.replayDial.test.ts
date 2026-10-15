/**
 * The E2E test-hook build and the replay dial (#3279).
 *
 * A test-hook build has no backend to serve the catalog, so without this every
 * session would get the production 10 % default and most hook-started
 * sessions would keep their gameplay rows on the device — what the logstore
 * E2E specs (#481 scenarios 9 and 11) caught. Such a build defaults to every
 * session in full; a production build is unchanged. The default is read when
 * the first session is decided, not at import, so it also covers a session a
 * screen starts before NetworkProvider registers the hooks, and nothing runs
 * while modules load.
 */

import { REPLAY_DEFAULT_SAMPLE_RATE } from "../eventQueueConfig";
import { __resetReplayDialForTests, acceptCatalog, decideReplay, dialFor } from "../replayDial";
import { generateUUID } from "../uuid";

describe("the replay dial's default in a test-hook build (#3279)", () => {
  const originalEnv = process.env.EXPO_PUBLIC_TEST_HOOKS;

  beforeEach(() => {
    __resetReplayDialForTests(); // the build's own default, read on first use
  });

  afterAll(() => {
    // Assigning undefined would leave the string "undefined": unset it instead.
    if (originalEnv === undefined) delete process.env.EXPO_PUBLIC_TEST_HOOKS;
    else process.env.EXPO_PUBLIC_TEST_HOOKS = originalEnv;
  });

  it("a test-hook build: every session uploads in full, with no hook registered", () => {
    process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
    expect(dialFor("yacht")).toEqual({ enabled: true, rate: 1 });
    for (let i = 0; i < 200; i += 1) expect(decideReplay("yacht", generateUUID())).toBe("full");
  });

  it("a fetched catalog still wins in a test-hook build", async () => {
    process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
    await acceptCatalog(
      { items: [{ name: "yacht", replay: { enabled: false, sample_rate: 0 } }] },
      Date.now()
    );
    expect(dialFor("yacht")).toEqual({ enabled: false, rate: 0 });
  });

  it("a production build keeps the 10 % default", () => {
    delete process.env.EXPO_PUBLIC_TEST_HOOKS;
    expect(dialFor("yacht")).toEqual({ enabled: true, rate: REPLAY_DEFAULT_SAMPLE_RATE });
  });
});
