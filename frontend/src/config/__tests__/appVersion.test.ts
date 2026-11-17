/**
 * `APP_VERSION` (#3858) is the release version: package.json's, which the release workflow keeps
 * equal to app.json's `expo.version`.
 */
import * as fs from "fs";
import * as path from "path";

import { APP_VERSION } from "../appVersion";

const appJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../../app.json"), "utf-8")
) as { expo: { version: string } };

describe("APP_VERSION", () => {
  it("is a MAJOR.MINOR.PATCH version", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("equals app.json's expo.version", () => {
    expect(APP_VERSION).toBe(appJson.expo.version);
  });
});
