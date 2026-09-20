/**
 * @jest-environment node
 *
 * Native version guard
 * --------------------
 * `.github/workflows/version-sync.yml` patches app.json, build.gradle and the
 * iOS project.pbxproj on every release — but never Info.plist. Info.plist
 * therefore must *reference* the pbxproj build settings
 * ($(MARKETING_VERSION) / $(CURRENT_PROJECT_VERSION)) rather than carry its
 * own literals; when it carried literals it sat at 1.0.0 while everything
 * else shipped 1.0.9.
 *
 * `expo prebuild` rewrites those two keys with literal values from app.json.
 * The result looks correct on the day and silently drifts at the next
 * release, so this test fails the moment a literal reappears. If it fails
 * after a prebuild, restore the two $(…) references — do not update the
 * expectation.
 */

import * as fs from "fs";
import * as path from "path";

// frontend/ is one level above src/
const frontendRoot = path.resolve(__dirname, "../..");

function read(relPath: string): string {
  return fs.readFileSync(path.join(frontendRoot, relPath), "utf-8");
}

function plistString(plist: string, key: string): string {
  const value = plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))?.[1];
  if (value === undefined) {
    throw new Error(`Info.plist has no string value for ${key}`);
  }
  return value;
}

function allValues(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((m) => (m[1] ?? "").trim());
}

const appJson = JSON.parse(read("app.json")) as {
  expo: { version: string; ios: { buildNumber: string } };
};

describe("native version sync", () => {
  it("Info.plist derives its version from the Xcode build settings", () => {
    const plist = read("ios/GamingApp/Info.plist");

    expect(plistString(plist, "CFBundleShortVersionString")).toBe("$(MARKETING_VERSION)");
    expect(plistString(plist, "CFBundleVersion")).toBe("$(CURRENT_PROJECT_VERSION)");
  });

  it("every iOS build configuration matches app.json", () => {
    const pbxproj = read("ios/GamingApp.xcodeproj/project.pbxproj");
    const marketing = allValues(pbxproj, /MARKETING_VERSION = ([^;]+);/g);
    const build = allValues(pbxproj, /CURRENT_PROJECT_VERSION = ([^;]+);/g);

    expect(marketing.length).toBeGreaterThan(0);
    expect(build.length).toBeGreaterThan(0);
    expect(new Set(marketing)).toEqual(new Set([appJson.expo.version]));
    expect(new Set(build)).toEqual(new Set([appJson.expo.ios.buildNumber]));
  });

  it("Android versionName matches app.json", () => {
    const gradle = read("android/app/build.gradle");

    expect(allValues(gradle, /versionName "([^"]+)"/g)).toEqual([appJson.expo.version]);
  });
});
