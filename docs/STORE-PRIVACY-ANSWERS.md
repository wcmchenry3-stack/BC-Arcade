# Store privacy declarations — answers to paste (v1.0)

For **#823** (App Store Connect → App Privacy), **#825 / #2014** (Play Console → Data safety) and the
age-rating questionnaires. Derived from the code, not from memory — sources are in
[`LEGAL-REVIEW-NOTES.md`](LEGAL-REVIEW-NOTES.md) and [`ATT-AUDIT.md`](ATT-AUDIT.md). The three places
that must agree: [`privacy-policy.html`](privacy-policy.html), the iOS privacy manifest
(`frontend/ios/GamingApp/PrivacyInfo.xcprivacy`) and these forms.

> Draft prepared by an AI assistant. The declarations are the publisher's legal statements — review
> before submitting. **Re-check this file whenever a data flow changes** (IAP, accounts, analytics, ads).

## What the app actually collects

| #   | Data                                                                          | Where it goes                                                 | Keyed to                       | Optional?                   |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------ | --------------------------- |
| 1   | Random per-install session ID (`X-Session-ID`)                                | Our API → Postgres (`games`, `game_entitlements`, `bug_logs`) | —                              | No                          |
| 2   | Game records: game, start/end, duration, outcome, score, per-session settings | Our API → Postgres                                            | session ID                     | No                          |
| 3   | Per-move event logs                                                           | Our API → Postgres (`game_events`)                            | session ID (via the game)      | No                          |
| 4   | Automatic warn/error log entries                                              | Our API → Postgres (`bug_logs`)                               | session ID                     | No                          |
| 5   | Crash, performance and diagnostic reports                                     | Sentry                                                        | nothing (no `setUser`)         | No                          |
| 6   | Feedback text + recent console logs                                           | Sentry User Feedback                                          | nothing (no name / email / ID) | **Yes** — only if submitted |
| 7   | IP address in request logs                                                    | Render (hosting) logs                                         | not joined to anything         | No                          |

Not collected: name, email, phone, contacts, location, photos, advertising ID, purchases, health,
financial or browsing data. No ads, no third-party analytics SDK, no tracking (`ATT-AUDIT.md`).
XP, level, statistics and leaderboard positions are **computed** from rows 2–3, not separately collected.

## Apple — App Privacy

**"Do you or your third-party partners collect data from this app?"** → **Yes.**

| Apple data type                         | Rows | Collected | Linked to the user | Used for tracking | Purposes                     |
| --------------------------------------- | ---- | --------- | ------------------ | ----------------- | ---------------------------- |
| Identifiers → **User ID**               | 1    | Yes       | **Yes**            | No                | App Functionality            |
| Usage Data → **Product Interaction**    | 2    | Yes       | **Yes**            | No                | App Functionality, Analytics |
| User Content → **Gameplay Content**     | 2, 3 | Yes       | **Yes**            | No                | App Functionality, Analytics |
| User Content → **Customer Support**     | 6    | Yes       | No                 | No                | App Functionality            |
| Diagnostics → **Crash Data**            | 5    | Yes       | No                 | No                | App Functionality            |
| Diagnostics → **Performance Data**      | 5    | Yes       | No                 | No                | App Functionality            |
| Diagnostics → **Other Diagnostic Data** | 4, 5 | Yes       | No                 | No                | App Functionality            |

Everything else → not collected. IP addresses are not an Apple data type unless used to derive
location, which the app does not do.

**Why "Linked: Yes" for the first three, even though we never know who the player is.** Apple counts
data as linked when it is tied to the user's identity "via their account, device, or details". A
persistent per-install ID that lets the player — and us — retrieve their history is a device-level
link, and nothing is stripped before collection. "Not linked" is what some publishers pick for
pseudonymous IDs; it is the riskier answer, and the label's wording ("Data Linked to You": gameplay
content, user ID) is harmless for a game. Over-declaring has no review cost; under-declaring does.
Row 4 rides with diagnostics as "not linked" on the label because Apple's Diagnostics category is
about the data's nature; if you prefer strict consistency, mark Other Diagnostic Data as linked too.

**Privacy manifest:** `PrivacyInfo.xcprivacy` now declares the same seven types with the same
linked / tracking values (it previously listed only the three Sentry diagnostics types).
`NSPrivacyTracking` stays `false`; no tracking domains.

**Privacy Policy URL:** `https://buffingchi.com/privacy` (must be live — #828).
**Privacy Choices URL:** leave blank (deletion is in-app: Settings → Delete my data).

## Google Play — Data safety

**Collects or shares user data?** Yes · **Encrypted in transit?** Yes (HTTPS only) ·
**Can users request deletion?** Yes — in the app (Settings → Delete my data). No account exists, so
the account-deletion URL requirement does not apply · **Shared with third parties?** **No** — Render,
Supabase and Sentry are service providers processing on our behalf, which Google's form does not
count as sharing · **Independent security review?** No · **Families policy / designed for children?** No.

| Google data type                                      | Rows | Collected | Shared | Processed ephemerally | Required / optional | Purposes                     |
| ----------------------------------------------------- | ---- | --------- | ------ | --------------------- | ------------------- | ---------------------------- |
| Device or other IDs                                   | 1    | Yes       | No     | No                    | Required            | App functionality            |
| App activity → App interactions                       | 2, 3 | Yes       | No     | No                    | Required            | App functionality, Analytics |
| App activity → Other user-generated content           | 6    | Yes       | No     | No                    | **Optional**        | App functionality            |
| App info and performance → Crash logs                 | 5    | Yes       | No     | No                    | Required            | App functionality, Analytics |
| App info and performance → Diagnostics                | 4, 5 | Yes       | No     | No                    | Required            | App functionality, Analytics |
| App info and performance → Other app performance data | 5    | Yes       | No     | No                    | Required            | App functionality, Analytics |

This **supersedes #2014's checklist**, which predates server-side scoring and lists crash logs and
diagnostics only.

## Age rating questionnaires — things to decide, not answers

- **Blackjack is simulated gambling.** Answer the simulated-gambling questions truthfully (play
  chips only, no real money, no prizes, no purchases). Expect it to raise the rating on both stores,
  and check the regional effect before submitting: PEGI has rated new titles with simulated gambling
  18 since 2020, and some countries restrict simulated-gambling apps outright. **Verify the current
  rules in both consoles' previews** — if the resulting rating is unacceptable, the fallback is to
  hide Blackjack in v1.0 with the existing visibility gate (`gameVisibility.ts`), which is a small
  change but must happen before screenshots (Oct 3).
- Keep the rating consistent with the policy's "not directed at children under 13".
- No user-to-user communication, no user-generated content visible to others, no web access, no
  location sharing, no purchases in v1.0.

## Before each submission

1. `privacy-policy.html` ↔ this file ↔ `PrivacyInfo.xcprivacy` still agree.
2. Both store forms match the tables above.
3. `https://buffingchi.com/privacy` and `/terms` resolve, and the Settings links open them (#1922).
