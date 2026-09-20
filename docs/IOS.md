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

## Local simulator troubleshooting

**`[runtime not ready]: ReferenceError: Property 'MessageQueue' doesn't exist` on launch** (#2328) — the dev-client binary on the simulator was compiled against a different react-native/Hermes than the JS Metro is serving. It shows up after a native dependency bump (react-native, hermes-engine, Expo SDK, any Pod). Rebuild the native app and clear Metro's cache — a JS reload is not enough:

```bash
cd frontend
npm ci
(cd ios && pod install)
npx expo run:ios      # fresh native build + install on the simulator
npx expo start -c     # Metro with a cleared cache
```

If `pod install` complains that a local pod (`React-Core-prebuilt`, `hermes-engine`, …) "differs from the version stored in `Pods/Local Podspecs`", delete `frontend/ios/Pods/Local Podspecs` and re-run `pod install`. `pod install` also regenerates the tracked codegen under `frontend/ios/build/generated/` — revert that with `git checkout -- frontend/ios/build` unless you are intentionally bumping a native package.

## Do not suggest

- `eas build` for iOS
- `prebuildCommand` in `eas.json`
- Treating `ios/` as a generated/ephemeral directory
