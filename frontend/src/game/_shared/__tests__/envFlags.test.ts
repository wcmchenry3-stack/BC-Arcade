import { areLegacyHeartsPersonasEnabled } from "../envFlags";

describe("areLegacyHeartsPersonasEnabled (HEARTS_LEGACY_PERSONAS, #3158)", () => {
  const g = globalThis as { __DEV__?: boolean };
  const realDev = g.__DEV__;
  const realUrl = process.env.EXPO_PUBLIC_API_URL;

  afterEach(() => {
    g.__DEV__ = realDev;
    if (realUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = realUrl;
  });

  function build(dev: boolean, url?: string) {
    g.__DEV__ = dev;
    if (url === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = url;
  }

  it("is on in a dev bundle", () => {
    build(true);
    expect(areLegacyHeartsPersonasEnabled()).toBe(true);
  });

  it("is on in a pre-launch (dev API) release build", () => {
    build(false, "https://dev-games-api.buffingchi.com");
    expect(areLegacyHeartsPersonasEnabled()).toBe(true);
  });

  it.each([
    undefined,
    "https://games-api.buffingchi.com",
    "https://dev-games-api.buffingchi.com.example.org",
    "http://dev-games-api.buffingchi.com",
  ])("is off in a store build (API %s)", (url) => {
    build(false, url);
    expect(areLegacyHeartsPersonasEnabled()).toBe(false);
  });
});
