/**
 * The iOS privacy manifest, the App Privacy answers in App Store Connect and
 * docs/privacy-policy.html must describe the same data flows
 * (docs/STORE-PRIVACY-ANSWERS.md). This pins the manifest's declarations so a
 * change is always deliberate — update the doc and both store forms with it.
 */

import * as fs from "fs";
import * as path from "path";

const MANIFEST = path.resolve(__dirname, "../../ios/GamingApp/PrivacyInfo.xcprivacy");

/** Minimal reader for the `NSPrivacyCollectedDataTypes` array of dicts. */
function collectedDataTypes(xml: string): Record<string, { linked: boolean; tracking: boolean }> {
  const section = xml.split("<key>NSPrivacyCollectedDataTypes</key>")[1] ?? "";
  const out: Record<string, { linked: boolean; tracking: boolean }> = {};
  for (const dict of section.split("<dict>").slice(1)) {
    const type =
      /<key>NSPrivacyCollectedDataType<\/key>\s*<string>NSPrivacyCollectedDataType(\w+)<\/string>/.exec(
        dict
      );
    const linked = /<key>NSPrivacyCollectedDataTypeLinked<\/key>\s*<(true|false)\/>/.exec(dict);
    const tracking = /<key>NSPrivacyCollectedDataTypeTracking<\/key>\s*<(true|false)\/>/.exec(dict);
    if (type?.[1] && linked && tracking) {
      out[type[1]] = { linked: linked[1] === "true", tracking: tracking[1] === "true" };
    }
  }
  return out;
}

describe("iOS privacy manifest", () => {
  const xml = fs.readFileSync(MANIFEST, "utf8");

  it("declares exactly the data types the app collects", () => {
    expect(collectedDataTypes(xml)).toEqual({
      // Keyed to the anonymous per-install session ID → linked.
      UserID: { linked: true, tracking: false },
      GameplayContent: { linked: true, tracking: false },
      ProductInteraction: { linked: true, tracking: false },
      // Sentry: feedback and diagnostics carry no identifier.
      CustomerSupport: { linked: false, tracking: false },
      CrashData: { linked: false, tracking: false },
      PerformanceData: { linked: false, tracking: false },
      OtherDiagnosticData: { linked: false, tracking: false },
    });
  });

  it("declares no tracking", () => {
    expect(xml).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
    expect(xml).toMatch(/<key>NSPrivacyTrackingDomains<\/key>\s*<array\s*\/>/);
  });
});
