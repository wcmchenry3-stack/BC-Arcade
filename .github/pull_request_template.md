## Summary

<!-- What changed and why? Focus on the why, not the how. -->

## Type of change

<!-- Match the Conventional Commit type in the PR title. -->

- [ ] `feat` / `fix` / `refactor` / `perf`
- [ ] `test` / `docs` / `chore` / `ci`
- [ ] `security` hardening or `a11y` improvement

## Verification

<!-- Tests, device checks, screenshots, or other evidence as applicable. -->

- [ ] Tests/checks relevant to this change pass.
- [ ] Documentation was updated if behavior, architecture, workflow, or a public contract changed — or documentation is not applicable.
- [ ] No secrets, credentials, or private user data are included.
- [ ] New dependencies reviewed (if any were added).

## Mobile checklist _(iOS / Android PRs only)_

- [ ] Tested on an iOS Simulator / Android emulator or a physical device
- [ ] `ios-build-check` / `android-build-check` CI job passes
- [ ] No hardcoded local paths in `.pbxproj` (`local-path-check` passes)
- [ ] `Podfile.lock` changes committed (if applicable)
- [ ] If `package.json` bumps a native or JSI package: the `detect-native-changes` job summary lists only expected packages

## Web checklist _(web / frontend PRs only)_

- [ ] No axe violations on affected pages; keyboard navigation works
- [ ] Tested at 320px viewport width and 200% zoom
