/**
 * `APP_VERSION` (#3858) is the app's own version from `expo-constants`: the native version on a
 * device, the app config's `version` (app.json) where there is no native app, "unknown" without
 * either. Never `package.json` (which would bundle the whole manifest).
 */
import * as fs from "fs";
import * as path from "path";

const appJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../../app.json"), "utf-8")
) as { expo: { version: string } };

function load(constants: Record<string, unknown>): string {
  let version = "";
  jest.isolateModules(() => {
    jest.doMock("expo-constants", () => ({ __esModule: true, default: constants }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a fresh module per mock
    version = (require("../appVersion") as { APP_VERSION: string }).APP_VERSION;
  });
  jest.dontMock("expo-constants");
  return version;
}

describe("APP_VERSION", () => {
  it("is the native app version when there is one", () => {
    expect(load({ nativeAppVersion: "1.4.2", expoConfig: { version: "1.0.0" } })).toBe("1.4.2");
  });

  it("falls back to the app config's version, then to unknown", () => {
    expect(load({ nativeAppVersion: null, expoConfig: { version: "1.3.0" } })).toBe("1.3.0");
    expect(load({ nativeAppVersion: null, expoConfig: null })).toBe("unknown");
  });

  it("is a MAJOR.MINOR.PATCH version under the jest preset (app.json's)", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { APP_VERSION } = require("../appVersion") as { APP_VERSION: string };
    expect([appJson.expo.version, "unknown"]).toContain(APP_VERSION);
  });

  it("does not read package.json", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../appVersion.ts"), "utf-8");
    expect(source).not.toMatch(/from ["'][./]*package\.json["']/);
  });
});
