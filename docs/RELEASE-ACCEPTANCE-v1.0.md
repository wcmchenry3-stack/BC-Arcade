# Release Acceptance — v1.0 (evidence template)

Evidence record for issue #2783 "Verify production builds, signing, and supported devices" (part of #2777, v1.0, P1). Copy this file per candidate build (or fill it in place and commit the result), mark each row, and link proof (screenshot, recording, log, CI run).

**A release check does not replace unresolved work in linked issues.** File every failing check as a specific bug, link it in the Blockers table, and do not tick a row while its bug is open. This is release acceptance, not a substitute for implementation.

Store build scope: **seven free games, three tabs** (Lobby, Profile, Settings). Internal/pre-launch builds (dev API) show all twelve games; keep those results separate (see #2480).

Legend: `[ ]` not run, `[x]` pass, `[!]` fail (link bug), `[n/a]` not applicable.

## 1. Build identifiers

| Field | iOS | Android |
| --- | --- | --- |
| Version / build number | | |
| Source branch + commit SHA | | |
| Build system + run link | Xcode Cloud workflow / build # | `./gradlew bundleRelease` on (machine) |
| API target (must be production) | `BC_API_TARGET` unset -> `games-api.buffingchi.com` (`select_api_target.sh`, #2774) | AAB grep check below |
| Distributed via | TestFlight build # / App Store Connect | Play track + release name |
| Tester / date | | |

## 2. Automated checks (run and attach)

| Check | Command / source | Result | Link |
| --- | --- | --- | --- |
| Frontend unit tests | `cd frontend && npm test` | | |
| Lint / typecheck | `npm run lint && npm run typecheck` | | |
| Store-build guard (7 games, no purchase/deep-link surface, prod env, no debug-signing fallback) | `npx jest src/__tests__/releaseBuildConfig.test.ts` | | |
| Visibility / route / tile / tab guards | `gameVisibility`, `premiumRoutes`, `HomeScreen`, `mainTabs` tests | | |
| Backend tests | `cd backend && python -m pytest tests/ -v` | | |
| CI on release commit (incl. `android-release-smoke`, secret scan, ZAP) | GitHub Actions run | | |
| Env guard | `npm run check-build-env` with `APP_ENV=production` | | |
| Existing security/build audits | #843, #845, #846, #847, #848 and CI issues: confirm required checks; do not mark audits complete by association | | |

## 3. Signing and API target

### Android upload certificate (Play Console)

1. Build on the release machine with the user-level `~/.gradle/gradle.properties` in place (docs/ANDROID-CI.md). The build fails by design if the upload keystore is missing or is the debug keystore.
2. In Play Console open **App integrity -> Play app signing -> Upload key certificate** and copy the SHA-1 (or SHA-256).
3. Run:

   ```bash
   scripts/verify-aab-signing.sh frontend/android/app/build/outputs/bundle/release/app-release.aab "<SHA from Play Console>"
   ```

   It prints SHA-1 and SHA-256, rejects the Android debug certificate, and exits non-zero on mismatch. Also cross-check `cd frontend/android && ./gradlew :app:signingReport` (release variant).
4. Status of the old upload-key reset (#830/#832): verify current console status rather than assuming the old block still exists.

| Check | Result | Evidence |
| --- | --- | --- |
| AAB SHA-1 matches Play Console upload certificate | | |
| AAB SHA-256 matches | | |
| Not the debug certificate (script exit 0) | | |
| Release build without keystore fails (negative test, optional) | | |

### Production API in the shipped binary

| Check | Result | Evidence |
| --- | --- | --- |
| Android (from `frontend/android`): `grep -a -c "https://dev-games-api.buffingchi.com" app/build/generated/assets/react/release/index.android.bundle` prints 0 | | |
| Android (from `frontend/android`): same grep for `https://games-api.buffingchi.com` prints > 0 | | |
| iOS: Xcode Cloud workflow has no `BC_API_TARGET=prelaunch` (unset -> games-api; the merged #2774 `select_api_target.sh` fails the build for a non-`main` source branch) | | |
| Android (required): `bundleRelease` built from `main` at the tagged release SHA (checked-out HEAD equals the release tag). Mirrors the iOS main-branch rule: a local `bundleRelease` from dev or a feature branch would ship dev code against the production API | | |
| On device: 7 tiles, 3 tabs, no debug panels, no premium tiles | | |
| Sentry environment is `production` for the build (#851) | | |

## 4. Functional matrix (store build, production API)

Run every row on the primary device of each platform; repeat the seven-game row on the matrix devices in section 5.

| Area | Check | iOS | Android | Notes / bug link |
| --- | --- | --- | --- | --- |
| Games | Yacht starts, plays, finishes, result recorded | [ ] | [ ] | |
| | Solitaire | [ ] | [ ] | |
| | FreeCell | [ ] | [ ] | |
| | Bottle Sort | [ ] | [ ] | |
| | Daily Word | [ ] | [ ] | |
| | 2048 | [ ] | [ ] | |
| | Sudoku | [ ] | [ ] | |
| Catalog | Exactly seven tiles; no Blackjack, Cascade, Hearts, Star Swarm, Mahjong (not even locked) | [ ] | [ ] | |
| | No purchase, paywall, upgrade or "locked" screen reachable anywhere | [ ] | [ ] | |
| Navigation | Three tabs only: Lobby, Profile, Settings; back navigation from every game | [ ] | [ ] | |
| | Per-game menu: Stats, Leaderboard entries open and return | [ ] | [ ] | |
| | Opening `com.buffingchi.games://` (iOS) does not navigate to any screen | [ ] | n/a | |
| Offline | Airplane mode: games playable; Daily Word cached puzzle; no crash | [ ] | [ ] | #856, #2428 |
| | Outcomes queued offline flush after reconnect (`SyncWorker`) | [ ] | [ ] | #2643 |
| | Entitlement offline grace does not lock free games | [ ] | [ ] | |
| Leaderboards | Board loads per game, own rank appears after a finished game | [ ] | [ ] | docs/MANUAL-QA-LEADERBOARDS.md |
| XP / daily | XP, level, daily challenge, streak update | [ ] | [ ] | #2480, #2392 |
| Deletion | Settings -> delete data works, app returns to clean state | [ ] | [ ] | #1923 |
| Legal | Privacy Policy and Terms links open the hosted pages | [ ] | [ ] | #1922, #828 |
| | Data deletion page `https://buffingchi.com/support#delete-data` opens in a browser without the app and matches Settings -> Delete my data; same URL entered as Play Console Data safety "Delete account URL" | n/a | [ ] | #2780, docs/LEGAL-PUBLISHING.md |
| Lifecycle | Background mid-game and resume: state intact, timers correct | [ ] | [ ] | |
| | Kill and relaunch mid-game: resume or clean start, no crash | [ ] | [ ] | |
| | Rotate (where supported), split view / multitasking on iPad | [ ] | [ ] | |
| Drag games | Real-device drag checks | [ ] | [ ] | #2263 |
| Errors | Sentry receives no new unexpected errors during the session | [ ] | [ ] | #851 |

## 5. Device matrix

Record model, OS version, build, and outcome. Add performance (smoothness, cold start), power (battery drain over a 10-minute session), and layout (clipping, safe areas, dark theme, narrow header) notes; deferred enhancements from #856, #1156, #1786, #853 are gates only where they break the basic experience.

| Class | Device / OS | Seven games | Layout | Perf | Power | Result / bug link |
| --- | --- | --- | --- | --- | --- | --- |
| iPhone narrow (e.g. SE / mini class) | | [ ] | [ ] | [ ] | [ ] | |
| iPhone standard | | [ ] | [ ] | [ ] | [ ] | |
| iPhone large (Plus / Max class) | | [ ] | [ ] | [ ] | [ ] | |
| iPad portrait (supported model) | | [ ] | [ ] | [ ] | [ ] | |
| iPad landscape | | [ ] | [ ] | [ ] | [ ] | |
| Android small / low-end | | [ ] | [ ] | [ ] | [ ] | |
| Android mid-range (primary) | | [ ] | [ ] | [ ] | [ ] | |
| Android large / tablet or foldable (if supported) | | [ ] | [ ] | [ ] | [ ] | |

## 6. IPv6-only network (iOS)

Apple review runs on IPv6-only (NAT64) networks. Test the store build (TestFlight) on a Mac Internet Sharing "Create NAT64 Network" hotspot (Settings -> Sharing -> Internet Sharing, tick "Create NAT64 Network") or an equivalent carrier/lab network.

| Check | Result | Evidence |
| --- | --- | --- |
| App launches, Lobby loads over the NAT64 network | | |
| Entitlement fetch, leaderboard load and score submit succeed | | |
| Daily Word / daily challenge load | | |
| Legal links open | | |
| Sentry event delivery (optional) | | |

## 7. Store build requirements

Checked 2026-10-01 against `dev` (Expo SDK 57.0.24, React Native 0.86.3). Re-check each row against the linked source before every submission; store rules change. Status: PASS = verified from the repo or artifacts, UNKNOWN = cannot be verified from the repo (say what to check).

| Requirement (source, read 2026-10-01) | Status | Evidence |
| --- | --- | --- |
| **iOS export compliance.** Standard algorithms and crypto built into Apple's OS need no export documentation; declaring `ITSAppUsesNonExemptEncryption` in Info.plist skips the encryption questions on each submission ([App Store Connect Help: overview of export compliance](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance)). | PASS | Audit: no crypto/cipher/TLS library in `package.json`; no CommonCrypto/CryptoKit/Security use in `ios/GamingApp/*.swift`; no crypto in `android/app/src/main`. JS uses only `fetch` over HTTPS (OS TLS), `crypto.randomUUID`/`getRandomValues` for IDs (`src/game/_shared/uuid.ts`), and base64-decodes the entitlement JWT payload without client-side verification (`src/entitlements/EntitlementContext.tsx`). FFmpeg is disabled in `react-native-audio-api` (`disableFFmpeg`, `disableAudioapiFFmpeg=true`). Declared in `ios/GamingApp/Info.plist` and mirrored in `app.json` (`ios.config.usesNonExemptEncryption`, `ios.infoPlist`); `npx expo config --type introspect` resolves it to false. Guarded by `src/__tests__/releaseBuildConfig.test.ts`. Re-evaluate before adding any non-OS crypto. |
| **Play target API level.** New apps and updates must target API 36 from 2026-08-31 (extension available to 2026-11-01) ([developer.android.com: target API level](https://developer.android.com/google/play/requirements/target-sdk)). | PASS | `android/app/build.gradle` reads `rootProject.ext.targetSdkVersion`, set by the `expo-root-project` plugin from the React Native version catalog (`node_modules/react-native/gradle/libs.versions.toml`): `targetSdk = 36`, `compileSdk = 36`, `minSdk = 24`. Nothing in `gradle.properties` or `app.json` overrides it. Confirm the "Target SDK" Play Console shows for the uploaded AAB. |
| **Play 16 KB memory page size** (apps targeting API 35+ with native code, 64-bit; Play blocks non-compliant updates from 2027-02-01 per the page) ([developer.android.com: page sizes](https://developer.android.com/guide/practices/page-sizes)). | PASS (static), AAB check pending | AGP 8.12.0 (≥ 8.5.1 zip-aligns uncompressed libs; `expo.useLegacyPackaging=false`). NDK 27.1.12297006 (r27 needs `-Wl,-z,max-page-size=16384`): the RN Gradle plugin adds `-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON` to the app's CMake build, and reanimated, worklets, gesture-handler, screens, svg, skia, audio-api and expo-modules-core set it or the linker flag themselves. Prebuilt `.so` files checked with `llvm-readelf -lW` (all LOAD segments `0x4000`, arm64-v8a and x86_64): `react-android-0.86.3`, `hermes-android` 0.17.0 and 250829098.0.17, `fbjni-0.7.0` (incl. `libc++_shared.so`), `sentry-native-ndk-0.16.6`. Skia ships static `.a` libs (linked into a 16 KB-aligned `.so`); audio-api's prebuilt FFmpeg `.so` files are excluded because FFmpeg is disabled. Not yet run: `zipalign -c -P 16 -v 4` on a release AAB/APK (no Android SDK in the agent environment). Run it on the release machine and check Play Console's App bundle explorer for 16 KB warnings. |
| **App Store Connect Xcode/SDK.** Since 2026-04-28 uploads must be built with Xcode 26 or later using the iOS 26 SDK; from 2026-09-09 apps must target iOS 13 or later ([Apple: upcoming requirements](https://developer.apple.com/news/upcoming-requirements/)). | Deployment target PASS; Xcode version UNKNOWN | `IPHONEOS_DEPLOYMENT_TARGET = 16.4` in every pbxproj configuration and `ios.deploymentTarget` 16.4 in `ios/Podfile.properties.json` (≥ 13). The Xcode version is set per workflow in App Store Connect → Xcode Cloud → Manage Workflows → Environment, not in the repo (`ios/ci_scripts/` and docs/IOS.md do not pin it). Confirm the release workflow uses Xcode 26.x (or "Latest Release") and record the Xcode version from the build log in section 1. |
| **Privacy manifest** (#2779). | PASS | `ios/GamingApp/PrivacyInfo.xcprivacy` exists, is in the GamingApp target's Resources phase (pbxproj), and `src/__tests__/privacyManifest.test.ts` pins it and its `app.json` mirror. |

Sources blocked from the agent environment on 2026-10-01: `dl.google.com` (Android SDK/NDK downloads, so `./gradlew` could not run), `repo.reactnative.dev` (react-android was fetched from the Maven Central GCS mirror instead) and `docs.expo.dev`.

## 8. Blockers and follow-ups

| Item | Linked issue / PR | Severity | Status |
| --- | --- | --- | --- |
| | | | |

Related issues and context (from #2783):

- Dev-build (12 games) checklist kept separate: #2480. Daily-challenge device acceptance: #2392. Real-device drag checklist: #2263. Result-submission E2E: #2643.
- Sentry environment/release evidence: #851 (development/production by API target, not a separate prod DSN or required testflight tag).
- TestFlight / Play testing tracks and Play upload-key-reset status: #830, #832. Launch version and native version/build sync: #857 (forced-upgrade/maintenance stays post-launch).
- Release-plan wording corrections (seven tiles, three tabs): #2732.
- Offline/error/empty states, battery, audio, performance budgets: #856, #1156, #1786, #853.
- Security/build work: #843, #845, #846, #847, #848 and CI issues. Production backup/plan: #2593.
- Prevent dev builds from targeting the production API (iOS Xcode Cloud guard, merged): PR #2774. Android has no equivalent script guard, so the `main`-at-tagged-SHA row above is a manual check.
- Other docs: docs/IOS.md, docs/ANDROID-CI.md, docs/RELEASE-PLAN-2026-10.md, docs/TESTING.md.

## 9. Sign-off

| Role | Name | Date | Decision (accept / reject) |
| --- | --- | --- | --- |
| Tester | | | |
| Owner | | | |
