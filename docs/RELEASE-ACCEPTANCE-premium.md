# Release Acceptance — First Premium Update (evidence template)

Evidence record for issue #2789 "Verify premium-game release readiness" (part of #2777, first premium update, P1). Copy this file per candidate build (or fill it in place and commit the result), mark each row, and link proof (screenshot, recording, log, CI run). It mirrors the v1.0 record ([`RELEASE-ACCEPTANCE-v1.0.md`](RELEASE-ACCEPTANCE-v1.0.md)). Signing, production API target and the IPv6-only check are defined there; run those sections against the premium candidate build instead of repeating them here.

**A release check does not replace unresolved work in linked issues.** File every failing check as a specific bug, link it in the Blockers table, and do not tick a row while its bug is open. Linking an issue here does not declare it unfinished in code, and it does not require every enhancement before release. This document only records which existing issues gate the release; it does not close, edit or replace them.

**This file records no device results.** Every result cell below starts empty (`[ ]`). The dispositions in section 3 are PROPOSED for owner confirmation. Nothing in this document has been tested on a device.

Legend: `[ ]` not run, `[x]` pass, `[!]` fail (link bug), `[n/a]` not applicable.

## 0. Owner decisions already made

| Decision                                                                                                                                | Source                                              | Effect on this record                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The first premium update ships **all five** premium games: Blackjack, Star Swarm, Cascade, Hearts, Mahjong.                             | Owner                                               | Every game gets a full row set in sections 4 and 5.                                                                                                                 |
| Each game is a **per-game one-time purchase** (non-consumable, `com.buffingchi.games.premium.<game_slug>`). No bundle, no subscription. | Owner; `docs/IAP.md` sections 1 and 2               | Access checks run per game, on both stores.                                                                                                                         |
| The owner **accepts the resulting age rating** from Blackjack's simulated gambling.                                                     | Owner; resolves `docs/IAP.md` section 17 question 1 | Blackjack stays in the update. The questionnaires are still answered from the actual content (#2790), and the resulting regional ratings are recorded, not assumed. |

## 1. Build identifiers

| Field                                                                           | iOS                                                                   | Android                                    |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------ |
| Version / build number                                                          |                                                                       |                                            |
| Source branch + commit SHA                                                      |                                                                       |                                            |
| Build system + run link                                                         | Xcode Cloud workflow / build #                                        | `./gradlew bundleRelease` on (machine)     |
| Contains the reviewed purchase flow (premium slugs removed from `HIDDEN_GAMES`) |                                                                       |                                            |
| Backend used for purchase testing                                               | `ENTITLEMENT_DEV_OVERRIDE` must be **off** (`docs/IAP.md` section 13) | same                                       |
| Store environment                                                               | Sandbox / TestFlight build #                                          | License tester / Play track + release name |
| Tester / date                                                                   |                                                                       |                                            |

The pre-launch API grants every premium game through `ENTITLEMENT_DEV_OVERRIDE`, so purchase testing there proves nothing. Record gameplay results from a pre-launch build separately from access-control results, which need a backend with the override off.

## 2. Automated checks (run and attach)

| Check                                                                                                            | Command / source                                                                                             | Result | Link |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------ | ---- |
| Frontend unit tests                                                                                              | `cd frontend && npm test`                                                                                    |        |      |
| Lint / typecheck                                                                                                 | `npm run lint && npm run typecheck`                                                                          |        |      |
| Backend tests (entitlements, purchases, catalog drift)                                                           | `cd backend && python -m pytest tests/ -v`                                                                   |        |      |
| Visibility guard updated for the premium binary (the five slugs are no longer hidden, everything else unchanged) | `gameVisibility`, `premiumRoutes`, `HomeScreen`, `mainTabs` tests                                            |        |      |
| Per-game engine tests                                                                                            | `frontend/src/game/<name>/__tests__/` for `blackjack`, `starswarm`, `cascade`, `hearts`, `mahjong`           |        |      |
| Blackjack economy and replay guards (#2788)                                                                      | `economy.test.ts`, `BlackjackReplay.test.tsx` (see `docs/games/blackjack.md`)                                |        |      |
| Asset credit guard                                                                                               | `src/__tests__/assetCredits.test.ts`                                                                         |        |      |
| Bundled-asset diff against the audit inventory                                                                   | `node frontend/scripts/list-bundled-assets.mjs` diffed against `docs/audits/ASSET-RIGHTS-AUDIT.md` section 3 |        |      |
| CI on the release commit (incl. `android-release-smoke`, secret scan)                                            | GitHub Actions run                                                                                           |        |      |
| Env guard                                                                                                        | `npm run check-build-env` with `APP_ENV=production`                                                          |        |      |

## 3. Linked issues per game (existing detailed work retained)

Source of the lists: #2789 "Existing detailed game work retained". State was read from GitHub on 2026-09-30. Every issue below was **open** at that time unless the State column says otherwise. All dispositions are **PROPOSED for owner confirmation**.

Rule used for the proposal: crashes, a broken core loop, data integrity, store-policy or accessibility blockers are proposed **release-blocking**; polish, enhancements, research and bookkeeping are proposed **later**. "Later" issues stay open and keep their full requirements; they are not cancelled. The owner may move any row either way.

Owner column: `[ ]` pending, `[x]` confirmed, `[!]` changed (write the new disposition in the rationale or in section 8).

### 3.1 Blackjack

| Issue                                                   | State | Summary                                                                                                                                                             | Proposed disposition                      | Rationale                                                                                                                                                                                    | Owner |
| ------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| #1911 Unlock rewards earned but not defined             | open  | Three cosmetic rewards (Felt Classic, Indigo Card Back, Gold Chip Set) are announced on the victory screen, but no assets, application logic or cosmetics UI exist. | PROPOSED release-blocking (minimum scope) | A paid game must not announce rewards that do not exist. The issue's own fallback (remove the notifications) is enough for release; building the cosmetics is later work.                    | [ ]   |
| #1127 Difficulty levels (Easy / Medium / Hard)          | open  | Enhancement. The text describes server-side dealer branching in `backend/blackjack/module.py`, which predates the client-side engine.                               | PROPOSED later                            | Enhancement. Core dealer play works at the fixed rule set. Re-scope the text against the current client-side engine before starting.                                                         | [ ]   |
| #175 Late surrender                                     | open  | Adds a surrender action; the issue itself calls it lower priority than split and insurance.                                                                         | PROPOSED later                            | Strategic-depth enhancement. `docs/games/blackjack.md` already has a Surrender section, so confirm against the code before scoping.                                                          | [ ]   |
| #2745 Sessions complete without `final_score`           | fixed | Was: Stats "Best" always empty (closing chips only in `result.final_chips`). Fixed by #2909: the server stores `final_score = final_chips` and Best reads past rows. | PROPOSED release-blocking                 | Data integrity. Code and backend/frontend tests merged in #2909; only the on-device check remains (§8).                                                                                      | [ ]   |
| #2370 `blackjack/smoke.yaml` never reaches BettingPanel | open  | Test-only defect in the Maestro flow (missing table-select tap, wrong chip testID). The issue states real users are unaffected.                                     | PROPOSED later                            | Test-only. The manual Blackjack device checklist in `docs/games/blackjack.md` covers the same path for this release.                                                                         | [ ]   |

### 3.2 Star Swarm

| Issue                                                               | State | Summary                                                                                                                                                                                                                                                                       | Proposed disposition                                                           | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                              | Owner |
| ------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| #2776 Combat lifecycle, Carrier, asteroid, Buddy refinements (epic) | open  | Umbrella for six child stories: #2842 wave lifecycle (open), #2843 Carrier, #2844 asteroids, #2845 Buddy, #2846 edge-drag (closed 2026-09-30), #2847 pickup communication (described as landed in `docs/games/starswarm.md`). Only #2842 and #2846 were read for this record. | PROPOSED release-blocking for #2842 and #2846 only; the rest of the epic later | #2842: damage and fire before combat starts, and hazards that do not clear at the wave boundary, are fairness defects in the core loop. #2846: the ship sticking at a screen edge was observed on device and breaks the only control input. The Carrier, asteroid and Buddy refinements are behavior polish. The epic says its children are complete "or explicitly descoped", so the owner should triage #2843 to #2845 individually. | [ ]   |
| #2483 Star Swarm v2: carrier, asteroids, upgrades (epic)            | open  | GitHub shows 10 of 11 sub-issues completed. Its text says it ships after IAP makes the game visible.                                                                                                                                                                          | PROPOSED later                                                                 | Feature epic that is nearly delivered. Confirm which sub-issue is still open (likely asset work such as #2571) and close the epic when it is done.                                                                                                                                                                                                                                                                                     | [ ]   |
| #2571 Pickup sprites and two SFX filenames                          | open  | Optional Kenney sprites for pickups, and pinning down two SFX source filenames. Procedural shapes remain the fallback.                                                                                                                                                        | PROPOSED later                                                                 | Polish with a working fallback. The provenance record for the two SFX still matters for the asset checks in section 6.                                                                                                                                                                                                                                                                                                                 | [ ]   |
| #2353 Notification interruption research spike                      | open  | Research only; the deliverable is a written recommendation, not code.                                                                                                                                                                                                         | PROPOSED later                                                                 | Research spike. Current auto-pause behavior is what the background/resume rows of section 4 check.                                                                                                                                                                                                                                                                                                                                     | [ ]   |
| #2150 Lives display overlaps the ship in the bottom-left corner     | open  | The lives indicator is a native View above the Skia canvas and can cover the ship.                                                                                                                                                                                            | PROPOSED later                                                                 | Cosmetic overlap; the ship stays playable. Escalate to release-blocking if the device matrix shows the ship cannot be seen on a narrow iPhone or small Android.                                                                                                                                                                                                                                                                        | [ ]   |
| #1125 Ship skins for Star Swarm                                     | open  | Two skins, one "subscription-locked" with a "Go Premium" CTA.                                                                                                                                                                                                                 | PROPOSED later                                                                 | Enhancement. The text assumes a subscription and a CTA, which conflicts with the one-time per-game model in `docs/IAP.md`; re-scope before any work.                                                                                                                                                                                                                                                                                   | [ ]   |

### 3.3 Mahjong

| Issue                                        | State | Summary                                                                                                                                                                                              | Proposed disposition                          | Rationale                                                                                                                                                                                                                                  | Owner |
| -------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| #2747 Every cleared board scores 1220        | fixed | Was: every clear scored 1220, so the board only ranked who finished first. Owner chose A; #2917 ranks by fastest clear per layout, with an on-screen timer.                                          | PROPOSED release-blocking (owner decision)    | Decision made (A, per layout, 36 s floor) and implemented with backend and frontend tests in #2917. Only the device checklist in #2917 remains.                                                                                            | [ ]   |
| #2214 Tap hit-test under zoom and pan        | open  | Never verified on device; tile taps use `Pressable` rather than the `Gesture.Tap` that #1454 specified. Labeled priority:high, ios.                                                                  | PROPOSED release-blocking                     | Core input: a wrong-tile or swallowed tap breaks the game if it reproduces. The first step is only a device check, which this matrix already requires.                                                                                     | [ ]   |
| #1565 Shuffle can create an unwinnable state | open  | A stacked matching pair after shuffle causes a permanent dead end. The stacked-pair rejection described in the issue is present in `frontend/src/game/mahjong/engine.ts` on `dev` (around line 649). | PROPOSED release-blocking (verification only) | Broken core loop if it regresses. Confirm the acceptance criteria with a test at 1 pair and at 2 to 4 pairs remaining, then close the issue.                                                                                               | [ ]   |
| #2219 Accessible tile list / overlay         | open  | Canvas and hit layer are `role="none"`, so screen readers cannot see any tile. Labeled priority:high, accessibility; `docs/ACCESSIBILITY.md` lists it as a known gap.                                | PROPOSED release-blocking                     | Accessibility blocker: the board is unusable with VoiceOver or TalkBack. Needs a design decision first (accessible tile list pattern).                                                                                                     | [ ]   |
| #1124 Alternate tile set                     | open  | Two tile sets, one "subscription-locked".                                                                                                                                                            | PROPOSED later                                | Cosmetic enhancement, and the subscription framing conflicts with the per-game model. Provenance of the current tile art is a separate blocker (U1, section 6).                                                                            | [ ]   |

### 3.4 Hearts

| Issue                                                 | State | Summary                                                                                                           | Proposed disposition      | Rationale                                                                                                                                                      | Owner |
| ----------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| #2587 PIMC strong engine, Hard tier                   | open  | Look-ahead AI. The body says nothing in it gates launch.                                                          | PROPOSED later            | AI-strength enhancement; the current utility AI plays.                                                                                                         | [ ]   |
| #2283 One engine per difficulty (Hearts + Yacht epic) | open  | Architecture epic; says scheduling is deferred to after launch.                                                   | PROPOSED later            | Epic for AI strength; no core-loop defect.                                                                                                                     | [ ]   |
| #2233 Hearts AI robustness epic                       | open  | Strategy gaps plus evaluation overhaul; 8 of 9 sub-issues complete on GitHub.                                     | PROPOSED later            | AI tuning and simulation. Sub-item #2236(a) (duck with the highest safe card) is described as a plain fix that can ship now; the owner may take it separately. | [ ]   |
| #2158 Hearts simulator instrumentation                | open  | Adds metrics and calibration gates to `scripts/simulate-hearts.ts`.                                               | PROPOSED later            | Test and simulation tooling with no player-facing effect.                                                                                                      | [ ]   |
| #2224 Integrity hardening on load                     | open  | `loadGame` checks shape only, so a shape-valid but corrupt save renders wrong scores; no deck-conservation check. | PROPOSED release-blocking | Data integrity: silently wrong scores with no recovery short of clearing data. Small change with concrete regression tests; labeled priority:medium.           | [ ]   |
| #2209 13-card hand shrinks to about 21 px             | open  | Card overlap has no floor, so tap targets fall below 24 px on narrow devices. Labeled priority:high.              | PROPOSED release-blocking | Accessibility and core input on the most common hand size and small devices (WCAG 2.2 AA).                                                                     | [ ]   |

### 3.5 Cascade

| Issue                                                  | State | Summary                                                                                                                              | Proposed disposition                                                     | Rationale                                                                                                                                                               | Owner |
| ------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| #1746 Cascade v2 engine rewrite (epic)                 | open  | Body checklist is unchecked, but #2265 reports that `engine2.ts` already meets its target.                                           | PROPOSED later                                                           | Stale epic; needs the bookkeeping decision in #2265. Physics behavior is still exercised by the gameplay rows of the matrix.                                            | [ ]   |
| #1605 Unify on Matter.js and physics compliance (epic) | open  | Same situation as #1746; only `matter-js` is in `package.json` per #2265.                                                            | PROPOSED later                                                           | Stale epic; same decision as #1746.                                                                                                                                     | [ ]   |
| #2265 Decision: verify and close #1746 and #1605       | open  | Decision card ("DO NOT IMPLEMENT" until the owner chooses); labeled priority:low.                                                    | PROPOSED later                                                           | Bookkeeping decision, not a defect. The owner should decide before this record is signed so the epics do not look unfinished.                                           | [ ]   |
| #1795 Cascade asset swap to CC0 art                    | open  | Replaces the current Gemini-generated fruit and celestial art with CC0 art (Kenney, Moreau Guillaume); 22 assets plus baked sprites. | PROPOSED release-blocking unless the owner attests U2 and U3 (section 6) | The current art's creator, tool and terms are recorded nowhere. This issue is the replacement route for U2 and U3. If the owner attests to both sets, it becomes later. | [ ]   |

### 3.6 Shared audio and assets

These apply to more than one premium game. Shared accessibility and localization work keeps its own scope and is not re-listed here.

| Issue                                             | State | Summary                                                                                                                                                                      | Proposed disposition | Rationale                                                                                                                               | Owner |
| ------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| #1631 Unified asset management (epic)             | open  | Per-game registries, lazy loading, size budgets, documented pipeline.                                                                                                        | PROPOSED later       | Structural epic. Its size budgets (`docs/ASSETS.md`) are checked in the performance rows of section 4, not as a separate gate.          | [ ]   |
| #1779 Right-size BGM (epic)                       | open  | Bundled BGM is about 20 MB of MP3 (Mahjong and Star Swarm). The issue documents a possible 20 to 100 ms gap on loop restart on some Android devices. 1 of 8 sub-issues done. | PROPOSED later       | Audio quality and size, not a crash or broken loop. An audible loop gap on a test device is recorded in the audio row and reconsidered. | [ ]   |
| #1786 Audio device QA (gapless, offline, battery) | open  | Real-device test plan tied to the CDN and AAC architecture that #1779 has not delivered.                                                                                     | PROPOSED later       | The premium matrix covers the overlapping checks that apply to the current build (loop, interruption, mute, offline).                   | [ ]   |

### 3.7 Daily-challenge premium goals (owner decision)

| Issue                                    | State | Summary                                                                                                                                                             | Proposed disposition                                 | Rationale                                                                                                                            | Owner |
| ---------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| #2458 Premium daily-challenge goal pools | open  | Post-launch work retained under #2777 and #2789. Needs result envelopes for Star Swarm, Sort and others, three tiers per game, localization and premium goal specs. | **OWNER DECISION REQUIRED**, not proposed either way | #2789 says to decide whether it ships with the first premium update, and that it is neither silently cancelled nor a launch blocker. | [ ]   |

**Decision to record (not decided in this document):**

- [ ] Ship #2458 with the first premium update
- [ ] Defer #2458 to a later update (the issue stays open)

If it ships, every requirement from the issue and its two review comments applies, and #2790 must add release-note language:

- Premium rotation length must stay odd (or `pick_games` is reworked).
- Validate that premium-pool games exist, are active and are premium (drift test), and decide what a template naming an inactive game does.
- A mid-day entitlement change swaps the challenge; decide whether to accept that or pin the slate per day (needs stored state).
- Decide whether `/status` gets a `slate` indicator field.
- Re-check the extra join per `/status` call.
- Each premium game needs easy, medium and hard goals, and the easy goal must not be luck-dependent.
- Adding premium specs re-scores existing premium-slate streaks (the streak is replayed over up to 60 days); decide whether to add a per-pool cutoff date, and never change `DAILY_CHALLENGE_SALT`.
- Star Swarm and Sort result envelopes and per-session rows, result models, i18n copy, and free-slate regression tests.

If it is deferred, the premium build must not present premium goals, and the free challenge must be unaffected (check in section 4.6, Daily challenge row).

### 3.8 Count of proposed dispositions (for owner review)

| Game            | Release-blocking (PROPOSED)           | Later (PROPOSED)                      | Owner decision |
| --------------- | ------------------------------------- | ------------------------------------- | -------------- |
| Blackjack       | 2 (#1911 minimum scope, #2745)        | 3 (#1127, #175, #2370)                | 0              |
| Star Swarm      | 1 (#2776, scoped to #2842 and #2846)  | 5 (#2483, #2571, #2353, #2150, #1125) | 0              |
| Mahjong         | 4 (#2747, #2214, #1565 verify, #2219) | 1 (#1124)                             | 0              |
| Hearts          | 2 (#2224, #2209)                      | 4 (#2587, #2283, #2233, #2158)        | 0              |
| Cascade         | 1 (#1795, conditional on U2/U3)       | 3 (#1746, #1605, #2265)               | 0              |
| Shared          | 0                                     | 3 (#1631, #1779, #1786)               | 0              |
| Daily challenge | n/a                                   | n/a                                   | 1 (#2458)      |

## 4. Release matrix (all five games)

Run every row on the primary device of each platform, and repeat the gameplay rows on the matrix devices in section 5. Access-control rows need a build and backend where `ENTITLEMENT_DEV_OVERRIDE` is off, using Apple sandbox accounts and Google license testers (`docs/IAP.md` sections 14 and 15). Each cell holds `[ ]` until run; link a screenshot, recording or log in Notes.

Games: **BJ** Blackjack, **SS** Star Swarm, **CA** Cascade, **HE** Hearts, **MJ** Mahjong.

### 4.1 Access controls (per game, per platform)

| Check                                                                                                                    | Platform | BJ  | SS  | CA  | HE  | MJ  | Notes / bug link                  |
| ------------------------------------------------------------------------------------------------------------------------ | -------- | --- | --- | --- | --- | --- | --------------------------------- |
| Tile is visible and shown locked before purchase; tapping opens the paywall, never the game                              | iOS      | [ ] | [ ] | [ ] | [ ] | [ ] |                                   |
|                                                                                                                          | Android  | [ ] | [ ] | [ ] | [ ] | [ ] |                                   |
| Locked game cannot be reached by deep link, direct route, or Ranks/Stats entry                                           | iOS      | [ ] | [ ] | [ ] | [ ] | [ ] |                                   |
|                                                                                                                          | Android  | [ ] | [ ] | [ ] | [ ] | [ ] |                                   |
| Paywall shows the localized store price and one-time access wording, and no lives, chips, continues or subscription copy | iOS      | [ ] | [ ] | [ ] | [ ] | [ ] | #841                              |
|                                                                                                                          | Android  | [ ] | [ ] | [ ] | [ ] | [ ] |                                   |
| Purchase succeeds; game unlocks without a restart; unlimited replay needs no further payment                             | iOS      | [ ] | [ ] | [ ] | [ ] | [ ] | #2786                             |
|                                                                                                                          | Android  | [ ] | [ ] | [ ] | [ ] | [ ] | #2787                             |
| Buying one game does not unlock the other four                                                                           | iOS      | [ ] | [ ] | [ ] | [ ] | [ ] |                                   |
|                                                                                                                          | Android  | [ ] | [ ] | [ ] | [ ] | [ ] |                                   |
| Cancelled purchase returns to the paywall silently (no message) and the game stays locked (IAP.md §5, §9.3)              | iOS      | [ ] | [ ] | [ ] | [ ] | [ ] |                                   |
|                                                                                                                          | Android  | [ ] | [ ] | [ ] | [ ] | [ ] |                                   |
| Pending purchase (Ask to Buy / slow payment) keeps the game locked and shows "Waiting for approval"                      | iOS      | [ ] | [ ] | [ ] | [ ] | [ ] |                                   |
|                                                                                                                          | Android  | [ ] | [ ] | [ ] | [ ] | [ ] |                                   |
| Restore Purchases (visible on the paywall and in Settings) unlocks owned games without recharging                        | iOS      | [ ] | [ ] | [ ] | [ ] | [ ] | Apple 3.1.1                       |
|                                                                                                                          | Android  | [ ] | [ ] | [ ] | [ ] | [ ] |                                   |
| Reinstall then restore; new device then restore                                                                          | iOS      | [ ] | [ ] | [ ] | [ ] | [ ] |                                   |
|                                                                                                                          | Android  | [ ] | [ ] | [ ] | [ ] | [ ] |                                   |
| Refund or revocation removes access after the next entitlement refresh                                                   | iOS      | [ ] | [ ] | [ ] | [ ] | [ ] | `docs/IAP.md` 6.5                 |
|                                                                                                                          | Android  | [ ] | [ ] | [ ] | [ ] | [ ] | `docs/IAP.md` 7.4                 |
| Entitlement JWT: 24 h refresh; 7-day offline grace keeps purchased games playable; expired grace re-locks                | iOS      | [ ] | [ ] | [ ] | [ ] | [ ] | `docs/ARCHITECTURE.md` section 10 |
|                                                                                                                          | Android  | [ ] | [ ] | [ ] | [ ] | [ ] |                                   |
| Reviewer path works as written in the review notes, with no hidden unlock codes or debug gestures                        | iOS      | [ ] | [ ] | [ ] | [ ] | [ ] | `docs/IAP.md` section 15          |
|                                                                                                                          | Android  | [ ] | [ ] | [ ] | [ ] | [ ] |                                   |

Free-game regression (one row, not per premium game):

| Check                                                                                          | iOS | Android | Notes / bug link |
| ---------------------------------------------------------------------------------------------- | --- | ------- | ---------------- |
| The seven free games stay complete, playable without purchase, and never show a payment prompt | [ ] | [ ]     |                  |

### 4.2 Gameplay

| Check                                                                                  | Platform | BJ  | SS  | CA  | HE  | MJ  | Notes / bug link          |
| -------------------------------------------------------------------------------------- | -------- | --- | --- | --- | --- | --- | ------------------------- |
| Start, play a full session to its end, result recorded, Play Again works               | iOS      | [ ] | [ ] | [ ] | [ ] | [ ] |                           |
|                                                                                        | Android  | [ ] | [ ] | [ ] | [ ] | [ ] |                           |
| Game-specific core loop (see 4.6)                                                      | iOS      | [ ] | [ ] | [ ] | [ ] | [ ] |                           |
|                                                                                        | Android  | [ ] | [ ] | [ ] | [ ] | [ ] |                           |
| Per-game menu: Stats and Leaderboard entries open and return                           | iOS      | [ ] | [ ] | [ ] | [ ] | [ ] | BJ board disabled (#2745) |
|                                                                                        | Android  | [ ] | [ ] | [ ] | [ ] | [ ] |                           |
| XP, level and (if applicable) daily-challenge progress update after a finished session | iOS      | [ ] | [ ] | [ ] | [ ] | [ ] | #2458 decision            |
|                                                                                        | Android  | [ ] | [ ] | [ ] | [ ] | [ ] |                           |

### 4.3 Audio

| Check                                                                                 | Platform | BJ    | SS  | CA    | HE    | MJ  | Notes / bug link                   |
| ------------------------------------------------------------------------------------- | -------- | ----- | --- | ----- | ----- | --- | ---------------------------------- |
| Sound effects play at the right events; mute toggle silences BGM and SFX as designed  | iOS      | [ ]   | [ ] | [ ]   | [ ]   | [ ] |                                    |
|                                                                                       | Android  | [ ]   | [ ] | [ ]   | [ ]   | [ ] |                                    |
| Background music (Mahjong, Star Swarm): loop restart has no audible gap or click      | iOS      | [n/a] | [ ] | [n/a] | [n/a] | [ ] | #1779, #1786                       |
|                                                                                       | Android  | [n/a] | [ ] | [n/a] | [n/a] | [ ] | Test at least one mid-range device |
| Incoming call, lock/unlock, and another audio app: audio pauses and resumes correctly | iOS      | [ ]   | [ ] | [ ]   | [ ]   | [ ] |                                    |
|                                                                                       | Android  | [ ]   | [ ] | [ ]   | [ ]   | [ ] |                                    |
| Every shipped sound file has a credit entry (`SOUND_CREDITS.md`)                      | both     | [ ]   | [ ] | [ ]   | [ ]   | [ ] | Section 6, U5                      |

### 4.4 Performance

Record model, OS and observed values. Do not enter a target as a result.

| Check                                                                                                                                                                  | Platform | BJ  | SS  | CA  | HE  | MJ  | Notes / bug link                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --- | --- | --- | --- | --- | ---------------------------------- |
| Cold start to game screen and game-select preload feel acceptable (no long blank screen)                                                                               | iOS      | [ ] | [ ] | [ ] | [ ] | [ ] | `docs/PERFORMANCE.md`              |
|                                                                                                                                                                        | Android  | [ ] | [ ] | [ ] | [ ] | [ ] |                                    |
| Smooth frame rate over a 10-minute session on the mid-range Android and the oldest supported iPhone (physics for CA, particles and enemies for SS, tile canvas for MJ) | iOS      | [ ] | [ ] | [ ] | [ ] | [ ] |                                    |
|                                                                                                                                                                        | Android  | [ ] | [ ] | [ ] | [ ] | [ ] |                                    |
| No overheating or unexpected battery drain over 10 minutes                                                                                                             | iOS      | [ ] | [ ] | [ ] | [ ] | [ ] |                                    |
|                                                                                                                                                                        | Android  | [ ] | [ ] | [ ] | [ ] | [ ] |                                    |
| Hearts AI decision time is acceptable on the mid-range Android                                                                                                         | Android  | n/a | n/a | n/a | [ ] | n/a | Relevant to #2587 only if it ships |
| Asset size budgets hold (`docs/ASSETS.md`); app binary growth recorded                                                                                                 | both     | [ ] | [ ] | [ ] | [ ] | [ ] | #1631, #1779                       |

### 4.5 Background, resume and offline

| Check                                                                                                              | Platform | BJ  | SS  | CA  | HE  | MJ  | Notes / bug link                           |
| ------------------------------------------------------------------------------------------------------------------ | -------- | --- | --- | --- | --- | --- | ------------------------------------------ |
| Background mid-game then resume: state intact, timers correct (SS auto-pauses; MJ and CA timers exclude time away) | iOS      | [ ] | [ ] | [ ] | [ ] | [ ] | #2353 (SS notifications), #2747 (MJ timer) |
|                                                                                                                    | Android  | [ ] | [ ] | [ ] | [ ] | [ ] |                                            |
| Kill and relaunch mid-game: resume or clean start, no crash, no corrupted score                                    | iOS      | [ ] | [ ] | [ ] | [ ] | [ ] | #2224 (Hearts saves)                       |
|                                                                                                                    | Android  | [ ] | [ ] | [ ] | [ ] | [ ] |                                            |
| Airplane mode: purchased game is playable with a valid entitlement; no crash                                       | iOS      | [ ] | [ ] | [ ] | [ ] | [ ] |                                            |
|                                                                                                                    | Android  | [ ] | [ ] | [ ] | [ ] | [ ] |                                            |
| Outcomes finished offline are queued and flush after reconnect (`SyncWorker`)                                      | iOS      | [ ] | [ ] | [ ] | [ ] | [ ] |                                            |
|                                                                                                                    | Android  | [ ] | [ ] | [ ] | [ ] | [ ] |                                            |
| Purchase attempted offline fails cleanly and leaves state unchanged                                                | iOS      | [ ] | [ ] | [ ] | [ ] | [ ] |                                            |
|                                                                                                                    | Android  | [ ] | [ ] | [ ] | [ ] | [ ] |                                            |
| Rotate, split view and multitasking on iPad: no crash or lost state                                                | iOS      | [ ] | [ ] | [ ] | [ ] | [ ] |                                            |

### 4.6 Game-specific core-loop checks

| Game            | Check                                                                                                                                                                                                                              | iOS | Android | Notes / bug link                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------- | --------------------------------- |
| Blackjack       | Manual device checklist in `docs/games/blackjack.md` (items 1 to 8): starting chips, out-of-chips card, replay without a purchase sheet, offline replay, keep playing then bust, New Game, relaunch resume, copy never sells chips | [ ] | [ ]     | #2788, #1911, #2745               |
| Blackjack       | Each table (Beginner, Intermediate, High Roller) can be started and finished; the victory screen matches the defined rewards                                                                                                       | [ ] | [ ]     | #1911                             |
| Star Swarm      | Countdown and swoop-in: no player fire or damage before combat; wave clear leaves a clean next wave                                                                                                                                | [ ] | [ ]     | #2842                             |
| Star Swarm      | Drag past the right and left edge, reverse, release and drag again: the ship follows the finger; repeat across a wave transition                                                                                                   | [ ] | [ ]     | #2846 (closed; confirm on device) |
| Star Swarm      | Carrier wave, asteroids, Buddy and upgrade pickups behave as `docs/games/starswarm.md` describes; a pickup's effect is explained on collection                                                                                     | [ ] | [ ]     | #2843 to #2845, #2847             |
| Cascade         | Two same-tier pieces merge every time; no piece disappears; overflow ends the game; pieces near a wall stay in bounds                                                                                                              | [ ] | [ ]     | #1746, #1605, #2265               |
| Cascade         | Every tier sprite aligns with its hull; Saturn and Uranus rings render; no clipping                                                                                                                                                | [ ] | [ ]     | #1795                             |
| Hearts          | Pass phase, full hand, moon shot and scoring complete correctly at each difficulty; the hand fits and every card is tappable on the narrowest device                                                                               | [ ] | [ ]     | #2209, #2224                      |
| Hearts          | A corrupt or interrupted save does not render wrong scores                                                                                                                                                                         | [ ] | [ ]     | #2224                             |
| Mahjong         | Tap a tile at 1x, zoomed and panned: the tile under the finger is selected                                                                                                                                                         | [ ] | [ ]     | #2214                             |
| Mahjong         | Shuffle with 1 pair and with 2 to 4 pairs left never produces an unwinnable board                                                                                                                                                  | [ ] | [ ]     | #1565                             |
| Mahjong         | Two clears with different play are ranked differently (or the board is hidden by owner decision)                                                                                                                                   | [ ] | [ ]     | #2747                             |
| Mahjong         | VoiceOver and TalkBack can list and match tiles                                                                                                                                                                                    | [ ] | [ ]     | #2219                             |
| Daily challenge | Free challenge unchanged in the premium build; premium goals present only if the #2458 decision is "ship"                                                                                                                          | [ ] | [ ]     | #2458, #2392                      |

## 5. Device and layout matrix

Record model, OS version, build and outcome. Add layout notes (clipping, safe areas, dark theme, narrow header, notch or Dynamic Island). Deferred enhancements are gates only where they break the basic experience.

| Class                                             | Device / OS | BJ  | SS  | CA  | HE  | MJ  | Layout | Perf | Result / bug link                                             |
| ------------------------------------------------- | ----------- | --- | --- | --- | --- | --- | ------ | ---- | ------------------------------------------------------------- |
| iPhone narrow (SE / mini class)                   |             | [ ] | [ ] | [ ] | [ ] | [ ] | [ ]    | [ ]  | Hearts hand overlap (#2209), Star Swarm lives overlap (#2150) |
| iPhone standard                                   |             | [ ] | [ ] | [ ] | [ ] | [ ] | [ ]    | [ ]  |                                                               |
| iPhone large (Plus / Max class)                   |             | [ ] | [ ] | [ ] | [ ] | [ ] | [ ]    | [ ]  |                                                               |
| iPad portrait (supported model)                   |             | [ ] | [ ] | [ ] | [ ] | [ ] | [ ]    | [ ]  | Mahjong board scale, Blackjack table                          |
| iPad landscape                                    |             | [ ] | [ ] | [ ] | [ ] | [ ] | [ ]    | [ ]  |                                                               |
| Android small / low-end                           |             | [ ] | [ ] | [ ] | [ ] | [ ] | [ ]    | [ ]  | Physics and particle load                                     |
| Android mid-range (primary)                       |             | [ ] | [ ] | [ ] | [ ] | [ ] | [ ]    | [ ]  |                                                               |
| Android large / tablet or foldable (if supported) |             | [ ] | [ ] | [ ] | [ ] | [ ] | [ ]    | [ ]  |                                                               |

Also repeat the paywall, purchase and restore rows of section 4.1 on one device per class where the paywall layout differs (narrow iPhone, iPad, small Android), and note the longest store price string seen.

## 6. Asset-rights prerequisites (release-blocking)

Source: `docs/audits/ASSET-RIGHTS-AUDIT.md` (issue #2782). The five premium games are compiled into the v1.0 binary already, so these assets are in a shipped binary today; a paid update that sells the games makes the gap a release matter. Each item below is a **premium release blocker** until the owner records an outcome (source and license, an owner statement of authorship, or replacement). U4 (brand icon files) is shared with the free build, is not premium-specific, and is tracked in the audit itself.

| ID  | Assets                                                                                       | Game      | Files | Gap (from the audit)                                                                                                                              | Resolution options                                                                                                               | Status   |
| --- | -------------------------------------------------------------------------------------------- | --------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------- |
| U1  | `frontend/assets/mahjong/01-white-dragon.svg` to `42-bamboo.svg` (tile faces)                | Mahjong   | 42    | No creator, source, license or credit anywhere; third-party-looking artwork. A CC-BY(-SA) origin would need attribution and possibly share-alike. | Confirm source and license, or an owner authorship statement, or replace. #1124 (alternate tile set) is not the fix.             | [ ] open |
| U2  | `frontend/assets/fruit-icons/*.webp`, `fruits-baked/*.png` (12 fruits)                       | Cascade   | 24    | Creator, generation method and terms unknown; the source PNGs live in an untracked Drive folder. #1795 calls the current art Gemini-generated.    | Owner states origin and terms and adds `CREDITS.md`, or replace via #1795.                                                       | [ ] open |
| U3  | `frontend/assets/celestial-icons/*.webp`, `cosmos-baked/*.png` (12 bodies)                   | Cascade   | 24    | Same as U2; the source images carried checkerboard backgrounds.                                                                                   | Same as U2.                                                                                                                      | [ ] open |
| U5  | `frontend/assets/sounds/blackjack-bust.ogg`, `blackjack-card-deal.ogg`, `blackjack-push.ogg` | Blackjack | 3     | No `SOUND_CREDITS.md` entry; embedded titles suggest Kenney packs (likely CC0) but that is unproven.                                              | Match against the Kenney Casino or Digital Audio packs and add entries, or replace. Also add a proper `blackjack-win.ogg` entry. | [ ] open |
| U6  | `frontend/assets/mahjong/layouts/*.json`                                                     | Mahjong   | 25    | Layout coordinates appear project-authored but carry no authorship note.                                                                          | One-line owner attestation (the audit rates this low risk).                                                                      | [ ] open |

Further asset checks for the premium candidate (from the audit follow-ups and open issues):

| Check                                                                                                                                                                      | Result | Evidence |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- |
| Re-run `node frontend/scripts/list-bundled-assets.mjs`, diff against the audit inventory, and record every new file in the matching credits file (audit section 6, item 3) | [ ]    |          |
| Star Swarm SFX source filenames pinned (`starswarm-gameover.ogg`, `starswarm-waveclear.ogg`) or the sounds swapped for named files                                         | [ ]    | #2571    |
| Star Swarm sprite credits file lists a source for every sprite; `assetCredits.test.ts` passes                                                                              | [ ]    |          |
| Cascade credits reflect the final art set (after U2/U3 or #1795)                                                                                                           | [ ]    |          |
| In-app credits/licenses surface exists if any shipped asset needs attribution (audit follow-up 1)                                                                          | [ ]    |          |

## 7. Dependencies and store setup

Nothing below is verified by this document. It lists what must be finished and where its record goes. Sequence follows `docs/IAP.md` section 17.

| Dependency                                            | What it delivers                                                                                                                                                                                                                      | State (2026-09-30) | Evidence |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------- |
| #840 Backend entitlements and purchase verification   | Extends `GameEntitlement` and `GET /entitlements`; verified Apple and Google evidence; restoration; refund and revocation; tests                                                                                                      | open               |          |
| #841 Paywall and Restore Purchases                    | Paywall screen, localized prices, restore action, error and already-owned handling, accessibility                                                                                                                                     | open               |          |
| #2786 Apple in-app purchase and restoration           | StoreKit 2 adapter, sandbox test matrix, first non-consumable submitted with the new binary, reviewer instructions                                                                                                                    | open               |          |
| #2787 Google Play Billing and restoration             | Play Billing adapter, acknowledgement, interrupted-purchase recovery, license testers, reviewer access                                                                                                                                | open               |          |
| #2790 Ratings, disclosures, listings, reviewer access | Apple and IARC questionnaires answered from actual content (Blackjack simulated gambling, Star Swarm fantasy violence), regional ratings recorded, listings, purchase disclosures, privacy answers, reviewer access to all five games | open               |          |

Store setup (from `docs/IAP.md` section 17), per platform:

| Item                                                                                                                                   | iOS | Android |
| -------------------------------------------------------------------------------------------------------------------------------------- | --- | ------- |
| Paid apps agreement, tax and banking (Apple) / payments profile (Google) active                                                        | [ ] | [ ]     |
| Five products created with the IDs in `docs/IAP.md` section 2 (non-consumable / one-time, one buy option each, never consumed)         | [ ] | [ ]     |
| Server credentials: In-App Purchase key and ASSN v2 URLs / service account linked in Play Console, Pub/Sub topic and push subscription | [ ] | [ ]     |
| Sandbox accounts / license testers configured; `ENTITLEMENT_DEV_OVERRIDE` off on the backend used                                      | [ ] | [ ]     |
| Family Sharing decision recorded (`docs/IAP.md` section 11; cannot be undone per product)                                              | [ ] | n/a     |
| Price per game decided                                                                                                                 | [ ] | [ ]     |
| Products submitted with the new binary; per-product review screenshot (Apple)                                                          | [ ] | n/a     |
| Reviewer notes and promo codes or sandbox path prepared (`docs/IAP.md` section 15)                                                     | [ ] | [ ]     |
| Store listing, screenshots and privacy answers updated for purchases (`docs/STORE-PRIVACY-ANSWERS.md`, `docs/STORE-LISTING.md`)        | [ ] | [ ]     |
| Privacy policy and the Delete My Data confirmation text state that store transaction records are retained after deletion: what (`docs/IAP.md` section 8.5), why (refunds, chargebacks, fraud, legal claims) and how long; both consoles' deletion / Data safety answers match. Sources: Apple, [Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app/) ("if local laws or regulations require that you maintain some data, let your users know"); Google Play, account deletion requirements and User Data policy (retention for security, fraud prevention or regulatory compliance must be disclosed, e.g. in the privacy policy) | [ ] | [ ]     |
| Age-rating questionnaires answered in both consoles; resulting regional ratings and distribution restrictions recorded                 | [ ] | [ ]     |
| Premium slugs removed from `HIDDEN_GAMES` in the submitted binary only (no server-side unhide)                                         | [ ] | [ ]     |
| 48-hour monitoring plan after release (Sentry and purchase events)                                                                     | [ ] | [ ]     |

Remaining open owner questions from `docs/IAP.md` section 17 (Blackjack is answered by the owner decision in section 0): Family Sharing, price tier per game, link caps, sandbox purchases on production, testing backend.

## 8. Blockers and follow-ups

Confirm section 3 first. Pre-filled rows are the PROPOSED release-blocking items and the store-side dependencies; "later" issues stay in section 3 and are not duplicated here.

| Item                                               | Linked issue / PR               | Severity                        | Status                               |
| -------------------------------------------------- | ------------------------------- | ------------------------------- | ------------------------------------ |
| Blackjack: cut or define unlock rewards            | #1911                           | PROPOSED blocking               | open                                 |
| Blackjack: final chips recorded as score           | #2745 (fixed by #2909)          | PROPOSED blocking               | merged 2026-10-01; confirm on device |
| Star Swarm: wave lifecycle safety                  | #2842 (under #2776)             | PROPOSED blocking               | open                                 |
| Star Swarm: edge-drag device confirmation          | #2846 (under #2776)             | PROPOSED blocking               | closed 2026-09-30; confirm on device |
| Mahjong: ranking rule (or hide board)              | #2747 (fixed by #2917)          | PROPOSED blocking               | merged 2026-10-01; confirm on device |
| Mahjong: tap accuracy under zoom                   | #2214                           | PROPOSED blocking               | open                                 |
| Mahjong: unwinnable shuffle                        | #1565                           | PROPOSED blocking (verify)      | open; fix present in engine          |
| Mahjong: screen-reader tile access                 | #2219                           | PROPOSED blocking               | open                                 |
| Hearts: validate saves on load                     | #2224                           | PROPOSED blocking               | open                                 |
| Hearts: hand tap targets on narrow devices         | #2209                           | PROPOSED blocking               | open                                 |
| Cascade: art provenance or replacement             | #1795, U2, U3                   | PROPOSED blocking (conditional) | open                                 |
| Mahjong tiles and layouts provenance               | U1, U6                          | Blocking (asset audit)          | open                                 |
| Blackjack sound provenance                         | U5                              | Blocking (asset audit)          | open                                 |
| Premium daily-challenge goals                      | #2458                           | Owner decision                  | open                                 |
| Purchase backend, paywall, store adapters, ratings | #840, #841, #2786, #2787, #2790 | Blocking (dependencies)         | open                                 |

Related issues and context (from #2789):

- Parent: #2777. Catalog and packaging contract: #2785 (`docs/IAP.md`). Store listings: #2784. Catalog: #2460. Blackjack economy verification: #2788.
- Daily-challenge device acceptance: #2392. Real-device drag checklist: #2263. Result-submission E2E: #2643.
- v1.0 record for signing, production API and IPv6-only checks: [`RELEASE-ACCEPTANCE-v1.0.md`](RELEASE-ACCEPTANCE-v1.0.md).
- Other docs: `docs/IAP.md`, `docs/IOS.md`, `docs/ANDROID-CI.md`, `docs/RELEASE-PLAN-2026-10.md`, `docs/TESTING.md`, `docs/games/`.

## 9. Sign-off

| Role             | Name | Date | Decision (accept / reject) |
| ---------------- | ---- | ---- | -------------------------- |
| Tester (iOS)     |      |      |                            |
| Tester (Android) |      |      |                            |
| Owner            |      |      |                            |
