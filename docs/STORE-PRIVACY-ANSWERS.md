# Store privacy declarations — answers to enter (v1.0)

For **#823** (App Store Connect → App Privacy), **#825 / #2014** (Play Console → Data safety) and the age-rating
questionnaires. Every row comes from [`DATA-INVENTORY.md`](DATA-INVENTORY.md) (verified against the code, #2779),
not from the older "not linked / not shared" defaults. The three places that must agree:
[`privacy-policy.html`](privacy-policy.html), the iOS privacy manifest (`frontend/ios/GamingApp/PrivacyInfo.xcprivacy`,
pinned by `frontend/src/__tests__/privacyManifest.test.ts`) and these forms.

> **DRAFT — pending owner/legal review.** These are the publisher's legal statements; an AI assistant prepared them.
> Nothing here has been entered in App Store Connect or Play Console (manual step, #2784). Scope is **v1.0: no purchases**.
> **Re-check this file whenever a data flow changes** (IAP, accounts, analytics, ads, leaderboard identity).

## What the app collects (row numbers used below)

| #   | Data                                                                                                                                                 | Where it goes                                          | Keyed to                                                             | Optional?                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------- | -------------------------------------------- |
| 1   | Random per-install ID (`X-Session-ID`)                                                                                                               | Our API → Postgres                                     | —                                                                    | No                                           |
| 2   | Game records: game, start/end, duration, outcome, score, per-game settings; Daily Word guesses                                                       | Our API → Postgres                                     | install ID                                                           | No                                           |
| 3   | Per-move event logs                                                                                                                                  | Our API → Postgres (`game_events`)                     | install ID (via the game)                                            | No                                           |
| 4   | Automatic warn/error log entries                                                                                                                     | Our API → Postgres (`bug_logs`)                        | install ID                                                           | No                                           |
| 5   | Crash, performance and diagnostic reports, breadcrumbs, sessions (app); server-side performance traces, sampled 10%, no install ID, headers scrubbed | Sentry                                                 | Sentry's own random install ID (`user.id`); not our ID               | No (no in-app switch; see DATA-INVENTORY §7) |
| 6   | Feedback title + description, optional `session-logs.txt`                                                                                            | Sentry User Feedback                                   | Sentry install ID only (no name/email/our ID)                        | **Yes**, only if submitted                   |
| 7   | IP address in request logs                                                                                                                           | Render logs (Cloudflare proxies traffic)               | not joined to anything                                               | No                                           |
| 8   | **Generated leaderboard name** (`Adjective Animal N`) + opt-in; shown publicly with score, rank and date                                             | Our API → Postgres (`players`), shown to other players | install ID (server-side only; the public response never includes it) | **Yes**, only after pressing Join            |

Not collected: real name, email, phone, contacts, location, photos, advertising ID, purchases, health, financial or
browsing data. No ads, no third-party analytics SDK, **no tracking** (`audits/ATT-AUDIT.md`).
XP, level, statistics, daily-challenge streaks and ranks are computed from rows 2-3, not separately collected.
Removal: **Profile → Leave leaderboards** removes row 8 and the player from every board; **Settings → Delete my data**
deletes rows 1-4 and 8 from our database (Sentry data is not reachable by it and expires after 90 days, per the policy).

## Apple — App Privacy

**"Do you or your third-party partners collect data from this app?"** → **Yes.** **Tracking** (any data type): **No.**
No data is "used to track you".

| Apple data type                         | Rows | Collected | Linked to the user | Used for tracking | Purposes                     |
| --------------------------------------- | ---- | --------- | ------------------ | ----------------- | ---------------------------- |
| Identifiers → **User ID**               | 1    | Yes       | **Yes**            | No                | App Functionality            |
| Identifiers → **Device ID**             | 5, 6 | Yes       | **Yes**            | No                | App Functionality            |
| Usage Data → **Product Interaction**    | 2    | Yes       | **Yes**            | No                | App Functionality, Analytics |
| User Content → **Gameplay Content**     | 2, 3 | Yes       | **Yes**            | No                | App Functionality, Analytics |
| User Content → **Other User Content**   | 8    | Yes       | **Yes**            | No                | App Functionality            |
| User Content → **Customer Support**     | 6    | Yes       | **Yes**            | No                | App Functionality            |
| Diagnostics → **Crash Data**            | 5    | Yes       | **Yes**            | No                | App Functionality            |
| Diagnostics → **Performance Data**      | 5    | Yes       | **Yes**            | No                | App Functionality            |
| Diagnostics → **Other Diagnostic Data** | 4, 5 | Yes       | **Yes**            | No                | App Functionality            |

Everything else → not collected. **Purposes rationale:** Analytics appears only on Product Interaction / Gameplay Content
(Apple) and App interactions (Google), because stored game records feed our own stats, XP and leaderboards; diagnostics rows are
App Functionality only (no analytics SDK), and the manifest and DATA-INVENTORY.md say the same. IP addresses are not an Apple data type unless used to derive location, which the app does not do.

**Why every row is "linked".** Apple treats data as linked when it is tied to the user "via their account, device, or details".
The install ID ties rows 1-4 and 8 together in our database. Sentry attaches its own random install ID to every event
(`RNSentry.mm:501`), so rows 5-6 link across reports from one device even though we cannot join them to our database. Sentry's
own manifest says "not linked" because it assumes the app sets no identifier and it does not see one; here the SDK does, so we
declare the conservative answer. Over-declaring has no review cost; under-declaring does. **Owner decision:** if legal review
prefers "not linked" for Sentry-only rows (5, 6), change those four rows and `privacyManifest.test.ts` together.

**Public display (row 8).** Apple has no "shared" column. The generated name is shown to other players only after the player
opts in; say so in the optional "Other User Content" purpose note and in the policy. It is not a real name, so **Name** is not selected.

**Privacy manifest:** `PrivacyInfo.xcprivacy` declares the same nine types with the same linked/tracking values and purposes
(`NSPrivacyTracking=false`, no tracking domains). Required-reason API list unchanged (FileTimestamp, UserDefaults, DiskSpace,
SystemBootTime: covered by React Native / Sentry). **Microphone:** `NSMicrophoneUsageDescription` stays in `Info.plist` (no app
code records audio; `expo-audio` still compiles a recorder, so removing it risks ITMS-90683, see DATA-INVENTORY §9). No data
type is declared for audio.

**Privacy Policy URL:** `https://buffingchi.com/privacy` (must be live and match this file, #2780).
**Privacy Choices URL:** leave blank (leaving the leaderboards and deletion are in-app).

## Google Play — Data safety

**Collects or shares user data?** Yes · **Encrypted in transit?** Yes (HTTPS only) ·
**Can users request deletion?** Yes — in the app (Settings → Delete my data; Profile → Leave leaderboards removes the public name).
No account exists, so the account-deletion URL requirement does not apply (#835 covers future accounts) ·
**Independent security review?** No · **Families policy / designed for children?** No.

**Shared with third parties?** **No.** Render, Supabase, Cloudflare (DNS/proxy) and Sentry are service providers processing on our
behalf, which Google does not count as sharing. Other players seeing a generated name and score on a leaderboard is player-visible
display, not a transfer to a third party. **Owner decision:** if you prefer to treat public display as "shared", mark row 8 as
Shared = Yes (no other row changes).

| Google data type                                          | Rows | Collected | Shared | Processed ephemerally | Required / optional | Purposes                     |
| --------------------------------------------------------- | ---- | --------- | ------ | --------------------- | ------------------- | ---------------------------- |
| Personal info → **User IDs** (generated leaderboard name) | 8    | Yes       | No     | No                    | **Optional**        | App functionality            |
| Device or other IDs (install ID; Sentry install ID)       | 1, 5 | Yes       | No     | No                    | Required            | App functionality            |
| App activity → App interactions                           | 2, 3 | Yes       | No     | No                    | Required            | App functionality, Analytics |
| App activity → Other user-generated content               | 6    | Yes       | No     | No                    | **Optional**        | App functionality            |
| App info and performance → Crash logs                     | 5    | Yes       | No     | No                    | Required            | App functionality            |
| App info and performance → Diagnostics                    | 4, 5 | Yes       | No     | No                    | Required            | App functionality            |
| App info and performance → Other app performance data     | 5    | Yes       | No     | No                    | Required            | App functionality            |

Not declared: Name, Email, Location, Financial info (no purchases in v1.0), Photos, Audio (no recording: the Android manifest has no
`RECORD_AUDIO`), Contacts. Google's form has no IP-address type. This **supersedes #2014's checklist**.

## Age rating questionnaires — things to decide, not answers

- **Blackjack is simulated gambling.** Answer the simulated-gambling questions truthfully (play chips only, no real money, no
  prizes, no purchases). Expect it to raise the rating on both stores; check the regional effect in both consoles' previews.
  Fallback: hide Blackjack in v1.0 with the visibility gate (`gameVisibility.ts`), before screenshots.
- Keep the rating consistent with the policy's "not directed at children under 13".
- **User-to-user communication: none. User-generated content visible to others: none** (leaderboard names are
  server-generated from curated word lists; players cannot type public text, so no UGC moderation/reporting flow applies, see
  `LEADERBOARD-IDENTITIES.md`). No web access, no location sharing, no purchases in v1.0.

## Before each submission

1. `privacy-policy.html` ↔ this file ↔ `PrivacyInfo.xcprivacy` ↔ `DATA-INVENTORY.md` still agree.
2. Both store forms match the tables above; record the accepted/no-warning status (or unresolved warnings) on #2779.
3. `https://buffingchi.com/privacy` and `/terms` resolve, show the updated policy, and the Settings links open them (#1922, #2780).
4. Owner has approved the legal wording.

## Premium update (not v1.0)

Purchases ([`IAP.md`](IAP.md)) add Apple **Purchases → Purchase History** / Google **Financial info → Purchase history**
(linked, App Functionality), entitlement records in `game_entitlements`, and store-verification calls. Re-run the inventory and
update all three artefacts before that release.
