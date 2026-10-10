# Testing Guide

See [~/.claude/standards/testing.md](~/.claude/standards/testing.md) for universal conventions (coverage thresholds, what not to test, accessible query priority).

## Test layers and which gate PRs

Source of truth: `.github/workflows/`. "Gates" means a failing run blocks the PR. Details: "Test layers and which gate PRs (#2975)" and "Quality gates" below.

| Layer                    | Where                                                                                         | Gates PRs?                                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pytest (backend)         | `backend/tests`, job `test-python`                                                            | Yes. `--cov-fail-under=96`                                                                                                                               |
| jest (frontend)          | `frontend/src/**/__tests__`, job `test-frontend`                                              | Yes. Coverage floors in `package.json`                                                                                                                   |
| Playwright (web)         | `e2e/tests`, job `e2e`                                                                        | Yes. Selective by changed paths; push and `main` PRs run the full suite                                                                                  |
| Maestro (iOS/Android)    | `e2e/maestro`, `mobile-smoke-{android,ios}.yml`                                               | No. `workflow_dispatch` only (not on PRs or push) until #2400 is fixed                                                                                   |
| Colour-literal check     | `frontend/scripts/check-color-literals.mjs`, job `frontend-static` (`Frontend static checks`) | Yes. No colour literals outside the theme and the per-game palettes (#2989); the checker has its own `node --test` run                                   |
| Markdown link check      | `lychee.toml`, job `docs-links`                                                               | Yes. Dead relative links and `#anchors` in `docs/**` and root `*.md` (offline; run `lychee --config lychee.toml "docs/**/*.md" "docs/**/*.html" "*.md"`) |
| Tools pytest             | `tools/`, job `test-tools`                                                                    | Yes (asset tools only)                                                                                                                                   |
| Yacht / Hearts sim gates | `yacht-sim-gate.yml`, `hearts-sim-gate.yml`                                                   | Only PRs touching the AI, engine or gate paths; the nightly full runs do not gate PRs. Hearts: zero principle violations (#3161)                         |

## Quality gates and ratchet schedule

Cheap ratchets added for the refactor epic (#2950, issue #2951). They are set at today's numbers so the epic's gains cannot silently regress. Run the same commands locally before opening a PR.

| Gate                       | Where                                                                                                      | Threshold (today)                                                                                                                                                                                                                                                                                                                                                                                                  | Blocking?                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| ruff complexity / bugbear  | `backend/pyproject.toml` (`extend-select`, `[tool.ruff.lint.mccabe]`)                                      | `B`, `C901`, `RUF`, `PLR0912`, `PLR0915`, `SIM`, `UP`; `max-complexity = 12`. Offenders carry `# noqa: C901  # see #2951`                                                                                                                                                                                                                                                                                          | Yes (`lint-python`)        |
| Backend coverage floor     | `backend/pyproject.toml` (`addopts` `--cov-fail-under`, `[tool.coverage.run] omit`)                        | `--cov-fail-under=96` over the whole backend (measured 97.6 % on both Python 3.11 and 3.13; see "Backend coverage (#2958)" below). Only `tests/`, `scripts/` and `perf/` are omitted                                                                                                                                                                                                                               | Yes (`test-python`)        |
| Backend file length        | `backend/scripts/check_file_length.py`, CI job `backend-file-length`                                       | 800 lines per `.py` (excl. `tests/`, `alembic/`, `.venv/`). Per-file `CAPS` (a file's count when capped, so it cannot grow) for any file over 800: none today (`purchases/google_notifications.py` was split in #2998)                                                                                                                                                                                             | Yes                        |
| eslint `max-lines`         | `frontend/eslint.config.js`                                                                                | 800 lines (skip blanks/comments) for `src/**` excl. `__tests__`. The 6 files already over 800 effective lines are `warn` in a `files:` override                                                                                                                                                                                                                                                                    | Error for new offenders    |
| eslint function size       | `frontend/eslint.config.js`                                                                                | `max-lines-per-function` 150, `complexity` 20                                                                                                                                                                                                                                                                                                                                                                      | Warn                       |
| eslint react-hooks v7      | `frontend/eslint.config.js`                                                                                | `refs`, `immutability`, `set-state-in-effect`, `purity`, `globals` at `warn`                                                                                                                                                                                                                                                                                                                                       | Warn                       |
| eslint `import-x/no-cycle` | `frontend/eslint.config.js`                                                                                | `ignoreExternal: true`, no depth cap, over `src/**` and `App.tsx` (#3108). Type-only imports are erased at compile time, so the rule ignores them: it flags runtime cycles, which break module load order on React Native. Zero cycles when the rule landed                                                                                                                                                        | Error                      |
| Duplication (jscpd)        | CI job `duplication`                                                                                       | `--threshold 2.5 --min-lines 20 --min-tokens 70` over `frontend/src frontend/tooling backend`                                                                                                                                                                                                                                                                                                                      | Yes                        |
| Unused code (knip)         | `frontend/knip.json`, CI job `frontend-static`                                                             | `npx knip --no-progress` (default mode, so exports used only by tests count as used) and `npx knip --production --no-progress` (production files only, #3126; test-only usage no longer counts); both at zero findings, with every `knip.json` allowlist entry commented; repo-root `tools/sim/*.ts` and `tools/generators/*.ts` are entries, and tooling exports only they use carry `@public` (see "Simulators") | Yes (blocking since #3111) |
| Jest coverage floors       | `frontend/package.json` (`jest.coverageThreshold.global`, `collectCoverageFrom`), run by `npm run test:ci` | Global floors: lines 90, statements 90, branches 85, functions 88 (measured 2026-10-05: lines 96.0, statements 94.3, branches 88.3, functions 91.9; see "Coverage policy") plus per-file 80 % lines for the solitaire/freecell/hearts engines                                                                                                                                                                      | Yes (`test-frontend`)      |

```bash
# backend
cd backend && ruff check . && black --check . && python scripts/check_file_length.py
# frontend
cd frontend && npx eslint . && npx knip --no-progress && npx knip --production --no-progress
# duplication (repo root)
npx --yes jscpd@4.3.0 --threshold 2.5 --min-lines 20 --min-tokens 70 \
  --ignore "**/__tests__/**,**/node_modules/**,**/.venv/**,**/*.generated.*,**/locales/**,**/tests/**,**/alembic/**" \
  --format "typescript,tsx,python" frontend/src frontend/tooling backend
```

**Ratchet schedule.** Once a quarter, lower the thresholds to the current measured numbers and never raise them:

- ruff `max-complexity` 12, then 10. `ARG` and `PLR0913` are enabled (#3108): `PLR0913` `max-args` is 7, `tests/**` and `scripts/**` are exempt via `per-file-ignores`, and production code uses a targeted `# noqa` with a reason where a signature is fixed by a framework (slowapi `request`, Protocol methods, pydantic hooks).
- eslint `max-lines` 800, then 600; `max-lines-per-function` 150, then 100; `complexity` 20, then 15. Remove a file from the `max-lines` warn override in the same PR that splits it.
- Promote the `react-hooks` v7 rules and the function-size rules from `warn` to `error` once their counts reach zero.
- jscpd `--threshold` 2.5, then 2.0, then 1.5 (measured at 0.35% when the gate landed with backend `tests/` and `alembic/` excluded, so there is headroom).
- `knip` is blocking in default mode and in `--production` mode (#3126). In production mode only the `!`-suffixed entries and project globs in `frontend/knip.json` count (`App.tsx`, `src/**/*.web.*`, `src/**`; `index.ts` comes from `package.json` `main`). Tests, `tooling/`, `scripts/`, `src/test-utils/` and the test double `src/purchases/fakeAdapter.ts` are not production. An export kept only so a test or offline tool can reach it carries an `@internal` JSDoc tag, which `"tags": ["-internal"]` excludes from the report; prefer deleting dead code with its tests, or un-exporting it, over adding a tag. Do not tag an export to hide code a production file should use.
- Backend file-length `CAPS`: lower or delete each entry as its split lands; an entry fails with "remove <path> from CAPS" once the file is at or under 800.
- Backend `--cov-fail-under`: 96 now (one point under the measured 97.6 %, rounded down). Raise it as coverage lands, in the same PR that adds the tests; never lower it to make a PR pass. Every non-migration module is at 100 % lines except `main.py`, `games/stats_columns.py` and `games/legacy_outcomes.py` (a handful of lines each; `games/boards/` is at 100 % since #2992); the modules below 90 % are `alembic/versions/*` (migration scripts whose `downgrade()` bodies the suite does not run).
- ruff is pinned to 0.16.8 in both `backend/requirements-dev.txt` and the `lint-python` job in `ci.yml`; bump them together.
- jest `coverageThreshold.global`: ratcheted after the Phase 0 coverage stories (#3010, #3014, #3017) landed. Floors are now lines 90, statements 90, branches 85, functions 88 (previously 82 / 81 / 78 / 75), each set to the measured value minus 3, rounded down, capped at 90. Measured on `dev` on 2026-10-05: lines 96.0 %, statements 94.3 %, branches 88.3 %, functions 91.9 %. The next ratchet step is 90 on every metric, once the remaining under-90 files are covered (see "Coverage policy" below).

### Coverage policy (frontend jest, #2952)

**What is collected.** `frontend/package.json` sets `collectCoverageFrom` so every source file counts, whether or not a test imports it: `src/**/*.{ts,tsx,js,jsx}` and `App.tsx` (the shipped `src/i18n/locales.js` is JavaScript), including the `.web.tsx` / `.web.ts` files that ship on Expo Web. Before #2952 jest only measured files that some test happened to import, so never-imported files (the Star Swarm canvases, `App.tsx`, the card faces, the Mahjong layout screens, parts of `components/cascade/*`) were invisible to the gate.

**Permanent exclusions** (package.json cannot hold comments, so they are documented here): `src/**/__tests__/**`, `src/**/__mocks__/**`, `*.d.ts`, `**/*.generated.ts`, `src/screens/__dev__/**` (dev-only screens), `src/i18n/glossary.js` (build-time input for `scripts/translate.js`, not shipped) and `src/i18n/localeLoaders.ts` (#2957: 247 of its lines are `() => import("./locales/<lng>/<ns>.json")` loaders, which jest cannot run without `--experimental-vm-modules`; `i18n/__tests__/localeLoaders.test.ts` instead checks that every locale file on disk has a loader whose source names its own path, and covers `loadLocaleNamespace` itself).

The CI/script-only simulators live outside `src/` in `frontend/tooling/` (#2969), so they are not collected at all; see "Simulators" below.

### Simulators (`frontend/tooling/`, #2969)

The Hearts, Yacht and Star Swarm balance simulators and the Yacht oracle table builder are not part of the app. They live in `frontend/tooling/<game>/` and only the repo-root scripts (`scripts/simulate-*.ts`, `tools/generators/build-yacht-oracle.ts`), their own tests and the sim-gate workflows use them:

| Path                                  | What                                                                           | CLI                                      |
| ------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------- |
| `frontend/tooling/hearts/`            | Principle checker, duplicate-deal harness, legacy SPRT gate, regret reference  | `tools/sim/simulate-hearts.ts`           |
| `frontend/tooling/yacht/`             | Paired-dice harness, stats, calibration bands                                  | `tools/sim/simulate-yacht.ts`            |
| `frontend/tooling/yacht/oracleBuild/` | Offline retrograde solver for `src/game/yacht/oracle/oracleTable.generated.ts` | `tools/generators/build-yacht-oracle.ts` |
| `frontend/tooling/starswarm/`         | Buddy balance harness, engine variants, presets, asteroid-awareness sim        | `tools/sim/simulate-starswarm.ts`        |

- **Run a simulator** from the repo root: `npx --prefix frontend tsx tools/sim/simulate-hearts.ts --check-principles --hands 2000` (each script's header lists its flags).
- **Tests** sit in `frontend/tooling/<game>/__tests__/` and run under the jest project `tooling` (the app's tests are the `app` project). Plain `npx jest` runs both; `npx jest --selectProjects tooling` runs only the simulators'. Their smoke runs (`ai.simulate.test.ts`, `ai.calibrate.test.ts`, the `fast` Star Swarm preset) still run in every PR with the rest of Jest.
- **Type-check:** `npm run typecheck` checks the app (`tsconfig.typecheck.json`, which excludes `tooling/`) and then `tsconfig.tooling.json` (`tooling/**` plus `tools/sim/*.ts` and `tools/generators/*.ts`, with Node and Jest types).
- **Boundary:** app code must not import `tooling/` (an eslint `no-restricted-imports` rule fails the lint), so nothing in it can reach the Metro bundle. Tooling imports app modules (engines, AI) by relative path into `src/`.
- **knip:** `frontend/knip.json` lists `../tools/sim/*.ts` and `../tools/generators/*.ts` as entries so the tooling files they import count as used. knip cannot credit exports used from outside its workspace, so the few tooling exports only a root script uses carry a `@public` JSDoc tag; delete the tag with the export when the script stops using it.

**Measured** (2026-10-05 on `dev` after the Phase 0 coverage stories #3010, #3014 and #3017, 324 suites / 6,063 tests, `jest --coverage`, all collected files):

| Metric     | Measured | Floor enforced now | Stretch target |
| ---------- | -------: | -----------------: | -------------: |
| Lines      |  95.97 % |               90 % |           90 % |
| Statements |  94.29 % |               90 % |           90 % |
| Branches   |  88.34 % |               85 % |           90 % |
| Functions  |  91.92 % |               88 % |           90 % |

Original baseline, for history (2026-10-04, before the coverage stories): lines 83.9 %, statements 82.9 %, branches 79.8 %, functions 76.8 % (floors then 82 / 81 / 78 / 75).

**Floors.** `coverageThreshold.global` sits 3 points under the measured value (rounded down), capped at 90. The margin absorbs run-to-run drift: seven non-test modules use unseeded `Math.random`, and identical runs have been seen to move a screen's function coverage by about three points (BlackjackTableScreen, 48 % to 51 %). Floors therefore only catch real regressions and never fail on unchanged code. Raise them in the same PR that adds the coverage; never lower them to make a PR pass. The next ratchet step is 90 on every metric, once the remaining under-90 files are covered. The per-file thresholds for the `solitaire`, `freecell` and `hearts` engines (80 % lines) stay as they are.

**How CI applies it.** The org reusable workflow `called-test-frontend.yml` runs `npm run test:ci` when the package defines it, and otherwise falls back to `npx jest --coverage --coverageThreshold='{"global":{"lines":80}}'`. A `--coverageThreshold` on the command line replaces the whole `coverageThreshold` object from `package.json` (including the per-file engine entries and the statements/branches/functions floors). `frontend/package.json` therefore defines `"test:ci": "jest --coverage"` so CI uses the thresholds in `package.json`. Run `npm run test:ci` locally to get the same result.

**Reading the report.** `jest --coverage` writes `frontend/coverage/` (`lcov-report/index.html` for browsing, `coverage-summary.json` for totals; the `coverageReporters` list in package.json guarantees both exist). Files with 0 % are now listed in the text table instead of being absent; sort by uncovered lines to pick the next target. Quick totals only: `npx jest --coverage --coverageReporters=text-summary --silent`.

## Test layers and which gate PRs (#2975)

The at-a-glance table is at the top of this guide. Web (Expo Web) is a supported secondary platform used for testing and the free games; it is not a revenue platform. iOS and Android are primary. Platform-specific bugs should name the platform.

E2E hooks (`window.__*`, `EXPO_PUBLIC_TEST_HOOKS=1` builds only) are installed through `registerTestHooks(namespace, hooks)` in `frontend/src/game/_shared/testHooksRegistry.ts`; per-game hooks live in `game/<game>/testHooks.ts`. Import `areTestHooksEnabled` from `game/_shared/envFlags`, never from the heavy `_shared/testHooks` module. `releaseBuildConfig.test.ts` asserts no release input enables the flag.

## CI workflow structure (#2973)

Shared pieces so a workflow change is made once:

- **`.github/actions/setup-frontend`** (composite): Node 22 + npm cache + `npm ci` in `frontend/`. Input `metro-cache: "true"` also restores the Metro transform cache (used by the Android bundle/release/Maestro jobs). Every workflow that needs the frontend toolchain calls it right after `actions/checkout`; put `if:` on the calling step to make it conditional.
- **`.github/actions/maestro-install`** (composite): installs the pinned Maestro CLI. **`e2e/maestro/summarize.py <platform> <label>`** writes the per-flow job summary for both `mobile-smoke-android.yml` and `mobile-smoke-ios.yml`.
- **`.github/paths/game-paths.yml`**: the one path-to-game table. `detect-e2e-scope` (Playwright, in `ci.yml`) and `detect-maestro-scope.yml` both pass it to `dorny/paths-filter` as `filters:`. Per-game keys are shared; `shared` is common to both, `playwright_shared` / `maestro_shared` are suite-specific "run everything" triggers, and `logstore` is Playwright-only. Adding a game means adding a key there and one line in each scope step.
- **`tsx`** is a pinned `frontend` devDependency. From the repo root run scripts as `npx --prefix frontend tsx scripts/<name>.ts` (CI and every doc use this form); the working directory stays the repo root.
- `openai-policy` runs only from `openai-policy.yml` (it used to run a second time inside `ci.yml`). `gemini-policy.yml` is kept on purpose; see the comment in the file.

Required check names are unchanged by this restructuring; do not rename a job's `name:` (or a job id that has no `name:`) without updating branch protection.

## Test layout rules (#2955)

These keep the suite split-safe: when a large source file is split into modules, its tests move one-to-one instead of being rewritten, and a moved test can never silently stop testing the shipped code.

- **One test file per module.** Name it after the module it tests (`engine.ts` → `engine.test.ts`; a module of a package behind a barrel → `<file>.<module>.test.ts`, e.g. `starswarm/__tests__/engine.carrier.test.ts` for `starswarm/engine/carrier.ts` (#2988) — the tests keep importing from the barrel, so a move inside the package never touches them). When a test file passes ~1,000 lines, split it along the source's own seams (planned modules or exported-function clusters) by moving whole `describe` blocks: the test count and every test's full name stay the same. Helpers used by more than one of the new files go in `__tests__/helpers/<name>Fixtures.ts` (not a test file: `testMatch` only picks up `*.test.ts(x)`); single-file helpers stay local.
- **No local re-implementations of shipped code.** A test imports the function it checks. If the logic is inline in a component, extract it into a pure module first (as `game/starswarm/drag.ts` was extracted from `Controls.tsx`) and test that; a copy in the test cannot fail when the shipped code regresses.
- **Prefer targeted assertions to large snapshots.** Assert the roles, texts and theme tokens that matter (`getByRole`, `getByText`, `toHaveStyle({ color: colors.accent })`, `accessibilityState`) so a token change fails one line with a readable diff instead of regenerating a few thousand lines nobody reviews. A snapshot is fine for one small element or a pure value (`toMatchInlineSnapshot`); keep `.snap` files under a few hundred lines.
- **Golden replay for seeded engines.** An engine with a seeded RNG gets a golden replay test before it is refactored: seed it, drive the public API with scripted input for N ticks, and compare a hash of the canonical state (keys sorted, non-integer numbers rounded to 6 decimals so Node/V8 float differences cannot move it) at checkpoints, plus exact integer gameplay fields, with a committed fixture (`starswarm/__tests__/goldenReplay.test.ts` and `__fixtures__/golden-replay-seed42.json`; re-record with `UPDATE_GOLDEN=1`). A pure-move refactor must leave the fixture byte-identical; a re-record is a behaviour change and the PR says why (the one sanctioned Star Swarm re-record is the `rng()` range fix of #2985).
- **Backend: same rules.** One `test_<module>.py` per module (`test_google_play.py`, `test_google_push_auth.py`, `test_google_rtdn.py`, `test_google_jobs.py`, `test_apple_store.py`, `test_apple_notifications.py` follow the `purchases/` seams of #2998). Shared plain helpers and fixtures for one area live in an underscore harness module (`tests/_google_iap_harness.py`, `tests/_apple_iap_harness.py`): import plain helpers from it, and pull its fixtures in with `pytest_plugins = ["tests._<area>_harness"]` (importing a fixture would trip ruff F811). Plugin fixtures are visible to every backend test module, so give them an area prefix (`google_gp`, `apple_verifier`). Register a new harness for assertion rewriting in `tests/conftest.py` (`pytest.register_assert_rewrite`). Store fakes stay in `google_play_fakes.py` / `apple_jws.py`.

## Project-specific test cases

## Backend

### Setup

```bash
cd backend && python -m pip install -r requirements.txt
```

### Running

```bash
# All tests
python -m pytest tests/ -v

# By file
python -m pytest tests/test_yacht_api.py -v            # Yacht API endpoints
python -m pytest tests/test_generic_leaderboard.py -v  # Leaderboard API (every game)

# With coverage
python -m pytest tests/ -v --cov=. --cov-report=term-missing
```

**Random test order (#2953, #3107).** `pytest-randomly` (in `requirements-dev.txt`) shuffles test order and reseeds `random` on every run, so a test that only passes after another one fails here. The run header prints the seed (`Using --randomly-seed=1234`). To reproduce an order-dependent failure, rerun with the same seed: `python -m pytest tests/ -p randomly --randomly-seed=1234`. To turn shuffling off (a bisect, or comparing against a fixed order), pass `-p no:randomly`. Fix the test rather than leaving it pinned to the escape hatch.

**Postgres-only tests (#3107).** `test-python` runs on SQLite, so the Postgres EXPLAIN gate and the JSON/dialect SQL execution tests skip there. The advisory `test-postgres` job runs them against a `postgres:16` (from the ECR Public mirror) service: `LEADERBOARD_EXPLAIN_PG_URL=postgresql://postgres:postgres@localhost:5432/postgres python -m pytest tests/test_leaderboard_query_plans.py tests/test_leaderboard_indexes_migration.py --no-cov`, and, with `DATABASE_URL` pointing at a migrated Postgres database (`alembic upgrade head`), `python -m pytest tests/test_jsonx.py --no-cov -o asyncio_default_fixture_loop_scope=session -o asyncio_default_test_loop_scope=session` (the asyncpg pool needs one event loop for the whole session).

**Backend coverage (#2958).** `pyproject.toml` sets `addopts = "--cov=. --cov-report=term-missing --cov-fail-under=96"`, so a plain `pytest` run enforces the gate. `[tool.coverage.run]` sets `concurrency = ["greenlet", "thread"]`: the async code runs under SQLAlchemy greenlets and TestClient portal threads, and without it coverage drops every line after the first `await` that switches greenlet (it used to read `me/router.py` at 74 % although its tests ran). With it the number does not depend on the interpreter (97.6 % on 3.11 and on 3.13, a few lines apart in `main.py`). It replaces `core = "sysmon"`, which only worked on Python 3.12+, so a 3.11 run silently under-reported; the cost is the C tracer on 3.13 (a full run is roughly 2x slower, 4 to 8 minutes). `sort/generate_levels.py` is measured (it has tests in `test_sort_generation.py`); the reference pour simulator now lives in `scripts/sort_verify_levels.py` (omitted with the rest of `scripts/`).

### Structure

`backend/tests/` has one `test_<module>.py` per backend module (about 100 files; list them with `ls backend/tests`), plus `conftest.py`, underscore helper modules (`_helpers.py`, `_migration_helpers.py`, `_pg_scratch.py`, the IAP harnesses) and fakes (`google_play_fakes.py`, `apple_jws.py`). Yacht scoring and rules are client-side (`frontend/src/game/yacht/engine.ts`, tested by jest); the backend only stores and ranks Yacht sessions. Representative files:

```
backend/tests/
├── test_yacht_api.py            # Yacht sessions on the generic board; scorecard round trip
├── test_yacht_models.py         # YachtMetadata rules, removed legacy models (no database)
├── test_yacht_result.py         # YachtResult and the final scorecard (no database)
├── test_generic_leaderboard.py  # GET /games/leaderboard/{game_type} via TestClient
└── ...                          # games, entitlements, purchases, migrations, stats, ...
```

### What's Tested

**test_yacht_api.py / test_yacht_models.py / test_yacht_result.py**

- `YachtMetadata` validation and the removed legacy `/yacht/*` routes (they answer 404)
- Yacht sessions rank on `GET /games/leaderboard/yacht` like every game: one entry per named player (their best), abandoned and unnamed rows never rank
- The scorecard saved by `PATCH /games/{id}/complete` and read back by `GET /games/{id}`, including reconciliation against the stored final score

**test_generic_leaderboard.py**

- `GET /games/leaderboard/{game_type}` — one entry per named player, ranked by
  each game's `BoardDefinition`; abandoned rows never rank. (The per-game
  leaderboard routes were removed in #2644; `test_legacy_leaderboard_routes_removed.py`
  checks that each answers 404.)

**test_leaderboard_query_plans.py** (#2965)

- EXPLAIN gate: every enabled board's `top_statement` must seek `games` through its
  index (SQLite: `SEARCH games USING INDEX ...`, never `SCAN games`). The Postgres
  half (fails on `Seq Scan` over `games`) runs only with `LEADERBOARD_EXPLAIN_PG_URL`
  set to a scratch server (it creates and drops its own database there; the suite's
  `DATABASE_URL` is never used); it skips otherwise, and `test-python` has no Postgres (the advisory `test-postgres` job sets it). See [LEADERBOARDS.md §7a](LEADERBOARDS.md#7a-indexes-2965).

### Notes

- API tests use FastAPI's `TestClient` (no running server needed).
- Shared fixtures live in `tests/conftest.py`; plain helpers live in `tests/_helpers.py` (`session_headers`, `jwt_games`, `count`), `tests/_migration_helpers.py` (`run_alembic`, `run_alembic_url`, `AlembicError`) and `tests/_pg_scratch.py` (`scratch_database`, `require_pg_url`: a throwaway Postgres database for planner tests, only via `LEADERBOARD_EXPLAIN_PG_URL`). Fixtures resolve by name, so a test file defines its own only when it needs a different shape (a local definition overrides the shared one). Never import from `conftest` itself (pytest does not support it); put shared plain functions in an underscore module instead:
  - `client`: the app under `TestClient` with its lifespan running.
  - `session_id`: a fresh UUID string.
  - `session_headers(sid)` (`from tests._helpers import session_headers`): a plain function, not a fixture, returning the JSON request headers.
  - `jwt_games(client, sid)` and `await count(Model, *where)` (`tests._helpers`): the games in the session's entitlement JWT, and a row count.
  - `migration_db_path`: a scratch SQLite path for a migration test.
  - `alembic`: a callable bound to `migration_db_path`; `alembic("upgrade", rev)` runs the CLI and raises `AlembicError` (with Alembic's output) on a non-zero exit.
- IAP tests share an underscore harness per store (`tests/_google_iap_harness.py`: `google_gp`, `google_install`, `grant`, `post_google`, `post_rtdn`, …; `tests/_apple_iap_harness.py`: `apple_verifier`, `apple_use_verifier`, `post_txn`, `post_note`, …), loaded through `pytest_plugins`; see "Test layout rules".

---

## Frontend

Localization architecture, locale/namespace contributor workflow, formatting
rules, and the purpose of the i18n guards are canonicalized in
[I18N.md](I18N.md). This testing guide should document how to run the checks,
not duplicate the product localization contract.

### Setup

```bash
cd frontend && npm install
```

### Running

```bash
npm test
npm run typecheck
```

### Type-checking (#2211)

`npm run typecheck` runs `tsc --noEmit -p tsconfig.typecheck.json` and must report zero errors.
CI runs it as the `TypeScript type-check` step of the `Frontend static checks` job (`frontend-static`, #3113) on every PR and fails on any error.

`tsconfig.typecheck.json` extends the main `tsconfig.json` but covers **production sources
only**: test files (`__tests__/`, `*.test.ts(x)`), jest setup files, `scripts/`, `e2e/` and
`eslint.config.js` are excluded. Editors keep using `tsconfig.json`, so tests still get
in-editor type hints; they just aren't gated in CI yet.

Don't suppress new errors with `@ts-ignore`/`@ts-expect-error` to get the job green. If one
genuinely needs a larger refactor, suppress that single line with a comment linking a tracking
issue.

### Writing a screen test (#2954)

`frontend/jest.setup.ts` mocks these for every test file, so a test doesn't mock them itself:
`expo-blur` and `expo-linear-gradient` (render only their children),
`react-native-safe-area-context` (zero insets), `react-native-gesture-handler`,
`react-native-screens`, `react-native-reanimated`, `expo-audio`, `@react-navigation/bottom-tabs`,
`@sentry/react-native`, `@react-native-async-storage/async-storage` (in-memory) and the pinned
`game/_shared/foregroundClock`. A test that needs a different shape still calls `jest.mock` for
that module; its own mock wins.

The modules most screens need mocked per test (`@react-navigation/native`, `api/stats`,
`game/_shared/gameEventClient`, `flushQueuedGames`, `displayNameSync`, `NetworkContext`) have
factories in `frontend/src/test-utils/mockScreenDeps.ts`. `jest.mock` is hoisted above the
imports, so `jest.setup.ts` exposes that module as the global `mockScreenDeps()` (a factory may
reference names starting with `mock`). Call it inside the test's own `jest.mock`, and pass a
`mock*` const the file declares later through `lazy()`:

```ts
const mockStartGame = jest.fn();
jest.mock("../../game/_shared/gameEventClient", () => {
  const { lazy, mockGameEventClient } = mockScreenDeps();
  return mockGameEventClient({ startGame: lazy(() => mockStartGame) });
});
jest.mock("../../game/_shared/flushQueuedGames", () =>
  mockScreenDeps().mockFlushQueuedGames(),
);
```

Each factory keeps the shape the screen tests had before #2954, and takes overrides or options
where tests differ; mock shapes decide what the screen sees, so change one only on purpose.
Module mocks particular to one screen (its engine, canvas, storage) stay in that test file.

### Adding a dev control (#2978)

In-screen developer panels live next to the game's components, one per game:
`components/starswarm/StarSwarmDevPanel.tsx`, `components/daily_word/DailyWordDevPanel.tsx`,
`components/yacht/YachtDevPanel.tsx`, `components/mahjong/MahjongDevPanel.tsx` (Hearts has its
own `HeartsDebugPanel`). Each is built on `components/dev/DevPanelShell.tsx`, which draws the
DEV button, the panel (`variant="modal"`, or `"sidebar"` over a live game) and its title, and
exports the controls: `DevSection` (a `── Title ──` header), `DevRow` (label + value),
`DevStepper` (`− value +`, or a `column` cell), `DevToggle` (labelled `Switch`) and
`DevActionButton` (`variant="primary"` for the solid accent button). Colours come from the
`DEV_*` tokens in `theme/theme.constants.ts`; add a token there rather than an `rgba(...)`
literal in a component (the design-token check flags those).

To add a control:

1. Add it to the game's `<Game>DevPanel.tsx` using the shell's controls. Give it a label a test
   can find: `DevToggle` and `DevStepper` use their labels as accessibility labels, and a
   `DevActionButton` takes `accessibilityLabel` / `testID`.
2. Keep the panel's own state inside the panel. State the screen needs (Star Swarm's
   `StarSwarmDevOptions`, Mahjong's free-tile overlay) stays in the screen and is passed in with
   a setter; the screen keeps only `devOpen` and renders one `<XDevPanel enabled={...} />`.
3. Pass the screen's existing gate as `enabled` (`__DEV__`, or Star Swarm's
   `DEV_TOOLS = __DEV__ || isPreLaunchApiBuild()`). The panel component returns `null` before
   any hook runs when it is false, so store builds neither show it nor run its timers or
   listeners. Never widen the gate in a panel.
4. Test it through the screen's dev-panel cases (`StarSwarmScreen.devpanel.test.tsx`, the
   "developer panel" blocks of `DailyWordScreen.flow.test.tsx` and `MahjongScreen.board.test.tsx`)
   or the panel's own test (`components/yacht/__tests__/YachtDevPanel.test.tsx`), driving it by
   label or testID. Shell behaviour itself is covered by
   `components/dev/__tests__/DevPanelShell.test.tsx`.

### Testing a native renderer (#2956)

The iOS/Android Skia renderers (`components/starswarm/GameCanvas.tsx`,
`components/mahjong/GameCanvas.tsx`) have component tests next to them
(`__tests__/GameCanvas.test.tsx`, `__tests__/GameCanvas.native.test.tsx`; run one with
`npx jest src/components/starswarm`). There is no global Skia mock: each test mocks
`@shopify/react-native-skia` with stubs that render a host `View` keeping the element's props
(`testID="sk-rect"`, `color`, `x`, ...), so a test asserts what would be drawn rather than
snapshotting it; the SVG card faces (`decks/__tests__/svgCardFaces.test.tsx`) stub
`react-native-svg` the same way and pin primitive counts and colours per card, picking
elements by their props, never by position. Engine state is seeded
(`initStarSwarm(w, h, wave, seed)` / `createGame(layout, seed)`), and the Star Swarm test
wraps the real engine and `buildFrame` in `jest.fn` so one test can force a single transition
(`tick.mockImplementationOnce`) and count publishes. `requestAnimationFrame` is replaced by a
hand-cranked queue (`createRafHarness` in `components/starswarm/__tests__/helpers/canvasFixtures.ts`,
with `seededStarSwarm`), so each `frame(dt)` runs exactly one loop iteration inside `act`; frame
publish gating is asserted as "no `buildFrame` call, no React commit (a `Profiler` counter)"
across frames of a paused or game-over game. The global Reanimated mock keeps a
`useSharedValue` object for the component's lifetime, as the real hook does, so a write from a
gesture or UI-thread callback survives the next render. Two traps remain, because the mock
evaluates `useAnimatedStyle` / `useDerivedValue` inline at render: a write made in an effect or
handler shows in an animated style only on the next render, so `rerender` (or `act` on something
that re-renders) before reading the style; and the init is read once at mount, so a prop-seeded
value (`useSharedValue(lifted ? -LIFT_AMOUNT : 0)` in `PlayerHand.tsx`) stays at its first value
when the prop changes unless the component writes `.value` itself.
`mockScreenDeps().mockGestureHandler(() => sink)` records every `GestureDetector` render (the
gesture it was given, composites with their children, each built gesture with its own `on*`
callbacks, and the child's testID); `detectedGesture(sink, "pan", { testID })` returns the
callbacks to fire. Restore
spies (`Date.now`, `performance.now`, `console.error`) in `afterEach(() =>
jest.restoreAllMocks())`, not at the end of a test body. Use `await` on every RNTL v14 call (`render`,
`rerender`, `unmount`, `fireEvent`), and don't wrap a plain ref call in a sync `act()`: an
unawaited one leaks into the next test. `App.tsx` has a smoke test (`src/__tests__/App.test.tsx`)
with navigator recorders and stub screens; jest cannot run `import()`, so it replays
`lazyScreens.ts`'s factory table through `require`.

### Structure

```
frontend/src/
├── game/cascade/__tests__/
│   ├── scoring.test.ts     # scoreForMerge() pure function
│   └── fruitQueue.test.ts  # FruitQueue peek/consume/bounds
└── theme/__tests__/
    └── fruitSets.test.ts   # All fruit set structural invariants
```

### What's Tested

**scoring.test.ts**

- `scoreForMerge(tier)` returns correct points per tier
- Values double each tier (tiers 0–9)
- Tier 10 (Watermelon) returns the disappear bonus (256)
- Cumulative scoring adds correctly

**fruitQueue.test.ts**

- `peek()` and `peekNext()` return tiers within `[0, MAX_SPAWN_TIER]`
- `consume()` returns the current peek value
- Queue advances correctly after consume
- Never spawns above `MAX_SPAWN_TIER` across 200 samples

**fruitSets.test.ts**

- All 3 sets (fruits, gems, planets) define exactly 11 tiers
- No duplicate tiers within a set; all tiers 0–10 covered
- Every fruit has non-empty name, emoji, and color
- Radii increase monotonically with tier
- Radii are identical across all sets for the same tier (physics skin-agnostic)

**releaseBuildConfig.test.ts** (#2783)

- Store build exposes exactly the seven free games: `App.tsx` registers only free/shared routes, premium routes come only from `visiblePremiumRoutes()`
- No purchase/paywall/IAP dependency, screen or route; no deep-link surface (no `linking` config, no Android VIEW intent-filter)
- `.env.production` targets exactly the production API; gradle config hard-codes no dev API
- Android release-signing guard is present and only the CI smoke build opts out
- Manual evidence for the rest of the release check: `docs/RELEASE-ACCEPTANCE-v1.0.md`

### Notes

- Physics engine (Matter.js) is not unit-tested — third-party, no jest DOM available.
- Native renderers and components have component tests; see "Testing a native renderer" above.

### Yacht AI simulation — two-layer model (#2245)

All Yacht AI simulation runs on one harness, `frontend/tooling/yacht/`:

- `streams.ts` gives each player their own seeded dice and AI-noise streams.
  Dice for roll _k_ of round _r_ come from a per-(stream, round) table, so one
  player's rerolls never shift the other player's dice. The old simulators
  shared one LCG seeded with `seed + i`; adjacent seeds of that LCG produce the
  same first die ~99.8% of the time, so their games weren't independent.
- `harness.ts` plays matchups in **blocks of four games**: A first and B first,
  each with the two dice streams mirrored between the players. Every matchup
  is therefore always order-swapped.
- `stats.ts` reports both players symmetrically: win rate (ties count half),
  win rate moving first and second, the order effect, the first-mover win
  rate, and per-player score, bonus rate, upper subtotal, below-par fills and
  per-category mean/hit rate. #2156 added score SD and 10th/50th/90th
  percentiles, the Yacht-zero rate, the Joker (second Yacht) rate, the round
  in which Chance is filled, and the share of zeroed upper boxes that were
  Fours–Sixes. Every value has a 95% CI computed **over blocks** (games in a
  block share dice, so blocks are the independent unit).
- `gate.ts` holds the calibration gate: matchups, game counts and bands. It is
  the only place bands are defined.

**Layer 1: PR smoke test.** `frontend/tooling/yacht/__tests__/ai.simulate.test.ts` runs in every PR
(about 140 games, ~15s under Jest with the #2246 tiers). It catches total breakage:
the AI throwing, invalid scores, a harder tier no longer beating Easy, or
mirroring broken (paired self-play must come out at exactly 50%). It is far too
small to see balance drift.

**Layer 2: scheduled calibration gate.** `.github/workflows/yacht-sim-gate.yml`
runs nightly, on demand (`workflow_dispatch`, with an optional games
override), and on PRs that touch the AI, engine, oracle or gate. Its
`bands` job runs the four `GATE_GROUPS` in parallel (Medium-vs-Easy was
added by #2156); its `regret` job runs
`ai.calibrate.test.ts` (#2244, below). Run it locally from the repo root:

```bash
npx --prefix frontend tsx tools/sim/simulate-yacht.ts --gate                       # everything (~40 min)
npx --prefix frontend tsx tools/sim/simulate-yacht.ts --gate --group self-play     # one CI group
npx --prefix frontend tsx tools/sim/simulate-yacht.ts --gate --group hard-vs-easy --games 400  # quick look
npx --prefix frontend tsx tools/sim/simulate-yacht.ts --a hard --b medium --blocks 250         # ad-hoc matchup
npx --prefix frontend tsx tools/sim/simulate-yacht.ts --a hard --b medium --mode independent   # unpaired dice
```

A failing band prints the band, the observed value and its CI, e.g.
`FAIL hard-vs-easy:win-rate: observed 55.1% [52.9%, 57.3%] (95% CI), band ≥ 57.0% and ≤ 67.0% — …`.
`[CI crosses the bound: inconclusive …]` means the run can't separate pass from
fail at that sample size; rerun that group with more `--games` before acting.

**Reading order-swap output.** For an A-vs-B matchup: `A moving first` and
`A moving second` are A's win rates in each seat; `order effect` is their
difference, paired within blocks. `First-mover win rate` is the result for
whoever moved first, so 50% means turn order doesn't matter. A #2200-style
artifact shows up as a large order effect. In self-play A's win rate is 50%
by construction, so the first-mover rate is the number to read.

**What the bands encode.** Since #2246 the bands describe the tier design:
each tier's mean score sits in a ±10-point band around its #2157 target (Easy
~160, Medium ~215, Hard ~250), the ladder is strictly ordered on score,
upper-bonus rate and below-par fills, and win-rate and bonus bands are
centred on the values measured on 2026-09-24 (in `gate.ts` comments). The
tiers ignore the opponent, so each player's game depends only on their own
streams: the order effect is exactly 0 and the self-play first-mover rate
exactly 50%. Those bands stay as a guard against an opponent-aware layer
reintroducing a #2200-class artifact.

**Variance and play-style metrics (#2156, measured 2026-09-25, self-play,
1,000 games per tier):**

| Tier   | Score SD | p10 / p50 / p90 | Yacht zero | Joker | Chance filled (round) | Zeroed upper boxes that were 4s–6s |
| ------ | -------- | --------------- | ---------- | ----- | --------------------- | ---------------------------------- |
| Easy   | 36.2     | 120 / 160 / 202 | 91.6%      | 1.2%  | 1.7                   | 23%                                |
| Medium | 45.8     | 167 / 203 / 264 | 78.6%      | 3.6%  | 2.6                   | 4.6%                               |
| Hard   | 56.3     | 187 / 241 / 308 | 69.2%      | 6.6%  | 6.6                   | 18% (±8)                           |

- **Gated:** score SD orders Hard > Medium > Easy (+10.5 and +9.6). Hard's
  SD is close to the ~60 of optimal play, which the dice fix. The Yacht-zero
  rate orders Easy > Medium > Hard (+13.0pp and +9.4pp). The SD's SE is
  normal-theory, SD / √(2(n−1)), with n = two dice streams per block, not
  the game count.
- **Reported, not gated:** percentiles, Joker rate, Chance timing and the
  sacrifice share.
  - Easy and Medium use Chance in round 2 on average, the beginner mistake
    #2156 named. That is by design for those tiers.
  - The sacrifice share doesn't back #2156's rule of thumb that the Ones and
    Twos boxes should always go first: Hard plays optimally, and 18% of the
    upper boxes it zeroes are Fours–Sixes.
- **Medium vs Easy:** Medium wins 86.4% [84.3, 88.4], scoring 216.3 to 162.4.
  Its band is ±5pp around that.

**Sample size and power** (measured, 4 CPU cores, ~0.06s/game under `tsx`
for the #2246 tiers; the first measurements below were taken on the older
utility AI at ~0.33s/game):

| Quantity                   | Per-block SD | Blocks (games) | 95% CI half-width | Band half-width |
| -------------------------- | ------------ | -------------- | ----------------- | --------------- |
| Win rate (A vs B)          | ≤ 0.245      | 500 (2,000)    | ±1.6–2.4pp        | ±5pp            |
| Order effect               | 0.247        | 500 (2,000)    | ±2.2pp            | ±5pp            |
| Self-play first-mover rate | ~0.18        | 250 (1,000)    | ±2.2pp            | ±5pp            |
| Mean score (one tier)      | ~30–40       | 250–500        | ±2.4–4.9          | ±10             |

With a CI half-width under half the band's half-width, a run whose true value
is at the band centre fails less than once in 10⁵ runs (z ≈ 4.5). A real shift
of 7.5pp is detected ~99% of the time; a shift of exactly 5pp is detected
50% of the time. Because the seeds are fixed, the gate is deterministic: the
same code gives the same numbers. It only changes result when the AI changes.

Wall-clock at these sizes: 2,000 games is ~2 min per matchup group and the
self-play group (3,000 games) is ~3 min on a 4-core dev box with the #2246
tiers (the older utility AI took ~11 and ~17 min). The jobs run in parallel;
each has a 90-min timeout to absorb slower runners.

**What pairing buys.** It isn't free variance reduction everywhere. Mirrored
pairs are negatively correlated (r ≈ −0.35), which cuts the variance of the
A−B score difference ~23% and halves the order-effect CI versus independent
dice (per-block SD 0.25 vs 0.51). But the order-swapped games in a block
replay the same dice, so for a plain win rate paired and independent CIs come
out about equal at the same game count. For one player's absolute score,
paired is slightly wider. `--mode independent` is there for unpaired runs.

**#2200 check.** Hard-vs-Hard over 4,000 paired games (seeds 15, 21–23) gives
a first-mover win rate of 48.8% ± 1.1: no first-mover handicap remains after
#2317. The old shared-LCG method on the same code gives 50.8% ± 3.1 over 1,000
games. The 57.3/42.7 split reported on #2317 came from 150 games per side, where
the CI is about ±8pp.

`tools/sim/simulate-yacht.ts` (#2213) is now a thin CLI over this harness. Its
old bands table (stale since the utility-AI rewrite) and the separate
`ai.baseline.test.ts` metrics printer were retired; `--gate` and the ad-hoc
report replace both.

### Yacht AI regret metric — EV-loss vs the optimal oracle (#2244)

Win rate says who won; it says nothing about _how well_ either side played — a
bot can win a dice game on luck while playing badly, or lose while playing
perfectly. The regret metric grades individual decisions instead: for each
hold or category choice the AI makes, "EV-loss" is `optimalEV - chosenEV`,
computed against the exact ground-truth oracle (`frontend/src/game/yacht/oracle/`,
[`docs/research/YACHT_ORACLE.md`](research/YACHT_ORACLE.md)) — the Yacht analogue of chess's
average centipawn loss. Implementation: `oracle/regret.ts` (per-decision
EV-loss + blunder banding) and `oracle/regretAggregate.ts` (summaries,
worst-decision tail, and a Welch's-t-test significance check), unit-tested in
`oracle/__tests__/regret.test.ts`, `regretAggregate.test.ts`, and (against the
real committed table) `regretOracle.test.ts`.

**Blunder bands** (`DEFAULT_EV_LOSS_BANDS`, adjustable — pass a custom
`EvLossBands` to any of `regret.ts`'s functions):

| Band      | EV-loss                                                                  |
| --------- | ------------------------------------------------------------------------ |
| `optimal` | `<= 0` (exact — chosen and optimal EV come from the same computed array) |
| `minor`   | `0 < loss < 1`                                                           |
| `mistake` | `1 <= loss <= 5`                                                         |
| `blunder` | `> 5`                                                                    |

**Run it** — lives in `ai.calibrate.test.ts`, gated behind `YACHT_SIM_FULL`,
and runs nightly as the `regret` job of `yacht-sim-gate.yml`. Its games use
the harness's per-player streams (`tooling/yacht/streams.ts`):

```bash
YACHT_SIM_FULL=3000 npx jest --testPathPattern="ai.calibrate" -t "regret" --silent=false
```

Each decision requires an **awaited** oracle query — mean ~2.5ms for hold EVs
in isolation on dev hardware ([`docs/research/YACHT_ORACLE.md`](research/YACHT_ORACLE.md) §7), but end-to-end
through this test file (oracle query + simulation overhead) that measures at
**~20-26ms/decision** across two real runs: 19.75ms/decision at N=30 (6,941
decisions, 137s), 25.59ms/decision at N=150 (34,628 decisions, 886s). At that
rate, full `YACHT_SIM_FULL` coverage (e.g. N=3000) would take on the order of
an hour for the hold-EV path alone, so the regret tests sample
`min(YACHT_SIM_FULL, 50)` games per difficulty by default (`REGRET_SAMPLE_CAP`
in the test file — already enough for the Easy-vs-Hard significance assertion
below at N=30, per the measurement above); override independently with
`YACHT_REGRET_SIM=<N>` for full or custom coverage. This is the documented
sampling fallback called for by #2244's acceptance criteria — full
non-sampled 3,000-game coverage was measured and found impractical for
routine runs, not assumed. With the #2246 tiers the AI itself is much
cheaper: the default run measures ~4ms/decision (11,550 decisions in 46s),
so raising `YACHT_REGRET_SIM` is now affordable when needed.

**Timeout caveat if you raise `YACHT_REGRET_SIM`**: the test's own
`it()` timeout (1,800,000ms) is not a reliable backstop for a large run. Once
the oracle table is loaded (one-time per process), every `await` in the hot
loop resolves an already-settled promise — a microtask, not a macrotask — so
a long chain of them can starve Node's timer queue (where Jest's timeout
callback lives) for the batch's entire real duration. Observed directly: a
600,000ms-timeout run that took 886s of real wall-clock time ran to
completion (failing on an assertion, not a timeout) rather than being
aborted at the 600s mark. Budget wall-clock time from the measured
ms/decision rate above, not from the configured timeout.

The gate asserts:

- Mean EV-loss orders Easy > Medium > Hard, and every adjacent gap is
  significant (measured 2026-09-24: 2.40 / 1.01 / 0.14, Welch's t = 22.8,
  31.0 and 40.9). Hard makes no blunder-band (> 5 EV) decisions: its slips
  are capped at 3 points below the oracle's best.
- A noise-free diagnostic plays each tier at temperature 0 on the same dice:
  the order still holds (0.97 / 0.48 / 0.00), so the ladder comes from each
  tier's foresight, not from how much noise it adds. Noise-free Hard _is_
  the oracle, so its EV-loss is ~0. (Before #2246 the equivalent diagnostic
  showed Easy and Medium making _identical_ decisions with noise removed —
  the problem #2246 fixed.)

Console output (only shown with `--silent=false` or on failure) reports a
per-difficulty table (mean EV-loss, hold/category split, blunders per 1,000
decisions), a band histogram, and the worst 5 decisions across all three
difficulties by EV-loss — e.g. an AI scoring a second Yacht roll into "fours"
instead of "yacht" (missing the +100 joker bonus) shows up as a ~90-point
blunder, which is exactly the kind of catastrophic single-decision failure
aggregate win-rate can't surface.

---

### Hearts sim gate — principle check (#3161)

The Hearts sim gate checks **every decision** the conservative CPU makes
against [`docs/hearts/CONSERVATIVE_AI.md`](hearts/CONSERVATIVE_AI.md) §2.4,
and passes only with **zero violations**. It replaced the persona-separation
/ SPRT gate below as the PR and nightly gate. That gate compared win shares
between the legacy personas, so it rewarded tuned-in mistakes and never
looked at a single play: the legacy CPUs routinely followed trick 1 with a
low club, and it never noticed.

- `frontend/tooling/hearts/principles.ts` — the checker. Given one decision
  (the acting seat's hand, the trick so far, the completed tricks, points per
  seat, trick number, hearts broken and the card chosen; for a pass, the 13
  cards dealt and the 3 passed) it walks the §2.4 procedure in the §2.3
  priority order and reports the first step the choice breaks. It is
  **independent of the CPU**: it imports only the engine's rules and types,
  never `ai.ts`, `aiConsiderations.ts`, `aiWeights.ts` or `conservative/`
  (`principles.test.ts` scans its imports), and it was written from the doc.
- `frontend/tooling/hearts/principleRun.ts` — the seeded run: one persona in
  all four seats through `harness.ts` (`playGame`, with its `onPass` /
  `onPlay` hooks capturing each decision), default seed 3161.

**What it checks.** Two kinds of check (`CHECKS` in `principles.ts`):

- _Predicate_ checks flag a property of the chosen card that a principle
  forbids, whatever the exact expected card: following a free trick (trick 1,
  or last seat with no points) below its highest led-suit card (P2,
  `follow.free-trick`); playing over the winning card while holding a card
  that would lose (P1, `follow.over-when-could-duck`); Q♠ into a trick it
  wins, A♠/K♠ into a spade trick the queen can still drop on, leading Q♠ or
  A♠/K♠ while Q♠ is live, keeping Q♠ under A♠/K♠, not discarding a legal Q♠,
  keeping or passing Q♠/A♠/K♠ against the spade-protection rule (P5); during
  a moon threat, spending the guard heart, or dropping Q♠ where it would
  complete X's moon (P7).
- _Procedure_ checks require the chosen card to equal the card §2.4 names,
  computed by the checker's own small implementation of the procedure: the
  P3/P9 lead order (`lead.shed`, `lead.exit`), the P6 discard order
  (`discard.high-heart`, `discard.most-dangerous`), A♠-then-K♠ discards
  (P5), the highest loser / highest winner (P1 `follow.duck-highest`,
  `follow.win-highest`), the P7 guard lead and take, and the P8 pass
  (`pass.order`; the order of the three cards does not matter).

All 24 checks (`CHECKS` in `principles.ts`; `principleRun.test.ts` fails if
a check is missing here):

| Check                             | Kind      | Principle     | Flags                                                                                                           |
| --------------------------------- | --------- | ------------- | --------------------------------------------------------------------------------------------------------------- |
| `lead.queen`                      | predicate | P5-QUEEN      | Led Q♠ while it had another legal card.                                                                         |
| `lead.spade-honour`               | predicate | P5-QUEEN      | Led A♠ or K♠ while Q♠ was live and it had another legal card.                                                   |
| `follow.moon-complete-queen`      | predicate | P7-MOON-GUARD | Dropped Q♠ under A♠/K♠ on a trick X could take when that completes X's moon.                                    |
| `follow.queen-under-honour`       | predicate | P5-QUEEN      | A♠/K♠ was winning a spade trick and it did not drop Q♠.                                                         |
| `follow.free-trick`               | predicate | P2-FREE-TRICK | On a free trick (trick 1, or last seat with no points) it did not play its highest led-suit card other than Q♠. |
| `follow.over-when-could-duck`     | predicate | P1-DUCK       | Played over the winning card while it held a led-suit card that would lose.                                     |
| `follow.moon-guard-keep`          | predicate | P7-MOON-GUARD | Moon threat and X can still overtake, but it ducked with its guard heart while it had another loser.            |
| `follow.queen-into-win`           | predicate | P5-QUEEN      | Played Q♠ into a trick it was winning while it held another legal card.                                         |
| `follow.spade-honour-under-queen` | predicate | P5-QUEEN      | Won a spade trick with A♠/K♠ while Q♠ was out and could still drop on it, holding another spade.                |
| `discard.moon-complete-queen`     | predicate | P7-MOON-GUARD | Discarded Q♠ onto a trick X could take when that completes X's moon.                                            |
| `discard.queen`                   | predicate | P5-QUEEN      | Void, holding a legal Q♠, and discarded something else.                                                         |
| `discard.moon-guard-keep`         | predicate | P7-MOON-GUARD | Moon threat, and it discarded its guard heart.                                                                  |
| `pass.queen-spades`               | predicate | P5-QUEEN      | Kept Q♠/A♠/K♠ with spades unprotected, or passed one with spades protected (P5 inside P8).                      |
| `lead.moon-guard`                 | procedure | P7-MOON-GUARD | Moon threat and its highest heart cannot be beaten, but it did not lead it.                                     |
| `lead.shed`                       | procedure | P3-SHED       | Held a DANGEROUS non-heart but did not lead the most dangerous one.                                             |
| `lead.exit`                       | procedure | P9-EXIT       | Nothing dangerous to lead, and it did not lead the card least likely to win.                                    |
| `follow.moon-complete-cover`      | procedure | P7-MOON-GUARD | Kept Q♠ in the moon-complete case but did not play its highest other spade.                                     |
| `follow.moon-guard-take`          | procedure | P7-MOON-GUARD | Moon threat, X winning a trick with points, and it could take it safely, but it did not.                        |
| `follow.duck-highest`             | procedure | P1-DUCK       | Ducked, but not with the highest card that loses.                                                               |
| `follow.win-highest`              | procedure | P1-DUCK       | Could not lose the trick, and did not win with its highest allowed card.                                        |
| `discard.spade-honour`            | procedure | P5-QUEEN      | Void, Q♠ live, and it did not discard A♠ (then K♠).                                                             |
| `discard.high-heart`              | procedure | P6-DISCARD    | Did not discard its highest HIGH heart.                                                                         |
| `discard.most-dangerous`          | procedure | P6-DISCARD    | Did not discard its most dangerous card.                                                                        |
| `pass.order`                      | procedure | P8-PASS       | Did not pass the first three cards of the P8 list.                                                              |

A forced play (one legal card) is never judged. Each violation carries the
principle it breaks (`principleId`, used for the counts) and the §2.3
attribution of the expected card (`attributedTo`). The checker is tested
against the doc itself: on every §5 rulebook position it must name the
rulebook's card and principle, accept that card and reject every other legal
card.

```bash
npx --prefix frontend tsx tools/sim/simulate-hearts.ts --check-principles                            # conservative x4, 10,000 hands
npx --prefix frontend tsx tools/sim/simulate-hearts.ts --check-principles --hands 2000               # the PR-sized run
npx --prefix frontend tsx tools/sim/simulate-hearts.ts --check-principles --persona cautious --hands 2000 --json out.json
```

`--persona` is `conservative` (default), `cautious`, `schemer` or `daring`;
`--seed` overrides the seed. The command exits 1 on any violation, and 2 when `--hands` is not a positive integer (e.g. `abc`, `5abc`, `0`) instead of falling back to a default.

**Reading a failure.** The report prints the violation count per principle,
then per check (with its kind), then the first 5 positions of each principle
as §5 rulebook yaml blocks. This one is the legacy Cautious CPU's trick-1
mistake:

```yaml
id: SIM-P2-1
decision: follow
seat: 0
trick_number: 1
hand: [5H, 10C, 6S, 9C, 2D, 2S, JS, 9D, 5C, QD, JH, 7D, 3H]
played: []
trick: [{ seat: 3, card: 2C }]
hearts_broken: false
queen_played: false
points: [0, 0, 0, 0]
expected: [10C]
principle: P2-FREE-TRICK
reason: "follow.free-trick: On a free trick (trick 1, or last seat with no points) it did not play its highest led-suit card other than Q♠. It played 9C."
```

`expected` and `principle` are what §2.4 prescribes; `reason` names the check
and the card the CPU played. Decide which side is wrong:

- If the CPU contradicts the doc, fix the CPU (`frontend/src/game/hearts/conservative/`).
- If the doc's principle handles the position badly, change the principle in
  the doc (never add a special case), add the position to the rulebook (paste
  the block, give it the next `R` id and a real reason) and update the CPU and
  the checker together.
- If the checker misreads the doc, fix the checker and add the position to
  `principles.test.ts`.

Never loosen a check to make a failure go away.

**Measured (seed 3161).** Conservative: 0 violations in 10,000 hands
(551,300 decisions, 433,710 with a choice; ~25 s). The legacy personas, 2,000
hands each: Cautious 55,926 violations (6,428 `follow.free-trick`), Schemer
44,592 (3,261), Daring 40,843 (2,132). `principleRun.test.ts` runs a seeded
Cautious game as a self-test and requires the trick-1 low-club P2 violation,
so the checker would have caught the original bug.

**CI.** The `principles` job of `hearts-sim-gate.yml` runs conservative x4:
2,000 hands on PRs (~6 s of simulation), 10,000 nightly and on manual runs
(the `hands` input overrides). It uploads the text and JSON report. Jest runs
the fast versions (`principles.test.ts`, `principleRun.test.ts`) in every PR.

---

### Hearts whole-game report (#3162)

The principle check says whether each play is sound; the **game report** says
how the conservative CPU does over whole games to 100 points. Later,
deliberate principle breaks in advanced CPUs must show up as better results
here. It is a report (numbers with 95% CIs), not a gate, apart from the
sanity floor below.

```
npx --prefix frontend tsx tools/sim/simulate-hearts.ts --game-report                                  # 2,000 games per matchup (~2 min)
npx --prefix frontend tsx tools/sim/simulate-hearts.ts --game-report --games 60                       # the PR smoke run (~4 s)
npx --prefix frontend tsx tools/sim/simulate-hearts.ts --game-report --seed 7 --json out.json --md out.md
```

`--games` and `--seed` are strict integers (anything else exits 2). Exit 1
means the sanity floor failed. Code: `frontend/tooling/hearts/gameReport.ts`
(report and metric definitions), `bots.ts` (the simulator-only opponents),
`__tests__/gameReport.test.ts`.

**Matchups** (duplicate deals: the same cards in rotated seats, so a
difference between matchups is the players; `--games` is games played per
matchup, rounded up to whole blocks):

| Matchup               | Table                                                            |
| --------------------- | ---------------------------------------------------------------- |
| `random-legal`        | 1 conservative vs 3 uniformly random legal players (random pass) |
| `conservative-mirror` | 4 conservative                                                   |
| `legacy-cautious`     | 1 conservative vs 3 legacy Cautious (flagged legacy, #3165)      |
| `legacy-schemer`      | 1 conservative vs 3 legacy Schemer                               |
| `legacy-daring`       | 1 conservative vs 3 legacy Daring                                |
| `moon-shooter`        | 3 conservative vs 1 bot that always tries to take every point    |

**Metrics** (per conservative seat; the opponents' points, win rate and moons
are reported too). Each is a ratio with its logged numerator and denominator
in the JSON, and a CI over blocks: `points_per_hand` (moon-adjusted),
`points_per_game` (final score; a game ends when a seat reaches 100),
`win_rate` (lowest score; ties split), `qs_taken`, `moon_allowed` (hands where
another seat shot the moon; a seat's own moon is not counted), `p7_hands`
(hands where the seat decided a play with P7, the moon guard), `zero_hands`
and `moon_shot`. The **moon guard table** looks at the whole table, for
hands where a non-conservative seat X is a moon threat, and answers _when_ the
CPU notices and _whether it could then stop it_. A trigger fires at the first
conservative play where it holds. Two triggers are compared on the same games
(no CPU change): the CPU's own (P7's condition: X alone has taken points and
holds 10 or more) and a hypothetical hearts trigger (one non-conservative
seat holds every heart taken so far, at least 3, Q♠ or not). For each, the
hands split by outcome (a non-conservative seat shot the moon, or it was
stopped) and the table gives the share stopped (Wilson 95% interval), the
mean and median trick of first recognition (the JSON and the moon-shooter
histogram give every trick 1-13), and `can stop`: at first recognition, a
conservative seat held a heart that no out card beats, so P7 had the means to
stop the moon. `can stop` is an upper bound: holding the top heart does not guarantee P7 could lead or win with it. `stopped` means no non-conservative moon was shot; it may include hands another seat stopped, not only the CPU. (Shares such as "the CPU recognized the threat in every moon"
or "P7 decided a play in none of them" are true by construction, because any
moon crosses 10 points alone and any play P7 names wins a point trick, so
they are not reported.) The JSON also holds `pointsPerHandAdvantage`
with both operands (`conservative` and `opponent` `{num, den}`) and the paired
difference with its CI. It also prints how often
each principle decided a conservative play or pass card (flagging any that
never fires, or decides more than 60% of the plays), and how many positions
reach the moon-complete branches of §2.4 (follow step 1, discard step 1).

**Sanity floor (the only pass/fail).** (1) Conservative's points per hand
must be at least `SANITY_FLOOR_MARGIN` = **4.0** below random-legal's, on the
same deals (paired by block; the **lower bound of the 95% CI** of the
difference must reach the margin, so noise cannot pass it).
Observed at the default size: 6.65 [6.58, 6.71] (conservative 1.79, random
8.44 points per hand), so the floor sits at about 60% of the observed margin;
a smoke run of 60 games observed about 6.9. (2) The conservative seats in the
`moon-shooter` matchup commit **0** principle violations (every decision is
graded with the checker). A failure of (1) means the CPU no longer plays
clearly better than chance: look at the principle fire table and the
`random-legal` row first. A failure of (2) prints the first positions as
rulebook YAML; fix it as under "Reading a failure" above.

**Reading the numbers (default run, moon-shooter matchup).** One hand in
five is a moon (2,724). The CPU's trigger first fires at trick 5.7 on average
(median 5) in hands that end in a moon and at 4.8 (median 4) in hands that are
stopped; 75.7% of the hands where it fired end without a moon [74.9%, 76.5%].
At first recognition a conservative seat held an unbeatable heart in 14.5% of
the moon hands but 70.6% of the stopped ones: moons mostly happen where P7
lacked the means by the time it noticed. The hypothetical hearts trigger fires
_later_ (mean trick 7.3 in moon hands, 7.1 in stopped hands) and in fewer
hands (5,755 vs 11,197), because it needs three hearts held by one seat while
the CPU's trigger also fires on Q♠ plus a few points; it would not give P7
more time in this bot's hands. That is for the owner decision (#3196), not a
bug in the report.

`--games` is capped at 10,000 (exit 2 above it).

**CI.** The `game-report` job of `hearts-sim-gate.yml` plays 2,000 games per
matchup nightly and on manual runs (the `games` input overrides), and 60 games
on PRs. It uploads the Markdown, JSON and text report (`hearts-game-report`)
and writes the Markdown to the job summary.

---

### Hearts AI sim gate v2 — duplicate deals, SPRT, conditional metrics (#2238; legacy, on demand)

**No longer gates PRs or runs nightly (#3161).** It stays runnable: locally
with `--gate` (below), or in CI from Actions → Hearts AI Sim Gate → Run
workflow with `legacy_gate` ticked (`max_blocks` caps the blocks). Its checks,
thresholds and `baseline.json` are unchanged.

All Hearts AI simulation runs on `frontend/tooling/hearts/`;
`tools/sim/simulate-hearts.ts` is the CLI around it.

- `harness.ts` — **duplicate-deal replay.** A _block_ replays one sequence
  of deals once per line-up of a matchup. Hand _h_ of block _b_ is always
  dealt from its own (seed, block, h) stream, whatever happened earlier, and
  each seat's AI noise comes from its own (seed, block, hand, seat) stream,
  so play never shifts the deals and one seat's noise never moves another's.
  Seat 0 always holds the **human stand-in** (Schemer): the AI treats seat 0
  as the human (Daring aims its passes and Q♠ dumps there, and `ai.ts` turns
  that targeting off for an AI in seat 0), so AIs under test only ever sit
  in seats 1–3.
  - The harness always runs the legacy personas, whatever the app's
    `HEARTS_LEGACY_PERSONAS` flag (#3158); players only see Conservative in
    store builds.
  - _Preset matchups_ are the tables the app deals (all-Cautious,
    all-Schemer, all-Daring, mixed), with the AIs rotated across seats 1–3.
  - The _field matchup_ is the duplicate-bridge comparison: one test seat
    takes each persona in turn, in each of seats 1–3, against an
    all-Schemer field on the same deals.
- `metrics.ts` — **every metric is `numerator | denominator`**, a ratio of
  two per-seat counters, and every report prints both counts. No metric can
  be declared without its denominator (the type requires one):

  | Metric             | Numerator \| denominator                                  |
  | ------------------ | --------------------------------------------------------- |
  | `win_share`        | games won (ties split) \| games played                    |
  | `points_per_hand`  | points taken (moon-adjusted) \| hands played              |
  | `qs_taken`         | hands taking Q♠ \| hands played                           |
  | `moon_attempt`     | hands the moon-attempt trigger fired \| hands played      |
  | `moon_success`     | moons shot in attempted hands \| hands attempted (paired) |
  | `moon_shot`        | moons shot \| hands played                                |
  | `qs_dump_on_human` | Q♠ dumps won by the human seat \| Q♠ dumps                |
  | `void_created`     | passes that emptied a suit \| passes that could have      |

  Estimates are ratio estimators over blocks (Σ numerators ÷ Σ
  denominators, delta-method SE), so games sharing deals are never counted
  as independent. A rate whose denominator never occurred is reported as
  `n/a`, never as 0.

- `sprt.ts` — Wald sequential probability ratio tests on per-block series
  (Gaussian, plug-in variance, as chess-engine CI does for game pairs).
- `gate.ts` — the matchups, the checks, and the pre-registered hypotheses;
  `baseline.json` holds the last-known-good values.

**Two kinds of check**, all sequential:

- **Regression checks** (14) hold a metric at its `baseline.json` value:
  H0 "equals the baseline" against H1 "moved by δ" (3pp for win shares,
  2–4pp for behaviour rates), both directions, each side at α/2.
- **Separation checks** (6) are signed hypotheses written into `gate.ts`
  _before_ a run, with the measurements behind them: "left − right ≈ +m"
  (H0) against "no difference" (H1). `m` is the lower 95% bound of the
  baseline measurement (mean − 2·SE, enforced by `gate.test.ts`): the
  smallest separation the evidence supports. A point estimate overshoots
  the truth half the time and turns noise into failures (#2235). A reversed
  or vanished separation fails; a larger one passes. The report prints the
  difference with its CI.

All 20 checks are one family, **Bonferroni-corrected**: each runs at
α = 0.05/20 = 0.0025 with β = 0.05, so a behaviour-neutral change fails the
gate with probability ≤ 5%, and each check misses a real move of its δ ≤ 5%
of the time. CIs in the report use the same adjusted level (99.75%).

**How a run proceeds.** Each group adds 200 blocks to every matchup, then
evaluates its undecided checks. A check's decision is final the first time
it crosses an SPRT boundary: it is not tested again at later looks (doing
so would inflate both error rates), and the report says
`(decided at N blocks)`. The group stops once every check has decided, so a
clear pass or fail stops early, unlike a fixed-N run. A check still
undecided at the block cap is **truncated**: it takes the side its
likelihood ratio favours, i.e. it fails exactly when the estimate is past
the midpoint between H0 and H1. The report marks it
`(truncated at the block cap)`. `--max-blocks` must be at least 1.

```bash
npx --prefix frontend tsx tools/sim/simulate-hearts.ts --gate                     # both groups
npx --prefix frontend tsx tools/sim/simulate-hearts.ts --gate --group field       # one CI group
npx --prefix frontend tsx tools/sim/simulate-hearts.ts --gate --max-blocks 1000   # quick look (truncates)
npx --prefix frontend tsx tools/sim/simulate-hearts.ts --count 3000               # descriptive report, no verdicts
```

**Reading a failure.**

- `FAIL table-daring/daring/moon_success: 3.10% [2.2%, 4.0%] vs baseline
7.23% ± δ 2.50% — moons shot in attempted hands | hands attempted =
402/12967 — LLR low/high 6.21 / -40.3` — a regression check accepted H1:
  the rate moved by about δ or more from the baseline, with the stated
  error rates. The logged counts show what the rate was computed from.
  Unlike a fixed-N band failure, this is a decision, not a borderline
  sample: the SPRT only stops when the evidence reaches its boundary. If
  the change was intended, update the baseline (below); if not, it is a
  regression.
- A **separation** `FAIL` means the pre-registered ordering reversed or
  collapsed (e.g. the human now does as well at the Cautious table as at
  the Schemer table). If a deliberate re-tune changed the ladder, update the
  expectation in `gate.ts` in the same PR, citing the new measurement.
- `(truncated at the block cap)` means the effect sits between H0 and H1 —
  smaller than δ, but not clearly zero. Treat a truncated fail as "moved by
  about half of δ": look at the CI, and rerun with `--max-blocks` raised or
  another `--seed` before acting.
- `denominator is 0 — the conditioning event never occurred` fails a check
  outright: the behaviour the rate is conditioned on (e.g. Daring moon
  attempts) disappeared.

**Updating the baseline.** Only a PR that deliberately changes Hearts AI
behaviour updates `baseline.json`, and it does so in the same PR as the
change:

```bash
npx --prefix frontend tsx tools/sim/simulate-hearts.ts --update-baseline --reason "#1234: rank-aware moon attempts"
```

This re-measures every regression metric at a fixed sample size on a seed
disjoint from the gate's (`BASELINE_SEED`), and records the reason, date,
logged counts and SEs. Then set each separation's `expected` in `gate.ts` to
its new `separations` mean − 2·SE (`gate.test.ts` fails until you do). The PR
description must say which metrics moved and why; reviewers read the JSON
diff. Never regenerate the baseline to make an
unexplained failure go away.

**CI wiring and runtime budget.** `.github/workflows/hearts-sim-gate.yml`
runs the two groups as parallel matrix jobs (`Legacy gate (<group>)`) only
on a manual run with `legacy_gate` ticked; until #3161 they ran on every PR
touching the Hearts AI and nightly. Measured on a 4-core
dev box (7–14 ms per game under `tsx`), the full gate on unchanged code
(seed 2238) decided every check early:

| Group     | Games per block | Stopped at (cap)      | Wall-clock |
| --------- | --------------- | --------------------- | ---------- |
| `presets` | 6               | 3,000 blocks (12,000) | ~2.5 min   |
| `field`   | 9               | 400 blocks (6,000)    | ~0.5 min   |

Worst case, with every check running to its cap (presets 12,000 blocks ×
6 games, field 6,000 × 9), is about 8.5–17 min per group at 7–14 ms a game
(a full field-group baseline run measured ~14 ms); the job timeout is
45 min. There is no reduced-N variant — the smoke layer below only proves
the pipeline runs.

**Per-PR smoke layer.** `frontend/tooling/hearts/__tests__/ai.calibrate.test.ts`
(run by `ci.yml` with the rest of Jest, ~5 s) runs every group at a 12-block
cap: each check must evaluate, find its denominator and produce finite
estimates. Its verdicts at that size mean nothing. Unit tests for the SPRT
on synthetic sequences (including its error rates over 300 runs), the
duplicate-deal invariants and the gate config are in
`frontend/tooling/hearts/__tests__/`.

**What duplicate deals buy.** Measured on 1,500 blocks:

| Comparison                                    | Variance vs unpaired blocks |
| --------------------------------------------- | --------------------------- |
| Field: persona win-share difference           | 0.80–0.88×                  |
| Field: persona points-per-hand difference     | 0.52–0.65×                  |
| Presets: stand-in win share, table vs table   | 0.76–0.82×                  |
| Mixed table: two personas at the _same_ table | 1.26–1.29× (worse)          |

Hearts diverges fast (a different pass changes every later trick), so the
reduction is modest. Comparing personas that sit at the same table
_increases_ variance, because they compete in the same zero-sum games —
which is why persona-vs-persona separations come from the field matchup,
not the mixed table.

**What the gate measured (2026-09-24, after #2555, #2234, #2235, #2236 and the #2283 retune).** Baseline
(`BASELINE_SEED`, presets 12,000 blocks, field 6,000; the full numbers with
counts are in `baseline.json`):

- The difficulty ladder holds at every step, on the targets the owner set
  (#2283): the human stand-in wins 40.0% at the all-Cautious table, 25.3% at
  all-Schemer and 16.3% at all-Daring (25.1% at the mixed table). At the
  mixed table Daring wins 40.0%, Schemer 23.5%, Cautious 11.3%. In the field
  matchup, Daring beats Schemer by +10.5pp and Schemer beats Cautious by
  +11.9pp. All six steps are separation checks.
- **Plausible mistakes (#2283).** A noise hit used to play a uniformly
  random card. It now plays a near-best one: each other card is weighted
  exp(−(best − score) / 0.1), in utility-score units (`MISTAKE_SPREAD`). A
  sloppy pass draws its 3 cards the same way.
  - Near-best mistakes cost fewer games, so the rates rose to hold the
    ladder: Cautious 55%, Schemer 19%, Daring 0% (previously 38 / 10 / 0).
  - Measured by the regret report on the same deals (60 blocks), a mistake
    costs 1.27 points instead of 1.51 (Cautious) and 1.21 instead of 1.49
    (Schemer). Blunders, Q♠-sized or worse, fell from 3.4% of mistakes to
    2.6% (Cautious) and from 3.8% to 2.0% (Schemer).
  - The per-play gain is modest because the AI's own scores rank the
    alternatives only roughly. Better rankings are #2587's job (the strong
    engine).
  - Before this, #2236's tactics had widened the ladder to 43.4 / 26.0 /
    16.5%: better deliberate play made random noise cost more.
- Before #2555 (Cautious noise 25%) the bottom of the ladder was inverted:
  Cautious was the strongest persona (+2.75pp over Schemer in the field) and
  the all-Cautious table the hardest for the human (21.9%). Changing
  Cautious's play weights barely moved that; its noise rate did (30% → still
  level with Schemer, 35% → a correct ladder). #2235's moon defense helped
  Cautious slightly more than Schemer and thinned that step, so Cautious
  noise went to 38% (and to 55% with #2283's plausible mistakes).
- Before #2234 Daring's moon trigger cost it games (field +1.5pp over
  Schemer; the human won 23.9% at its table). The new trigger (`moonHand.ts`)
  attempts rarely from the opening hand and commits once Daring holds every
  point taken and at least 13 of them. Moons completed rose from 0.77% to
  ~1.4% of Daring's hands. (`moon_attempt` now also counts hands where
  Daring commits mid-hand, so its attempt and paired-success rates — 14.4%
  and 10.3% after, 9.2% and 7.2% before — measure different populations and
  aren't directly comparable.)
- #2235 made moon defense shooter-aware: a point card is scored by where
  the trick's points will land — on the would-be shooter (feeding the moon)
  or on someone else (breaking it) — using who still has to play, the cards
  already in the trick, pass memory and known voids; the threat is graded
  from 2 points instead of switching on at 4. Against a Schemer field,
  Daring's paired moon success fell from 10.1% to 5.3% (moons per hand
  1.47% → 0.76%).
- #2236 added engine-level tactics (`rateTactics`), validated one at a time
  head to head (a seat with the tactic against the same seat without it,
  same cards, Schemer field): duck high (play the highest card that already
  loses — #1500's rule) +30.5pp win share with its moon guard; forced/free
  win with the highest card +4.1pp; low-spade flush leads +3.0pp. Keeping
  low "exit" cards for the endgame cost 1.2-2.2pp in every variant and was
  left out. Duck-high stands aside while a lone opponent holds every
  point taken, and at least 2 of them: unguarded, defenders shed their
  stoppers and Daring's moon success rose from 5% to 21%. At the
  all-Daring table paired moon success is now 9.2%.
- 35% of Daring's Q♠ dumps land on the human (Schemer: 33%). Passes that
  could void a suit do so 23% (Cautious), 69% (Schemer), 84% (Daring) of
  the time.

**Relation to #2204.** The v2 gate keeps #2204's HRT-1 fix: `moon_success`
is the paired rate (completions in attempted hands ÷ attempted hands, never
÷ a narrower trigger count), pinned by `tooling/hearts/__tests__/metrics.test.ts`.
HRT-3 corrected the old Cautious-vs-Schemer check to "the human does better
against Schemers" — true only because the ladder was inverted. #2555 fixed
the ladder, so the gate now pre-registers the opposite direction (the human
does better against Cautious players), pinned by `gate.test.ts`. The old six
fixed-N batches and their ✓/✗ threshold checks are retired; `--count` keeps
#2204's meaning (games per matchup), and `--log-games` is
unchanged.

### Hearts AI regret metric — points lost vs a perfect-information reference (#2239)

Win share mixes a persona's own play with its opponents'. The regret metric
grades each card play instead, like chess's average centipawn loss: how many
points worse the chosen card was than the best card, by a reference that
sees all four hands. The AI only ever sees its own hand; the harness deals
every hand, so it can grade a decision afterwards without giving the AI
anything it didn't have.

- **Reference (`tooling/hearts/oracle.ts`).** For each graded play, every legal card is
  tried on the true state and the hand is finished by a perfect-information
  rollout for all four seats. The rollout is greedy and moon-aware: a lone
  point-holder with 10+ points plays the moon out and the others try to take
  a point off it. Each card's value is the average of 16 rollouts, one greedy
  and 15 with ε = 0.2 random plays. Every card sees the same random streams,
  and the seed comes from the cards in play, so results are repeatable.
  - A card's cost is the acting seat's moon-adjusted hand score minus the
    table mean. Without a moon, that is its own points − 6.5, so regret is in
    plain points: Q♠ is 13, a heart 1. A moon counts −19.5 for the shooter
    and +6.5 for everyone else.
  - `oracle.ts` imports only the engine's rules, never `ai.ts`,
    `aiConsiderations.ts` or `aiWeights.ts`, so it shares no heuristic or bug
    with what it grades. A test pins this.
- **Is it stronger than the AI?** A player that cheats with this reference
  (`oraclePolicy`) wins 73% of games against a Schemer field, against
  Daring's 34% on the same cards. A single greedy rollout managed only 49%,
  and 8 rollouts at ε = 0.15 72.5%.
- **What regret includes.** It is measured against a player that can see
  every hand, so its absolute level (~10 points per hand) is mostly the value
  of hidden information. Read the differences between personas on the same
  cards, not the level. Each value is a sampled rollout average, so a single
  decision's regret is an estimate; the report averages tens of thousands.
- **Blunder bands** (`DEFAULT_REGRET_BANDS`, adjustable):

  | Band      | Regret (points) | Roughly                   |
  | --------- | --------------- | ------------------------- |
  | `optimal` | `0`             | the reference's best card |
  | `minor`   | `0 < r < 3`     | a stray heart or two      |
  | `mistake` | `3 <= r < 10`   | several hearts            |
  | `blunder` | `r >= 10`       | Q♠-sized, or a moon       |

- **Noise split.** ai.ts's noise is one `rng() < NOISE_RATE` draw per play.
  `tooling/hearts/regret.ts` tags each graded play as noise or deliberate from that
  draw, passing the RNG through unchanged; a test pins that grading and
  tagging leave every game identical.

**Run it.** It is a report, not a gate, and always exits 0:

```bash
npx --prefix frontend tsx tools/sim/simulate-hearts.ts --regret                                  # 100 blocks, every play graded
npx --prefix frontend tsx tools/sim/simulate-hearts.ts --regret --blocks 40 --sample-every 4     # quicker
npx --prefix frontend tsx tools/sim/simulate-hearts.ts --regret --oracle-player                  # also run the cheating reference player
npx --prefix frontend tsx tools/sim/simulate-hearts.ts --regret --pimc 16                        # also grade the PIMC engine (#2587), 16 deals a move
```

Each persona takes the test seat against a Schemer field on the same deals,
so per-block differences are paired as in the gate.

- **Cost:** grading takes ~3.5 ms per play. 100 blocks grade ~130,000 plays
  (~7.5 min), or ~10 min with `--oracle-player`, which runs the reference for
  its own plays too.
- **Sampling:** `--sample-every K` grades about one play in K, picked
  pseudo-randomly per play so a K that divides 13 can't lock onto one trick
  of every hand, and scales points lost back up by K.

Unit tests: `tooling/hearts/__tests__/oracle.test.ts` covers a known four-hand endgame
where the reference must find the 13-point difference, rollout rules, hand
cost and bands. `regret.test.ts` covers the tallies, the noise split, win
share reported independently of regret, and the ladder check.

**What it measured (2026-09-24, seed 2238, 100 blocks, every play graded — with the old uniform-random noise, before #2283):**

| Persona         | Points lost / 100 hands | Per noise play | Per deliberate play | Blunders | Win share |
| --------------- | ----------------------- | -------------- | ------------------- | -------- | --------- |
| Cautious        | 1,095                   | 1.33           | 0.636               | 1.5%     | 10.7%     |
| Schemer         | 966                     | 1.30           | 0.696               | 1.2%     | 24.8%     |
| Daring          | 1,010                   | —              | 0.777               | 1.3%     | 33.8%     |
| Oracle (cheats) | 0                       | —              | 0                   | 0%       | 73.0%     |

- **The noise ladder holds.** On noise plays alone, Cautious loses 384 more
  points per 100 hands than Schemer [359, 410], and Schemer 131 more than
  Daring [120, 142].
- **Noise varies in how often it fires, not in how bad each mistake is.** A
  noise play costs ~1.3 points for both Cautious and Schemer, because it is a
  uniform random card either way.
- **Win share and regret disagree, as the metric allows.** In total,
  Cautious loses more than Schemer (+131 [90, 171]). But Daring loses _more_
  than Schemer (+55 [14, 95]) while winning 34% of games to Schemer's 25%.
  Daring's deliberate plays are the least reference-like of the three
  (0.777 points per play). Its moon attempts and aggressive dumps cost
  expected hand points, and they pay off in games won. Cautious's deliberate
  play is actually the closest to the reference; its weakness is almost all
  noise.

**After #2283's plausible mistakes** (same run settings; Cautious 55%,
Schemer 19%):

| Persona  | Points lost / 100 hands | Per noise play (blunders) | Per deliberate play | Win share |
| -------- | ----------------------- | ------------------------- | ------------------- | --------- |
| Cautious | 1,099                   | 1.28 (2.5%)               | 0.524               | 15.3%     |
| Schemer  | 999                     | 1.20 (2.2%)               | 0.693               | 23.8%     |
| Daring   | 1,018                   | —                         | 0.783               | 33.3%     |

The noise ladder still holds on noise plays: Cautious − Schemer is +476
[450, 503] and Schemer − Daring +232 [217, 246]. Each mistake is cheaper and
less often a blunder; the personas simply make more of them.

### Star Swarm Buddy balance simulation (#2880)

This is a seeded, headless harness over the real Star Swarm engine. An autoplayed player,
invincible or not, fights while Buddy is launched through the real power-up path. The harness
reports, per difficulty × wave type:

- Buddy's destruction rate and killers, and its HP;
- the shots it draws, and whether they hit;
- its damage and kill share, and its per-sortie kills and share of the fleet;
- the Carrier's time-to-kill, with and without Buddy, on the same seeds.

It lives in `frontend/tooling/starswarm/`, and its CLI is `tools/sim/simulate-starswarm.ts`. A
fast smoke preset runs with the normal jest suite. The full runs use the CLI
(`npx --prefix frontend tsx tools/sim/simulate-starswarm.ts --preset baseline --jobs 4`). How to run it, shard it and
override tuning in the sim only:
[starswarm.md → Balance simulation](games/starswarm.md#balance-simulation-2880).

### Hearts: conservative CPU rulebook suite (#3160)

`frontend/src/game/hearts/__tests__/conservative.rulebook.test.ts` (loader and state builder in
`__tests__/helpers/rulebook.ts`) is the executable form of the `yaml` positions in
[`hearts/CONSERVATIVE_AI.md` §5](hearts/CONSERVATIVE_AI.md#5-rulebook). The doc is read at test
time, so adding a position means adding a block there; nothing is transcribed into test code. The suite
fails if any fence in §5 is not a closed plain `yaml` block, if the number of blocks differs from the
number of `id:` lines, if a block cannot be parsed (unknown or missing fields, bad cards, duplicate keys,
including inside `{...}` mappings), if ids repeat, or if fewer than 42 positions load. Per position it
re-derives the history (points, flags, leaders, hand size, duplicate cards, trick 1 opening with 2C,
follow-suit), checks the expected cards are in the hand and legal under `getValidPlays`, then runs the
shipped path (`selectCardToPlay` / `selectCardsToPass` with `"conservative"`, no RNG pinning, no mocks)
for the card, `choosePlay` / `choosePass` for the principle ID, five hand orders (ascending, descending,
three seeded shuffles) and the position rotated to each of the four seats. It runs in the normal
`frontend` jest job (`**/__tests__/**/*.test.ts`). The YAML is parsed by a small strict parser because no YAML library is
a declared dependency.

## Manual repros

### Hearts: tab-switch state preservation (#745)

Verifies that `scoreHistory` and full game state survive a top-tab switch
(which unmounts the Lobby HomeStack).

1. Start a Hearts game; play through at least 2 hands so `cumulativeScores`
   are non-zero and the round table has 2+ rows.
2. Mid-game, tap the **Profile** or **Settings** bottom-tab.
3. Tap **Lobby** to return; resume Hearts.
4. Open the ⋯ menu → **Scorecard**. Expected:
   - Round table shows the same number of rows as before the switch.
   - Each row sums to 26 (or `[0,26,26,26]` for moon shots).
   - Totals row equals the sum of every round row, per player.
5. Continue play. **Game Over must not fire spuriously** on re-entry —
   it should only trigger when a player legitimately reaches ≥ 100.

### Hearts: Sentry integrity validators (#745)

Verifies the validators emit warnings when state is impossible. Run with
the Sentry dashboard open and filtered to `subsystem:hearts.integrity`.

1. From a dev build, manually corrupt `AsyncStorage["hearts_game"]` so
   `cumulativeScores[1]` exceeds the sum of `scoreHistory[*][1]` (e.g. via
   React Native Debugger). Re-mount the Hearts screen.
2. Confirm a warning event appears in Sentry tagged
   `subsystem=hearts.integrity, check=totals_vs_rounds_mismatch`.
3. Repeat-mount the screen with the same payload. Confirm Sentry receives
   **at most one** event per check per mount (per-mount dedupe).

### Hearts: hearts-broken sound + animation (#774)

Verifies the crack sound and burst animation fire exactly once when hearts break.

1. Start a Hearts game. Pass phase may occur first — complete it.
2. Play non-heart cards until someone is void in the led suit and must discard a heart.
   (Alternatively: reach trick 2+ where hearts can be led if broken, then lead a heart.)
3. The moment the **first** heart is played into any trick:
   - Confirm the crack sound plays once (audible pop/crack).
   - Confirm a red ♥ icon springs up at the trick center, cracks radiate outward, and a red tint flashes on the trick area.
   - Confirm the icon lingers at reduced opacity (~3 s total), then fades out over 0.5 s.
   - Confirm play is **not blocked** — other cards remain tappable while the animation runs.
4. Play a second heart into a subsequent trick. Confirm the animation and sound do **not** fire again.
5. **Reduced-motion fallback:** Enable Reduce Motion in device accessibility settings, repeat steps 2–3.
   Confirm only an instant red tint flash (~0.3 s) occurs, no spring or crack-line motion.

### Hearts: shoot-the-moon sound + animation (#773)

Verifies the fanfare sound and full-screen moon overlay fire exactly once when someone shoots the moon.

1. Start a Hearts game and engineer a moon shot (one player takes all 13 hearts and Q♠). The easiest way in a local dev build is to seed the engine state via the console so that one AI player holds all 26 point cards after trick 13.
2. Once all 13 tricks resolve, confirm:
   - A triumphant fanfare (hearts-moon-shot.mp3) plays once.
   - A dark semi-transparent full-screen overlay appears with a 🌙 moon icon spring-scaling from 0 → 1.
   - Six ★ stars stagger in around the moon (each 120 ms apart).
   - The shooter label appears below the moon (e.g. "You shot the moon!" or "{Name} shot the moon!").
   - The overlay auto-dismisses after ~2.2 s. Play is **not blocked** — the hand-end modal (or game-over modal) appears after the animation.
3. Re-mount the Hearts screen mid-game (e.g. navigate away and back). Confirm the moon shot animation does **not** replay on re-render.
4. **Mute toggle:** Enable the global mute, trigger a moon shot. Confirm the animation still shows but the sound is suppressed.
5. **Reduced-motion fallback:** Enable Reduce Motion in device accessibility settings, trigger a moon shot. Confirm the moon icon and stars appear instantly (no spring motion) and the label is visible immediately; overlay still auto-dismisses after 2.2 s.

### Hearts: Queen of Spades sound + animation (#775)

Verifies the dark sting sound and card animation fire exactly once when the Queen of Spades is taken.

1. Start a Hearts game and play until a trick containing Q♠ is resolved.
2. The moment the trick resolves (four cards played):
   - Confirm a dark ominous sting (hearts-queen-of-spades.mp3) plays once.
   - Confirm a Q♠ card (white card face with "Q" and "♠") springs up at scale 0 → 1.4×.
   - Confirm the card executes 4 left-right shake iterations (translateX ±8 px).
   - Confirm the card fades to opacity 0 after the shakes.
   - Confirm a full-screen red flash overlay (rgba(220,38,38,0.25)) fades in and out over the ~1.0 s duration.
   - Confirm the taker's label is correctly identified (check the player who took the trick).
3. Confirm play is **not blocked** — the animation runs in parallel with normal game flow.
4. **Reduced-motion fallback:** Enable Reduce Motion in device accessibility settings, trigger a Q♠ trick. Confirm only a red flash (~0.8 s) occurs, no zoom or shake.

### Star Swarm: ship hidden on Game Over freeze frame (#2334)

Verifies the player ship (and any shield/lightning overlay) disappears the instant the
game freezes on death, instead of the frozen frame looking like the ship is still flying
and firing. `engine.ts` clears `playerBullets` on the GameOver transition (unit-tested);
this repro covers the render-only half in `GameCanvas.tsx`, which this repo does not unit
test (see "What's Tested" note above — no React/canvas coverage).

1. Start a Star Swarm run and take the last hit while enemy bullets or diving enemies are
   still on screen (any wave). Bonus: collect Lightning first so bullets are in flight at
   the moment of death, matching the original report.
2. The instant "GAME OVER" appears:
   - Confirm the player ship sprite is **not** visible anywhere on the frozen frame.
   - Confirm no stray player bullet is rendered floating near where the ship was.
   - Confirm the shield ring / lightning tint overlay (if a power-up was active) also
     disappears along with the ship.
   - The rest of the frame (enemies, enemy bullets, starfield) still freezes as expected —
     only the player's own ship/bullets should be gone.

### Star Swarm: tuning with the run-stats dev panel (#2491)

The question the panel answers is "does the collision rate match the enemy's skill?" — the
per-tier dodge odds are configuration; the panel shows what actually happened next to them. Dev
builds and internal pre-launch builds only (the `DEV` button in the corner of the canvas). The
panel (`components/starswarm/StarSwarmDevPanel.tsx`) is behind `DEV_TOOLS` in
`StarSwarmScreen.tsx`, which is `__DEV__` or a build against the pre-launch API (#2567, as Hearts
does), so store builds never show it.

1. Start a run at the difficulty you are tuning (the _Difficulty_ section applies on New Game).
2. Open the panel. Under _Run stats_ the tier table has one row per tier:
   `base` (configured dodge chance), `eff` (base × difficulty, capped at 97%), `rolls`, `dodge`,
   `rate` (dodged ÷ rolls), `struck` (rocks that hit a ship of that tier) and `flak` (shots fired
   at rocks). Below it are the run counters: reinforcements launched, armor deflections, beam hits
   on the player, rocks spawned and rocks broken by each side.
3. To get a sample quickly, press _Throw asteroid_ repeatedly (two rocks on screen at most) instead
   of waiting for timed spawns. `rate` should converge on `eff` for each tier; if it doesn't, the
   threat check or the path nudge is not giving that tier its roll.
4. _Dodge off_ removes every roll so `struck` becomes the no-skill baseline for comparison;
   _Flak off_ removes the enemy's other defence so only dodging is in play. _Enemy missiles off_
   silences flak too (it is an enemy bullet), so leave it on when measuring flak.
5. _Kill escorts_ destroys every non-Carrier ship at once, which is the fastest way to reach the
   Carrier's final stand (#2843: fast twin lasers, beams and attack runs) and the plating drop.
6. The panel refreshes 4× a second from a timer; the game keeps running underneath, so pause
   (header button) when you want a still reading.

The same numbers reach Sentry as one `starswarm.run_stats` breadcrumb per finished run (counts,
wave, difficulty, score) — look at the breadcrumbs on any Star Swarm event to compare real play
against the panel. Unit coverage: `engine.stats.test.ts` ("Run stats (#2491)") and `telemetry.test.ts`.

### Star Swarm: reading the "Frame" readout (#2567)

The readout answers "is the canvas keeping up, and is React out of the frame loop?". Turn on
_Frame readout_ in the dev panel, then close the panel. A green line appears along the bottom
edge of the game:

```
16.7 ms avg · 18.2 p95 · 60 f · 0 commits/s
```

- **`ms avg` and `p95`** are the mean and 95th-percentile interval between the game loop's
  frames over the last second. At 60 Hz a healthy loop reads about 16.7 for both. A p95 well
  above the average means occasional long frames (jank) even when the average looks fine. At
  120 Hz the target is about 8.3.
- **`f`** is the number of frames in that second: the frame rate the loop actually got.
- **`commits/s`** is how many times React re-rendered the game canvas in that second. It should
  be 0 while paused and only a few per second in play (score, wave and banner changes). The
  removed legacy renderer re-rendered once per frame, so this read about the frame rate.

Read it with the panel closed. The panel's own 4 Hz run-stats refresh re-renders the screen and
the canvas with it, which adds 4 commits/s. The readout polls on its own timer and re-renders only
itself, so it does not disturb what it measures.

It measures the JavaScript thread, where the game loop runs. A slow UI thread (drawing the
Picture) shows up as a lower `f` only when it holds up the loop's next frame. React Native's Perf
Monitor (dev menu) shows the UI thread's frame rate separately in dev builds.

Take real numbers from a release build (TestFlight or a Play test build against the pre-launch
API). Dev builds run React in development mode and are much slower. The same summary is on the
`__starswarm_getRunStats()` test hook as `frame` in E2E builds. The protocol and results table
are in [`PERFORMANCE.md`](PERFORMANCE.md#star-swarm-native-renderer-2567). Unit coverage:
`frameStats.test.ts` and `FrameStatsReadout.test.tsx`.

---

## E2E Test Conventions

Guidelines for writing Playwright specs in `e2e/tests/`. These rules exist because each item below caused a real flaky-run incident.

### 1. Storage key versioning

When a game's `localStorage` key changes (e.g. `blackjack_game_v1` → `v2`), search `e2e/` for the old key and update **all** references atomically in the same PR. Partial updates leave some specs clearing the wrong key, leaking state between tests.

```bash
grep -r "blackjack_game_v" e2e/
```

### 2. `data-testid` for i18n-coupled labels

Any element whose accessible label comes from a translation string must also carry a `testID` prop so specs can target it without coupling to translated copy. Elements that currently need this:

- Deal button (`/deal cards with/i`)
- Clear Bet button
- 2048 overlay New Game button
- Cascade Play Again button

### 3. No branching on `isVisible()` without a prior settled wait

Never call `isVisible()` in an `if` branch unless the immediately preceding `await` is `expect(...).toBeVisible()` or `locator.waitFor()` on the **same** locator with no intervening awaits. The snapshot can go stale between the wait and the branch check.

```typescript
// Bad — race window between toBeVisible() and isVisible()
await expect(page.getByText("Hit").or(page.getByText("Next Hand"))).toBeVisible();
const hitVisible = await page.getByText("Hit").isVisible(); // stale snapshot

// Good — isVisible() is inside the same await chain
const hitOrResult = page.getByText("Hit").or(page.getByText("Next Hand"));
await expect(hitOrResult).toBeVisible({ timeout: 5000 });
if (await page.getByText("Hit").isVisible()) { ... }
```

### 4. No `waitForTimeout`

Replace all hard sleeps with assertion-driven waits. Hard sleeps add wall time on fast runners and silently under-budget on slow ones.

```typescript
// Bad
await page.waitForTimeout(2000);
await expect(page.getByText("Score")).toBeVisible();

// Good
await expect(page.getByText("Score")).toBeVisible({ timeout: 8000 });
```

### 5. Non-deterministic outcomes

Tests that exercise live RNG must use the `.or()` pattern for assertions rather than asserting a specific outcome. Tests that need deterministic assertions must use `injectEngineState()` to pre-seed the engine state.

```typescript
// Live RNG — assert either outcome
await expect(
  page.getByText("Hit").or(page.getByText("Next Hand")),
).toBeVisible();

// Deterministic — inject known state
await injectEngineState(page, playerPhaseState());
await expect(page.getByText("Hit")).toBeVisible();
```
