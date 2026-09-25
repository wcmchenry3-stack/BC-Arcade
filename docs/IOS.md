# iOS Build — Xcode Cloud

## How iOS is built

This project builds iOS via **Xcode Cloud** (Apple's CI/CD in App Store Connect). EAS Build is **not used**.

## What this means

- `frontend/ios/` is **committed to the repo** — it is NOT gitignored and NOT generated at build time
- Xcode Cloud checks out the repo and expects `frontend/ios/GamingApp.xcworkspace` to exist
- The `/Volumes/workspace/repository/` path in build logs is **Xcode Cloud infrastructure**, not EAS
- Builds are triggered through App Store Connect

## If the ios/ folder is missing

The `frontend/ios/` directory must exist in the repo. If it is missing:

1. It was likely accidentally added to `.gitignore` — remove `/ios` from `frontend/.gitignore`
2. Run `expo prebuild` once to regenerate it: `cd frontend && npx expo prebuild`
3. Restore the version references in `frontend/ios/GamingApp/Info.plist` — prebuild overwrites them with literals from `app.json` (see [Version numbers](#version-numbers))
4. Commit the generated `ios/` folder
5. Do **not** add `prebuildCommand` to `eas.json` — EAS is not the build target

## Version numbers

`Info.plist` does not carry its own version. `CFBundleShortVersionString` is `$(MARKETING_VERSION)` and `CFBundleVersion` is `$(CURRENT_PROJECT_VERSION)`, both resolved from `project.pbxproj`, which `.github/workflows/version-sync.yml` patches on every release. Never type a version into `Info.plist` — a literal looks right on the day and silently drifts at the next release (it sat at 1.0.0 while the app shipped 1.0.9). `frontend/src/__tests__/nativeVersionSync.test.ts` fails if a literal reappears, e.g. after `expo prebuild`.

Xcode Cloud replaces `CFBundleVersion` with its own auto-incrementing build number, so store builds never carry the pbxproj value (10009, 10100, …). **Do not upload a locally archived build to App Store Connect**: it would carry that large number, and every later Xcode Cloud upload in the same version train would be rejected as lower until the Xcode Cloud next-build-number is raised past it.

## EAS status

EAS Build and `eas submit` are **not used** for this project — neither now nor planned. `eas.json` has been removed.

## CI / CD

iOS builds run via **Xcode Cloud** (App Store Connect), not GitHub Actions.
GitHub Actions `ci.yml` does not include an iOS build step.
The `/Volumes/workspace/repository/` path in Xcode Cloud logs is Apple's runner — not EAS.

### API URL per workflow (pre-launch vs. App Store)

The API URL a build is compiled against decides whether it is a pre-launch build or a store build. `isPreLaunchApiBuild()` (`frontend/src/game/_shared/envFlags.ts`) turns on the hidden premium games, the Hearts debug panel, the Star Swarm dev panel and Sentry's `development` environment for any bundle compiled against the dev API. The dev backend also grants every premium game for free (`ENTITLEMENT_DEV_OVERRIDE`). A build meant for the App Store must never use the dev URL.

`frontend/ios/ci_scripts/ci_post_clone.sh` deletes `.env.production` and writes `frontend/.env` on every Xcode Cloud build. It picks the URL from the workflow's **`BC_API_TARGET`** environment variable (App Store Connect → Xcode Cloud → workflow → Environment → Environment Variables):

| Workflow                           | `BC_API_TARGET`             | API URL baked into the bundle          | Build type                          |
| ---------------------------------- | --------------------------- | -------------------------------------- | ----------------------------------- |
| Internal / TestFlight (pre-launch) | `prelaunch`                 | `https://dev-games-api.buffingchi.com` | Pre-launch: all 12 games, dev tools |
| App Store release                  | unset (or `production`)     | `https://games-api.buffingchi.com`     | Store: 6 games, no dev tools        |
| Any workflow                       | anything else (e.g. a typo) | none: the build fails                  | none                                |

Only the internal/TestFlight workflow sets the variable. A workflow without it, including any new or copied workflow, builds against production. This fails closed: forgetting the variable gives a TestFlight build that shows 6 games, never an App Store build with the dev tools.

- The post-clone log shows the choice: `=== workflow '<name>': BC_API_TARGET='…' -> <url> ===`.
- An archive from the TestFlight workflow is a pre-launch build. **Never submit it for App Store review.** Submit only archives built by the App Store release workflow.
- Each workflow uses the same URL until launch and after it. Nobody needs to edit the script on launch day.
- `frontend/src/entitlements/__tests__/gameVisibility.test.ts` reads the script. It fails if the script knows a third URL, if anything other than `prelaunch` selects the dev API, or if an unset variable stops meaning production.

Android makes the same split differently. See [`ANDROID-CI.md`](ANDROID-CI.md), "API URL: store vs. pre-launch builds".

### Store-build guard (test hooks)

`EXPO_PUBLIC_TEST_HOOKS=1` is inlined into the JS bundle and unhides the premium games that store builds must not show (`frontend/src/entitlements/gameVisibility.ts`, #2390). `frontend/ios/ci_scripts/ci_post_clone.sh` therefore fails the Xcode Cloud build when the flag is `1` in the workflow's environment variables or in any dotenv file Expo loads for a production bundle (`.env`, `.env.local`, `.env.production`, `.env.production.local`). A healthy build logs `=== test-hooks guard passed ===` in the post-clone step. If it fails, remove the variable from the Xcode Cloud workflow (App Store Connect → Xcode Cloud → workflow → Environment) or from the named file — do not weaken the check. Android has the equivalent guard in `frontend/android/app/build.gradle` (see [`ANDROID-CI.md`](ANDROID-CI.md)).

## Local simulator troubleshooting

**`[runtime not ready]: ReferenceError: Property 'MessageQueue' doesn't exist` on launch** (#2328) — the dev-client binary on the simulator was compiled against a different react-native/Hermes than the JS Metro is serving. It shows up after a native dependency bump (react-native, hermes-engine, Expo SDK, any Pod). Rebuild the native app and clear Metro's cache — a JS reload is not enough:

```bash
cd frontend
npm ci
(cd ios && pod install)
npx expo run:ios      # fresh native build + install on the simulator
npx expo start -c     # Metro with a cleared cache
```

If `pod install` complains that a local pod (`React-Core-prebuilt`, `hermes-engine`, …) "differs from the version stored in `Pods/Local Podspecs`", delete `frontend/ios/Pods/Local Podspecs` and re-run `pod install`.

`pod install` also generates the React Native codegen under `frontend/ios/build/generated/`. Like `Pods/`, that directory is **not tracked** (`frontend/ios/.gitignore` ignores `build/`) — it must match the installed react-native, so never restore or commit it. A stale copy fails to compile with errors such as `no type named 'ResultT' in 'JS::NativeSafeAreaContext::Constants::Builder'`; the fix is to re-run `pod install`.

**Simulator builds from the command line on this project's Intel Mac** need `ARCHS=x86_64`; an `arm64` simulator build compiles fine and then fails to install with "Failed to find matching arch".

## Do not suggest

- `eas build` for iOS
- `prebuildCommand` in `eas.json`
- Treating `ios/` as a generated/ephemeral directory
