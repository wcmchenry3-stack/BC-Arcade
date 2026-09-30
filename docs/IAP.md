# In-App Purchases — Premium Access Contract

**Status:** contract for owner review (#2785). Nothing in this document has shipped
yet: purchase code, the `purchases` table and the paywall are implemented by
#840 (backend), #841 (paywall), #2786 (Apple) and #2787 (Google), which build to
the interfaces defined here. Where this document and an older issue disagree,
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
| Restore                | Via verified store ownership on the same store account, after reinstall or on a new device. No sign-in required.                                                      |
| Cross-platform sharing | **Not supported and not promised.** An App Store purchase does not unlock Android, or the reverse.                                                                    |
| Family Sharing         | **Recommended: enable for all five Apple products** (owner sign-off required; it cannot be turned off once on). Not available for Google Play one-time products.      |
| Refresh policy         | Keep the 24-hour JWT and 7-day offline grace.                                                                                                                         |
| v1.0 visibility        | Premium games stay compiled-hidden (`HIDDEN_GAMES`) until the binary that contains the reviewed purchase flow. No server-side unhide.                                 |
| Web                    | No purchases on web. Premium games stay hidden there (ARCHITECTURE §10.7).                                                                                            |

---

## 2. Catalog

The catalog lives in one file:
[`frontend/src/entitlements/premiumProducts.json`](../frontend/src/entitlements/premiumProducts.json),
wrapped by `premiumProducts.ts` (`PREMIUM_PRODUCTS`, `productIdForGame`,
`gameForProductId`).

| Game       | `game_types.name` (slug) | Product ID                               | Store type (Apple / Google)             |
| ---------- | ------------------------ | ---------------------------------------- | --------------------------------------- |
| Blackjack  | `blackjack`              | `com.buffingchi.games.premium.blackjack` | Non-Consumable / one-time, not consumed |
| Cascade    | `cascade`                | `com.buffingchi.games.premium.cascade`   | Non-Consumable / one-time, not consumed |
| Hearts     | `hearts`                 | `com.buffingchi.games.premium.hearts`    | Non-Consumable / one-time, not consumed |
| Mahjong    | `mahjong`                | `com.buffingchi.games.premium.mahjong`   | Non-Consumable / one-time, not consumed |
| Star Swarm | `starswarm`              | `com.buffingchi.games.premium.starswarm` | Non-Consumable / one-time, not consumed |

**Drift guards** (both run in CI):

- `frontend/src/entitlements/__tests__/premiumProducts.test.ts` — the catalog
  equals `PREMIUM_GAMES` and `HIDDEN_GAMES`, every ID follows the convention.
- `backend/tests/test_premium_products.py` — the catalog equals the
  `game_types.is_premium` rows after migrations and `_ALL_PREMIUM_SLUGS`.

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
- A session gets a game only through a `game_entitlements` row that points at
  a verified, non-revoked purchase (`purchase_id`).
- **Proof of ownership is store-signed evidence that the server verifies**:
  a JWS from Apple, checked against Apple's root CA and then with the App
  Store Server API, or a Google token checked with the Play Developer API.
  That evidence is only on a device signed in to the buying store account. A
  client-supplied product ID or success flag is never enough.
- **Initial purchase binding.** When a purchase starts, the client passes the
  session identity into the store purchase:
  - Apple: `appAccountToken = X-Session-ID` (a UUID, as StoreKit requires).
  - Google: `obfuscatedAccountId = hex(SHA-256(X-Session-ID))`, 64 characters,
    within Play's limit.

  The server records it. On `source: "purchase"`, a mismatch with the calling
  session is rejected (`403 ownership_mismatch`).

- **Restore / new device / reinstall.** The same verified purchase can be
  linked to another session (`source: "restore" | "sync"`). One store account
  legitimately uses several installs (an iPhone and an iPad, or a reinstall), so
  a purchase may be linked to at most **`MAX_SESSIONS_PER_PURCHASE = 5`**
  sessions. Linking a sixth unlinks the least recently verified one. That
  bounds the damage from a leaked transaction without locking out real users. The
  cap is an owner-tunable constant (§17).
- Every link and unlink is logged (purchase ID, session hash, source) for
  support and abuse review. Raw tokens are never logged.
- **Future accounts (#144/#1047).** When an optional account exists, purchases
  can also link to `player_id`. Nothing in this model has to be migrated for
  that; `purchases` stays the source of truth.

**Residual risk (accepted, for owner sign-off).** Someone who pulls a valid JWS
or token off their own device could share it with up to four other installs.
Rate limits, the session cap and the audit log keep this small. Apple's
per-device `deviceVerification` binding is optional hardening for later.

---

## 5. Purchase lifecycle

"Finish" means Apple `Transaction.finish()` or Google acknowledgement, done by
`expo-iap`'s `finishTransaction({ purchase, isConsumable: false })`.

| State / event                                  | Client behavior                                                                                                                                         | Server effect                                                                                               | Finish?                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Success**                                    | Send evidence to `POST /purchases/{apple,google}`, apply the returned token, open the game.                                                             | Verify, upsert `purchases` (state `owned`), link session in `game_entitlements`, and on Google acknowledge. | **After** the server returns `owned` (after persistence).            |
| **User cancel**                                | Return to the paywall silently. No error toast.                                                                                                         | None.                                                                                                       | Nothing to finish.                                                   |
| **Pending** (Ask to Buy, Play pending payment) | Show "Waiting for approval". No access. The purchase finishes later through the transaction listener.                                                   | Google: `state=pending` row if reported, never linked. Apple: nothing until the transaction arrives.        | No.                                                                  |
| **Pending → completed**                        | The listener (running from app start) receives it and runs the Success path, even if the paywall is closed.                                             | As Success.                                                                                                 | After persistence.                                                   |
| **Pending → cancelled/declined**               | Clear the "waiting" state.                                                                                                                              | Google RTDN `ONE_TIME_PRODUCT_CANCELED` marks the row `cancelled`.                                          | n/a                                                                  |
| **Interrupted** (killed/crashed after charge)  | On next launch the adapter handles unfinished transactions (Apple `Transaction.unfinished`/updates, Google `queryPurchases`) and runs the Success path. | Idempotent upsert.                                                                                          | After persistence.                                                   |
| **Server unreachable after charge (offline)**  | "Purchase received — it unlocks when you're back online." Retry on reconnect/foreground with backoff.                                                   | Google: RTDN lets the server verify and acknowledge without the client (§7.4).                              | **No** until the server confirms. The store redelivers.              |
| **Server verification fails (4xx)**            | Generic error, Sentry event, no access.                                                                                                                 | Nothing granted.                                                                                            | No. Google will auto-refund an unacknowledged purchase after 3 days. |
| **Server transient error (5xx/503)**           | As "server unreachable".                                                                                                                                | None.                                                                                                       | No.                                                                  |
| **Already owned**                              | The paywall shows "Owned" or navigates straight in. A buy attempt that returns "already owned" runs Restore for that product.                           | Idempotent.                                                                                                 | n/a                                                                  |
| **Refund / revocation**                        | The next token refresh drops the game. `EntitlementContext` clears that game's local state. A game in progress plays on.                                | Notification sets the row to `revoked` and deletes its `game_entitlements` links.                           | n/a                                                                  |
| **Refund reversed** (Apple `REFUND_REVERSED`)  | Access returns on the next sync or restore.                                                                                                             | Row back to `owned`. Sessions re-link on their next sync.                                                   | n/a                                                                  |
| **Reinstall, same device**                     | Silent **sync** on first launch (below), then an explicit Restore button if needed.                                                                     | Link the new session (subject to the cap).                                                                  | n/a                                                                  |
| **New device, same store account**             | As reinstall.                                                                                                                                           | As reinstall.                                                                                               | n/a                                                                  |
| **Different store account / other platform**   | Not restorable. The paywall shows the price.                                                                                                            | None.                                                                                                       | n/a                                                                  |
| **Offline, already entitled**                  | Cached JWT, then up to 7 days of grace (§10).                                                                                                           | None.                                                                                                       | n/a                                                                  |

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
- `requestPurchase({ request: { ios: { sku, appAccountToken: sessionId } } })`.
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
- Steps:
  1. Verify the JWS signature chain.
  2. Check `bundleId == com.buffingchi.games`, then the environment (§6.4).
  3. Check `productId` is in the catalog and `type == Non-Consumable`.
  4. Check there is no `revocationDate`.
  5. Fetch the authoritative state with the App Store Server API
     **Get Transaction Info** (`/inApps/v1/transactions/{transactionId}`). This
     also catches a JWS that has since been revoked.
  6. Upsert on `originalTransactionId`.
- Record `appAccountToken`, `inAppOwnershipType`, `environment`,
  `purchaseDate` and `transactionId`.

### 6.3 Finishing

The client finishes the transaction **only after** the server responds `owned`
(the purchase is persisted) or `revoked`. An unfinished transaction is
redelivered at every launch, and that redelivery is the recovery path.
Re-posting is safe because the server is idempotent.

### 6.4 Environments

TestFlight, sandbox testers and **App Review** all produce `Sandbox`
transactions against the **production** API. So production must accept
`Sandbox` as well as `Production`
(`APPLE_IAP_ENVIRONMENTS=Production,Sandbox`), or App Review cannot buy. Rows
store `environment` so sandbox purchases can be told apart and removed. Only
App Store Connect users and testers can make sandbox purchases.

### 6.5 Refunds and revocations — App Store Server Notifications V2

- Set the production and sandbox notification URLs in App Store Connect to
  `POST /purchases/apple/notifications`.
- Verify `signedPayload` with the same `SignedDataVerifier`. Handle these types:
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
- `requestPurchase({ request: { android: { skus: [productId], obfuscatedAccountId } } })`.
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
    reports. The next client sync links it.
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
  acknowledged_at     timestamptz     -- Google only
  revoked_at          timestamptz
  revocation_reason   text
  created_at / updated_at timestamptz
  unique (platform, store_key)
  index (game_slug), index (state)

game_entitlements            -- existing table, extended
  + purchase_id       uuid null references purchases(id) on delete cascade
  + last_verified_at  timestamptz null
  + source            text not null default 'legacy'   -- 'purchase' | 'restore' | 'sync' | 'legacy'
  index (purchase_id)
  (existing unique (session_id, game_slug) and session_id index retained)

purchase_events              -- audit + webhook idempotency
  id uuid pk, purchase_id uuid null, kind text, dedupe_key text unique null,
  session_hash text null, detail jsonb, created_at timestamptz
```

`GET /entitlements`, `check_entitlement` and `require_entitlement` **stay
unchanged**. They already read `game_entitlements` by session, so a verified
purchase reaches the JWT and every server guard through the rows #840 writes.
The indexed session lookup stays the hot path. #840 measures the target of
under 5 ms per lookup.

### 8.2 Endpoints

```http
POST /purchases/apple            rate limit 20/minute per session
X-Session-ID: <uuid>
{ "signed_transaction": "<JWS>", "source": "purchase" | "restore" | "sync" }

POST /purchases/google           rate limit 20/minute per session
X-Session-ID: <uuid>
{ "product_id": "com.buffingchi.games.premium.hearts",
  "purchase_token": "<token>",
  "source": "purchase" | "restore" | "sync" }
```

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

| HTTP | `detail`                                                                         | Client action                         |
| ---- | -------------------------------------------------------------------------------- | ------------------------------------- |
| 400  | `invalid_request`                                                                | Bug. Report to Sentry. Do not finish. |
| 403  | `ownership_mismatch` (`source: "purchase"` with a foreign account token)         | Do not finish. Show a generic error.  |
| 422  | `verification_failed`, `unknown_product`, `wrong_app`, `environment_not_allowed` | Do not finish. Report to Sentry.      |
| 429  | rate limited                                                                     | Back off.                             |
| 503  | `store_unavailable` (Apple or Google API down or timed out)                      | Retry later. Do not finish.           |

**Idempotency rules.** The endpoint is a pure function of (verified store
state, calling session):

1. Upsert `purchases` on `(platform, store_key)` and refresh `state`,
   `verified_at` and the other fields from the store's answer.
2. If the purchase is `owned`, upsert `game_entitlements(session_id,
game_slug)` with `purchase_id`, `last_verified_at = now`, and `source`. Then
   apply the session cap (§4).
3. If it is `revoked`, delete that purchase's entitlement links and return
   `revoked`.

Repeating a call never creates a second grant. No `Idempotency-Key` header is
needed. A session that already holds `game_slug` through a _different_ purchase
(for example a Family-Shared transaction and its own purchase) keeps one row.
Revoking one purchase then re-links from any other `owned` purchase that the
same session has presented.

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
- Restore from a second session: linked, subject to the cap.
- A foreign `appAccountToken` with `source: "purchase"` → 403.
- Duplicate webhooks.
- Revoke → JWT drops the game → `POST /games` returns 403.
- `REFUND_REVERSED`.
- Sandbox rejected when not allowed.
- Free-game regression.

Mock the store clients at the `apple.py` / `google.py` boundary. Use a real
signed JWS fixture made with a test CA for the verifier.

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
export type PremiumGameSlug =
  "blackjack" | "cascade" | "hearts" | "mahjong" | "starswarm";

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
  | "verification_failed" // server 4xx
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
  not in production. #840 should make the PATCH refuse an `is_premium` change
  for a slug that is in the product catalog, or document that such changes are
  migration-only.
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
| `APPLE_IAP_ENVIRONMENTS`                                   | `Production,Sandbox` in production (§6.4).                                                   |
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
4. **`MAX_SESSIONS_PER_PURCHASE = 5`** (§4). Accept the residual-risk
   statement?
5. **Sandbox/test purchases on production** (§6.4, §7.2). Accept that TestFlight
   testers and license testers get premium access free on the production
   backend? Rows are tagged by environment and can be revoked.
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
