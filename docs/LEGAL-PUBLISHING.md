# Legal and support pages: publishing record

**Status: release/legal (#2780, part of #2777).** Records the final public URLs for the Privacy Policy, Terms of Service and
Support page, which repo file backs each one, how they are hosted, and the owner's approval. The policy text itself is covered by
[`LEGAL-REVIEW-NOTES.md`](LEGAL-REVIEW-NOTES.md) and [`DATA-INVENTORY.md`](DATA-INVENTORY.md) (#2779). This file is not legal
advice. The documents were drafted from the codebase and need owner and legal review before they are published.

## 1. Final URLs

| URL                                          | Backing file in this repo                                      | Used by                                                                                                                                |
| -------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `https://buffingchi.com/privacy`             | [`docs/privacy-policy.html`](privacy-policy.html)              | `PRIVACY_POLICY_URL`: Settings legal row, Paywall (premium update); App Store Connect Privacy Policy URL; Play Console privacy policy  |
| `https://buffingchi.com/terms`               | [`docs/terms-of-service.html`](terms-of-service.html)          | `TERMS_OF_SERVICE_URL`: Settings legal row, Paywall (premium update)                                                                   |
| `https://buffingchi.com/support`             | [`docs/support.html`](support.html)                            | `SUPPORT_URL`: Paywall "contact support" (premium update, `not_linkable`); App Store Connect Support URL; Play Console website/contact |
| `https://buffingchi.com/support#delete-data` | [`docs/support.html`](support.html) section `id="delete-data"` | **Play Console → App content → Data safety → "Delete account URL"** (data deletion web resource). Not linked from the app              |

**Delete account URL (Google Play).** Play requires apps that let users create an account to give a web page, usable without
reinstalling the app, where users can request deletion of their account and data. Apple counts auto-generated "guest" accounts
as accounts, and BC Arcade's anonymous install ID behaves like one, so v1.0 treats the URL as required. The "Delete your data"
section of the support page names the app and developer, gives the in-app steps (Settings → Delete my data), says what is
deleted and what is kept and for how long (consistent with the privacy policy), and gives an email fallback. Keep the
`delete-data` anchor stable; it is entered in Play Console.

The first three URLs live in `frontend/src/config/legal.ts` and are pinned by `frontend/src/config/__tests__/legal.test.ts`. If the owner
changes a URL, change `legal.ts`, that test, this table, [`STORE-LISTING.md`](STORE-LISTING.md),
[`STORE-PRIVACY-ANSWERS.md`](STORE-PRIVACY-ANSWERS.md) and both consoles together.

The pages are English only. Translating them is out of scope for this release (#2780). Only the in-app link labels are localized.

## 2. Hosting: how these URLs are served

**Nothing in this repository publishes `buffingchi.com/privacy`, `/terms` or `/support`.** Checked 2026-09-30:

- `render.yaml` defines four Render services. Only the two static sites serve HTML (`bc-arcade-frontend` at
  `games.buffingchi.com`, `bc-arcade-frontend-dev` at `dev-games.buffingchi.com`). Both publish the Expo Web export
  (`frontend/dist`) and nothing from `docs/`. Neither is bound to the apex `buffingchi.com`.
- No GitHub Actions workflow deploys `docs/` or anything to the apex domain. There is no Cloudflare Pages or Workers config
  (`wrangler.toml`), `CNAME`, `_redirects` or `public/` site in the repo.
- `docs/RELEASE-PLAN-2026-10.md` lists "DNS/hosting for buffingchi.com legal pages" as a manual owner task. DNS for
  `buffingchi.com` is on Cloudflare (the `games` / `games-api` CNAMEs are there).

So `docs/*.html` are the **source** for the pages, not what is served. Until the owner publishes them, the URLs in the app
and the consoles are whatever the apex domain serves today, which was not checked from here (outbound access to
`buffingchi.com` was blocked in the session that wrote this).

**What the owner needs to do** (any static host works. Cloudflare Pages is the simplest because DNS is already there):

1. Resolve every `[OWNER TO CONFIRM: …]` marker (section 3) and get legal sign-off.
2. Publish the three files so that `/privacy`, `/terms` and `/support` return `200` with `Content-Type: text/html`, publicly,
   with no login and no PDF. Example with Cloudflare Pages (direct upload): upload a folder containing `privacy.html`,
   `terms.html` and `support.html` (copies of the three docs files). Pages serves `privacy.html` at `/privacy`, and so on.
   Attach `buffingchi.com` as the project's custom domain, or use Cloudflare redirect rules if another site already serves the
   apex domain.
3. Check: `curl -sI https://buffingchi.com/privacy` (and `/terms`, `/support`) shows `200` and `text/html`, and the page
   matches the approved commit.
4. Republish by hand whenever these files change. No automation copies them.

## 3. Owner-supplied values (`[OWNER TO CONFIRM]` markers)

Nothing below may be filled in by an assistant. Replace each marker with the confirmed value, or delete it if the drafted text
is confirmed as correct. Then run `grep -n "OWNER TO CONFIRM" docs/*.html`. It must print nothing.

| #   | Decision                                                                                                                                                                                                                                                                                                                       | Where                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Publisher **legal name** (Buffing Chi, or the registered person/entity)                                                                                                                                                                                                                                                        | privacy-policy "Your Rights" (GDPR controller); terms intro + §17 Contact; support Contact                                                                          |
| 2   | Publisher **postal address** (GDPR Art. 13)                                                                                                                                                                                                                                                                                    | privacy-policy "Your Rights"; terms §17                                                                                                                             |
| 3   | **Contact / support email** (currently `buffingchi@gmail.com`): keep, or use a domain address                                                                                                                                                                                                                                  | privacy-policy Contact; terms §17; support Contact. If changed, also replace the plain `buffingchi@gmail.com` mentions in the policy's deletion and rights sections |
| 4   | Terms **effective date** (the day the approved version goes live)                                                                                                                                                                                                                                                              | terms header                                                                                                                                                        |
| 5   | Terms **liability cap** amount                                                                                                                                                                                                                                                                                                 | terms §9                                                                                                                                                            |
| 6   | Terms **governing-law jurisdiction** (state / country)                                                                                                                                                                                                                                                                         | terms §13                                                                                                                                                           |
| 7   | Sentry **"Prevent Storing of IP Addresses"** turned on                                                                                                                                                                                                                                                                         | privacy-policy "Crash and performance reports"                                                                                                                      |
| 8   | Sentry **retention** is 90 days on the current plan (4 markers)                                                                                                                                                                                                                                                                | privacy-policy "Crash and performance reports", "Feedback you choose to send", "How Long We Keep It"; support "What is kept"                                        |
| 9   | **Maximum retention** for inactive sessions (or confirm "until you delete" only)                                                                                                                                                                                                                                               | privacy-policy "How Long We Keep It"; support "Delete your data" → "What is kept"                                                                                   |
| 10  | Supabase **backup window**                                                                                                                                                                                                                                                                                                     | privacy-policy "How Long We Keep It"; support "What is kept"                                                                                                        |
| 11  | **Email fallback for data deletion**: is it acceptable, given an email cannot be matched to or verify an install ID? (Options: keep it as help-only, as drafted; or drop it and rely on the in-app button; or add a verifiable route, e.g. showing the install ID in Settings for the user to quote.) Also confirm the address | support "Delete your data" → "If you cannot use the app"                                                                                                            |

That is 21 markers in total: 8 in the privacy policy, 7 in the terms and 6 on the support page (some decisions appear in more
than one place).

Related owner decisions that have no marker but block approval (from `LEGAL-REVIEW-NOTES.md` and `DATA-INVENTORY.md`):

- Accept the processors' DPAs (Sentry, Supabase, Render, Cloudflare).
- Diagnostics consent decision (DATA-INVENTORY §7) and the IP-address declaration approach (DATA-INVENTORY "Owner confirmations").
- Delete legacy feedback issues from the old Cloudflare-worker path if any hold personal text.
- Keep the store age rating consistent with "not directed at children under 13".

## 4. Product facts the documents rely on (v1.0)

Re-check these when the product changes, and update all three pages together.

- **No user-generated content.** Leaderboard names are generated by the server and cannot be edited as free text (#2778). Joining
  is optional (Join / Leave leaderboards in Profile). No chat, messaging or public profile text exists. So no UGC rules or
  acceptance flow are needed. Terms §4 states this. If editable public names or any other shared content is added, publish UGC
  rules (reporting, blocking, moderation) and obtain acceptance **before** submission (#2780 acceptance criterion).
- **No purchases in v1.0.** Terms §5A describes the premium update's one-time, per-game, store-billed purchases in future tense.
  The privacy policy says v1.0 has no purchases, and the support page says the app is free. **For the premium update**: revise
  the privacy policy (purchase records, Apple/Google as verifiers; see DATA-INVENTORY "Premium update"), change terms §5A
  to present tense, add a "Restore purchases" FAQ to the support page, then re-approve all three (#2790).
- Delete My Data, Leave leaderboards and the local-only data are described the same way in the policy and on the support page.
  The support page's "What is kept" list mirrors the policy's "How Long We Keep It". **For the premium update**, add the
  purchase-record retention statement (store transaction IDs and ownership records, and how long they are kept after Delete my
  data, e.g. for refunds and restore) to both the policy and the support page's delete-data section before submission.

## 5. In-app link wiring (verified 2026-09-30)

| Surface                                                    | URL constant                                 | Label key(s)                                                   | Opens with                                                | Tests                                                                         |
| ---------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Settings → legal row (store build)                         | `PRIVACY_POLICY_URL`, `TERMS_OF_SERVICE_URL` | `legal.privacyPolicy`, `legal.termsOfService` (all 13 locales) | `Linking.openURL` (system browser). Failures go to Sentry | `SettingsScreen.test.tsx` (press opens exact URL, `accessibilityRole="link"`) |
| Paywall → Terms / Privacy (premium update, hidden in v1.0) | `TERMS_OF_SERVICE_URL`, `PRIVACY_POLICY_URL` | `common:legal.termsOfService`, `common:legal.privacyPolicy`    | `Linking.openURL`                                         | `PaywallScreen.test.tsx` (press opens each URL)                               |
| Paywall → Contact support (`not_linkable`, premium update) | `SUPPORT_URL`                                | `common:paywall.contactSupport` (all 13 locales)               | `Linking.openURL`                                         | `PaywallScreen.test.tsx`                                                      |
| URL values                                                 | all three                                    | —                                                              | —                                                         | `config/__tests__/legal.test.ts`                                              |

The v1.0 store build has no in-app support link. Support is reached through the store listings' Support URL and the in-app
feedback form. The policy and terms are English only (see section 1).

## 6. Owner approval checklist

Tick each item and link evidence (screenshot, curl output, console screenshot).

- [ ] Legal review of `docs/privacy-policy.html` completed
- [ ] Legal review of `docs/terms-of-service.html` completed
- [ ] Support page `docs/support.html` reviewed
- [ ] All `[OWNER TO CONFIRM]` markers resolved (`grep -n "OWNER TO CONFIRM" docs/*.html` prints nothing)
- [ ] Publisher legal name and contact email confirmed and identical on all three pages
- [ ] Hosting done: `/privacy`, `/terms`, `/support` (with the `#delete-data` section) return 200 `text/html`, public, no login, match the approved commit
- [ ] Links verified on a **real iOS** store-configuration build (Settings → Privacy Policy, Terms of Service open the hosted pages)
- [ ] Links verified on a **real Android** store-configuration build (same)
- [ ] App Store Connect: **Privacy Policy URL** = `https://buffingchi.com/privacy`, **Support URL** = `https://buffingchi.com/support`
- [ ] Play Console: **Privacy policy** = `https://buffingchi.com/privacy`. **Contact details**: email and website
      (`https://buffingchi.com/support`) filled in
- [ ] Play Console → Data safety: **Delete account URL** = `https://buffingchi.com/support#delete-data`, and the page opens in a
      browser without the app installed
- [ ] Owner decision #11 (email fallback for deletion) made
- [ ] Row in `RELEASE-ACCEPTANCE-v1.0.md` §4 "Legal" ticked for both platforms

## 7. Approved versions

Fill in when the owner approves. A version is the git commit of the file that was published.

| Document         | URL                              | Approved commit SHA | Effective / last-updated date | Approved by | Date approved |
| ---------------- | -------------------------------- | ------------------- | ----------------------------- | ----------- | ------------- |
| Privacy Policy   | `https://buffingchi.com/privacy` |                     |                               |             |               |
| Terms of Service | `https://buffingchi.com/terms`   |                     |                               |             |               |
| Support          | `https://buffingchi.com/support` |                     |                               |             |               |

**Version approved:** \_\_\_\_\_\_\_\_ (owner)
