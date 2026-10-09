# CI Checks and Branch Protection

Every PR into `dev` or `main` shows 40+ checks. This guide says what each one is for, what it prevents, where it is defined, when it was introduced, how it gates, and roughly how long it takes. Research issue: #3103. Making the colour-literal and docs-link checks required is tracked in #3102.

Source of truth is `.github/workflows/`; this document is a snapshot taken from `dev` at `8f6a834a` (2026-10-09). If it disagrees with the workflow files, the workflow files win. For how the test layers fit together see [TESTING.md](TESTING.md); for the native build pipelines see [IOS.md](IOS.md) and [ANDROID-CI.md](ANDROID-CI.md).

## Summary

A PR into `dev` or `main` triggers 41 workflow jobs: 36 in `ci.yml` plus 5 stand-alone policy and hygiene workflows (`commitlint`, `design-token-check`, `openai-policy`, `gemini-policy`, `schema-migration`). Many of these call reusable workflows from the org repo `wcmchenry3-stack/.github`. Seven checks are conditional: `ios-build-check`, `android-build-check` and `Podfile.lock freshness` (native changes; the first two always run on PRs into `main`), `android-release-smoke` (Android-relevant files), the Playwright E2E scope (selective on `dev`, full suite on `main`), and the Yacht and Hearts sim gates (AI paths only, up to 90 minutes). The slowest unconditional checks are Playwright E2E (about 13 minutes on a full run), `test-python` (about 6 minutes) and `test-frontend` (about 4 minutes); everything else finishes in under a minute.

Not covered by workflow files, and so not described in detail here: CodeQL, Supabase Preview and the Codex review app (see [External apps](#external-apps-not-in-workflow-files)).

### How to read the tables

- **Introduced**: the earliest commit that adds the job to the workflow file (`git log -S`), with the PR or issue number from the commit subject when it has one. Early commits have no number; those are cited by short SHA. The five stand-alone workflows were synced from the org template into this repo on 2026-04-11; their real origin is in the org repo and is "origin unclear" from here.
- **Gating**: "Always" means the job runs on every PR into `dev` and `main`. "Tier 1" means it has `needs: [lint-python, lint-frontend, secret-scan, conflict-markers, forbidden-terms]`, so it is skipped when any Tier 0 job fails.
- **Time**: wall-clock for the job on a recent successful run of `ci.yml` (run 37901059505, 2026-10-09). A figure marked "timeout" is the configured limit, not a measurement. Runner start-up and queueing are not included.
- **Reusable workflow bodies** live in `wcmchenry3-stack/.github`, which is not readable from this repository. Where a purpose below is taken only from the job name or its inputs, the cell says so.
- Where a reusable workflow is called, the check shows up in GitHub as `<job> / <inner job name>` (for example `lint-python / Lint Python (black + ruff)`). Branch protection matches on that full string.

## Tier model in `ci.yml`

```text
Tier 0 (start immediately)
  gate-main-source, secret-scan, lint-python, lint-python-tools, test-tools,
  lint-frontend, conflict-markers, forbidden-terms
        |
        v   needs: lint-python, lint-frontend, secret-scan, conflict-markers, forbidden-terms
Tier 1  everything else except the four below
        |
        v   needs: test-python, test-frontend (+ detect-* where noted)
Tier 2  e2e (also needs detect-e2e-scope), ios-build-check, android-build-check,
        android-release-smoke
Podfile.lock freshness needs only detect-native-changes.
```

`gate-main-source`, `lint-python-tools` and `test-tools` are Tier 0 but are not in the Tier 1 `needs:` list, so a failure in them does not skip the Tier 1 jobs.

## Code quality and style

| Check | Purpose | Prevents | Workflow:job | Introduced | Gating | Time |
| --- | --- | --- | --- | --- | --- | --- |
| `lint-python` | black + ruff on `backend/` (ruff pinned to 0.16.8, in lockstep with `requirements-dev.txt`) | Unformatted code, unused imports, bugbear/complexity findings landing in the backend | `ci.yml:lint-python` (org `called-lint-python.yml`) | 2026-03-22, 12715a0c | Tier 0, always | 17s |
| `lint-python-tools` | Same lint, pointed at `tools/` (dev tooling) | Style drift in the asset, sim and generator scripts | `ci.yml:lint-python-tools` | 2026-10-07, #3057 | Tier 0, always | 12s |
| `lint-frontend` | eslint + prettier on `frontend/` (includes the file-size and complexity rules from #2951) | Lint errors, formatting drift, 800-line files and 150-line functions growing unchecked | `ci.yml:lint-frontend` (org `called-lint-frontend.yml`) | 2026-03-22, 12715a0c | Tier 0, always | 57s |
| `typecheck-frontend` | `npm run typecheck` over production sources (`tsconfig.typecheck.json`, tests excluded) | A type error merging because Jest/Babel do not type-check | `ci.yml:typecheck-frontend` | 2026-09-23, #2211 | Tier 1 | 36s |
| `Backend file length` | `backend/scripts/check_file_length.py`: `.py` files must stay within 800 lines (per-file caps otherwise) | A backend module quietly growing into an unreviewable monolith | `ci.yml:backend-file-length` | 2026-10-04, #3006 | Tier 1 | 16s |
| `Duplication (jscpd)` | jscpd over `frontend/src`, `frontend/tooling`, `backend`; fails above 2.5% duplicated lines | Copy-paste growth across games and backend modules | `ci.yml:duplication` | 2026-10-04, #3006 | Tier 1 | 17s |
| `Unused code (knip)` | `npx knip` for unused files, exports and dependencies in `frontend/` | Dead code and unused dependencies accumulating. The step has `continue-on-error: true`, so today it **reports but does not fail** | `ci.yml:knip` | 2026-10-04, #3006 | Tier 1 | 46s |
| `Colour literals` | `frontend/scripts/check-color-literals.mjs` plus its own `node --test` run | A hex or rgb colour hard-coded in a screen instead of the theme or the per-game palette | `ci.yml:check-color-literals` | 2026-10-08, #3098 (rule from #2989) | Tier 1 | 40s |
| `i18n completeness check` | `frontend/scripts/check-i18n-strings.js`: every locale has every string | A new UI string shipped without translations in all locales | `ci.yml:check-i18n` | 2026-03-28, f4062948 | Tier 1 | 43s |
| `design-token-check` | Design tokens and accessibility policy (`.claude/policies/design-tokens.md`: raw colours, px font sizes, positive `tabindex`) | A PR that bypasses design tokens or breaks the WCAG-oriented rules | `design-token-check.yml:design-token-check` (org `called-design-token-check.yml`) | 2026-04-11, e1d70005 template sync; original origin unclear | Always (also runs on PR edits) | not measured |
| `commitlint` | Conventional Commits check (PR titles become the squash-merge message; see `CONTRIBUTING.md`) | A merge commit like "stuff" that breaks release-please changelogs | `commitlint.yml:commitlint` (org `called-commitlint.yml`) | 2026-04-11, e1d70005 template sync; original origin unclear | Always (also runs on PR edits) | not measured |
| `expo-compat` | `npx expo install --check`; fails if a package is **ahead** of Expo's matrix without an approved override, warns if behind | An incompatible dependency bump that breaks native builds | `ci.yml:expo-compat` | 2026-03-31, 2e98ac00 | Tier 1 | 40s |

## Tests

| Check | Purpose | Prevents | Workflow:job | Introduced | Gating | Time |
| --- | --- | --- | --- | --- | --- | --- |
| `test-python` | Backend pytest with coverage (`--cov-fail-under=96` in `pyproject.toml`) | A backend regression or coverage drop | `ci.yml:test-python` (org `called-test-python.yml`) | 2026-03-22, fa4d6417 | Tier 1 | about 6 min |
| `test-frontend` | Jest with the coverage floors in `frontend/package.json` | A frontend regression or coverage drop | `ci.yml:test-frontend` (org `called-test-frontend.yml`) | 2026-03-22, fa4d6417 | Tier 1 | about 4 min |
| `Test tools (pytest)` | pytest for `tools/assets` | A broken asset-pipeline script | `ci.yml:test-tools` | 2026-10-07, #3057 | Tier 0, always | 27s |
| `Detect E2E scope` | Maps changed paths to games via `.github/paths/game-paths.yml` | Running (or skipping) the wrong Playwright projects | `ci.yml:detect-e2e-scope` | 2026-04-05, 140b3968 (GH #239); path table from #2973 | Tier 1 | 9s |
| `Playwright E2E` | Builds Expo web and runs Playwright for the selected games | A user-visible web flow breaking while unit tests stay green. Web is a secondary platform, so this guards the free games and test harness | `ci.yml:e2e` | 2026-03-27, db21b572 (selective scope added 2026-04-05) | Needs `test-python`, `test-frontend`, `detect-e2e-scope`. Selective on `dev`; full suite for PRs into `main` or when shared paths change | about 13 min (full suite) |
| `schema-check` | Alembic `upgrade head` on SQLite (per `GAME-CONTRACT.md`) | A migration that does not apply cleanly | `schema-migration.yml:schema-check` (org `called-schema-migration.yml`, Python 3.11) | 2026-04-11, baeb7a27 template sync; original origin unclear | Always | not measured |
| `Yacht AI Calibration Gate`: `Bands (<group>)` x4, `Regret` | Full AI calibration matchups and EV-loss versus oracle | A Yacht AI or engine change that makes bots weaker or mis-calibrated | `yacht-sim-gate.yml:bands`, `regret` | 2026-09-24, #2245 (regret gate #2244) | **Conditional**: PRs touching `frontend/src/game/yacht/{ai*,engine,oracle/**}`, `frontend/tooling/yacht/**`, `simRandom.ts`, `tools/sim/simulate-yacht.ts` or the workflow. Also nightly | timeout 90 / 60 min |
| `Hearts AI Sim Gate`: `Gate (<group>)` x2 | Sequential (SPRT) non-regression and persona-separation checks | A Hearts AI or engine change that regresses play strength | `hearts-sim-gate.yml:gate` | 2026-09-24, #2238 | **Conditional**: PRs touching Hearts AI/engine/types, `frontend/tooling/hearts/**`, `simRandom.ts`, `tools/sim/simulate-hearts.ts` or the workflow. Also nightly | timeout 45 min (about 12 worst case per its comment) |

## Security and supply chain

| Check | Purpose | Prevents | Workflow:job | Introduced | Gating | Time |
| --- | --- | --- | --- | --- | --- | --- |
| `secret-scan` | gitleaks | A committed API key, token or keystore password | `ci.yml:secret-scan` (org `called-secret-scan.yml`) | 2026-03-22, fa4d6417 | Tier 0, always | 31s |
| `cve-python` | pip-audit on `backend/` (ignores PYSEC-2025-183, no upstream fix yet) | A known-vulnerable Python dependency | `ci.yml:cve-python` (org `called-cve-python.yml`) | 2026-03-22, fa4d6417 | Tier 1 | 30s |
| `cve-frontend` | npm audit at `critical` level on `frontend/` | A critical-severity npm advisory shipping | `ci.yml:cve-frontend` (org `called-cve-frontend.yml`) | 2026-03-22, fa4d6417 | Tier 1 | about 40s |
| `gradle-wrapper-check` | Validates `gradle-wrapper.jar` against known-good checksums; emits notices/warnings when Gradle files change | A tampered Gradle wrapper in the Android project | `ci.yml:gradle-wrapper-check` | 2026-04-02, ee52c4c6 | Tier 1, PRs only | 21s |
| `provenance-coverage` | Org-defined check; the repo does not show what it inspects (origin issue #509) | Origin unclear; confirm in the org workflow | `ci.yml:provenance-coverage` (org `called-provenance-coverage.yml`) | 2026-04-14, 55b531d9 (#509) | Tier 1 | 13s |
| `sentry-cli-check` | Verifies `SENTRY_AUTH_TOKEN` authenticates with Sentry | Release builds silently losing source-map upload. If the secret is unset it only warns | `ci.yml:sentry-cli-check` | 2026-04-11, 6c21e25c (#435) | Tier 1, PRs only | 40s |
| CodeQL | Static analysis for JS/TS, Python and Actions | Injection and similar vulnerability classes | Not in repo (default setup) | origin unclear | See [External apps](#external-apps-not-in-workflow-files) | not measured |

## Policy, brand and compliance

| Check | Purpose | Prevents | Workflow:job | Introduced | Gating | Time |
| --- | --- | --- | --- | --- | --- | --- |
| `Forbidden brand/trademark terms` | grep for the third-party and competitor names listed in the job's `TERMS` array (see `docs/BRANDING.md`) in source and docs (excludes `.github`, `.claude`, `alembic`, `BRANDING.md`, `CLAUDE.md`) | A trademarked or competitor name reaching the store listing or code | `ci.yml:forbidden-terms` | 2026-06-06, #1981 | Tier 0, always | 10s |
| `openai-policy-check` | OpenAI API usage policy (`.claude/policies/openai.md`: hardcoded keys and similar) | A PR that adds a hardcoded OpenAI key or violates the usage policy | `openai-policy.yml:openai-policy-check` (org `called-openai-policy.yml`) | 2026-04-11, 14f2a4c5 template sync; original origin unclear | Always (also runs on PR edits) | not measured |
| `gemini-policy-check` | Gemini API policy (`.claude/policies/gemini.md`) | A Gemini integration landing without following the policy. Nothing in the app calls Gemini today, so it passes trivially; it is kept on purpose (comment in the file, #2973 review) | `gemini-policy.yml:gemini-policy-check` | 2026-04-11, 346cfd00 template sync; original origin unclear | Always | not measured |
| `feedback-token-lint` | Org-defined lint; the repo does not show what it inspects (wired in under #507) | Origin unclear; confirm in the org workflow | `ci.yml:feedback-token-lint` (org `called-feedback-token-lint.yml`) | 2026-04-14, 1c258bfe (#507) | Tier 1 | 8s |
| `local-path-check` | Scans `frontend/ios/GamingApp.xcodeproj` and `frontend/android` (`*.pbxproj`, `*.xcconfig`, `*.gradle`, `*.properties`) for absolute local paths | A developer's `/Users/...` path committed into the Xcode or Gradle project, which breaks Xcode Cloud and CI | `ci.yml:local-path-check` | 2026-03-31, 2e98ac00 | Tier 1 | 9s |
| `sentry-check` | Org-defined backend Sentry check, run with the Sentry DSN secret | Backend Sentry misconfiguration. Exact assertions not visible from this repo | `ci.yml:sentry-check` | 2026-03-31, 2e98ac00 | Tier 1 | 35s |
| `backend-health` | Probes the live dev API on Render (`/health`, and `/games/me` expecting HTTP 400) | A backend that does not boot or has lost its auth route. It depends on an external service being up | `ci.yml:backend-health` (org `called-backend-health.yml`) | 2026-03-31, 2e98ac00 | Tier 1 | 4s |

## Mobile builds

iOS and Android release builds are made by Xcode Cloud and Gradle, not by these jobs; these are pre-merge guards that the native projects still build (see [IOS.md](IOS.md), [ANDROID-CI.md](ANDROID-CI.md)).

| Check | Purpose | Prevents | Workflow:job | Introduced | Gating | Time |
| --- | --- | --- | --- | --- | --- | --- |
| `Detect native package changes` | Diffs `frontend/package.json` against the base; flags bumped packages that ship a podspec, Android native code or JSI bindings | Native-package bumps going unbuilt | `ci.yml:detect-native-changes` | 2026-06-19, #2141 | Tier 1. Step is `continue-on-error`; on failure it defaults to "no native changes", so the build gates then run only on `main` PRs | 31s |
| `ios-build-check` | iOS build of `GamingApp.xcworkspace` (scheme `GamingApp`) | A change that breaks the iOS build | `ci.yml:ios-build-check` (org `called-ios-build-check.yml`) | 2026-03-31, 2e98ac00 | **Conditional**: PRs into `main`, pushes to `main`, or `has_native_ios == true`. Needs `test-python`, `test-frontend`, `detect-native-changes`. Skipped otherwise | not measured (skipped on the sampled run) |
| `android-build-check` | Android Gradle build | A change that breaks the Android build | `ci.yml:android-build-check` (org `called-android-build-check.yml`) | 2026-04-02, ee52c4c6 | **Conditional**: same rule using `has_native_android`. Skipped otherwise | not measured (skipped on the sampled run) |
| `Podfile.lock freshness` | Fails if a native iOS package was bumped but `frontend/ios/Podfile.lock` was not updated | An iOS build that resolves different pods from the committed lockfile | `ci.yml:podfile-lock-check` | 2026-06-19, #2141 | **Conditional**: only when `has_native_ios == true` | skipped on sampled run |
| `android-release-smoke` | `assembleRelease` (arm64-v8a, debug-signed) | A release-only Android failure (R8, signing config, Hermes) that debug builds hide | `ci.yml:android-release-smoke` | 2026-04-11, 6c21e25c (#435) | PRs only; needs `test-python`, `test-frontend`. The job always starts, but its build steps run only if `frontend/android/`, `package.json` or `package-lock.json` changed | 20s when it no-ops; timeout 30 min when it builds |
| `android-bundle-check` | `expo export:embed` for Android; fails if the bundle is missing, under 1 KB or over 8 MB; posts the "Bundle size report" PR comment | The Android JS bundle growing past the budget, or failing to build | `ci.yml:android-bundle-check` | 2026-04-02, ee52c4c6 | Tier 1. `bundlesize` step is non-blocking; the hard limit is the 8 MB check | 53s |

The Maestro iOS and Android smoke workflows (`mobile-smoke-ios.yml`, `mobile-smoke-android.yml`) are `workflow_dispatch` only (until #2400 is fixed) and do not appear on PRs.

## Docs and repo hygiene

| Check | Purpose | Prevents | Workflow:job | Introduced | Gating | Time |
| --- | --- | --- | --- | --- | --- | --- |
| `Markdown links (lychee)` | Offline check of relative links and `#anchors` in `docs/**` and root `*.md` (`lychee.toml`) | Dead documentation links and renamed headings | `ci.yml:docs-links` | 2026-10-09, #3100 (#3000) | Tier 1 | 16s |
| `Conflict marker check` | grep for `<<<<<<<`, `=======`, `>>>>>>>` in source and config files | A merge conflict committed by accident | `ci.yml:conflict-markers` | 2026-05-29, #1857 | Tier 0, always | 9s |
| `Large tracked file guard` | `scripts/check_large_files.py`: no tracked file over 5 MiB outside the allow-list | Another `backend/dev.db`-style binary bloating the repo | `ci.yml:large-file-guard` | 2026-10-07, #3044 | Tier 1 | 8s |

## Gating and orchestration

| Check | Purpose | Prevents | Workflow:job | Introduced | Gating | Time |
| --- | --- | --- | --- | --- | --- | --- |
| `gate-main-source` (inner job "Verify PR source is dev") | Org-defined; from its name and the project git workflow, a PR into `main` must come from `dev` | A feature branch merged straight into `main`, bypassing `dev` | `ci.yml:gate-main-source` (org `called-gate-main-source.yml`) | 2026-03-22, 0e30ba1a | Tier 0. Runs on all PRs; the exact condition lives in the org workflow | 4s |
| `Detect native package changes` | See [Mobile builds](#mobile-builds) | | `ci.yml:detect-native-changes` | 2026-06-19, #2141 | Feeds the three native checks | 31s |
| `Detect E2E scope` | See [Tests](#tests) | | `ci.yml:detect-e2e-scope` | 2026-04-05, 140b3968 | Feeds `Playwright E2E` | 9s |
| `Bundle size report` (PR comment) | Comment bot, a step inside `android-bundle-check`, not a separate check. Edits its last comment, otherwise posts a new one | Size regressions going unnoticed | `ci.yml:android-bundle-check` | 2026-04-02, ee52c4c6 | PRs only | n/a |
| `detect-maestro-scope.yml` | Reusable workflow used only by the manual Maestro smoke jobs | n/a on PRs | `detect-maestro-scope.yml:detect` | 2026-08-16, 1f8c8ca5 | Not run on PRs | n/a |

Concurrency: `ci.yml` cancels in-progress runs for the same ref except on `main` (`cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`). That is why a re-push shows an earlier cancelled run.

## External apps (not in workflow files)

None of these is defined under `.github/workflows/`, and this repo does not contain their configuration. Everything below is therefore "to confirm in GitHub settings".

| Check | What it likely is | Evidence in repo | Notes |
| --- | --- | --- | --- |
| `CodeQL` and `CodeQL Analyze (javascript-typescript / python / actions)` | GitHub code scanning, default setup | No CodeQL workflow or config file in the repo | The four-check pattern matches default setup. Origin unclear |
| `Supabase Preview` | Supabase GitHub integration | No `supabase/` directory. `docs/ARCHITECTURE.md` says Supabase is used as plain Postgres with no Supabase CLI migrations and no branching | Does not match the documented setup; confirm whether the integration should still be installed |
| Codex | Codex GitHub app (named in the request that prompted this doc) | No config in the repo | Not a workflow check; behavior and origin unclear from the repo |

## Workflows that do not run on PRs

For completeness, these exist in `.github/workflows/` but do not produce PR checks: `release-please.yml` and `sync-main-to-dev.yml` (push), `version-sync.yml` (release), `perf.yml`, `zap-scan.yml` and `post-deploy-scan.yml` (scheduled or after deploy), `mobile-smoke-ios.yml` and `mobile-smoke-android.yml` (manual). `ci.yml` also runs on pushes to `dev` and `main` after a merge.

## Branch protection

Live branch-protection and ruleset settings need admin access and cannot be read from the repo. Every statement in the "Enforced" columns below is therefore either read from a workflow file, taken from a doc, or marked **to confirm in GitHub settings**.

What the repo does tell us:

- `docs/TESTING.md` states that required check names exist and that a job's `name:` (or job id when it has no `name:`) must not be renamed without updating branch protection. The list itself is not in the repo.
- `CLAUDE.md` says: never push directly to `main` or `dev`; branch from `dev`; PRs go `feat/<name>` to `dev` to `main` (releases only).
- `CONTRIBUTING.md` says PR titles become the squash-merge commit message.
- There is no `CODEOWNERS` file.

### PRs into `dev`

| Item | Status |
| --- | --- |
| Always-on checks | Everything marked "always", "Tier 0" or "Tier 1" above, plus `commitlint`, `design-token-check`, `openai-policy-check`, `gemini-policy-check`, `schema-check`, `gradle-wrapper-check`, `sentry-cli-check` and `android-release-smoke` (the last three PRs only) |
| Conditional | `ios-build-check`, `android-build-check` and `Podfile.lock freshness` only when native packages changed; `Playwright E2E` runs only the selected projects; Yacht and Hearts sim gates only on AI/engine paths |
| `gate-main-source` | Runs but is not expected to restrict `dev` PRs; exact condition to confirm in the org workflow |
| No direct pushes | Policy in `CLAUDE.md`; enforcement to confirm in GitHub settings |
| Required reviews | To confirm in GitHub settings |
| Squash-only merges | Squash-merge titles implied by `CONTRIBUTING.md`; whether other merge methods are disabled: to confirm in GitHub settings |
| Which checks are currently required | To confirm in GitHub settings |

### PRs into `main` (release PRs from `dev`)

| Item | Status |
| --- | --- |
| Always-on checks | The same as `dev` |
| Additionally run | `ios-build-check` and `android-build-check` always (condition `github.base_ref == 'main'`); `Playwright E2E` always runs the full suite; `Podfile.lock freshness` still only when native iOS packages changed |
| `gate-main-source` | Intended to fail PRs into `main` whose source branch is not `dev` (inferred from the job name "Verify PR source is dev" and `CLAUDE.md`); exact logic to confirm in the org workflow |
| No direct pushes, required reviews, squash or merge-commit policy (releases from `dev` may need a merge commit; not stated in the repo) | To confirm in GitHub settings |
| Which checks are currently required | To confirm in GitHub settings |

### Recommended required checks

These are recommendations, not a record of current settings. Two rules of thumb: a conditional job that is skipped counts as passing for required-check purposes, so conditional build checks can safely be required; and a required check must exist on every PR, so required names should come from jobs that always start. Use the exact check names as shown in the PR (for reusable workflows, `<job> / <inner job>`).

**`dev`** (fast, deterministic, always-on):

- `gate-main-source`, `secret-scan`, `lint-python`, `lint-frontend`, `conflict-markers`, `forbidden-terms`, `commitlint`
- `typecheck-frontend`, `test-python`, `test-frontend`, `Playwright E2E`, `schema-check`
- `cve-python`, `cve-frontend`
- `design-token-check`, `openai-policy-check`, `gemini-policy-check`
- `Colour literals` and `Markdown links (lychee)` (the subject of #3102)
- `i18n completeness check`, `Backend file length`, `Large tracked file guard`, `local-path-check`, `android-bundle-check`
- `ios-build-check`, `android-build-check`, `Podfile.lock freshness`, `android-release-smoke` (safe to require because they skip when not applicable)

Leave advisory for now: `Unused code (knip)` (does not fail today), `sentry-cli-check` (warns only), `backend-health` (depends on the live dev Render service), `Duplication (jscpd)` (a threshold that can trip on unrelated PRs), `Test tools (pytest)` and `lint-python-tools` (only meaningful when `tools/` changes), and the sim gates (path-conditional; if required they must be required on the conditional path only).

**`main`**: everything above, plus the checks that are skipped on `dev`: `ios-build-check` and `android-build-check` become real builds on every release PR, and `Playwright E2E` is the full suite. `gate-main-source` is the check that matters most on `main`.

Everything about reviews, push restrictions and merge method: to confirm in GitHub settings.

## Observations (suggestions only)

These are not decisions.

- **`lint-python` and `lint-python-tools`** call the same reusable workflow with different directories and the same ruff pin. They could become one job with a matrix on `working-directory`, or `tools/` could be linted inside `lint-python`. The cost of leaving them is one extra check name.
- **Three "cheap grep" jobs** (`Conflict marker check`, `Forbidden brand/trademark terms`, `Large tracked file guard`) each spin up a runner for under 10 seconds. They could be one "repo hygiene" job. A merged job would make failures a little less self-explanatory, and would change required check names (see `docs/TESTING.md`).
- **Seven frontend jobs each repeat the `setup-frontend` install** (`typecheck-frontend`, `expo-compat`, `i18n completeness check`, `Colour literals`, `knip`, `android-bundle-check`, `Playwright E2E`). The npm cache makes this cheap, but the typecheck, i18n and colour-literal checks could share one "frontend static checks" job.
- **Policy workflows**: `design-token-check`, `Colour literals` and `lint-frontend` overlap in intent (hard-coded styling). The org design-token check is policy-based; the colour-literal checker is repo-specific and stricter about per-game palettes. Worth checking whether the org check still catches anything the local one does not.
- **`Gemini policy`** passes trivially today but is intentionally kept (see the file comment). Do not treat it as a consolidation candidate without a policy decision.
- **`gradle-wrapper-check`** mostly emits notices; only wrapper validation can fail. **`sentry-cli-check`** and **`Unused code (knip)`** are effectively non-blocking. Either make them real gates or document them as informational.
- **`docs/TESTING.md` says `Unused code (knip)` gates PRs**, but the step is `continue-on-error: true`. One of the two should change.
- **`backend-health`** probes a live external service and can fail for reasons unrelated to the PR.
- **Expensive checks**: `Playwright E2E` (about 13 minutes, full suite on every `main` PR and any shared-path change), `test-python` (about 6 minutes), `test-frontend` (about 4 minutes), and the native build checks. A full suite is wall-clock bound by test-python or test-frontend followed by E2E, about 20 to 25 minutes end to end on recent runs. Everything else is under a minute.
- **Cancelled runs**: the `ci.yml` concurrency group cancels superseded runs on PR branches, which is why the checks list can show earlier cancelled attempts.
- **`Supabase Preview`** does not match `docs/ARCHITECTURE.md`, which says there is no Supabase branching. If the integration is unused it is a cheap check to remove.
- **Reusable workflows are in another repo.** Several checks (`provenance-coverage`, `feedback-token-lint`, `sentry-check`, `gate-main-source`) cannot be explained from this repo alone. A short description in each `called-*.yml` header, or a link from here, would close that gap.
