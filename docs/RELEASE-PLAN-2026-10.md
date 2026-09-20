# BC Arcade — Store Submission Game Plan (target: submit by Oct 15, 2026)

## Context

BC Arcade v1.0.9 (build 10009) has never been submitted to either store. Epic #1916 (first-submission readiness) and epic #821 (productionization) track the gaps. The goal: **submit to both the Apple App Store and Google Play by Oct 15**, working day-by-day from Sep 18 with two machines (1 Mac, 1 PC) available every day.

### Decisions made (with the user, 2026-09-17)

1. **Premium games are hidden entirely in v1.0** — not shown locked, not free. The 6 premium games (yacht, cascade, hearts, sudoku, starswarm, sort) disappear from the store build; the 6 free games ship (blackjack, solitaire, freecell, mahjong, daily word, twenty48). IAP comes post-launch (epic #822). This resolves blocker #1917 without building IAP and without ever releasing premium content free.
2. **Guideline 4.2 mitigation = XP + daily challenge** (#1914 Tier 1 minus Game Center): server-side Arcade XP/player level, one daily cross-game challenge over free games, home-screen progression, strong reviewer notes.
3. **Store accounts + app records already exist** in App Store Connect and Play Console; app has been on internal/closed testing before. No Play 14-day cold-start blocker assumed (verify Day 1).
4. **Quality bar for launch = crash/stability fixes only.** i18n gaps, a11y backlog, and CI hardening are explicitly deferred post-launch (except where a hidden game makes the issue moot).

### Current ground truth (verified in code, 2026-09-17)

- ✅ Already fixed: iOS mic usage description (#1919), Android RECORD_AUDIO/SYSTEM_ALERT_WINDOW (#1920), iOS Privacy Manifest declares Sentry crash/perf/diagnostics (#1921), data deletion (#1923). Sentry integrated both sides, `sendDefaultPii: false`.
- ❌ **#1918/#2277 keystore password still committed** in `frontend/android/gradle.properties` (lines 72 + 74), file tracked in git, not gitignored. Findings Sep 18: **this repo is public**, so the value is permanently burned; the keystore *file* was never committed on any branch (password is useless without it), so a password change suffices — no Play upload-key reset needed unless the file has ever left the owner's machines. Keystore is PKCS12 (one password covers store + key), alias `upload`. No workflow reads any `ANDROID_*` secret — release signing is local-only; CI's release smoke uses a throwaway debug key. Seven secrets exist: `ANDROID_UPLOAD_*` ×3 (to be refreshed) and a legacy unused `ANDROID_KEYSTORE_*`/`ANDROID_KEY_*` ×4 (delete after rotation). History will **not** be scrubbed (would require force-pushing protected branches; rotation makes the old value worthless).
- ❌ **No privacy/terms links** in `frontend/src/screens/SettingsScreen.tsx`; no Privacy Policy or ToS hosted anywhere (#828, #1922).
- ❌ **No IAP code** anywhere (moot — premium games hidden).
- ❌ Locked-game UI live: `LockedGameScreen.tsx`, `makePremiumScreen()` in `frontend/App.tsx` (~130–154), premium set in `frontend/src/entitlements/EntitlementContext.tsx` (~line 25).
- ✅ **Version discrepancy — fixed Sep 19 (#2412)**: iOS `Info.plist` hardcoded 1.0.0 / build 1 while app.json, Android and the pbxproj were at 1.0.9 / 10009 (`version-sync.yml` never patched the plist). The plist now references `$(MARKETING_VERSION)` / `$(CURRENT_PROJECT_VERSION)` — **never hand-edit a version into it**; see `docs/IOS.md` §Version numbers. Side effects of the first post-merge Xcode Cloud build: it uploads as **1.0.9**, opening a new ASC/TestFlight version train (earlier uploads were 1.0.0 — rename the ASC "Prepare for Submission" version to match when it's needed), and the Sentry iOS release id moves from `…@1.0.0+N` to `…@1.0.9+N`.
- ⚠️ No prod environment: backend runs at dev-games-api.buffingchi.com only (#505).
- ❌ **`deploy.yml` is invalid at the workflow-file level** (found Sep 18): fails on every push to every branch, no successful run in its last 100. It calls `wcmchenry3-stack/gaming_app/.github/workflows/ci.yml@main` — apparently the repo's pre-rename name. Doesn't block PRs (push-event run, not a check) but **will block the Sep 28 prod deploy** — fix as part of #505.
- CI: `ci.yml` green on dev; iOS mobile smoke red since June (#2347) — deferred, manual TestFlight verification instead.
- ⚠️ **Correction (2026-09-18): Android Maestro smoke was never actually green.** Every "success" in `mobile-smoke-android.yml`'s history (including Sep 11) is the Maestro job being *skipped* because `detect-maestro-scope` found nothing relevant; every run where it really executed (~30, June → Aug 30, across `main` + 5 branches) failed or was cancelled — cold-launch ANR on the CI emulator plus an unbounded "Wait"-dismiss loop in `_shared/launch.yaml`. **Maestro is descoped from the launch on both platforms**: Android leg taken off `pull_request` (on-demand `workflow_dispatch` only), restoration tracked in #2400. Verification below relies on Jest + manual checks on real release builds instead.
- Open PRs (end of Sep 18): #2332 (release-please 1.1.0 — **hold until the Oct 6 version decision**). #2374 and all Dependabot PRs merged; dev is at expo 57.0.23 / RN 0.86.3 / reanimated 4.5.5 / gesture-handler 3.3.0 / screens 4.28.0 / skia 2.11.2 / sentry-rn 8.26.0.

### Launch-gating issues (must close before submission)

| # | Issue | Notes |
|---|---|---|
| 1917 | Locked games blocker | Resolved via hide-premium — implementation issue #2390 |
| 1918/2277 | Keystore rotation + secret removal | PC + Play Console; Fri 19 — procedure in the schedule row below |
| 1914 | 4.2 cohesion | XP (#2391) + daily challenge (#2392) |
| 828 | Privacy Policy + ToS hosted at stable URLs | buffingchi.com/privacy, /terms |
| 1922 | Privacy/ToS links in Settings | Small; i18n'd link text |
| 505 | Prod Render environment | games-api.buffingchi.com; pin to main. **Includes repairing `deploy.yml`** (stale `gaming_app` reusable-workflow reference — never succeeds today) |
| 823 | App Store Connect listing (metadata, screenshots, age rating) | Mac; screenshots after hide-premium lands |
| 825 | Play Console listing (assets, content rating, Data Safety) | PC |
| 2014 | Play Data Safety form (Sentry) | Manual, minutes |
| 830 | TestFlight internal track | Mac |
| 832 | Play testing tracks | PC |
| 836 | ATT/IDFA audit doc | Likely "no ATT needed" — document it |
| ~~2328~~ | iOS MessageQueue runtime error | ✅ Sep 18 — did not reproduce on a clean Metro cache + fresh native build (stale dev-client binary after the SDK 57/RN 0.86 bumps); recovery recipe in `docs/IOS.md` (#2404) |
| ~~2380~~ | Android offline errors spamming Sentry | ✅ Sep 18 — #2402 (CodedError classified as network in `httpClient.ts`) |
| 2403 | Offline retries/fallbacks ignore Android `CodedError` | **Candidate — decide after a device check.** Found reviewing #2402: `withRetry.ts` never retries and `DailyWordScreen.tsx` never falls back to its cached puzzle when an Android offline failure arrives as `CodedError` instead of `TypeError` (3 more sites are premium/cosmetic). Both affect shipping free games. Test: Android build → airplane mode → open Daily Word. If the cached puzzle doesn't load, this gates launch (~1 hr: export `isNetworkError()` from `httpClient.ts`, use at all 5 sites) and goes ahead of hide-premium. |
| ~~2372/2374~~ | Hearts Android crash | ✅ Sep 18 — #2374 merged (game hidden but code ships) |
| ~~—~~ | iOS version string mismatch (1.0.0 vs 1.0.9) | ✅ Sep 19 — #2412 (Info.plist derives from the pbxproj build settings; Jest guard `nativeVersionSync.test.ts`). Confirm 1.0.9 on the next Xcode Cloud build |
| 851 | Sentry envs/prod DSN/release tag | Needed so prod crashes are visible at launch |
| 857 | Versioning + forced-upgrade kill-switch | Descope to: pick launch version + document; kill-switch post-launch |

### Explicitly deferred post-launch

Maestro as a PR gate on either platform (#2400 Android, #2347 iOS — see the 2026-09-18 correction above), IAP (#822, #837–#842), Hearts/Yacht AI epics (#2283 etc. — games hidden), i18n gaps (#2193–#2195, #2212 — free-game locales OK-ish; verify Daily Word #1924 lightly), a11y backlog (#2192, #2219, #2207–#2209, #854), CI hardening (#2347 iOS smoke, #2211 TS check, #2153), Percy epic, analytics epic (#1800), audio epic (#1779), drag polish (#2274), account deletion beyond what exists (#835 blocked by SSO #144), leaderboard/security mediums (#2215–#2217, #2210 — NOTE: #2210 rate-limit on /games/catalog is a small fix, pull into launch if trivial), all `chore`/`tech-debt` spikes.

## Feature designs (from code investigation)

### A. Hide premium games (~1.5–2 dev-days)

**Mechanism: compiled TS constant, NOT an env var and NOT server-driven.** Two reasons: (1) Apple 2.3.1 — the reviewed binary must equal what users get; a server flag that unhides content post-review is itself a rejection pattern; (2) **`frontend/ios/ci_scripts/ci_post_clone.sh` deletes `.env.production` and force-writes a 2-line `.env` on every Xcode Cloud build** — any new `EXPO_PUBLIC_*` var silently disappears, which could ship premium games to App Review by accident.

- New file `frontend/src/entitlements/gameVisibility.ts`: `HIDDEN_GAMES` set (the 6 premium slugs), `SHOW_HIDDEN_GAMES = __DEV__ || process.env.EXPO_PUBLIC_TEST_HOOKS === "1"` (reuses the existing test-build signal already set by the Maestro/Playwright test builds and used in `httpClient.ts`/`syncApi.ts`), `isGameVisible(slug)`. Keep visibility decoupled from `PREMIUM_GAMES` in `EntitlementContext.tsx` (unchanged — IAP re-activates it later).
- `frontend/src/screens/HomeScreen.tsx`: the 12-game array is a hardcoded literal (backend catalog is never fetched — leave it that way); rename to `ALL_GAMES` and filter through `isGameVisible`.
- `frontend/App.tsx`: conditionally register hidden games' screens in `LobbyStack()`; keep `makePremiumScreen()`/`LockedGameScreen` (still correct for dev/test builds). **Also hide the "Ranks" tab in `MainTabs()`** — `LeaderboardScreen.tsx` is StarSwarm-only, a dead tab once StarSwarm is hidden.
- Backend: **no change** (leave `is_active`/`is_premium` rows alone; `is_active=False` would break `POST /games` for internal testing).
- Maestro: **no work** (descoped 2026-09-18). Existing premium-game flows are unaffected because test builds set `EXPO_PUBLIC_TEST_HOOKS=1`; the `navigation.yaml` switch, the `home/hidden-games.yaml` negative flow, and the no-test-hooks CI job are dropped.
- Jest (now the only automated guard): verify `HomeScreen.test.tsx` behavior under Jest's `__DEV__`; add hidden-games describe block (copy the existing "Pachisi disabled" pattern) + `gameVisibility.test.ts`, which must assert all 6 premium slugs are hidden with `__DEV__ === false` and `EXPO_PUBLIC_TEST_HOOKS` unset.
- Manual guard: the Mon 22 TestFlight and Tue 23 Play internal builds are the real negative test — exactly 6 tiles, 3 tabs, no locked screen reachable.
- Screenshots for stores must come from a no-test-hooks release build (correct 6-tile grid).

### B. Arcade XP + player level (~2 dev-days)

Pure derivation from the existing `games` table — no new table, no migration.
- New `backend/games/progression.py`: pure `compute_progression(summary: StatsSummary)` — base XP per completed game + variety bonus per distinct game played (breadth supports the anti-container narrative), `LEVEL_THRESHOLDS` array marked "tune post-launch". Unit tests with hand-built fixtures (`backend/tests/test_progression.py`).
- Extend `StatsResponse` in `backend/games/schemas.py` (`arcade_xp`, `arcade_level`, `xp_into_level`, `xp_for_next_level`); ~5-line change in `backend/stats/router.py::get_my_stats()`.
- Frontend: extend `StatsResponse` in `frontend/src/api/types.ts`; level header + progress bar on `ProfileScreen.tsx` (reuse bento styles); level pill on `HomeScreen.tsx` header via `statsApi.getMyStats()` + `withRetry` (omit badge on failure, never block the grid). i18n keys in `profile`/`common`.

### C. Daily cross-game challenge (~2.5–3 dev-days)

Clone the Daily Word stateless pattern — no new tables; completion is a read-side view over data already written by `PATCH /games/{id}/complete`.
- New `backend/daily_challenge/` package (mirrors `daily_word/`): `definitions.py` — deterministic template pick by `(YYYYMMDD + DAILY_CHALLENGE_SALT) % len(TEMPLATES)`; templates span free games only. **Only twenty48 gets `score_at_least` goals** (it's the only visible free game with comparable `final_score` — per migration 0003 comment); all others use binary "complete".
- `service.py`: one query over `games` join `game_types` for today's local-day window (client `tz_offset_minutes`, same as Daily Word); evaluate goals in Python.
- `router.py`: `GET /daily-challenge/today` (public, 60/min) + `GET /daily-challenge/status` (session-scoped via `get_session_id`, 60/min), mounted in `main.py`. Rate limits satisfy hard rule #12.
- Frontend: `frontend/src/game/daily_challenge/api.ts` (`createGameClient` pattern); `DailyChallengeCard.tsx` at top of Home ScrollView — goal chips with checkmarks, refetch on AppState foreground + network reconnect (`useNetwork()`); offline = lightweight "check connection" state, offline completions retroactively count when `scoreQueue` flushes. New `daily_challenge` i18n namespace.
- Tests: backend determinism + completion-detection; `DailyChallengeCard.test.tsx`; manual end-to-end play-through on sim/device (no Maestro flow — descoped 2026-09-18).

**Top design risks:** (1) env-var regression re-introducing the Xcode Cloud clobber gap — call out in PR; (2) with Maestro descoped there is no automated check of a no-test-hooks build — the Mon 22 / Tue 23 release-build checks are mandatory, not optional; (3) don't bikeshed XP constants pre-launch; (4) richer challenge goals are out of scope; (5) verify Jest `__DEV__` assumption empirically.

## Day-by-day schedule (Sep 18 → Oct 15)

Both machines available daily. Mac = Xcode Cloud/TestFlight/iOS sim/ASC; PC = Gradle/Play Console/backend + most feature dev. Feature code (frontend/backend) is machine-agnostic — the split below assigns it wherever the day's platform work already is. All work branches from `dev`, lands via draft PRs per the git standard.

### Week 1 — clear the decks + hide premium (Sep 18–24)
| Day | PC | Mac |
|---|---|---|
| **Thu 18** ✅ | Done: #2374 merged; #2401 Maestro descope merged; #2380 fixed early (#2402); #2332 decided (hold to Oct 6); implementation issues filed (#2390 hide-premium, #2391 XP, #2392 daily challenge — no separate umbrella, epic #1916 + the gating table above serve that role; gating checklist posted as a task-list comment on #1916); #2400 filed (Maestro restoration, post-launch); #2403 filed (offline `CodedError` follow-up — launch candidate); keystore investigated and Fri 19 procedure worked out (see ground truth). Found: `deploy.yml` broken (see ground truth / #505). Still open: Play Console record + testing-track history check; airplane-mode Daily Word device check for #2403. | Done: Dependabot cleared (#2396 expo 57.0.23, #2395 12-pkg group — each needed a `pod install` Podfile.lock commit pushed onto the Dependabot branch); #2328 closed (#2404). Still open: Xcode Cloud build of current dev + ASC record/agreements check. |
| **Fri 19** | **#1918/#2277 keystore** (owner, ~20 min, no Google round-trip): (1) new letters+digits password into the password manager; (2) `keytool -importkeystore … -deststoretype PKCS12 -srcalias upload` into a fixed location **outside every checkout** — non-destructive, original stays as fallback (replaces the earlier `-storepasswd` idea, which rewrites in place); (3) `keytool -list -v` → compare SHA-1 with Play Console → App integrity → Upload key certificate, and confirm Play App Signing is enrolled; (4) user-level `~/.gradle/gradle.properties` gets `UPLOAD_STORE_FILE` (absolute, forward slashes) + both passwords — overrides the tracked file, so every checkout/worktree signs from one keystore with no `build.gradle` change; (5) `./gradlew :app:signingReport` proves it; (6) delete the old-password original, back up the new file off-machine; (7) refresh the 3 `ANDROID_UPLOAD_*` secrets, delete the 4 legacy ones. **Then Claude's PR**: strip lines 72 + 74 from tracked `gradle.properties`, fix `docs/ANDROID-CI.md` (wrongly says passwords come from env vars), find out why gitleaks never flagged it, verify `assembleDebug` + CI release-smoke, close both issues. Order matters: steps 1–5 before pulling that PR. Carry-over: Play Console record check; #2403 device check. | Fix iOS version string (Info.plist 1.0.0 → match app.json). Carry-over: Xcode Cloud + ASC checks. (#2380 already landed Sep 18.) |
| **Sat 20** | Implement hide-premium (A): `gameVisibility.ts`, HomeScreen filter, App.tsx routes + Ranks tab. | Verify on iOS simulator; check 3-tab layout + 6-tile grid. |
| **Sun 21** | Finish A: Jest updates (`gameVisibility.test.ts`, HomeScreen hidden-games block), docs. Open PR, review, merge. | Start XP (B) backend: `progression.py` + tests. |
| **Mon 22** | XP: schemas/router wiring + backend tests green. | **Cut TestFlight internal build #1** (hide-premium in): confirm premium tiles absent in a real release build. |
| **Tue 23** | XP frontend: types, ProfileScreen level header, Home level pill, i18n. | Upload same rev to **Play internal track**; confirm install on Android device. |
| **Wed 24** | XP PR review + merge. Start daily challenge (C) backend package. | Buffer: any fallout from first builds (Xcode Cloud, signing, Sentry symbols). |

### Week 2 — daily challenge + prod env + legal (Sep 25–Oct 1)
| Day | PC | Mac |
|---|---|---|
| **Thu 25** | C backend: definitions/service/router + rate limits + tests. | C frontend start: `api.ts`, `DailyChallengeCard` skeleton. |
| **Fri 26** | C backend polish; salt env var on Render. | C frontend: card UI, offline state, refetch wiring, i18n. |
| **Sat 27** | C: Jest (`DailyChallengeCard.test.tsx`); PR review + merge. | Manual play-through of challenge completion end-to-end on sim/device. |
| **Sun 28** | **#505 prod Render env**: prod API + DB at games-api.buffingchi.com, pin to main; **#851** Sentry prod DSN/env/release tags; ZAP scan vs prod API (deployment standard). | Draft Privacy Policy + ToS (haiku draft from #828 acceptance criteria; user reviews). |
| **Mon 29** | Host privacy/terms at buffingchi.com; **#1922** Settings links (i18n'd). | Point release config at prod API; verify entitlements/leaderboards/daily endpoints against prod. |
| **Tue 30** | **Play closed-track build #2** (all features, prod API). | **TestFlight build #2** (all features, prod API). |
| **Wed 1** | Device QA Android: all 6 free games, challenge, XP, offline queue. Log bugs. | Device QA iOS: same script + VoiceOver sanity on Home/Settings. |

### Week 3 — listings, screenshots, RC (Oct 2–8)
| Day | PC | Mac |
|---|---|---|
| **Thu 2** | **#825** Play listing: content rating questionnaire, **#2014** Data Safety (Sentry crash/diagnostics), store description. | **#823** ASC listing: metadata, age rating, privacy-policy URL, App Privacy answers (match PrivacyInfo.xcprivacy). |
| **Fri 3** | Android screenshots (release build, no test hooks) — phone + 7"/10" tablet if targeted. | iOS screenshots — 6.7"/6.1" (+ iPad since `supportsTablet: true`). |
| **Sat 4** | Fix QA bugs from Oct 1. | **#836** ATT audit doc (expect "no ATT — no tracking, `NSPrivacyTracking:false`"); draft **reviewer notes** (XP + daily challenge walkthrough, per #1914 Tier 1 item 5). |
| **Sun 5** | Bug fixes continued; Sentry crash-free monitoring on both tracks. | Same; re-test fixed areas. |
| **Mon 6** | Version decision: land release-please 1.1.0 (or bump to it) — one version across app.json/build.gradle/`project.pbxproj` (all patched by `version-sync.yml`; **do not edit Info.plist** — it derives from the pbxproj); release notes. | Verify Xcode Cloud picks up version cleanly. |
| **Tue 7** | **RC builds both platforms**; manual regression script on the RC build (all 6 free games, challenge, XP, offline queue, Settings links). | Same, iOS side. |
| **Wed 8** | Final sweep of #1916 checklist + this plan's gating table; freeze except showstoppers. | TestFlight external/internal sanity pass on RC. |

### Week 4 — submit + buffer (Oct 9–15)
| Day | Action |
|---|---|
| **Thu 9** | **Submit both stores** (6 days of buffer ahead of the deadline): ASC "Submit for Review" with reviewer notes; Play production (or open testing → production per account state) with release notes. |
| **Fri 10 – Wed 15** | Monitor review status + Sentry. If rejected: same-day triage, fix, resubmit — buffer absorbs 1–2 rejection round-trips (most likely: 4.2 narrative or metadata nits). If approved early: staged rollout on Play (10–20%), hold iOS release for manual release if desired. |

## Execution conventions

- **Branches/PRs**: one branch per workstream (`feat/hide-premium-v1`, `feat/arcade-xp`, `feat/daily-challenge`, `fix/…`), draft PRs → dev, user merges. Never push to dev/main.
- **Models**: subagents `haiku` for mechanical work (issue filing, translation/i18n key passes, doc drafts, Maestro flow edits, lint fixes); `sonnet` for code-implementation subagents (justification: code generation beyond haiku); main session (this model) for design, review, and orchestration. No opus subagents.
- **Agent tooling gotchas (PC, Sep 18)**: the project agents in `.claude/agents/` (`plan-issues`, `lint-review`, `policy-compliance`) don't register as agent types — the files lack `name`/`description` YAML frontmatter; use a general-purpose haiku agent with the same brief until fixed. Agent worktree isolation fails on this PC over a path-casing mismatch (`bc-arcade` vs `BC-Arcade`) — create the worktree manually and point the agent at it. Any PR opened before #2401 merged carries a stale Maestro run: cancel it and merge `dev` in.
- **Manual/user-only tasks** (Claude can't do these): Play Console + ASC console actions (keystore upload, Data Safety form, content rating, screenshots upload, submit buttons), DNS/hosting for buffingchi.com legal pages, Apple/Google account agreements.

## Verification

- Hide-premium: release-mode build (no `EXPO_PUBLIC_TEST_HOOKS`) shows exactly 6 tiles, 3 tabs, no locked screens reachable — checked by hand on both the TestFlight and Play internal builds; `gameVisibility.test.ts` green.
- XP/challenge: backend tests green (`python -m pytest tests/ -v`, 80% floor holds); play a game → XP rises on Profile; complete a challenge goal → checkmark on Home; offline completion syncs and retroactively satisfies goal.
- Keystore: fresh clone contains no secrets (`git grep -i password frontend/android`); `:app:signingReport` SHA-1 matches Play Console's upload certificate; release build signs from the user-level `~/.gradle/gradle.properties` (no keystore or password inside any checkout); ZAP scan on prod API returns zero high-severity.
- Store readiness: every row of the launch-gating table above closed or explicitly waived before Oct 8 freeze; crash-free > 99% on both test tracks before submission (#821 success metric).

## Model usage policy for execution

- Sub-agents: `haiku` for mechanical work (lint fixes, translation file passes, doc drafting, issue filing bodies, Maestro flow edits); `sonnet` for code implementation subagents; main session drives design/review.
- Per global cost rule: never opus subagents without justification.
