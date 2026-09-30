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

The table exists today, but production IAP receipt/transaction validation that grants those rows is still future work under the premium/IAP epic.

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
