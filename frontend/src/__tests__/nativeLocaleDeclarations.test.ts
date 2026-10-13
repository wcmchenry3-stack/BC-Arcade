/**
 * @jest-environment node
 *
 * Native locale declarations guard (#3151)
 * ----------------------------------------
 * The OS and the stores learn which languages the app supports from native
 * config, not from i18next:
 *   - iOS: a `<code>.lproj/InfoPlist.strings` per language in the bundle —
 *     App Store Connect builds the listing's Languages row from the bundle's
 *     .lproj folders. Generated from app.json `expo.locales` by prebuild.
 *     `CFBundleLocalizations` in Info.plist (via app.json `ios.infoPlist`)
 *     supplements it, and `knownRegions` in the pbxproj lists each one.
 *   - Android: `res/xml/locales_config.xml`, referenced by
 *     `android:localeConfig` on <application> (Settings → App languages).
 *
 * All of them must list exactly `LAUNCH_LOCALE_CODES`. When the launch list
 * changes, update every declaration below — do not loosen this test.
 */

import * as fs from "fs";
import * as path from "path";

import { LAUNCH_LOCALE_CODES } from "../i18n/locales";

const frontendRoot = path.resolve(__dirname, "../..");

function read(relPath: string): string {
  return fs.readFileSync(path.join(frontendRoot, relPath), "utf-8");
}

const expected = [...LAUNCH_LOCALE_CODES].sort();

function sorted(values: string[]): string[] {
  return [...values].sort();
}

describe("native locale declarations match LAUNCH_LOCALE_CODES", () => {
  it("app.json ios.infoPlist.CFBundleLocalizations", () => {
    const app = JSON.parse(read("app.json")) as {
      expo: { ios: { infoPlist: { CFBundleLocalizations?: string[] } } };
    };
    expect(sorted(app.expo.ios.infoPlist.CFBundleLocalizations ?? [])).toEqual(expected);
  });

  it("ios/GamingApp/Info.plist CFBundleLocalizations", () => {
    const plist = read("ios/GamingApp/Info.plist");
    // Exactly one key: a duplicate (e.g. after a prebuild) leaves the winner ambiguous.
    expect(plist.match(/<key>CFBundleLocalizations<\/key>/g)).toHaveLength(1);
    const array = plist.match(
      /<key>CFBundleLocalizations<\/key>\s*<array>([\s\S]*?)<\/array>/
    )?.[1];
    expect(array).toBeDefined();
    const codes = [...(array ?? "").matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1] ?? "");
    expect(sorted(codes)).toEqual(expected);
  });

  it("Info.plist development region stays English", () => {
    // $(DEVELOPMENT_LANGUAGE) resolves from the pbxproj developmentRegion.
    const plist = read("ios/GamingApp/Info.plist");
    const pbxproj = read("ios/GamingApp.xcodeproj/project.pbxproj");
    expect(plist).toMatch(
      /<key>CFBundleDevelopmentRegion<\/key>\s*<string>\$\(DEVELOPMENT_LANGUAGE\)<\/string>/
    );
    expect(pbxproj).toMatch(/developmentRegion = en;/);
  });

  it("app.json expo.locales has one entry per launch locale", () => {
    const app = JSON.parse(read("app.json")) as {
      expo: { locales?: Record<string, string> };
    };
    const locales = app.expo.locales ?? {};
    expect(sorted(Object.keys(locales))).toEqual(expected);
    for (const [code, file] of Object.entries(locales)) {
      const json = JSON.parse(read(file)) as { ios?: { CFBundleDisplayName?: string } };
      // Under `ios` only: top-level keys would also go into Android strings.xml.
      expect({ code, name: json.ios?.CFBundleDisplayName }).toEqual({ code, name: "BC Arcade" });
    }
  });

  it("each launch locale has an .lproj with InfoPlist.strings in the bundle", () => {
    // App Store Connect lists the languages the bundle has .lproj folders for.
    const pbxproj = read("ios/GamingApp.xcodeproj/project.pbxproj");
    for (const code of expected) {
      const strings = read(`ios/GamingApp/Supporting/${code}.lproj/InfoPlist.strings`);
      expect(strings).toMatch(/CFBundleDisplayName\s*=\s*"BC Arcade";/);

      const fileRef = pbxproj.match(
        new RegExp(
          `([0-9A-F]{24}) /\\* InfoPlist\\.strings \\*/ = \\{isa = PBXFileReference;[^}]*path = "${code}\\.lproj/InfoPlist\\.strings";`
        )
      )?.[1];
      expect({ code, fileRef }).toEqual({ code, fileRef: expect.any(String) });
      const buildFile = pbxproj.match(
        new RegExp(
          `([0-9A-F]{24}) /\\* InfoPlist\\.strings in Resources \\*/ = \\{isa = PBXBuildFile; fileRef = ${fileRef} `
        )
      )?.[1];
      expect({ code, buildFile }).toEqual({ code, buildFile: expect.any(String) });
      const resources =
        pbxproj.match(/isa = PBXResourcesBuildPhase;[\s\S]*?files = \(([\s\S]*?)\);/)?.[1] ?? "";
      expect({ code, inResources: resources.includes(String(buildFile)) }).toEqual({
        code,
        inResources: true,
      });
    }
  });

  it("pbxproj knownRegions lists each launch locale", () => {
    const pbxproj = read("ios/GamingApp.xcodeproj/project.pbxproj");
    const block = pbxproj.match(/knownRegions = \(([\s\S]*?)\);/)?.[1] ?? "";
    const regions = block
      .split(",")
      .map((r) => r.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
    expect(regions).toEqual(expect.arrayContaining(expected));
  });

  it("android res/xml/locales_config.xml", () => {
    const xml = read("android/app/src/main/res/xml/locales_config.xml");
    // Strip comments until none remain, so a commented-out <locale> never counts.
    let body = xml;
    for (let prev = ""; prev !== body;) {
      prev = body;
      body = body.replace(/<!--[\s\S]*?-->/g, "");
    }
    const codes = [...body.matchAll(/<locale\b[^>]*\bandroid:name="([^"]+)"/g)].map(
      (m) => m[1] ?? ""
    );
    expect(sorted(codes)).toEqual(expected);
  });

  it("AndroidManifest.xml <application> points at the locale config", () => {
    const manifest = read("android/app/src/main/AndroidManifest.xml");
    const application = manifest.match(/<application\b[^>]*>/)?.[0] ?? "";
    expect(application).toContain('android:localeConfig="@xml/locales_config"');
  });
});
