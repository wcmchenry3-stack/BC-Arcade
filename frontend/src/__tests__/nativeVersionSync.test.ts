/**
 * @jest-environment ./jest-env/node.js
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

/**
 * Launch version guard (#857). One marketing version everywhere, and one
 * Android versionCode that only ever goes up: Play rejects an upload whose
 * versionCode is not above every code already uploaded, and 1.0.9 (10009) was
 * uploaded before v1.0.0 launched at 10010. version-sync.yml keeps the code
 * monotonic (max(formula, current + 1)); this pins the committed values.
 */
describe("launch version and versionCode", () => {
  const LAST_PRELAUNCH_VERSION_CODE = 10009;
  const app = JSON.parse(read("app.json")) as {
    expo: { version: string; ios: { buildNumber: string }; android: { versionCode?: number } };
  };
  const gradle = read("android/app/build.gradle");
  const version = app.expo.version;

  it("every version field carries the same marketing version", () => {
    const pkg = JSON.parse(read("package.json")) as { version: string };
    const lock = JSON.parse(read("package-lock.json")) as {
      version: string;
      packages: Record<string, { version?: string }>;
    };
    const manifest = JSON.parse(read("../.release-please-manifest.json")) as Record<string, string>;
    const pbxproj = read("ios/GamingApp.xcodeproj/project.pbxproj");

    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect({
      pbxproj: [...new Set(allValues(pbxproj, /MARKETING_VERSION = ([^;]+);/g))],
      gradle: allValues(gradle, /versionName "([^"]+)"/g),
      packageJson: pkg.version,
      packageLock: [lock.version, lock.packages[""]?.version],
      releasePleaseManifest: manifest["."],
    }).toEqual({
      pbxproj: [version],
      gradle: [version],
      packageJson: version,
      packageLock: [version, version],
      releasePleaseManifest: version,
    });
  });

  it("gradle versionCode equals app.json android.versionCode (prebuild cannot reset it)", () => {
    const codes = allValues(gradle, /versionCode (\d+)/g).map(Number);
    expect(codes).toEqual([app.expo.android.versionCode]);
  });

  it("versionCode is above every pre-launch upload", () => {
    expect(app.expo.android.versionCode).toBeGreaterThan(LAST_PRELAUNCH_VERSION_CODE);
  });

  it("iOS buildNumber mirrors the Android versionCode (version-sync convention)", () => {
    // Xcode Cloud replaces the shipped CFBundleVersion with its own counter;
    // the committed value only has to be consistent (docs/IOS.md).
    expect(app.expo.ios.buildNumber).toBe(String(app.expo.android.versionCode));
  });
});
