# In-App Purchases — Premium Access Contract

**Status:** contract for owner review (#2785). The backend core has shipped
(#840): the `purchases` / `purchase_links` / `purchase_events` schema,
`POST /purchases/{apple,google}`, link caps, derived `game_entitlements` and
the store-verifier interface (§8.4). Real store verification, webhooks and
crons (#2786 Apple, #2787 Google) and the paywall (#841) have not shipped;
until they do, the purchase routes answer `503 store_unavailable`. Those
stories build to the interfaces defined here. Where this document and an older issue disagree,
this document wins; where it and shipped code disagree, fix one of them in the
same PR.

Related: [PRODUCT.md — Monetization](PRODUCT.md#monetization) (product rules),
[ARCHITECTURE.md §10](ARCHITECTURE.md#10-premium-entitlements) (the entitlement
system this reuses), [../SECURITY.md](../SECURITY.md) "IAP / Paid-Entitlement
Readiness Gate" (security requirements this must satisfy).

---

## 1. Decisions at a glance

| Topic                  | Decision                                                                                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Packaging              | **One non-consumable product per game.** No bundle in the first paid catalog.                                                                                         |
| First paid catalog     | All five premium games: Blackjack, Star Swarm, Cascade, Hearts, Mahjong.                                                                                              |
| Model                  | One-time purchase, lasting access, unlimited replay. Never lives, attempts, continues, chips, currency, levels or subscriptions.                                      |
| Free games             | Stay free and complete, with no payment prompt.                                                                                                                       |
| Product IDs            | `com.buffingchi.games.premium.<game_slug>`, identical on App Store Connect and Play Console.                                                                          |
| Client library         | [`expo-iap`](https://www.npmjs.com/package/expo-iap) `~5.8.2` for both platforms (StoreKit 2 on iOS, Play Billing Library 9.1 on Android).                            |
| Server verification    | Apple: signed-transaction (JWS) verification plus App Store Server API. Google: Play Developer API. The client's "success" is never trusted.                          |
| Entitlement system     | Reuse `game_entitlements` + `GET /entitlements` RS256 JWT. A new `purchases` table records store evidence and feeds `game_entitlements`; no second entitlement model. |
| Restore                | Via verified store ownership on the same store account, after reinstall or on a new device. No sign-in required. Capped links per purchase (§4).                      |
| Cross-platform sharing | **Not supported and not promised.** An App Store purchase does not unlock Android, or the reverse.                                                                    |
| Family Sharing         | **Recommended: enable for all five Apple products** (owner sign-off required; it cannot be turned off once on). Not available for Google Play one-time products.      |
| Refresh policy         | Keep the 24-hour JWT and 7-day offline grace.                                                                                                                         |
| v1.0 visibility        | Premium games stay compiled-hidden (`HIDDEN_GAMES`) until the binary that contains the reviewed purchase flow. No server-side unhide.                                 |
| Web                    | No purchases on web. Premium games stay hidden there (ARCHITECTURE §10.7).                                                                                            |

---

## 2. Catalog

The catalog lives in one file:
[`frontend/src/entitlements/premiumProducts.json`](../frontend/src/entitlements/premiumProducts.json),
wrapped by `premiumProducts.ts` (`PREMIUM_PRODUCTS`, `PremiumGameSlug`,
`isPremiumGameSlug`, `productIdForGame`, `gameForProductId`).

| Game       | `game_types.name` (slug) | Product ID                               | Store type (Apple / Google)             |
| ---------- | ------------------------ | ---------------------------------------- | --------------------------------------- |
| Blackjack  | `blackjack`              | `com.buffingchi.games.premium.blackjack` | Non-Consumable / one-time, not consumed |
| Cascade    | `cascade`                | `com.buffingchi.games.premium.cascade`   | Non-Consumable / one-time, not consumed |
| Hearts     | `hearts`                 | `com.buffingchi.games.premium.hearts`    | Non-Consumable / one-time, not consumed |
| Mahjong    | `mahjong`                | `com.buffingchi.games.premium.mahjong`   | Non-Consumable / one-time, not consumed |
| Star Swarm | `starswarm`              | `com.buffingchi.games.premium.starswarm` | Non-Consumable / one-time, not consumed |

**Drift guards** (both run in CI):

- `frontend/src/entitlements/__tests__/premiumProducts.test.ts` — the catalog
  equals `PREMIUM_GAMES` and matches `PremiumGameSlug`, every `HIDDEN_GAMES`
  entry is purchasable (a subset check: a game could be hidden for other
  reasons, but a hidden premium game must have a product), and every ID follows
  the convention.
- `backend/tests/test_premium_products.py` — the catalog equals the
  `game_types.is_premium` rows after migrations (read straight from the table,
  so an inactive premium game still counts) and `_ALL_PREMIUM_SLUGS`.

So a tier change (a migration flipping `is_premium`) fails CI until the catalog
changes with it. #2460 still owns folding `_ALL_PREMIUM_SLUGS` into a query.

**The backend does not read the JSON at runtime** (the Render service is built
from `backend/` only). #840 derives the product ID from the slug with the same
prefix and accepts a product only if `game_types.is_premium` is true for the
slug. The backend drift test keeps the two in step.

**No new catalog endpoint.** `GET /games/catalog` (rate-limited, cached 5 min)
already exposes `is_premium`, and prices must come from the store (below), so a
separate `/iap/catalog` would only duplicate data. The paywall reads the game
name and art from the existing client registry, the product ID from
`premiumProducts.ts`, and the price from the store.

### Product-ID rules

- The same string on both stores. Play allows only lowercase letters, digits,
  `_` and `.`, and the ID must start with a letter or digit. App Store Connect
  allows letters, digits, `_` and `.`. The convention fits both. The tests
  also cap the length at 40 characters as a safety margin; the longest ID
  today is 38.
- **Neither store lets you reuse a product ID, even after deleting it.** Do
  not create products for testing under these IDs. Never rename one.
- A future premium game adds one line to the JSON (plus the `is_premium`
  migration). A future bundle would be a new product ID mapping to several
  slugs. That is out of scope here, and the JSON's shape (`gameSlug` per
  product) would need a `gameSlugs` array. It is recorded here so nobody
  reuses a per-game ID for it.

### Store metadata

Price tier, display name and description are set in each store console and
localized there. The app always shows the store's `displayPrice` string and
never hardcodes a price. The price tier is an owner decision (§17). The
description must say "one-time purchase, unlimited play" and must not mention
lives, chips or continues.

---

## 3. Product rules this contract enforces

From [PRODUCT.md](PRODUCT.md#monetization), made concrete:

1. A purchase grants **access to one whole game**, for good, with unlimited
   replay. Blackjack chips stay in-game, cannot be bought, and are never tied
   to the purchase.
2. No consumables. Google purchases are **never consumed**. Apple products are
   Non-Consumable.
3. The paywall is reached **only by a user action**: tapping a premium tile, or
   Settings → Restore purchases. It is never shown at a loss, after a game ends,
   on a timer or on a streak.
4. An entitlement change (a refund, say) **never interrupts a game already in
   progress** (ARCHITECTURE §10.3).
5. Free games never touch the purchase code path.

---

## 4. Ownership model

Current state: the only identity is the anonymous `X-Session-ID` UUID (one per
install). SECURITY.md §11 requires that a bare session ID is **not** the only
proof that a caller owns a purchase. The old rule "no restore until SSO (#144)"
is **withdrawn**.

**The store purchase is the unit of ownership. Sessions are where it is
currently used.**

- A `purchases` row is keyed by the store's identity for the purchase. For
  Apple that is `originalTransactionId`; for Google, the `purchaseToken`. The
  row exists once, however often it is presented.
- A session is linked to a purchase by a `purchase_links` row (§8.1). A
  session gets a game only through a `game_entitlements` row derived from a
  link to a verified, `owned` purchase.
- **Proof of ownership is store-signed evidence that the server verifies**:
  a JWS from Apple, checked against Apple's root CA and then with the App
  Store Server API, or a Google token checked with the Play Developer API.
  That evidence is only on a device signed in to the buying store account. A
  client-supplied product ID or success flag is never enough.
- **Initial purchase binding.** When a purchase starts, the client passes a
  one-way derivative of the session identity into the store purchase. The raw
  `X-Session-ID` never leaves the app except in our own API header; it is
  never given to Apple or Google, so it cannot be read back out of a
  transaction, a receipt or a store report.
  - Apple: `appAccountToken = uuid5(APP_ACCOUNT_NS, X-Session-ID)`. StoreKit
    requires a UUID, and a name-based v5 UUID is a UUID. `APP_ACCOUNT_NS` is a
    fixed namespace UUID shared by client and server (a constant, not a
    secret): **`9be30341-bb1d-44c0-a581-03038f538fe9`**
    (`backend/purchases/apple.py`). Never change it; every earlier purchase's
    ownership check depends on it.
  - Google: `obfuscatedAccountId = hex(SHA-256(X-Session-ID))`, 64 characters,
    within Play's limit.

  The server records the token, recomputes the expected value from the calling
  session's `X-Session-ID`, and compares. On `source: "purchase"`, a mismatch
  is rejected (`403 ownership_mismatch`). Only a transaction returned by a
  `purchase()` call started in this app process is posted as `"purchase"`
  (§5).

- **Restore / new device / reinstall — the designed transfer rule.** The same
  verified purchase can be linked to another session (`source` `"restore"` or
  `"sync"`). One store account legitimately uses several installs (an iPhone and
  an iPad, or a reinstall), so cross-session linking is allowed, but capped:
  - A purchase may be linked to at most **`MAX_SESSIONS_PER_PURCHASE = 5`**
    sessions. A link beyond that is **rejected** (`409 link_limit`). Nothing
    is evicted, so a leaked transaction cannot push the real owner's
    installs out.
  - Additionally, at most **`MAX_NEW_LINKS_PER_PURCHASE_PER_30D = 3`** new
    sessions may be linked per purchase in any rolling 30 days, also
    `409 link_limit`. Re-presenting from an already-linked session is not a
    new link and is always allowed.
  - Both limits count `purchase_links` rows (§8.1).
  - **Unlinking happens only via support** (for example a user who has
    reinstalled more than five times). There is no self-service unlink.
  - Per-IP and per-`store_key` rate limits (§8.2) slow down anyone trying to
    spray one transaction across many sessions.

  This is the "explicitly designed transfer rule" that SECURITY.md §10, §11
  and §14 allow. Both constants are owner-tunable (§17).

- Every link, rejected link and support unlink is logged (purchase ID, session
  hash, source) for support and abuse review. Raw tokens are never logged.
- **Future accounts (#144/#1047).** When an optional account exists, purchases
  can also link to `player_id`. Nothing in this model has to be migrated for
  that; `purchases` stays the source of truth.

**Residual risk (accepted, for owner sign-off).** Someone who pulls a valid JWS
or token off their own device could share it with up to four other installs
(at most three in any 30 days), after which the purchase refuses new links,
including the buyer's own. Rate limits, the link caps and the audit log keep
this small and visible. True binding to a person, rather than to a capped set
of installs, needs accounts (#144); Apple's per-device `deviceVerification`
binding is optional hardening for later. Neither is required for launch.

---

## 5. Purchase lifecycle

"Finish" means Apple `Transaction.finish()` or Google acknowledgement, done by
`expo-iap`'s `finishTransaction({ purchase, isConsumable: false })`.

| State / event                                  | Client behavior                                                                                                                                          | Server effect                                                                                                 | Finish?                                                              |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Success**                                    | Send evidence to `POST /purchases/{apple,google}` (`source` per the rule below), apply the returned token, open the game.                                | Verify, upsert `purchases` (state `owned`), link session in `game_entitlements`, and on Google acknowledge.   | **After** the server returns `owned` (after persistence).            |
| **User cancel**                                | Return to the paywall silently. No error toast.                                                                                                          | None.                                                                                                         | Nothing to finish.                                                   |
| **Pending** (Ask to Buy, Play pending payment) | Show "Waiting for approval". No access. The purchase finishes later through the transaction listener.                                                    | Google: `state=pending` row if reported, never linked. Apple: nothing until the transaction arrives.          | No.                                                                  |
| **Pending → completed**                        | The listener (running from app start) receives it and runs the Success path with `source: "sync"`, even if the paywall is closed.                        | As Success.                                                                                                   | After persistence.                                                   |
| **Pending → cancelled/declined**               | Clear the "waiting" state.                                                                                                                               | Google RTDN `ONE_TIME_PRODUCT_CANCELED` marks the row `cancelled`.                                            | n/a                                                                  |
| **Interrupted** (killed/crashed after charge)  | On next launch the adapter handles unfinished transactions (Apple `Transaction.unfinished`/updates, Google `queryPurchases`) and posts `source: "sync"`. | Idempotent upsert.                                                                                            | After persistence.                                                   |
| **Server unreachable after charge (offline)**  | "Purchase received — it unlocks when you're back online." Retry on reconnect/foreground with backoff.                                                    | Google: RTDN lets the server verify and acknowledge without the client (§7.4).                                | **No** until the server confirms. The store redelivers.              |
| **Server verification fails (400/422)**        | Generic error, Sentry event, no access.                                                                                                                  | Nothing granted.                                                                                              | No. Google will auto-refund an unacknowledged purchase after 3 days. |
| **Valid purchase, not linkable (403/409)**     | `ownership_mismatch` or `link_limit`: no access on this install. Show "This purchase can't be used here — contact support" with a support link.          | Store evidence verified and the `purchases` row kept (audit). No link. `purchase_events` records the refusal. | **Yes.** The purchase is real; see below.                            |
| **Server transient error (5xx/503)**           | As "server unreachable".                                                                                                                                 | None.                                                                                                         | No.                                                                  |
| **Already owned**                              | The paywall shows "Owned" or navigates straight in. A buy attempt that returns "already owned" runs Restore for that product.                            | Idempotent.                                                                                                   | n/a                                                                  |
| **Refund / revocation**                        | The next token refresh drops the game. `EntitlementContext` clears that game's local state. A game in progress plays on.                                 | Notification sets the row to `revoked`; the game drops from linked sessions' `game_entitlements`.             | n/a                                                                  |
| **Refund reversed** (Apple `REFUND_REVERSED`)  | Access returns on the next token refresh.                                                                                                                | Row back to `owned`. Existing `purchase_links` restore access at once.                                        | n/a                                                                  |
| **Reinstall, same device**                     | Silent **sync** on first launch (below), then an explicit Restore button if needed.                                                                      | Link the new session (subject to the link caps, §4).                                                          | n/a                                                                  |
| **New device, same store account**             | As reinstall.                                                                                                                                            | As reinstall.                                                                                                 | n/a                                                                  |
| **Different store account / other platform**   | Not restorable. The paywall shows the price.                                                                                                             | None.                                                                                                         | n/a                                                                  |
| **Offline, already entitled**                  | Cached JWT, then up to 7 days of grace (§10).                                                                                                            | None.                                                                                                         | n/a                                                                  |

**Which `source` to send.** `source: "purchase"` is sent **only** for the
transaction returned by a `purchase()` call started in this app process. Every
other transaction is `source: "sync"`: those from the transaction listener
(Ask to Buy approval, a purchase on another device), unfinished transactions
at launch, and `getAvailablePurchases`. The explicit Restore button sends
`source: "restore"`, which the server treats exactly like `"sync"` except in
the audit log. Only `"purchase"` checks the account token (§4). A transaction
that arrives outside `purchase()` may belong to another install's session
(a second device, a reinstall), so it must not be judged as a fresh purchase.

**Finish on `ownership_mismatch` and `link_limit`.** Both mean the server
verified real store evidence and kept the `purchases` row; they only refuse to
link _this_ session. Leaving the transaction unfinished would not help:
Apple would redeliver it at every launch for ever, and Google would
auto-refund a purchase the user really paid for after 3 days. So the client
finishes or acknowledges it, and the user is sent to support, which can unlink
old installs (§4).

**Silent sync (both platforms).** At launch, once `EntitlementContext` has
loaded, the adapter lists owned products without any UI. That is
`getAvailablePurchases` (Apple `Transaction.currentEntitlements`, Google
`queryPurchasesAsync`), and on iOS it never prompts for a password. For any
owned product whose game is **not** in the current `entitled_games`, the
adapter posts it with `source: "sync"`. So a reinstall usually restores itself
with no user action. The explicit **Restore Purchases** button also calls
`AppStore.sync()` (which may prompt for the Apple ID password) and posts with
`source: "restore"`. Apple requires a visible restore action; Guideline 3.1.1.

---

## 6. Apple (iOS) — #2786

### 6.1 Client

- `expo-iap` StoreKit 2 path. The deployment target is 16.4 already, above
  StoreKit 2's 15.0 minimum.
- Start the transaction listener (`purchaseUpdatedListener`) **at app start**,
  not only when the paywall is open, so Ask-to-Buy approvals, interrupted
  purchases and purchases made on another device are handled.
- `requestPurchase({ request: { ios: { sku, appAccountToken } } })`, where
  `appAccountToken = uuid5(APP_ACCOUNT_NS, sessionId)` (§4). Never pass the raw
  session ID.
  Send the transaction's `purchaseToken` / JWS (`jwsRepresentation`) to the
  server. Never send the legacy app receipt.
- Treat `ownershipTypeIOS` `PURCHASED` and `FAMILY_SHARED` alike on the client.
  The server decides.
- The In-App Purchase capability is on by default. No entitlement file change is
  needed. `frontend/ios/` stays committed and buildable (Xcode Cloud).

### 6.2 Server verification

- Library: Apple's official
  [`app-store-server-library`](https://pypi.org/project/app-store-server-library/)
  (Python, `3.1.x`), using `SignedDataVerifier` with Apple's root certificates.
  The root certificates are public and may be committed under
  `backend/purchases/apple_roots/`.
- **One verifier and one API client per allowed environment.** The library's
  `SignedDataVerifier` and `AppStoreServerAPIClient` are each bound to one
  environment. At startup, build a `SignedDataVerifier` and an
  `AppStoreServerAPIClient` for every environment in `APPLE_IAP_ENVIRONMENTS`
  (§6.4): the Production pair uses `APPLE_APP_ID` and
  `api.storekit.itunes.apple.com`, the Sandbox pair uses
  `api.storekit-sandbox.itunes.apple.com`.
- Steps:
  1. Read `environment` from the **unverified** JWS payload. It only picks
     the verifier; it is not trusted. If it is not in
     `APPLE_IAP_ENVIRONMENTS`, reject (`422 environment_not_allowed`).
  2. Verify the JWS signature chain with that environment's verifier. The
     verifier checks that the signed `environment` matches, so a payload that
     lies about its environment fails here.
  3. Check `bundleId == com.buffingchi.games`.
  4. Check `productId` is in the catalog and `type == Non-Consumable`.
  5. Check there is no `revocationDate`.
  6. Fetch the authoritative state with the **same environment's** App Store
     Server API client, **Get Transaction Info**
     (`/inApps/v1/transactions/{transactionId}`). This also catches a JWS that
     has since been revoked.
  7. Upsert on `originalTransactionId`.
- Record `appAccountToken`, `inAppOwnershipType`, `environment`,
  `purchaseDate` and `transactionId`.

### 6.3 Finishing

The client finishes the transaction **only after** the server responds `owned`
(the purchase is persisted) or `revoked`, or rejects the link with `403
ownership_mismatch` / `409 link_limit` (§5: the evidence is valid and
persisted). An unfinished transaction is
redelivered at every launch, and that redelivery is the recovery path.
Re-posting is safe because the server is idempotent.

### 6.4 Environments

TestFlight, sandbox testers and **App Review** all produce `Sandbox`
transactions against the **production** API. So production must accept
`Sandbox` as well as `Production`
(`APPLE_IAP_ENVIRONMENTS=Production,Sandbox`), or App Review cannot buy. Sandbox
transactions are verified with the Sandbox verifier and the Sandbox API host
(§6.2), never the Production ones. A transaction whose verified environment is
not allowed is rejected (`environment_not_allowed`). Rows store `environment`
so sandbox purchases can be told apart and removed.

Sandbox purchases need a Sandbox Apple Account or a TestFlight build. **Anyone
who joins a public TestFlight link is a TestFlight tester and can mint valid
Sandbox JWSes for free.** So, while production accepts Sandbox, a public
TestFlight link hands out free premium access on production. Keep TestFlight
groups invite-only, or accept the risk (§17 Q5).

### 6.5 Refunds and revocations — App Store Server Notifications V2

- Set the production and sandbox notification URLs in App Store Connect to
  `POST /purchases/apple/notifications`.
- Verify `signedPayload` the same way as §6.2: read `data.environment` from the
  unverified payload, reject it if not allowed, verify with that environment's
  `SignedDataVerifier`, and use that environment's API client for any
  follow-up call. Handle these types:
  - `REFUND` → revoke.
  - `REVOKE` → revoke (Family Sharing stopped).
  - `REFUND_REVERSED` → restore to `owned`.
  - `ONE_TIME_CHARGE` → upsert; no session link.
  - `TEST` → log.
  - Anything else → `200`, ignored.
- Idempotency: `notificationUUID` goes in `purchase_events`. A duplicate is a
  no-op returning `200`.
- Backstop: a daily Render cron calls **Get Notification History** for the last
  48 h and replays anything missed.
- `CONSUMPTION_REQUEST` does not apply to non-consumables. No refund UI in the
  app; users request refunds through Apple.

---

## 7. Google Play (Android) — #2787

### 7.1 Client

- `expo-iap`'s Android path wraps **Play Billing Library 9.1.0** through
  `openiap-google` 3.6.x. Play requires each new app update to use a
  recent-enough PBL; re-check the requirement at submission, not against the
  old v6/v7 notes.
- The BILLING permission comes from the billing library's manifest merge.
  `frontend/android/` stays committed; run `./gradlew assembleDebug` before
  changing it (ANDROID-CI.md).
- `requestPurchase({ request: { android: { skus: [productId], obfuscatedAccountId } } })`,
  where `obfuscatedAccountId = hex(SHA-256(sessionId))` (§4). Never pass the raw
  session ID.
  Send `purchaseToken`, `productId` and `packageName` to the server.
- **At every launch**, call `getAvailablePurchases()`. Google requires this to
  catch purchases completed while the app was closed and pending purchases
  that have since completed. Post any purchase not yet reflected in the token.
- `purchaseState` `PENDING` means no access and no acknowledgement.

### 7.2 Server verification

- Call the Play Developer API `purchases.products.get(packageName, productId, token)`
  (Android Publisher v3). The Python client is `google-api-python-client` and
  `google-auth`, with a service account. If Google deprecates this call in
  favour of `purchases.productsv2`, switch to the v2 equivalent; the checks
  stay the same.
- Grant only when all of these hold:
  - `purchaseState == 0` (purchased);
  - the package name matches;
  - the product is in the catalog and `is_premium`;
  - `consumptionState == 0` (never consumed).
- `purchaseType == 0` means a license-tester test purchase. Record it as
  `environment = "test"`.
- Upsert on `purchaseToken`. Store `orderId` and `obfuscatedExternalAccountId`.

### 7.3 Acknowledgement (3-day deadline)

- The **server** acknowledges with `purchases.products.acknowledge`,
  **after** the row is persisted, in the same request. That makes
  acknowledgement atomic with the grant from the client's view.
- If `acknowledgementState == 1` already, skip. Acknowledgement is safe to
  repeat.
- The client then calls `finishTransaction(isConsumable: false)`. `expo-iap`
  calls `acknowledgePurchase`. If the purchase is already acknowledged
  (`isAcknowledgedAndroid`), skip the call or ignore its "already acknowledged"
  result.
- **Never consume.** `isConsumable` is always `false`. Consuming would destroy
  the user's ownership record.
- Recovery: a daily Render cron finds `owned` Google rows with a null
  `acknowledged_at` that are younger than 3 days, and acknowledges them.

### 7.4 Real-time Developer Notifications (RTDN) and voided purchases

- A Pub/Sub topic with a **push** subscription to
  `POST /purchases/google/notifications`. Verify the push's OIDC bearer token:
  its audience is `GOOGLE_RTDN_AUDIENCE` and its email is the push service
  account.
- `oneTimeProductNotification`:
  - `ONE_TIME_PRODUCT_PURCHASED` → verify, upsert, acknowledge. The row is not
    linked to a session, so the 3-day deadline is met even if the client never
    reports. Acknowledging before any session is linked is safe: the
    acknowledgement only tells Google the purchase was delivered, and the
    purchase stays on the buyer's Play account. Any session that presents the
    token is linked on its next sync (the listener, launch-time
    `getAvailablePurchases`, or Restore), subject to the link caps. The purchase
    is never lost.
  - `ONE_TIME_PRODUCT_CANCELED` → mark a pending row `cancelled`.
- `voidedPurchaseNotification` (refund or chargeback) → revoke, keyed on
  `purchaseToken`.
- Backstop: a daily Render cron calls the **Voided Purchases API**
  (`purchases.voidedpurchases.list`, last 48 h) and revokes any matches.
- Idempotency: the Pub/Sub `messageId` goes in `purchase_events`.

### 7.5 Family Library

Google Play Family Library does not share in-app products. On Android, no
family-sharing behavior is offered or described.

---

## 8. Backend contract — #840

Module: `backend/purchases/` (router, service, apple.py, google.py, schemas).
The routes use the ORM, `@limiter.limit(...)`, and `get_session_id`. All
purchase routes require `X-Session-ID` except the store notification webhooks,
which authenticate with store signatures.

### 8.1 Schema (one reversible Alembic migration)

```text
purchases
  id                  uuid pk
  platform            text  not null  check in ('apple','google')
  store_key           text  not null  -- Apple originalTransactionId | Google purchaseToken
  product_id          text  not null
  game_slug           text  not null  -- = game_types.name, is_premium at grant time
  state               text  not null  check in ('pending','owned','revoked','cancelled')
  environment         text  not null  -- 'production' | 'sandbox' | 'test'
  ownership_type      text  not null default 'purchased'  -- 'purchased' | 'family_shared'
  store_transaction_id text           -- Apple latest transactionId | Google orderId
  account_token       text            -- appAccountToken | obfuscatedExternalAccountId
  purchased_at        timestamptz
  verified_at         timestamptz not null
  state_changed_at    timestamptz not null  -- store time of the latest applied transition (§8.4)
  acknowledged_at     timestamptz     -- Google only
  revoked_at          timestamptz
  revocation_reason   text
  created_at / updated_at timestamptz
  unique (platform, store_key)
  index (game_slug), index (state)

purchase_links               -- which sessions a purchase is linked to (the ownership record)
  id                  uuid pk
  purchase_id         uuid not null references purchases(id) on delete cascade
  session_id          text not null  -- X-Session-ID
  source              text not null  -- 'purchase' | 'restore' | 'sync'
  last_verified_at    timestamptz not null
  created_at          timestamptz not null  -- the 30-day new-link limit counts this
  unique (purchase_id, session_id)
  index (session_id), index (purchase_id, created_at)

game_entitlements            -- existing table, extended; derived for purchased games
  + purchase_id       uuid null references purchases(id) on delete set null  -- recompute decides (§8.4)
  + last_verified_at  timestamptz null
  + source            text not null default 'legacy'   -- 'purchase' | 'restore' | 'sync' | 'legacy'
  index (purchase_id)
  (existing unique (session_id, game_slug) and session_id index retained)

purchase_events              -- audit + webhook idempotency
  id uuid pk, purchase_id uuid null, kind text, dedupe_key text unique null,
  session_hash text null, detail jsonb, created_at timestamptz
```

**`purchase_links` is the ownership record; `game_entitlements` is derived
from it.** For purchased games, a `(session_id, game_slug)` row exists exactly
when some `purchase_links` row for that session joins a `purchases` row with
`state = 'owned'` and that `game_slug`. #840 maintains this in the same
transaction as every change to `purchase_links` or `purchases.state` (a small
`recompute_entitlements(session_id, game_slug)` helper), with `purchase_id`
pointing at one of the qualifying purchases. Links are kept when a purchase is
revoked, so a refund reversal restores access without a new sync. The session
cap and the 30-day new-link limit (§4) count `purchase_links` rows, never
`game_entitlements` rows. Rows with `source = 'legacy'` (no `purchase_id`) are
not touched.

`GET /entitlements`, `check_entitlement` and `require_entitlement` **stay
unchanged**. They already read `game_entitlements` by session, so a verified
purchase reaches the JWT and every server guard through the rows #840 writes.
The indexed session lookup stays the hot path. #840 measures the target of
under 5 ms per lookup.

### 8.2 Endpoints

```http
POST /purchases/apple            rate limits: see below
X-Session-ID: <uuid>
{ "signed_transaction": "<JWS>", "source": "purchase" | "restore" | "sync" }

POST /purchases/google           rate limits: see below
X-Session-ID: <uuid>
{ "product_id": "com.buffingchi.games.premium.hearts",
  "purchase_token": "<token>",
  "source": "purchase" | "restore" | "sync" }
```

**Rate limits** (both endpoints; all three apply, the first to trip returns
`429`):

| Key                          | Limit              | Why                                                                                                                    |
| ---------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| per session (`X-Session-ID`) | 20/minute          | Normal retry and sync bursts.                                                                                          |
| per client IP                | 30/minute, 200/day | Session IDs are free to mint, so a per-session limit alone does not stop spraying.                                     |
| per `store_key`              | 10/hour, 30/day    | One transaction presented from many sessions or IPs. Counted after the store key is parsed, before any store API call. |

Per-IP limits use the same proxy-aware client address as the existing
limiter. All three are owner-tunable constants.

**200 response**, the same shape for both:

```json
{
  "status": "owned",
  "game_slug": "hearts",
  "product_id": "com.buffingchi.games.premium.hearts",
  "finish": true,
  "entitlements": {
    "token": "<RS256 JWT>",
    "expires_at": "2026-10-01T12:00:00Z"
  }
}
```

- `status` is `owned`, `pending` or `revoked`.
- `finish` is true when the client should finish or acknowledge. That is the
  case for `owned` and `revoked`, but not for `pending`.
- `entitlements` is the same payload as `GET /entitlements`, issued with
  `service.issue_token` after the write, so the client can unlock without a
  second round trip.

**Errors** (FastAPI `detail` codes):

| HTTP | `detail`                                                                         | Client action                            |
| ---- | -------------------------------------------------------------------------------- | ---------------------------------------- |
| 400  | `invalid_request`                                                                | Bug. Report to Sentry. Do not finish.    |
| 403  | `ownership_mismatch` (`source: "purchase"` with a foreign account token)         | **Finish** (§5). Show "contact support". |
| 409  | `link_limit` (session cap or 30-day new-link limit reached, §4)                  | **Finish** (§5). Show "contact support". |
| 422  | `verification_failed`, `unknown_product`, `wrong_app`, `environment_not_allowed` | Do not finish. Report to Sentry.         |
| 429  | rate limited                                                                     | Back off.                                |
| 503  | `store_unavailable` (Apple or Google API down or timed out)                      | Retry later. Do not finish.              |

**Idempotency rules.** The endpoint is a pure function of (verified store
state, calling session):

1. Upsert `purchases` on `(platform, store_key)` and refresh `state`,
   `verified_at` and the other fields from the store's answer.
2. If the purchase is `owned` and this session already has a
   `purchase_links` row for it, refresh `last_verified_at`. Otherwise check the
   account token (`source: "purchase"` only, §4), then the session cap and
   the 30-day new-link limit, counted on `purchase_links` under a row lock on
   the purchase. If a check fails, return `403` / `409` and link nothing.
   If both pass, insert the `purchase_links` row. Then recompute the
   session's `game_entitlements` row (§8.1).
3. If it is `revoked`, keep the `purchase_links` rows, recompute
   `game_entitlements` for every linked session (dropping the game unless
   another `owned` purchase qualifies), and return `revoked`.

Repeating a call never creates a second grant: `unique (purchase_id,
session_id)` makes the link idempotent, and a re-post from a linked session is
not a new link. No `Idempotency-Key` header is needed. A session that already
holds `game_slug` through a _different_ purchase (for example a Family-Shared
transaction and its own purchase) has two `purchase_links` rows but one
`game_entitlements` row. Revoking one purchase then keeps the game, because
the recompute finds the other `owned` purchase through that session's links.
A refund reversal (`REFUND_REVERSED`) sets the purchase back to `owned` and
recomputes, so every still-linked session gets the game back at once.

**Webhooks** (no session; rate limited per IP; return `200` quickly):

```http
POST /purchases/apple/notifications    body: { "signedPayload": "<JWS>" }
POST /purchases/google/notifications   Pub/Sub push envelope, OIDC bearer
```

**Cron jobs** (Render cron, daily):

- Apple notification-history replay.
- Google voided-purchases poll.
- Google unacknowledged-purchase sweep.

### 8.3 Tests #840 must add

- The cases in SECURITY.md §14.
- Idempotent re-post of the same transaction.
- Restore from a second session: linked.
- A sixth session → `409 link_limit`, nothing evicted; a fourth new session
  within 30 days → `409 link_limit`; a re-post from an already-linked session
  still succeeds at the cap.
- Per-IP and per-`store_key` rate limits return 429.
- A foreign `appAccountToken` with `source: "purchase"` → 403; the same
  transaction with `source: "sync"` links (subject to the caps).
- `appAccountToken` / `obfuscatedAccountId` are derived from the session ID
  (never equal to it) and the server's recomputation matches the client's.
- A Sandbox JWS is verified with the Sandbox verifier and API host; a
  Production JWS with the Production pair; a JWS whose environment is not
  allowed → `environment_not_allowed`.
- Duplicate webhooks.
- Revoke → JWT drops the game → `POST /games` returns 403.
- `REFUND_REVERSED` restores access to every still-linked session.
- Sandbox rejected when not allowed.
- Free-game regression.

Mock the store clients at the `apple.py` / `google.py` boundary. Use a real
signed JWS fixture made with a test CA for the verifier.

### 8.4 Implementation notes (#840)

**What #840 shipped** (`backend/purchases/`, migration
`0031_add_purchases`):

| Piece                                   | Where                                                           |
| --------------------------------------- | --------------------------------------------------------------- |
| Schema (§8.1), reversible               | `alembic/versions/0031_add_purchases.py`, `db/models.py`        |
| Upsert, link caps, recompute, revoke    | `purchases/service.py`                                          |
| `POST /purchases/apple`, `/google`      | `purchases/router.py`, `purchases/schemas.py`                   |
| Account tokens, Apple store-key parse   | `purchases/apple.py`, `purchases/google.py`                     |
| Verifier interface and defaults         | `purchases/verifiers.py`                                        |
| Admin `PATCH is_premium` guard (§13)    | `games/service.py` `patch_game_type`                            |
| Tests                                   | `tests/test_purchases.py`, `tests/test_purchases_migration.py`, `tests/test_entitlement_lookup_perf.py` |

**Verifier interface.** The service never calls a store. The routes get a
verifier through a FastAPI dependency (`apple.get_apple_verifier`,
`google.get_google_verifier`) and pass the service its normalized answer:

```python
@dataclass(frozen=True)
class VerifiedPurchase:
    platform: Literal["apple", "google"]
    product_id: str
    store_key: str                 # Apple originalTransactionId | Google purchaseToken
    transaction_id: str | None     # Apple transactionId | Google orderId
    environment: Literal["production", "sandbox", "test"]
    ownership_type: Literal["purchased", "family_shared"]
    state: Literal["pending", "owned", "revoked", "cancelled"]
    purchased_at: datetime | None
    account_token: str | None      # appAccountToken | obfuscatedExternalAccountId
    revoked_at: datetime | None = None
    revocation_reason: str | None = None
    acknowledged: bool = False     # Google acknowledgementState == 1
    event_at: datetime | None = None  # store time of this state (see "Event ordering")

class AppleVerifier(Protocol):
    async def verify(self, evidence: AppleEvidence) -> VerifiedPurchase: ...

class GoogleVerifier(Protocol):
    async def verify(self, evidence: GoogleEvidence) -> VerifiedPurchase: ...
    async def acknowledge(self, evidence: GoogleEvidence) -> None: ...
```

A verifier raises `PurchaseError(status, detail)` with a §8.2 code instead of
returning a partial answer. The shipped defaults (`NotConfiguredAppleVerifier`,
`NotConfiguredGoogleVerifier`) raise `503 store_unavailable`, so nothing is
granted until #2786 / #2787 replace the dependency bodies with real verifiers.
Tests override the dependencies with fakes.

**Hooks left for #2786 / #2787.**

- `purchases.service.apply_store_state(db, platform=, store_key=, state=,
  reason=, dedupe_key=, event_at=)` sets `owned` / `revoked` / `cancelled`
  from a verified notification, recomputes every linked session, and is a
  no-op for a repeated `dedupe_key` (Apple `notificationUUID`, Pub/Sub
  `messageId`). The key is checked again after the purchase row lock, and a
  unique-key race on commit rolls back to the same no-op, so two parallel
  deliveries of one notification apply once. Webhooks and crons call it; they
  are not in #840.
- **Required of #2786 / #2787: pass the store's event time.** Webhooks and
  crons must pass `event_at` — Apple: the notification's `signedDate`
  (ASSN v2) or, for the history replay, that notification's `signedDate`;
  Google: RTDN `eventTimeMillis`, voided-purchases `voidedTimeMillis`. The
  verifiers should set `VerifiedPurchase.event_at` (Apple: the transaction
  JWS `signedDate` from Get Transaction Info; Google: when the Play API was
  read). Omitted, the time defaults to now — for a client POST, the moment the
  request started verifying, before the store call. See "Event ordering".
- **Environment allow-list.** `purchases.verifiers.allowed_environments()`
  reads `APPLE_IAP_ENVIRONMENTS` (default `Production,Sandbox`) and
  `GOOGLE_PLAY_ENVIRONMENTS` (default `production,test`). The verifiers must
  apply it before any store call (§6.2 step 1); `process_verified_purchase`
  checks it again on the verified answer and returns `422
  environment_not_allowed` before writing anything, whatever a verifier
  returned.
- `purchases.service.delete_purchase(db, purchase_id)` is the way to remove a
  purchase (support, sandbox clean-up): it deletes the purchase and its links
  and recomputes every session it was linked to. A raw SQL delete leaves
  derived rows (see "Deleting a purchase") until the next recompute.
- Google acknowledgement runs after the grant is committed, in the same
  request. If it fails, the grant stands and `acknowledged_at` stays null for
  the #2787 sweep.

**Event ordering.** `purchases.state_changed_at` is the store time of the
latest applied state transition. A verified answer or notification whose
event time is older than it — and that would change the state — is ignored and
audited as `stale_ignored` (a notification's `dedupe_key` is still recorded, so
its redelivery stays a no-op). So a `REFUND` signed before a
`REFUND_REVERSED` but delivered after it does not revoke again, and a client
POST whose verifier read the store before a webhook's revoke cannot restore
access: the POST's default event time is taken before its store call. Equal
times apply.

**Deleting a purchase.** `game_entitlements.purchase_id` is `ON DELETE SET
NULL`, not `CASCADE`: deleting one purchase must not drop a game that another
`owned` purchase still grants. The recompute treats a non-legacy row with no
(or a dangling) `purchase_id` like any other derived row and re-points or
removes it.

**Concurrency.** The purchase row is locked (`FOR UPDATE`) before any link or
state change. `recompute_entitlement` locks the session's existing row,
evaluates the qualifying purchase after that lock (so a removal never acts on
an answer a concurrent grant has changed), and writes with one `INSERT ... ON
CONFLICT (session_id, game_slug) DO UPDATE` (Postgres and SQLite dialects).
When several sessions are recomputed they are taken in `(session_id,
game_slug)` order, so two transactions cannot lock rows in opposite orders.

**Behavior details #840 settled.**

- A missing or invalid `X-Session-ID` on `/purchases/*` is `400
  invalid_request` (other routes keep their existing messages).
- A verified `pending` answer for an `owned` purchase is refused: the purchase
  stays `owned`, a `regression_refused` event is recorded and a warning is
  logged.
- A malformed body, or an Apple JWS whose unverified payload names no
  `originalTransactionId`, is `400 invalid_request` (FastAPI's default 422
  is remapped for these routes, because 422 means "store verification failed").
- The per-`store_key` limit is keyed by a SHA-256 of `platform:store_key`, so
  raw store keys never sit in limiter storage. Like the other limits it is
  in-process memory (slowapi's default storage), per worker.
- The Google product ID is checked against the naming convention before the
  store is called; the service then accepts a product only when
  `game_types.is_premium` is true for its slug (`422 unknown_product`).
- A verified `cancelled` purchase is recorded and answered with
  `422 verification_failed` (nothing to grant or finish).
- The same `store_key` presented with a different product is
  `422 verification_failed`.
- Google ownership tokens are compared case-insensitively; Apple tokens as
  UUIDs. Both are computed over the exact `X-Session-ID` string.
- Audit: `purchase_events` rows `recorded`, `linked`, `link_rejected`
  (reason `ownership_mismatch` / `session_cap` / `new_links_30d`),
  `state_changed`, `notification`, `stale_ignored`, `regression_refused`,
  `deleted`, each with `session_hash = sha256(session)`;
  matching JSON lines go to the `audit` logger. Raw tokens and session IDs
  are never written.
- `/purchases/*` accepts bodies up to 32 KB (other routes stay at 1 KB).
- Admin `PATCH /games/catalog/{id}` answers `409 is_premium_migration_only`
  for an `is_premium` change on a game in the product catalog or with any
  `purchases` row (§13). Same-value patches and `category` changes still work.

**Measured entitlement lookup (target < 5 ms).**
`tests/test_entitlement_lookup_perf.py` seeds 20,001 `game_entitlements` rows
over 10,000 sessions and times 200 `check_entitlement` calls (the
`is_premium` read plus the `(session_id, game_slug)` lookup) through the async
ORM on one open session. On the CI SQLite database the median was **1.8 ms**
(p95 2.6 ms), and `get_entitled_games` took 1.4 ms; the query plan uses the
`uq_game_entitlements_session_slug` index, not a scan. The test fails if the
median reaches 5 ms or the plan stops using an index. Postgres was not
measured here; the lookup is the same indexed equality query, so it is
expected to be no slower. The query-plan check always runs (SQLite `EXPLAIN
QUERY PLAN`, Postgres `EXPLAIN`); the timing check uses the 5 ms target
locally and 20 ms when `CI` is set or coverage is running, where shared
runners make wall-clock time noisy.

**Residual risks (accepted for #840, revisit with #2786 / #2787).**

- **Per-`store_key` bucket burn.** The per-`store_key` limit is counted
  *before* verification, from the **unverified** Apple JWS payload (that is
  its purpose: it runs before any store call). Anyone can mint a forged JWS
  naming a victim's `originalTransactionId`, so 30 forged posts burn that
  purchase's bucket for a day (10 per hour) and the real owner's restores and
  syncs get `429` until it refills. No access is granted or lost — the
  existing links and entitlements stand, and the store's own redelivery
  retries later — but restores on new devices are delayed. The Google key is
  the purchase token, which is not public, so this is mainly an Apple risk.
  Mitigations if abused: count the bucket only after signature verification
  (#2786's `SignedDataVerifier` is local and cheap), or key it by
  `(store_key, session)` as well.
- **Per-IP limit trusts `X-Forwarded-For`.** The per-IP limit uses the
  limiter's proxy-aware address, which takes the *first*
  `X-Forwarded-For` hop — client-controlled, so a client can rotate its
  apparent IP and escape the per-IP limit. Known issue, fixed globally in a
  follow-up (SECURITY.md §9 "Known issue: X-Forwarded-For spoofing"); the
  per-session and per-`store_key` limits still apply.

---

## 9. Frontend contract — #841

### 9.1 Files

| File                                         | Owner       | Purpose                                                                                |
| -------------------------------------------- | ----------- | -------------------------------------------------------------------------------------- |
| `src/entitlements/premiumProducts.{json,ts}` | #2785       | Catalog (exists).                                                                      |
| `src/purchases/types.ts`                     | #841        | `PurchaseAdapter` and result types (below).                                            |
| `src/purchases/purchasesApi.ts`              | #841        | `POST /purchases/{apple,google}` client (`createGameClient`).                          |
| `src/purchases/expoIapAdapter.ts`            | #2786/#2787 | The one real adapter, branching on `Platform.OS`.                                      |
| `src/purchases/fakeAdapter.ts`               | #841        | Deterministic adapter for Jest and Maestro test builds.                                |
| `src/purchases/unavailableAdapter.ts`        | #841        | Web builds and store builds where premium is hidden: every call reports `unavailable`. |
| `src/purchases/PurchaseProvider.tsx`         | #841        | Owns the adapter lifecycle (`init` at launch, listener, silent sync).                  |
| `src/screens/PaywallScreen.tsx`              | #841        | UI.                                                                                    |

### 9.2 `PurchaseAdapter`

The only purchase surface the UI may use. The UI never imports `expo-iap`.

```ts
// Defined and exported by src/entitlements/premiumProducts.ts (#2785), with
// the `isPremiumGameSlug(s)` type guard for narrowing untrusted strings.
import type { PremiumGameSlug } from "../entitlements/premiumProducts";

export interface StoreProduct {
  gameSlug: PremiumGameSlug;
  productId: string;
  /** Localized, store-formatted price. Always display this; never hardcode prices. */
  displayPrice: string;
  title: string;
  description: string;
}

export type PurchaseErrorCode =
  | "store_unavailable" // store not connected, billing unavailable, not signed in
  | "product_unavailable" // product not found / not approved yet
  | "verification_failed" // server 400/422
  | "not_linkable" // server 403 ownership_mismatch / 409 link_limit — finished; show "contact support"
  | "server_unavailable" // server 5xx / network — purchase is safe, will retry
  | "unknown";

export type PurchaseOutcome =
  | { kind: "owned"; gameSlug: PremiumGameSlug } // verified, persisted, finished
  | { kind: "pending"; gameSlug: PremiumGameSlug } // Ask to Buy / pending payment
  | { kind: "awaiting_server"; gameSlug: PremiumGameSlug } // charged; server not reached yet
  | { kind: "cancelled" }
  | { kind: "error"; code: PurchaseErrorCode; retryable: boolean };

export interface RestoreResult {
  restored: PremiumGameSlug[]; // newly linked to this session
  alreadyOwned: PremiumGameSlug[]; // already in entitled_games
  pending: PremiumGameSlug[];
  error?: PurchaseErrorCode; // set when the restore could not complete
}

export type TransactionEvent =
  | { kind: "owned"; gameSlug: PremiumGameSlug }
  | { kind: "pending"; gameSlug: PremiumGameSlug }
  | { kind: "revoked"; gameSlug: PremiumGameSlug }
  | { kind: "error"; gameSlug?: PremiumGameSlug; code: PurchaseErrorCode };

export interface PurchaseAdapter {
  /** Connect to the store, start the transaction listener, process unfinished transactions. Idempotent. */
  init(): Promise<void>;
  dispose(): Promise<void>;
  /** Store products for the catalog; missing products are omitted, not thrown. */
  getProducts(slugs: readonly PremiumGameSlug[]): Promise<StoreProduct[]>;
  /** Full purchase: store sheet → server verification → finish. Never resolves "owned" before the server says so. */
  purchase(slug: PremiumGameSlug): Promise<PurchaseOutcome>;
  /** User-initiated restore (may show a store sign-in prompt on iOS). */
  restore(): Promise<RestoreResult>;
  /** Silent: post store-owned products missing from `entitled`. Never prompts. */
  syncOwned(entitled: ReadonlySet<string>): Promise<RestoreResult>;
  /** Transactions arriving outside a purchase() call (Ask to Buy approval, interrupted, other device). */
  onTransaction(listener: (e: TransactionEvent) => void): () => void;
}
```

After any `owned` outcome, event, or restore, the adapter calls
`EntitlementContext`'s new `applyToken(token)` with the server's `entitlements`
token. `canPlay` then updates at once. #841 adds these to
`EntitlementContextValue`:

```ts
refresh(): Promise<void>;           // re-fetch GET /entitlements (already exists internally)
applyToken(rawToken: string): Promise<void>; // validate, cache (AsyncStorage) and apply
```

### 9.3 Paywall UX

- **Entry.** A premium tile whose game `canPlay` is false opens `Paywall` with
  `{ gameSlug }` (a modal). This applies only in builds where the game is
  visible. The premium game routes also redirect to the paywall if they are
  reached without entitlement.
- **Contents.**
  - Game name and art.
  - "One-time purchase · unlimited play · no ads, lives or in-game purchases".
  - The store `displayPrice`.
  - A **Buy** button.
  - A **Restore Purchases** button, visible without scrolling on the smallest
    supported screen (Apple 3.1.1).
  - Links to the Terms and Privacy pages.
- **Settings** gets a "Restore purchases" row as well, so a user can restore
  without opening a locked game.
- **States.**
  - Loading products.
  - Product unavailable: Buy disabled, with an explanation.
  - Purchasing.
  - Pending: "Waiting for approval".
  - Awaiting server: "Purchase received — unlocks when online".
  - Owned: navigate into the game.
  - Error: retry.
  - Cancelled: no message.
- All copy goes through `t()`. Touch targets are at least 44 pt / 48 dp.
  Contrast is at least 4.5:1.
- **Family Sharing copy.** Only if the owner enables it: "Shared with your
  family via Family Sharing (App Store)". It appears on iOS only.
- **Never** show the paywall at game end, after a loss, or on a timer (§3).

---

## 10. Entitlement refresh policy

**Retain** the 24-hour JWT TTL and the 7-day offline grace (ARCHITECTURE §10.2).
Reviewed for paid access:

- The grace only keeps **local** play going. Server-authorized premium actions
  (`POST /games` for a premium game) always check current `game_entitlements`
  rows, so a refunded user loses server-backed access at once. Local-only
  access ends at most 24 h + 7 days after the refund, and only while the
  device stays offline. Neither store requires faster revocation. **Accepted.**
- New: purchase and restore responses carry a fresh token, so an unlock does
  not wait for the next refresh.
- The client already re-fetches on every foreground. No change.

---

## 11. Family Sharing (Apple) — recommendation

**Recommend: enable Family Sharing on all five non-consumables.** This needs
owner sign-off.

- It fits "buy once, keep playing". Family members get the same lasting access,
  and nothing is consumable to share.
- The server treats `inAppOwnershipType = FAMILY_SHARED` transactions as
  entitling. Each family member presents their own transaction, which becomes
  its own `purchases` row with `ownership_type = family_shared`.
- A `REVOKE` notification (the purchaser stops sharing or leaves the family)
  removes that access.
- **Irreversible:** once Family Sharing is enabled for a product in App Store
  Connect, it cannot be turned off for that product. That is the one concrete
  reason to wait. No other blocker was found.
- If the owner declines, leave it off. The server then rejects `FAMILY_SHARED`
  (it should never see one) and the paywall copy omits sharing.
- Google: not available (§7.5). Store listing copy must not promise it on
  Android.

---

## 12. Cross-platform

**Not supported.** App Store and Play purchases are separate: a Play purchase
never unlocks iOS, and the reverse. Restore works only within the same store
account. The store listings and paywall must not suggest otherwise. A future
optional account (#144) could enable cross-platform access, but only as a
separate product decision.

---

## 13. Visibility and release gating

- **v1.0 (current store builds):** the five games are in `HIDDEN_GAMES`, a
  compiled constant (ARCHITECTURE §10.7). No purchase code ships. Nothing is
  locked or teased.
- **Premium update:** the reviewed binary contains the paywall, the adapter
  and the products. It removes the five slugs from `HIDDEN_GAMES`, and they
  appear as locked tiles. The products are submitted **with that binary**.
- **No server-side unhide, ever.** `GET /games/catalog`, `is_premium` and the
  admin `PATCH /games/catalog/{id}` must never make a hidden game visible.
  Visibility changes only by shipping a new reviewed binary (Guideline 2.3.1).
- **Admin `PATCH is_premium` hazard.** Flipping a game to free while it has
  `purchases` would give it away to everyone. Flipping it to premium without a
  catalog product leaves it unbuyable. The drift tests catch the second in CI,
  not in production. **Done (#840):** the PATCH refuses an `is_premium` change
  for a slug in the product catalog, or for any game with a `purchases` row,
  with `409 is_premium_migration_only`. Such changes are migration-only.
- **Pre-launch API.** The pre-launch API grants every premium game through
  `ENTITLEMENT_DEV_OVERRIDE`, so purchase testing there proves nothing. Sandbox
  testing needs a backend with the override **off** (§14).

---

## 14. Test plans

### Automated

- Backend: see §8.3. Frontend: `fakeAdapter` drives PaywallScreen unit tests
  and Maestro flows:
  - tap locked → paywall → buy → unlocked;
  - pending;
  - cancel;
  - restore;
  - `awaiting_server`.

  `expo-iap` is mocked at the module boundary in Jest.

### Apple sandbox (#2786)

- Create **Sandbox Apple Accounts** in App Store Connect → Users and Access,
  plus one set up as an Ask-to-Buy child inside a sandbox family group. Use
  TestFlight builds against a backend with the override **off**.
- For each of the five products:
  - buy;
  - cancel;
  - Ask to Buy approve / decline;
  - kill the app mid-purchase, relaunch, and check it unlocks;
  - delete the app, reinstall, and check silent sync (and the Restore button);
  - a second device on the same sandbox account;
  - refund (Settings → Developer → Sandbox, or the App Store Connect refund
    test), which should send a `REFUND` notification and lock the game;
  - a Family Sharing member, if enabled;
  - airplane mode after buying (`awaiting_server`), then back online.
- Local StoreKit testing (`.storekit` config in Xcode) is fine for UI work.
  It does not exercise server verification.

### Google (#2787)

- Add **license testers** in Play Console. Use an **internal testing** track
  build; billing works only on builds installed from Play.
- Use the test cards: "always approves", "declines", and "slow — pending".
- For each product:
  - buy;
  - cancel;
  - pending → approve, and pending → decline;
  - clear data / reinstall → sync;
  - a second device;
  - refund from Play Console → Order management → voided notification →
    locked;
  - stay offline more than 5 minutes after buying, and confirm RTDN
    acknowledgement still happens.
- Test purchases are recorded as `environment = test`.

---

## 15. Reviewer access

- **Apple.** Reviewers buy with sandbox accounts on the production build. This
  works because production accepts `Sandbox` (§6.4). Review notes should say:
  "Premium games show a lock on the Home screen. Tap one → paywall → Buy
  (sandbox). Restore Purchases is on the paywall and in Settings." Attach a
  review screenshot to each IAP product and submit the products with the
  binary.
- **Google.** Describe the same path in Play Console → App content → App
  access. If Play needs the paid content unlocked without paying, give
  **Play promo codes** for the one-time products.
- **No hidden unlock codes, debug gestures or reviewer backdoors** in the
  binary. They are a security hole and a review risk (2.3.1).

---

## 16. Credentials

All credentials live in Render environment variables, marked `sync: false`, on
the production and dev backends. They are never in the app, the repo, logs or
Sentry (SECURITY.md §13).

| Variable                                                   | Purpose                                                                                      |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `APPLE_IAP_ISSUER_ID`, `APPLE_IAP_KEY_ID`                  | App Store Server API key identity (App Store Connect → Integrations → In-App Purchase key).  |
| `APPLE_IAP_PRIVATE_KEY`                                    | The `.p8` key (PEM string).                                                                  |
| `APPLE_BUNDLE_ID` (`com.buffingchi.games`), `APPLE_APP_ID` | Verifier inputs. `APPLE_APP_ID` is the numeric Apple ID, needed for production verification. |
| `APPLE_IAP_ENVIRONMENTS`                                   | `Production,Sandbox` in production (§6.4). Default when unset: `Production,Sandbox`.         |
| `GOOGLE_PLAY_ENVIRONMENTS`                                 | Allowed Google environments, `production,test` (default). Drop `test` to refuse license-tester purchases. |
| `GOOGLE_PLAY_PACKAGE_NAME` (`com.buffingchi.games`)        | Package check.                                                                               |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`                         | Service-account key.                                                                         |
| `GOOGLE_RTDN_AUDIENCE`, `GOOGLE_RTDN_PUSH_SA`              | Pub/Sub push OIDC verification.                                                              |

**Least privilege for the Google service account.** Grant it in Play Console
only for this app. It needs "View financial data" (to read purchases and voided
purchases) and "Manage orders" (to acknowledge). It needs no release or admin
permissions.

**Rotation.** Revoke and reissue the key in each console, then update Render.
The old key keeps working until it is revoked, so rotation causes no downtime.

---

## 17. Dependencies and rollout

### Dependencies per platform

| Platform | Client                                                                                                   | Server                                            | Store setup                                                                                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iOS      | `expo-iap ~5.8.2` (Expo Module, built against Expo 57 / RN 0.86; StoreKit 2; iOS ≥ 15, app targets 16.4) | `app-store-server-library` 3.1.x                  | Paid Apps agreement, tax and banking active; five Non-Consumables; In-App Purchase key; ASSN v2 URLs; sandbox accounts; Family Sharing decision.                                |
| Android  | same `expo-iap` (Play Billing 9.1.0 through `openiap-google` 3.6.x)                                      | `google-api-python-client` 2.x, `google-auth` 2.x | Payments profile; five one-time products (one "buy" option each, never consumed); service account linked in Play Console; Pub/Sub topic and push subscription; license testers. |

**Why `expo-iap` and not `react-native-iap` 16.x.** Both are maintained by the
same OpenIAP project and share native cores. `react-native-iap` 16 requires
`react-native-nitro-modules`, which adds another native dependency to both
committed native projects. `expo-iap` is an Expo Module that autolinks the way
every other native module here does. Its 5.8.2 release is built against
`expo ^57.0.12` / RN 0.86.2, which matches this app (`expo ~57.0.24`, RN
0.86.3). Pin it with `npx expo install expo-iap` and re-check the current patch
version when #2786 starts.

### Rollout sequence

1. **#2785** (this): the contract, catalog JSON and drift tests. Owner sign-off
   on §17 questions.
2. **Store setup.** Create the five products in both consoles in "ready to
   submit" / inactive state. Set up keys, the service account, Pub/Sub, sandbox
   accounts and license testers.
3. **#840** backend: migration, `/purchases/*`, webhooks, crons, tests. Deploy
   to dev. Turn **off** `ENTITLEMENT_DEV_OVERRIDE` on whichever backend is used
   for purchase testing.
4. **#841** paywall, `PurchaseAdapter` types, fake and unavailable adapters,
   and the `applyToken`/`refresh` context API. It can run in parallel with #840
   against the contract.
5. **#2786 / #2787**: `expoIapAdapter`, native build checks (Xcode Cloud,
   `./gradlew assembleDebug`), and the sandbox and license-tester matrix in §14.
6. **Premium update binary.** Remove the premium slugs from `HIDDEN_GAMES`.
   Update the store listing and privacy answers (purchases are now collected).
   Check the age rating (Blackjack; §17 Q1). Submit the binary together with
   the IAPs and reviewer notes. Work through the SECURITY.md §15 readiness
   checklist.
7. After approval, release it. Monitor Sentry and the purchase events for 48 h.

### Open owner questions

1. **Blackjack and the age rating.** Showing Blackjack, even locked, puts
   simulated gambling in the binary. RELEASE-PLAN says that rates the whole app
   13+/18+ and PEGI 18. Ship all five in the first premium update and accept the
   rating, or ship four and add Blackjack later?
2. **Family Sharing** on the Apple products (§11). It cannot be undone per
   product.
3. **Price tier** per game. Is it the same for all five?
4. **Link caps** (§4): `MAX_SESSIONS_PER_PURCHASE = 5` (rejected beyond, no
   eviction), `MAX_NEW_LINKS_PER_PURCHASE_PER_30D = 3`, unlink via support
   only. Accept these values and the residual-risk statement?
5. **Sandbox/test purchases on production** (§6.4, §7.2). Accept that TestFlight
   testers and license testers get premium access free on the production
   backend? Note that **anyone who joins a public TestFlight link** can mint
   valid Sandbox transactions, so either keep TestFlight invite-only or accept
   that. Rows are tagged by environment and can be revoked.
6. **Testing backend.** Turn off `ENTITLEMENT_DEV_OVERRIDE` on the dev backend
   at launch, or stand up a separate IAP staging backend?

---

## 18. Superseded requirements

These older requirements are withdrawn; do not implement them:

- "Coming soon" locked tiles in v1.0, and the old `paid`/`purchasable` catalog
  flags and `/games/catalog` free/paid split (#837). Visibility is compiled;
  `is_premium` is the classification.
- "Purchases cannot be restored until SSO" (#840 original, #842). Restore goes
  through verified store ownership (§4).
- `Transaction.isUpgraded` for Family Sharing (#842). That property is about
  subscription upgrades; family sharing is `ownershipType`.
- Pinned Play Billing v6/v7, and `POST /iap/validate/*` endpoint names. The
  endpoints are `/purchases/*`.
- The old paid lists that included Sudoku, and the free list that included
  Blackjack. The catalog is §2.
