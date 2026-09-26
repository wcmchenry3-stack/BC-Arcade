/**
 * sentryConfig (#851, #2429) — which Sentry environment a build reports to, and
 * which builds report at all. Companion to `gameVisibility.test.ts`: both follow
 * the API URL, so the Tue 29 switch to the production API flips them together.
 */

import {
  makeDropSimulatorEvents,
  resolveSentryEnvironment,
  shouldInitSentry,
  shouldTrackAppHangs,
} from "../sentryConfig";

const PRE_LAUNCH_API_URL = "https://dev-games-api.buffingchi.com";
const PRODUCTION_API_URL = "https://games-api.buffingchi.com";

const ENV_KEYS = [
  "EXPO_PUBLIC_SENTRY_ENVIRONMENT",
  "EXPO_PUBLIC_API_URL",
  "EXPO_PUBLIC_TEST_HOOKS",
] as const;

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("sentryConfig", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) setEnv(key, saved[key]);
  });

  describe("resolveSentryEnvironment", () => {
    it("reports a release build against the production API as production", () => {
      setEnv("EXPO_PUBLIC_API_URL", PRODUCTION_API_URL);
      expect(resolveSentryEnvironment(false)).toBe("production");
    });

    it("reports a release build against the pre-launch API as development", () => {
      setEnv("EXPO_PUBLIC_API_URL", PRE_LAUNCH_API_URL);
      expect(resolveSentryEnvironment(false)).toBe("development");
    });

    it("reports every debug build as development, whatever API it talks to", () => {
      setEnv("EXPO_PUBLIC_API_URL", PRODUCTION_API_URL);
      expect(resolveSentryEnvironment(true)).toBe("development");
      setEnv("EXPO_PUBLIC_API_URL", "http://localhost:8000");
      expect(resolveSentryEnvironment(true)).toBe("development");
    });

    it("fails towards production for a release build with no or an unknown API URL", () => {
      expect(resolveSentryEnvironment(false)).toBe("production");
      setEnv("EXPO_PUBLIC_API_URL", "https://dev-games-api.buffingchi.com.example.org");
      expect(resolveSentryEnvironment(false)).toBe("production");
    });

    it("lets an explicit EXPO_PUBLIC_SENTRY_ENVIRONMENT win", () => {
      setEnv("EXPO_PUBLIC_API_URL", PRODUCTION_API_URL);
      setEnv("EXPO_PUBLIC_SENTRY_ENVIRONMENT", "staging");
      expect(resolveSentryEnvironment(false)).toBe("staging");
      expect(resolveSentryEnvironment(true)).toBe("staging");
    });

    it("ignores an empty explicit value", () => {
      setEnv("EXPO_PUBLIC_API_URL", PRE_LAUNCH_API_URL);
      setEnv("EXPO_PUBLIC_SENTRY_ENVIRONMENT", "");
      expect(resolveSentryEnvironment(false)).toBe("development");
    });
  });

  describe("shouldInitSentry", () => {
    it("is off for test-hooks builds only", () => {
      expect(shouldInitSentry()).toBe(true);
      setEnv("EXPO_PUBLIC_TEST_HOOKS", "1");
      expect(shouldInitSentry()).toBe(false);
      setEnv("EXPO_PUBLIC_TEST_HOOKS", "0");
      expect(shouldInitSentry()).toBe(true);
    });

    it("is off on web regardless of test-hooks flag (#2716)", () => {
      expect(shouldInitSentry("web")).toBe(false);
      setEnv("EXPO_PUBLIC_TEST_HOOKS", "1");
      expect(shouldInitSentry("web")).toBe(false);
    });

    it("is on for native platforms when test-hooks is off", () => {
      expect(shouldInitSentry("ios")).toBe(true);
      expect(shouldInitSentry("android")).toBe(true);
    });
  });

  describe("shouldTrackAppHangs", () => {
    it("is on for release builds and off for debug builds", () => {
      expect(shouldTrackAppHangs(false)).toBe(true);
      expect(shouldTrackAppHangs(true)).toBe(false);
    });
  });

  describe("makeDropSimulatorEvents", () => {
    const simulator = { contexts: { device: { simulator: true } } };
    const device = { contexts: { device: { simulator: false } } };

    it("drops simulator and emulator events from production", () => {
      expect(makeDropSimulatorEvents("production")(simulator)).toBeNull();
    });

    it("keeps real-device events in production", () => {
      expect(makeDropSimulatorEvents("production")(device)).toBe(device);
    });

    it("keeps an event with no device context", () => {
      const bare = {};
      expect(makeDropSimulatorEvents("production")(bare)).toBe(bare);
    });

    it("keeps simulator events outside production", () => {
      expect(makeDropSimulatorEvents("development")(simulator)).toBe(simulator);
    });
  });
});
