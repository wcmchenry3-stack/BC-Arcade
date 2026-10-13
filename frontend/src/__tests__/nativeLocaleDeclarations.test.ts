/**
 * @jest-environment node
 *
 * Native locale declarations guard (#3151)
 * ----------------------------------------
 * The OS and the stores learn which languages the app supports from native
 * config, not from i18next:
 *   - iOS: `CFBundleLocalizations` in Info.plist (App Store listing languages,
 *     Settings → BC Arcade → Language). Set through app.json `ios.infoPlist`
 *     so `expo prebuild` writes the same value.
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

  it("android res/xml/locales_config.xml", () => {
    const xml = read("android/app/src/main/res/xml/locales_config.xml");
    // Strip comments until none remain, so a commented-out <locale> never counts.
    let body = xml;
    for (let prev = ""; prev !== body;) {
      prev = body;
      body = body.replace(/<!--[\s\S]*?-->/g, "");
    }
    const codes = [...body.matchAll(/<locale\s+android:name="([^"]+)"\s*\/>/g)].map(
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
