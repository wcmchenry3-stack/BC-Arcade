# Security Policy

## Supported Versions

Only the latest release on `main` is actively maintained and receives security updates.

| Branch | Supported |
| --- | --- |
| `main` (latest) | Yes |
| Older releases | No |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Use GitHub private vulnerability reporting for this repository or contact the maintainer privately through the contact information on the GitHub profile.

Include:
- a description of the vulnerability;
- reproduction steps;
- likely impact;
- suggested mitigation, if known.

Target response:
- acknowledgement within 48 hours;
- status update within 7 days;
- fix or mitigation plan within 30 days for a confirmed vulnerability.

## Disclosure Policy

- Remediate before public disclosure where practical.
- Credit reporters unless they prefer anonymity.
- Use coordinated disclosure; the normal target window is 90 days.

# Current Security Architecture

This section documents the security model that exists on `dev` today. It deliberately does **not** describe planned OAuth/SSO/IAP work as though it has shipped.

## 1. Trust model

BC Arcade's single-player game engines are client-authoritative. The backend is not an anti-cheat referee for ordinary scores.

The server **is** still the security boundary for:
- request shape and size;
- session ownership of stored rows;
- premium entitlement rows;
- administrative operations;
- rate limits;
- persistence/database access;
- user-supplied text;
- public/private data surfaces.

A client being trusted to report a game result does not imply that arbitrary requests or another session's stored data are trusted.

## 2. Session identity

Most personal BC Arcade server data is keyed by `X-Session-ID`.

Current behavior:
- the app generates/persists a UUID for the installation/session identity;
- `backend/session.py` requires the header where a session is needed;
- the backend validates that the value parses as a UUID;
- it is **not** currently an authenticated account credential;
- there is no shipped Google/Apple SSO layer and no refresh-token/JTI system.

The session id therefore behaves as a **pseudonymous client-held identifier**, not proof of a human identity.

### Security consequence

Anyone who obtains another player's session UUID may be able to act as that session on routes whose authorization is session ownership alone.

Mitigations today include:
- UUID entropy;
- HTTPS in production;
- no deliberate exposure of the header in public UI;
- Sentry/feedback scrubbing rules for sensitive headers;
- service methods that scope reads/writes to the supplied session;
- per-session and per-IP rate limits where appropriate.

This is acceptable for the current anonymous/free product data model, but it is **not by itself sufficient evidence of purchase ownership** for IAP.

Future accounts may provide a stronger identity binding, but premium transaction security must not assume SSO has to ship first.

## 3. Game/session authorization

The generic game API stores each game with the creating `session_id`.

Subsequent read/write operations verify ownership through that session id in the shared service layer. A caller should not be able to complete/read/mutate another session's game merely by knowing its game UUID.

For premium games:
- `POST /games` calls `check_entitlement(db, session_id, game_type)` before a premium game session is created;
- game-specific premium routers use `require_entitlement(game_slug)` where they expose their own endpoints;
- a game already in progress is allowed to continue under the product rule that an entitlement change must not interrupt active gameplay.

Do not describe generic game completion as "JWT validation": the server-side entitlement source is the database/session relationship.

## 4. Premium entitlement model — current state

### Database authority

`game_entitlements` is the server authority for which premium game slugs a session owns.

Each row is unique by:
- `session_id`;
- `game_slug`.

For purchased games the rows are derived from `purchase_links` joined to `owned` `purchases` rows, in the same transaction as every link or purchase-state change (#840, [docs/IAP.md §8.1](docs/IAP.md#81-schema-one-reversible-alembic-migration)); rows that predate purchases carry `source = 'legacy'` and are left alone. `POST /purchases/{apple,google}` writes them only from a store-verified answer. Apple verification (#2786, [docs/IAP.md §6.6](docs/IAP.md#66-as-built-2786-server-side)) and Google verification (#2787, [docs/IAP.md §7.6](docs/IAP.md#76-as-built-2787-server-side)) are implemented but each is dormant until its environment variables are set; until then its routes answer `503 store_unavailable` and grant nothing.

The admin `PATCH /games/catalog/{id}` refuses an `is_premium` change for a game in the product catalog or with any recorded purchase (`409 is_premium_migration_only`), so a paid game cannot be flipped free from the API.

### `GET /entitlements`

The endpoint:
1. validates `X-Session-ID`;
2. reads that session's `game_entitlements`;
3. returns an RS256-signed JWT containing:
   - `sub` = session id;
   - `entitled_games`;
   - `iat`;
   - `exp`.

Token TTL is currently 24 hours.

### What the JWT is for

The entitlement JWT is primarily a **signed client cache** of the server's entitlement answer.

The frontend caches it in AsyncStorage and uses the embedded `entitled_games` to decide whether premium navigation is available.

The current frontend decodes the token payload for this local decision; it does not cryptographically verify the RS256 signature on-device. That is not the server authorization boundary.

### Server-side authorization

When the app talks to a premium backend path, the backend uses:
- `X-Session-ID`;
- current `game_entitlements` database state;
- the premium status of the game.

It does **not** trust an `entitled_games` claim supplied by the client.

This separation means modifying the cached token/client UI cannot grant server-side premium access.

## 5. Offline premium grace

The client allows a cached entitlement set for up to **7 days after token expiry** when it cannot refresh.

This is a product/offline convenience, not a server bypass.

Consequences:
- a previously entitled player can continue local premium gameplay during the grace window;
- once the app reconnects, the server's current entitlement rows control new server-authorized premium actions;
- revocation detected by a refreshed entitlement response removes local access and clears configured local game state.

Any future IAP implementation must preserve legitimate offline restoration without allowing the offline cache to mint server entitlements.

## 6. Development override

`ENTITLEMENT_DEV_OVERRIDE=true` grants all premium games for development/pre-launch testing.

Controls:
- production `render.yaml` must never define it;
- backend tests assert the production service does not set it;
- startup logs a warning when it is active.

Treat enabling this in production as a security incident/configuration failure.

## 7. Admin endpoint

Catalog mutation currently uses `X-Admin-Token` compared against `ADMIN_API_TOKEN`.

This is an explicit interim admin mechanism; it is not RBAC. Do not document role-based user authorization as shipped until it exists.

Admin secrets belong only in secret/environment storage and must never be embedded in the client.

## 8. Database and environment isolation

Production, dev and local/CI data are separate:

- production API → Supabase Postgres;
- dev API → Render Postgres;
- local/CI → SQLite.

Alembic is the schema source of truth.

Production safeguards include tests that reject:
- wiring a `main` service to the Render dev database;
- setting the entitlement dev override on production.

Operational topology is documented in `docs/RENDER.md` and `docs/ARCHITECTURE.md`.

## 9. Input, transport, and abuse controls

Current cross-cutting controls include:
- Pydantic/FastAPI request validation;
- SQLAlchemy query construction rather than string-built SQL;
- request-body size caps;
- route rate limits (session-keyed and/or IP-keyed depending on the surface);
- explicit CORS allowlists for browser access;
- environment-held secrets;
- Gitleaks/secret scanning in repository workflows;
- Sentry/diagnostic scrubbing described in `docs/FEEDBACK-OBSERVABILITY.md` once that canonical doc lands.

A statement that “every endpoint has exactly the same auth or rate-limit model” would be inaccurate; public catalog/challenge routes and session-scoped routes intentionally differ.

**Client IP trust model (#2863).** Every per-IP rate-limit bucket and every logged client IP comes from one resolver, `client_ip` in `backend/limiter.py`; nothing else reads `X-Forwarded-For`, `CF-Connecting-IP` or the socket peer. The request path is client → Cloudflare (owner's zone) → Render's proxy → uvicorn. The socket peer is Render's proxy (uvicorn only rewrites it for peers in `FORWARDED_ALLOW_IPS`, loopback by default, and the start command sets no `--forwarded-allow-ips` — keep it that way). `X-Forwarded-For` is a list each proxy *appends* to, so only entries counted in from the right are proxy-written; everything to their left came from the client. `CF-Connecting-IP` is written by Cloudflare's edge, which replaces any value the client sent. `TRUSTED_PROXY_MODE` picks what is trusted (values and recommended settings in [docs/RENDER.md](docs/RENDER.md#client-ip-and-rate-limit-keys)):

- `cloudflare` (default; prod and dev): `CF-Connecting-IP`, else the `X-Forwarded-For` entry `TRUSTED_PROXY_HOPS` from the right (the one Render's proxy appended), else the peer.
- `render`: that right-hand `X-Forwarded-For` entry, else the peer. Never the left-most.
- `none`: the peer only.

Values are parsed as IP addresses and canonicalised (IPv6 case/zero-compression, IPv4-mapped IPv6 → IPv4); a missing, malformed or duplicated value falls through to the next trusted rule and finally to the peer, never leftward. An unknown mode or an out-of-range hop count stops the app at import. A client-sent `X-Forwarded-For` therefore cannot choose or rotate its bucket (`backend/tests/test_limiter.py`). The previous resolver took the left-most `X-Forwarded-For` entry; the change moved every per-IP bucket once (limiter storage is in-memory, so counters simply started again).

*Residual risk — bypassing Cloudflare.* Each API service also answers on its `*.onrender.com` hostname (Render's subdomain is enabled on both, and CI's backend-health check uses the dev one on purpose). A request sent there that does not pass through a Cloudflare edge could carry a forged `CF-Connecting-IP` and pick its bucket in `cloudflare` mode. Whether it can depends on Render's own edge, which the repository cannot show — the owner confirms it with the test in [docs/RENDER.md](docs/RENDER.md#client-ip-and-rate-limit-keys). If a forged value does get through, the options are: disable the `onrender.com` subdomain on the prod API (Render service setting; the dev one is used by CI), or require a shared-secret header that a Cloudflare Transform Rule adds and the API checks, or restrict inbound IPs on the Render service to Cloudflare's published ranges. Per-session and per-store-key limits apply to `/purchases` regardless. Per-IP buckets are per address, so an IPv6 client that can rotate addresses within its own /64 still gets a fresh bucket per address; bucketing IPv6 by /64 is a possible follow-up.

**Sentry.** Crash reports never carry request bodies (`max_request_body_size="never"`) or frame locals; header and payload keys `x-session-id`, `session_id`, `x-admin-token`, `purchase_token`, `signed_transaction`, `signedPayload`, `store_key`, and (#2787) `purchaseToken`, `obfuscatedExternalAccountId`, `account_token`, `orderId`, `service_account_json` and `service_account_info` are scrubbed, as is `authorization` (the SDK default, which covers the Pub/Sub push bearer token), at any depth (case-insensitive); and SQLAlchemy `[SQL: ...]` / `[parameters: ...]` fragments and Postgres `DETAIL:` lines are cut from exception messages (`backend/main.py`, #840). Store API URLs carry credentials in their path (Google purchase tokens, Apple transaction IDs), so `before_send`, `before_send_transaction` and `before_breadcrumb` rewrite `/tokens/…`, `/transactions/…`, `/history/…` and `token=` / `paginationToken=` values to `[redacted]` in every event, span and breadcrumb, and the `httpx` / `httpcore` loggers are held at `WARNING` so request URLs never reach the Render logs (#2787).

# IAP / Paid-Entitlement Readiness Gate

Paid entitlements raise the impact of session replay and transaction replay. The following gate must be completed before the first premium purchase flow ships.

## 10. Store transaction validation

The purchase implementation must:

- validate Apple/Google transactions with the authoritative store/server mechanism appropriate to the platform;
- never grant entitlement based only on client-provided product id, purchase-success boolean, or decoded receipt fields;
- verify the product maps to the intended BC Arcade entitlement;
- verify transaction state is actually entitled (not revoked/refunded/invalid as applicable);
- persist enough authoritative transaction identity to make processing idempotent;
- allow the same legitimate transaction to be re-validated/restored without double-grant side effects;
- reject reuse of one transaction to mint entitlement for unrelated sessions/accounts, except under the explicitly designed transfer rule below;
- define how restore/reinstall/device-change transfers ownership under the product's identity model.

**Designed transfer rule (anonymous-session model, [docs/IAP.md §4](docs/IAP.md#4-ownership-model)).** Until optional accounts exist (#144), the transfer rule is a *capped cross-session link*: a verified store purchase may be linked to at most `MAX_SESSIONS_PER_PURCHASE = 5` sessions, and to at most `MAX_NEW_LINKS_PER_PURCHASE_PER_30D = 3` new sessions in any rolling 30 days. A link beyond either limit is **rejected** (`409 link_limit`); existing links are never evicted, and unlinking happens only via support. Purchase endpoints are rate limited per session, per client IP and per store transaction key. Every link and refusal is audited in `purchase_events`. A transaction presented beyond these limits is "rejected" in the sense of §14.

“Mark every purchase token used once and reject it forever” is **not** sufficient: store restoration legitimately re-presents prior purchases. The invariant is **idempotent, ownership-consistent processing**, not one-shot parsing.

## 11. Session / ownership binding

Before IAP ships, explicitly decide and test what owns a purchase:

- anonymous install/session;
- store account transaction identity;
- optional future BC Arcade account;
- or a migration path among these.

A bare, forgeable `X-Session-ID` must not be the only proof that a caller owns a purchase.

The design must support legitimate restore while preventing one captured transaction from being attached to arbitrary session ids.

**Decision (docs/IAP.md §4).** The store purchase (Apple `originalTransactionId`, Google `purchaseToken`) owns the entitlement; sessions are where it is used. Proof of ownership is store-signed evidence verified server-side, not the session ID. The initial purchase is bound to the buying session by a one-way derivative of `X-Session-ID` (Apple `appAccountToken = uuid5(namespace, session)`, Google `obfuscatedAccountId = SHA-256(session)`; the raw session ID is never sent to a store), which the server recomputes and compares. Restore to other sessions follows the capped cross-session link rule in §10.

**Accepted residual risk.** A user who extracts valid store evidence from their own device can share it with a bounded number of other installs (at most four more, at most three new in any 30 days) before the purchase refuses new links. True binding to a person needs optional accounts (#144); Apple `deviceVerification` binding is later hardening. Neither is a launch requirement.

## 12. Replay and refund/revocation handling

Required before paid release:

- repeated validation is idempotent;
- duplicate webhook/server notifications are safe;
- transaction replay cannot create extra entitlement grants;
- refunds/revocations have a defined server effect;
- client cached access converges back to server authority after reconnect;
- an already-running game follows the documented non-interruption rule;
- server write paths cannot be unlocked merely by editing the local JWT/cache.

## 13. Secrets and store credentials

Store API credentials/private keys:
- stay server-side;
- are injected through the deployment secret store;
- are excluded from logs/Sentry payloads;
- have rotation/revocation procedures;
- are never committed or packaged into mobile/web builds.

**Google Play (#2787, [docs/IAP.md §7.6](docs/IAP.md#76-as-built-2787-server-side)).** The Play Developer API service-account key lives only in the Render secret `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`; it is never in a repr, a log or Sentry, and a broken key is reported by reason code only. The account holds no Cloud IAM roles, only the `androidpublisher` OAuth scope, and in Play Console only "View financial data" and "Manage orders" for this app. Rotation: create a new key, update Render, then delete the old key. The RTDN webhook trusts nothing it is told: the Pub/Sub push must carry a Google-signed RS256 OIDC token for the configured audience and push service account (fails closed, `401`/`403`), and every purchase a notification names is re-read from the Play Developer API before any state is written.

## 14. Required tests before premium release

The premium/IAP release gate should include automated or integration coverage for:

- valid purchase → entitlement granted;
- invalid/forged purchase → no entitlement;
- replay of same valid transaction → idempotent result;
- restore of same legitimate purchase → succeeds without duplicate grant;
- transaction presented by an unrelated session/owner → rejected or follows the explicitly designed transfer rule;
- refund/revocation → entitlement removed/updated;
- entitlement refresh JWT reflects the database result;
- premium `POST /games` / premium game-specific endpoints reject an unentitled session;
- local cached/offline grace cannot bypass server authorization after reconnect;
- production configuration has no dev entitlement override.

Link the concrete implementation tests from the IAP epic (#822 / current premium implementation work) when they exist.

**Covered by #840** (`backend/tests/test_purchases.py`, store verification faked at the verifier boundary): verified purchase → entitlement; idempotent replay and restore without a duplicate grant; foreign account token on `source: "purchase"` → `403 ownership_mismatch`; link caps → `409 link_limit` with no eviction; revocation removes access for every linked session and the refund reversal restores it; the returned and `GET /entitlements` JWT reflect the database; premium `POST /games` rejects an unentitled or revoked session; per-session, per-IP and per-store-key rate limits; free-game regression. **Covered by #2786 (Apple, server side)** (`backend/tests/test_apple_iap.py`, JWS signed by a throwaway test CA the verifier is told to trust): valid signed transaction → entitlement; forged payload, untrusted chain, foreign leaf, missing Apple marker OID, expired certificate, `alg` other than ES256 (HS256, `none`), bad `x5c` → `422`; wrong bundle → `wrong_app`; unknown/consumable/free product → `unknown_product`; environment allow-list and a payload lying about its environment; revoked transaction; Get Transaction Info answer authoritative; App Store Server Notifications V2 through `POST /purchases/apple/notifications` — REFUND, REFUND_REVERSED in and out of order, duplicate deliveries, invalid signatures → `4xx` with nothing applied, dormant config → `503`; notification-history replay. **Covered by #2787 (Google, server side)** (`backend/tests/test_google_iap.py`, Google mocked at the HTTP transport with a fake Play Developer API, token endpoint and JWKS, all keys throwaway RSA keys generated at runtime): valid owned purchase → entitlement and server-side acknowledgement (retries, idempotent, sweep); pending → recorded, no grant; cancelled / voided → revoked; token for another package, unknown or free product, rental, wrong quantity and consumed purchases → `422`; foreign `obfuscatedExternalAccountId` on `source: "purchase"` → `403`; environment allow-list; Play API and token-endpoint failures → `503`; the RTDN webhook `POST /purchases/google/notifications` — missing, malformed, `alg: none`, HS256-with-the-public-key, wrong-key, unknown-`kid`, expired, wrong-issuer and wrong-audience tokens → `401`, another service account → `403`, JWKS unreachable → `503`, body parsed only after auth; notification claims never trusted (every purchase re-read from Play); `messageId` dedupe; voided-then-older-purchased events out of order; same-state watermark and environment-mismatch guard; voided-purchases poll with pagination and the page cap; dormant and half-set configuration → `503`; Delete My Data keeps the Google purchase records and churn still hits the link caps. **Still open:** the production-config check.

## 15. Readiness checklist

Before premium content is enabled in a store build:

- [ ] Store transaction/receipt validation is implemented server-side.
- [ ] Transaction processing is idempotent and restore-safe.
- [ ] Purchase ownership binding is documented (docs/IAP.md §4) and tested.
- [ ] Replay across unrelated sessions cannot mint entitlement beyond the designed capped-link transfer rule (§10): a link past `MAX_SESSIONS_PER_PURCHASE` or `MAX_NEW_LINKS_PER_PURCHASE_PER_30D` is rejected, with per-IP and per-store-key rate limits in place.
- [ ] Refund/revocation behavior is implemented or explicitly accepted with store-compliant rationale.
- [ ] `game_entitlements` remains server authority.
- [ ] Premium generic/game-specific routes are covered by authorization tests.
- [ ] Offline grace and reconnect/revocation behavior are tested.
- [ ] Production secrets/configuration have been verified.
- [ ] Premium/IAP epic links to this gate.
- [ ] Implementing engineer reviews this section before release.

# Automated Security Controls

The repository uses automated security checks including dependency auditing, static analysis and secret scanning in CI/workflows. The exact enabled workflow configuration is the source of truth; do not treat an aspirational tool list in documentation as evidence that a check runs.

When a security check is added/removed, update this section only after verifying the actual workflow.

# Related Documentation

- `docs/ARCHITECTURE.md` — system, entitlement and environment architecture
- `docs/GAME-CONTRACT.md` — game/session ownership and persistence contract
- `docs/RENDER.md` — deployment/environment secrets and database topology
- `docs/STORE-PRIVACY-ANSWERS.md` — store-facing data declarations
- `docs/FEEDBACK-OBSERVABILITY.md` — diagnostics/feedback data handling (once canonical PR lands)

## 16. Dependabot triage automation and Resend email

Dependabot itself is configured in `.github/dependabot.yml` (weekly npm, pip and GitHub Actions updates; CVE fixes grouped as `security-updates`). This repo contains no email code and no Resend references.

Whether GitHub Dependabot security alerts are enabled is a repository setting and cannot be verified from the code. [OWNER TO CONFIRM: Dependabot alerts enabled in repo settings.] Do not treat them as a fallback for the triage email until that is confirmed.

The triage automation lives in the org-level repo `wcmchenry3-stack/.github`, not here. Its source of truth is that repo's `dependabot-triage/README.md`; this section only records the facts that matter for BC Arcade.

| Item | Detail |
| --- | --- |
| Workflow | "Scheduled Dependabot Triage" (`.github/workflows/scheduled-dependabot-triage.yml` in the `.github` repo) |
| Trigger | Daily cron at 06:00 UTC, plus `workflow_dispatch` (dry-run is the default). The nightly run has been live since 2026-08-29. |
| Scope | Dependabot PRs in the repos enabled in `dependabot-triage/config.yml`, including BC Arcade (it waits about 45 minutes for BC Arcade CI). It may comment, rebase and merge them. |
| Email | One stack-wide report per run, sent through Resend's HTTP API (`dependabot-triage/report.py`). Subject prefix "Dependabot Triage". |
| Content | Counts, reasons and decisions from the run ledger (repo, PR and dependency metadata) plus one paragraph written by Claude Haiku 4.5. |
| Recipient | The repository owner (role only; no address is recorded in docs). |
| Sender and domain | `dependabot-triage@mail.buffingchi.com`. The domain `mail.buffingchi.com` must stay verified in Resend. |
| Secrets | GitHub Actions secrets in the `.github` repo: `RESEND_API_KEY` (email), `ANTHROPIC_API_KEY` (pay-as-you-go, separate from any Claude subscription) and `DEPENDABOT_TRIAGE_TOKEN` (fine-grained PAT). |
| Kill switch | A `HOLD` file at the root of the `.github` repo halts runs. |

### Security notes

- An automated job can merge Dependabot PRs into BC Arcade. It is gated by the triage guard tests and BC Arcade's CI, but a compromised token or a weak guard means unreviewed dependency changes could reach `dev`.
- `DEPENDABOT_TRIAGE_TOKEN` has pull-requests and contents access on the target repos only, deliberately without Administration or Actions access. Keep it that way.
- No player data goes to Resend or Anthropic from this job; only repo, PR and dependency metadata. It is an internal developer notification.

### Rotating the Resend key

1. Create a new send-only key in Resend, restricted to `mail.buffingchi.com`.
2. Update the `RESEND_API_KEY` secret in the `wcmchenry3-stack/.github` repo.
3. Trigger a manual dry run and confirm the email arrives.
4. Revoke the old key.

### If it breaks

- If `RESEND_API_KEY` is unset, the script logs "not sending email" and carries on, so reports stop silently. Resend errors are logged in the run.
- The ledger is still uploaded as a run artifact (90 days) and metrics are committed to the `.github` repo, so check the workflow runs there if reports stop arriving.
