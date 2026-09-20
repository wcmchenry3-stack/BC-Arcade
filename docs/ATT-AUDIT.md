# BC Arcade — App Tracking Transparency (ATT) / IDFA Audit

**Audit Date:** 2026-09-20  
**Commit:** a4f15ddd  
**Revision:** 1.0

---

## Summary & Verdict

### **No ATT prompt required — NSPrivacyTracking:false is accurate**

BC Arcade does not use Apple's Identifier for Advertisers (IDFA), device identifiers, or user-tracking SDKs. The app collects no user-tracking data and declares `NSPrivacyTracking: false` correctly in its PrivacyInfo.xcprivacy manifest and app.json configuration. **No user-facing ATT ("Ask App Not to Track") prompt is required for App Store submission.**

All nine evidence steps were completed. Two limits apply and are stated under "Limits of this audit": the prebuilt React Native / Hermes archives were checked at the link-flag level rather than unpacked, and the audit covers the dependency set at the commit below.

---

## Scope & Method

| Item                      | Value                                                                                                                                                                                                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **App**                   | BC Arcade (com.buffingchi.games)                                                                                                                                                                                                                                                               |
| **Framework**             | Expo / React Native iOS                                                                                                                                                                                                                                                                        |
| **Date**                  | 2026-09-20                                                                                                                                                                                                                                                                                     |
| **Commit**                | a4f15ddd                                                                                                                                                                                                                                                                                       |
| **Audit Scope**           | Privacy manifests, dependency inventory, native/JS source code for IDFA, advertising, and analytics SDKs                                                                                                                                                                                       |
| **Evidence Completeness** | All 9 steps completed. `Pods/` present locally. `Pods/sentry-xcframeworks/9.28.0/Sentry.xcframework` is a **symlink** into `~/Library/Caches/sentry-react-native/xcframeworks/9.28.0/` — the binary was inspected there (a plain `grep -r` over `Pods/` does not follow it and skips binaries) |

---

## Evidence Summary Table

| Step | Checked                                                                                                    | Command / Method                                                                                                                                                                                 | Result                                                                                                                                                                                                                                                                                                                            | File:Line Reference                                                                                              |
| ---- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1    | PrivacyInfo.xcprivacy                                                                                      | Read entire file                                                                                                                                                                                 | ✅ NSPrivacyTracking: false; NSPrivacyTrackingDomains: empty; NSPrivacyAccessedAPITypes: FileTimestamp, UserDefaults, DiskSpace, SystemBootTime; NSPrivacyCollectedDataTypes: CrashData, PerformanceData, OtherDiagnosticData (all Tracking=false)                                                                                | frontend/ios/GamingApp/PrivacyInfo.xcprivacy:82-85                                                               |
| 2    | app.json                                                                                                   | Grep: NSPrivacyTracking, NSUserTrackingUsageDescription, privacyManifests, plugins                                                                                                               | ✅ NSPrivacyTracking: false declared in ios.privacyManifests; plugins list includes @sentry/react-native/expo, expo-localization, react-native-audio-api (none tracking-related)                                                                                                                                                  | frontend/app.json:18-28, 42-60                                                                                   |
| 3    | Info.plist                                                                                                 | Grep: NSUserTrackingUsageDescription                                                                                                                                                             | ✅ Not present (as expected)                                                                                                                                                                                                                                                                                                      | frontend/ios/GamingApp/Info.plist:(no match)                                                                     |
| 4    | package.json dependencies                                                                                  | Parsed full list; flagged tracking SDKs                                                                                                                                                          | ✅ No matching deps: expo-tracking-transparency, expo-ads-_, react-native-google-mobile-ads, react-native-fbsdk_, @react-native-firebase/analytics, appsflyer, adjust, branch, segment, amplitude, mixpanel, onesignal, expo-notifications, react-native-idfa, expo-application                                                   | frontend/package.json:59-96                                                                                      |
| 5    | Podfile.lock                                                                                               | `grep '^  - ' \| sed` to extract top-level pods; flagged tracking-related                                                                                                                        | ✅ No matching pods: Ads, AdSupport, GoogleAppMeasurement, Firebase, FBSDK, FBAudience, AppsFlyer, Adjust, Branch, Amplitude, Mixpanel, Segment, OneSignal, Tracking. Found RNSentry only (error tracking, not user tracking)                                                                                                     | frontend/ios/Podfile.lock:(63 unique pods, none flagged)                                                         |
| 6a   | Source IDFA symbols (frontend/ios except Pods/build)                                                       | grep -rI: ASIdentifierManager, advertisingIdentifier, AdSupport, ATTrackingManager, AppTrackingTransparency                                                                                      | ✅ No matches in native source files (GamingApp-Bridging-Header.h, AppDelegate.swift)                                                                                                                                                                                                                                             | frontend/ios/{GamingApp-Bridging-Header.h, AppDelegate.swift}:(no match)                                         |
| 6b   | IDFA symbols in `frontend/ios/Pods`, **binaries included**                                                 | `grep -rla -E 'ASIdentifierManager\|ATTrackingManager' Pods`                                                                                                                                     | ✅ No file matches                                                                                                                                                                                                                                                                                                                | —                                                                                                                |
| 6c   | Any target linking an ad / tracking framework                                                              | `grep -rl -E 'AdSupport\|AppTrackingTransparency\|AdServices'` over `Pods/Target Support Files`, `Pods.xcodeproj`, `GamingApp.xcodeproj`                                                         | ✅ No target links `AdSupport`, `AppTrackingTransparency` or `AdServices` — this covers every pod, including the prebuilt React Native / Hermes archives, because `advertisingIdentifier` cannot be read without linking `AdSupport`                                                                                              | —                                                                                                                |
| 7    | Sentry Cocoa 9.28.0 (via `@sentry/react-native` 8.26.0) — device slice `ios-arm64_arm64e/Sentry.framework` | `grep -a -c` on the Mach-O binary for `ASIdentifierManager`, `advertisingIdentifier`, `ATTrackingManager`, `AdSupport`, `AppTrackingTransparency`; `otool -L`; `plutil -p PrivacyInfo.xcprivacy` | ✅ **0 occurrences of every symbol**; links no ad/tracking framework. Sentry **ships its own `PrivacyInfo.xcprivacy`**: no `NSPrivacyTracking`, no tracking domains; collected types CrashData / PerformanceData / OtherDiagnosticData, each `Tracking = false`; required-reason APIs UserDefaults, SystemBootTime, FileTimestamp | `~/Library/Caches/sentry-react-native/xcframeworks/9.28.0/Sentry.xcframework/ios-arm64_arm64e/Sentry.framework/` |
| 8    | Cloudflare Web Analytics                                                                                   | grep -rIn: cloudflareinsights, beacon.min.js, cf-beacon (excluding node_modules, Pods, build)                                                                                                    | ✅ Not found anywhere in frontend source                                                                                                                                                                                                                                                                                          | frontend/(no match)                                                                                              |
| 9    | JS-level IDFA (frontend/src + App.tsx)                                                                     | grep -rIn: getIosIdForVendorAsync, getAdvertisingId, requestTrackingPermissions                                                                                                                  | ✅ Not found in any JS/TS source                                                                                                                                                                                                                                                                                                  | frontend/src/, frontend/App.tsx:(no match)                                                                       |

---

## Dependency Inventory

### De-duplicated Pod List (63 unique, top-level from Podfile.lock)

**Categories:**

- **React Native Core:** React, React-Core, React-Fabric, React-FabricComponents, react-native, react-native-web
- **React Native Support:** React-hermes, hermes-engine, Yoga, ReactNativeDependencies
- **Expo Modules:** Expo, ExpoAsset, ExpoAudio, ExpoBlur, ExpoFileSystem, ExpoFont, ExpoHaptics, ExpoKeepAwake, ExpoLinearGradient, ExpoLocalization, ExpoScreenOrientation
- **Expo Dev Tools:** expo-dev-client, expo-dev-launcher, expo-dev-menu, ExpoLogBox
- **Community/Third-party:** RNSentry (Sentry error tracking), RNGestureHandler, RNReanimated, RNScreens, RNSVG, RNWorklets, RNAudioAPI, react-native-safe-area-context, react-native-netinfo, react-native-skia
- **Support/Infrastructure:** EXConstants, EXJSONUtils, EXManifests, FBLazyVector, and numerous React-* sub-libraries (callinvoker, jsi, logger, jsinspector, utils, etc.)

**Tracking-Related Flags:** None. No pods match: Ads, AdSupport, GoogleAppMeasurement, Firebase, FBSDK, FBAudience, AppsFlyer, Adjust, Branch, Amplitude, Mixpanel, Segment, OneSignal, Tracking.

### Flagged Dependencies Check (package.json + Podfile.lock)

| Dependency Class   | Checked For                                                      | Found? | Notes                                                                                                                                                                   |
| ------------------ | ---------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ad SDKs            | expo-ads-*, react-native-google-mobile-ads                       | ❌ No  | None present                                                                                                                                                            |
| Facebook           | react-native-fbsdk*, FBSDK (pods)                                | ❌ No  | None present                                                                                                                                                            |
| Google Analytics   | @react-native-firebase/analytics, GoogleAppMeasurement           | ❌ No  | None present                                                                                                                                                            |
| ATT/IDFA Wrappers  | expo-tracking-transparency, react-native-idfa                    | ❌ No  | None present                                                                                                                                                            |
| Advertising IDs    | expo-application (getAdvertisingId), getIosIdForVendorAsync (JS) | ❌ No  | None present                                                                                                                                                            |
| Attribution/MMP    | appsflyer, adjust, branch, segment                               | ❌ No  | None present                                                                                                                                                            |
| Analytics          | amplitude, mixpanel                                              | ❌ No  | None present                                                                                                                                                            |
| Push Notifications | expo-notifications, onesignal                                    | ❌ No  | None present                                                                                                                                                            |
| Included: Sentry   | @sentry/react-native (v~8.26.0, pod: RNSentry)                   | ✅ Yes | Error tracking and performance monitoring; **does not use IDFA** (step 7: zero IDFA symbols in the 9.28.0 device binary; its own privacy manifest declares no tracking) |

---

## Privacy Manifest Review

### Current Declarations

**App-Level (frontend/ios/GamingApp/PrivacyInfo.xcprivacy):**

```xml
<key>NSPrivacyTracking</key>
<false/>

<key>NSPrivacyTrackingDomains</key>
<array/>

<key>NSPrivacyAccessedAPITypes</key>
<array>
  <dict>
    <key>NSPrivacyAccessedAPIType</key>
    <string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
    <key>NSPrivacyAccessedAPITypeReasons</key>
    <array>
      <string>C617.1</string>
      <string>0A2A.1</string>
      <string>3B52.1</string>
    </array>
  </dict>
  <dict>
    <key>NSPrivacyAccessedAPIType</key>
    <string>NSPrivacyAccessedAPICategoryUserDefaults</string>
    <key>NSPrivacyAccessedAPITypeReasons</key>
    <array>
      <string>CA92.1</string>
    </array>
  </dict>
  <dict>
    <key>NSPrivacyAccessedAPIType</key>
    <string>NSPrivacyAccessedAPICategoryDiskSpace</string>
    <key>NSPrivacyAccessedAPITypeReasons</key>
    <array>
      <string>E174.1</string>
      <string>85F4.1</string>
    </array>
  </dict>
  <dict>
    <key>NSPrivacyAccessedAPIType</key>
    <string>NSPrivacyAccessedAPICategorySystemBootTime</string>
    <key>NSPrivacyAccessedAPITypeReasons</key>
    <array>
      <string>35F9.1</string>
    </array>
  </dict>
</array>

<key>NSPrivacyCollectedDataTypes</key>
<array>
  <dict>
    <key>NSPrivacyCollectedDataType</key>
    <string>NSPrivacyCollectedDataTypeCrashData</string>
    <key>NSPrivacyCollectedDataTypeLinked</key>
    <false/>
    <key>NSPrivacyCollectedDataTypePurposes</key>
    <array>
      <string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
    </array>
    <key>NSPrivacyCollectedDataTypeTracking</key>
    <false/>
  </dict>
  <dict>
    <key>NSPrivacyCollectedDataType</key>
    <string>NSPrivacyCollectedDataTypePerformanceData</string>
    <key>NSPrivacyCollectedDataTypeLinked</key>
    <false/>
    <key>NSPrivacyCollectedDataTypePurposes</key>
    <array>
      <string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
    </array>
    <key>NSPrivacyCollectedDataTypeTracking</key>
    <false/>
  </dict>
  <dict>
    <key>NSPrivacyCollectedDataType</key>
    <string>NSPrivacyCollectedDataTypeOtherDiagnosticData</string>
    <key>NSPrivacyCollectedDataTypeLinked</key>
    <false/>
    <key>NSPrivacyCollectedDataTypePurposes</key>
    <array>
      <string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
    </array>
    <key>NSPrivacyCollectedDataTypeTracking</key>
    <false/>
  </dict>
</array>
```

**app.json Configuration (ios.privacyManifests):**

```json
"privacyManifests": {
  "NSPrivacyAccessedAPITypes": [
    {
      "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryUserDefaults",
      "NSPrivacyAccessedAPITypeReasons": ["CA92.1"]
    }
  ],
  "NSPrivacyCollectedDataTypes": [],
  "NSPrivacyTracking": false,
  "NSPrivacyTrackingDomains": []
}
```

### Pods Shipping PrivacyInfo.xcprivacy

**ReactNativeDependencies** (folly, glog, boost bundles across multiple architectures):

- Declares `NSPrivacyTracking: false`
- Declares only `NSPrivacyAccessedAPICategoryFileTimestamp` (C617.1)
- No user tracking

**Sentry (Sentry.framework 9.28.0, inside the xcframework):**

- Ships its own `PrivacyInfo.xcprivacy`
- Collected data types: CrashData, PerformanceData, OtherDiagnosticData — each `NSPrivacyCollectedDataTypeTracking = false`
- Required-reason APIs: UserDefaults, SystemBootTime, FileTimestamp — **all three categories are also declared in the app's manifest**, which additionally declares DiskSpace
- The app-level manifest's three collected data types mirror Sentry's exactly

### Completeness Assessment

✅ **No required-reason APIs are missing.** The app declares:

- File timestamp APIs (for cache/file management)
- UserDefaults (for app preferences)
- Disk space queries (system diagnostics)
- System boot time (performance analysis)

These are standard React Native / Expo runtime behaviors and are appropriately declared.

✅ **No tracking APIs are declared.** NSPrivacyTracking is correctly set to false.

✅ **No user-facing tracking is present.** The app does not collect or use IDFA, AAID, or any third-party tracking identifiers.

### Recommendation (no change made)

`frontend/app.json` → `ios.privacyManifests` has drifted from the committed manifest: it lists `NSPrivacyCollectedDataTypes: []` and only the UserDefaults API, while `frontend/ios/GamingApp/PrivacyInfo.xcprivacy` (what actually ships — `frontend/ios/` is committed and built by Xcode Cloud, never regenerated by `expo prebuild`) declares three collected data types and four API categories. Harmless today, but a future `expo prebuild` would overwrite the correct manifest with the thinner one. Bring `app.json` in line post-launch.

### Limits of this audit

- The prebuilt React Native / Hermes `.tar.gz` archives under `Pods/*-artifacts/` were not unpacked; they are covered by the link-flag check (6c).
- The App Store Connect **App Privacy** answers must match this manifest: Diagnostics (crash, performance, other diagnostic data), **not linked to the user, not used for tracking**. Gameplay data keyed to the anonymous session ID is a separate question for that form — see the Privacy Policy.

---

## Attestation

**For App Store Review / On-File:**

> BC Arcade does not use Apple's Identifier for Advertisers (IDFA) or any equivalent device identifier for user tracking, profiling, or analytics purposes. The app declares `NSPrivacyTracking: false` in its privacy manifest. No user-tracking SDKs (e.g., AppsFlyer, Adjust, Firebase Analytics, Facebook SDK) are included. The app uses Sentry for error tracking and performance monitoring only; Sentry does not access IDFA and is not a user-tracking service. No third-party analytics that require IDFA are present. Therefore, the app does not require Apple's App Tracking Transparency (ATT) prompt and complies with Apple's privacy policy requirements as of the submission date.

---

## Out of Scope

- **Android Advertising ID (GAID):** Not audited; Android builds use separate privacy declarations.
- **Re-audit Triggers:** This audit is valid for the current dependency set. **Re-audit if:**
  - Any ads SDK is added (Google Mobile Ads, Facebook Audience Network, AppLovin, etc.)
  - Analytics SDK with IDFA use is added (AppsFlyer, Adjust, Firebase Analytics, Amplitude, Mixpanel, Segment, etc.)
  - An IAP SDK is introduced (RevenueCat etc. — planned post-launch, epic #822)
  - Sentry is upgraded to a major version (e.g., 9.x, 10.x) — verify IDFA use in release notes.
  - Any new npm/pod dependencies flagged for analytics, attribution, or advertising are added.

---

**Audit Completed:** 2026-09-20 | **Status:** ✅ App Tracking Transparency not required
