# BC Arcade — Game Architecture

This document is policy. It applies to every game shipped in this repo. New games
must be designed to fit; existing games that don't fit are tracked in linked
issues for migration.

## 1. Core principle

**Offline-first single-player. Server-authoritative multi-player.**

BC Arcade is a play-anywhere arcade. Players should be able to enjoy single-player
games without a network connection. Cheating is not a meaningful threat to a
casual single-player game; offline availability is. Multi-player justifies a
different trust model and is treated separately.

## 2. Single-player contract

### 2.1 The client owns

- The rule engine (`frontend/src/game/<name>/engine.ts`).
- Session state during play, persisted to AsyncStorage so it survives app kill.
- Event log generation with priority tags.
- The submission queue (uses the shared pipeline — see §4).

### 2.2 The server owns

- Persistence: game records, final scores, event logs.
- Identity and auth (when introduced).
- **Boundary security:** input validation, payload size caps, rate limits,
  content sanitization, ORM-only DB access. The OWASP layer stays even though
  rule enforcement leaves. See §6.
- Vocabulary: `GameType` and `GameOutcome` enums (see [GAME-CONTRACT.md](GAME-CONTRACT.md)).
- Aggregates: leaderboards, ranks.

### 2.3 The server explicitly does NOT

- Validate game rules.
- Recompute scores from event logs.
- Hold in-memory session state for single-player games.

## 3. The rule engine — written once

For any game that may eventually support multi-player, the rule engine lives in
**one place**: a TypeScript module at `frontend/src/game/<name>/engine.ts`.

To allow the same engine to run server-side in multi-player, every engine must
be:

- **Headless** — no React, no UI, no platform imports inside `engine.ts`.
- **Pure(ish)** — no AsyncStorage, network, audio, haptics, or other side
  effects inside the engine itself. Side effects live one layer up (in screen /
  hook / service code that consumes the engine).
- **Runnable in Node** — covered by tests that import the engine and exercise it
  outside React Native, to confirm portability.

This is a discipline, not new infrastructure. Existing games are audited for
compliance under epic #894.

## 4. Persistence and offline contract

Every game uses the shared submission pipeline. **No game implements its own
queue.** The pipeline is:

- `SyncWorker` — batched event flush with exponential backoff (1s → 30min).
- `ScoreQueue` — outcome submissions, retried up to 5 attempts.
- `PendingGamesStore` — pending games persisted across app restarts.
- All three are AsyncStorage-backed and survive app kill.

What we log:

- **Outcomes:** final score, completion / abandonment, duration, metadata.
- **Gameplay event logs:** per-move or per-action records, useful for analytics
  and for diagnosing reported bugs.

**Memory cap: 2 MB total queue size.** When the queue exceeds this, eviction
kicks in (see §5). If 2 MB turns out to be too small in practice, that is a
signal to revisit _how_ we queue — not a signal to bump the cap.

## 5. Eviction policy

When the queue is over budget, evict oldest entries from the lowest non-empty
tier first.

| Tier                   | Contents                                          | Eviction order        |
| ---------------------- | ------------------------------------------------- | --------------------- |
| **P0** (most precious) | High-priority bug reports / crashes               | last to evict         |
| **P1**                 | Game outcomes (final score, completion, duration) | evicted after P2 / P3 |
| **P2**                 | Low-priority bug reports / user feedback          | evicted after P3      |
| **P3**                 | Normal gameplay event logs                        | first to evict        |

Bug priority is **assigned automatically by the client**, not by the user:

- Unhandled crash, error, or hang → **P0**.
- User-submitted feedback or in-app bug report → **P2**.

Users do not pick a priority. The client classifies.

## 6. Boundary security

Even though the server is not a referee, it remains the security boundary:

- Every endpoint validates input shape and types.
- Every endpoint is rate-limited (per [security.md](~/.claude/standards/security.md)).
- Payload size caps on every POST.
- Content sanitization on any user-supplied text (player names, bug report
  bodies, etc.).
- Database access through the ORM only — no raw SQL, no string-built queries.
- Auth and authorization on anything user-scoped.

This layer is anti-OWASP, not anti-cheat. The fact that we trust the client
about _game rules_ does not mean we trust it about _the request_.

## 7. Multi-player

When multi-player ships, it is server-authoritative. The MP server uses the same
TypeScript rule engine the SP client uses (§3). One rule engine, two execution
contexts.

Multi-player does not get its own application — it lives in this repo, sharing
identity, persistence, the event pipeline, and the UI shell. The MP service
architecture (Node sidecar, embedded JS runtime, separate service) is deferred
until at least one MP game design is on the table.

## 8. Escape hatch

The default answer is **no.** Server-authoritative single-player is not allowed
in this repo because it fragments the architecture. If a game appears to require
it — for example, server-side physics, daily-content tamper resistance, or
prize-stakes tournaments — **stop and discuss before writing code.** Three
possible outcomes:

1. **Redesign to fit.** Many "we need server authority" instincts come from
   anti-cheat reflex, not real requirements. Preferred outcome.
2. **Accept as a documented exception.** Captured in this file, with a written
   reason and the constraint kept narrow.
3. **Carve out as a separate application.** If the requirement is real and the
   constraint is broad (e.g., a prize tournament platform), the game does not
   belong in BC Arcade.

Do not silently introduce server-authoritative single-player for a new game.

## 9. Implications for current games

Existing games that don't fit the policy are **not** critiqued here. They are
tracked in:

- **#893 — Trouble-game migrations.** Yacht (server-authoritative SP), Blackjack
  (two rule engines), Starswarm and Freecell (in-memory leaderboards).
- **#894 — Shared TS rule engine epic.** Audit existing engines for headlessness
  ahead of multi-player work, including Mahjong (WIP, #870) before its engine
  ships.

Both issues note that "first step is further research" — the snapshots in those
issues are not authoritative.

## 10. Premium entitlements

BC Arcade has a server-authoritative premium access layer that is independent of
game rule enforcement. Entitlements control _which games a session may open_, not
how those games behave once open.

### 10.1 How it works

1. The client calls `GET /entitlements` on startup (and on foreground-resume if
   the cached token is within 1 hour of expiry).
2. The server returns an **RS256-signed JWT** containing:
   - `sub`: session_id
   - `entitled_games`: array of game slugs the session may access
   - `iat` / `exp`: issued-at and expiry (24-hour TTL)
3. The token is cached in AsyncStorage by `EntitlementContext.tsx`.
4. Before navigating to any premium game, the context checks `entitled_games`.
   If the game is absent, the UI shows an upgrade prompt instead.

### 10.2 Offline grace period

Tokens remain valid for **7 days past expiry** when the device is offline. If
a token is missing or expired beyond the grace period, the app shows a
"Reconnect to restore premium access" message. Free games are always accessible
regardless of token state.

### 10.3 Route protection

Every premium API endpoint uses the `require_entitlement(game_slug)` FastAPI
dependency. A missing or invalid token returns `403 not_entitled`. This prevents
score submission from a session that has lost its entitlement between sessions.

### 10.4 Dev override

Set `ENTITLEMENT_DEV_OVERRIDE=true` in the backend environment to skip all
entitlement checks and grant access to every game. Never set this in production.

### 10.5 Key files

| Layer                            | File                                                      |
| -------------------------------- | --------------------------------------------------------- |
| Backend — JWT issuance           | `backend/entitlements/service.py`                         |
| Backend — Route guard            | `backend/entitlements/dependencies.py`                    |
| Frontend — Token cache & context | `frontend/src/entitlements/EntitlementContext.tsx`        |
| DB — entitlement rows            | `backend/alembic/versions/0014_game_types_premium_cat.py` |

### 10.6 Adding a premium game

1. Add `is_premium=true` in the Alembic migration that inserts the game row.
2. Add the game slug to `PREMIUM_GAMES` in `EntitlementContext.tsx`.
3. Add `require_entitlement("<slug>")` to every route in `backend/<game>/router.py`.
4. Document the tier in `docs/games/<game>.md`.
5. While v1.0 hides premium games (§10.7), also add the slug to `HIDDEN_GAMES` in
   `gameVisibility.ts` and its route to `PREMIUM_ROUTES` in `premiumRoutes.ts`
   (plus the unguarded screen in `App.tsx`'s `PREMIUM_SCREEN_BASES`). The
   `gameVisibility` / `premiumRoutes` tests fail if any of these sets drift.

### 10.7 Game visibility in store builds (v1.0)

Entitlement answers "locked or playable?". **Visibility** answers "does this game
exist in this build at all?" and lives separately in
`frontend/src/entitlements/gameVisibility.ts`.

v1.0 ships with the six premium games hidden entirely — no tile, no route, no
locked screen — until IAP lands (epic #822). `isGameVisible(slug)` filters:

- the Home grid and chunk prefetch (`HomeScreen.tsx`);
- route and tab registration — `App.tsx` registers premium screens from the
  `premiumRoutes.ts` registry, which also owns the Star Swarm-only **Ranks** tab;
- Profile — bento tiles are re-derived from visible games and hidden-game rows
  are dropped from Recent Games, so earlier plays by a tester cannot resurface.

`SHOW_HIDDEN_GAMES = __DEV__ || EXPO_PUBLIC_TEST_HOOKS === "1" || isPreLaunchApiBuild()`,
so dev builds, e2e test builds and **pre-launch builds** keep all 12 games; a store
build shows 6 tiles and 3 tabs.

**Pre-launch builds (owner decision, 2026-09-19).** Until launch, internal
TestFlight / Play test builds keep every game visible and free. A build is
"pre-launch" only when it was compiled against the pre-launch API,
`https://dev-games-api.buffingchi.com` (`isPreLaunchApiBuild()` in
`game/_shared/envFlags.ts`) — the one backend that runs with
`ENTITLEMENT_DEV_OVERRIDE` (§10.4) and so grants every premium game to every
session. Anything else — the production URL, an unknown host, no URL — is a store
build (fails closed). There is deliberately **no flag to flip back before
launch**: pointing the release config at the production API hides the games and
ends the free entitlements in the same step. `gameVisibility.test.ts` reads the
real config to keep that true: the tracked `.env.production` must yield a store
build, and the URL `ci_post_clone.sh` writes must be exactly the pre-launch or the
production API.

It is a compiled constant on purpose:

- **Not a new env var** — `frontend/ios/ci_scripts/ci_post_clone.sh` deletes
  `.env.production` and rewrites `.env` on every Xcode Cloud build, so a new
  `EXPO_PUBLIC_*` flag would silently vanish and could ship premium games to
  App Review. (`EXPO_PUBLIC_API_URL` is exempt: it is one of the two vars that
  script itself writes.)
- **Not server-driven** — the binary App Review approves must be the binary users
  get (guideline 2.3.1). The API URL is inlined at build time, so this still holds.

Store screenshots must therefore come from a release build without test hooks.

The gate is the build flavour, not the platform: the **Render web build hides
the premium games too** (owner decision, 2026-09-20). Web is unmonetized, and
nothing premium should be free anywhere. That is the production site
(`bc-arcade-frontend`, built against the production API). The `dev`-branch
staging site (`bc-arcade-frontend-dev`) is built against the pre-launch API, so
like TestFlight it shows all 12 until launch.
the premium games too** (owner decision, 2026-09-19). Web is unmonetized, and
nothing premium should be free anywhere.

A leaked `EXPO_PUBLIC_TEST_HOOKS=1` would unhide everything. Android release
builds refuse to run when the flag is set (`docs/ANDROID-CI.md`, "Release bundle
guard"), `scripts/check-build-env.js` rejects it for the Render web build, and
Xcode Cloud rewrites `.env` on every build (it does not check the workflow's own
environment variables — never add the flag there). `frontend/metro.config.js`
keys Metro's cache on `EXPO_PUBLIC_*` values so a stale transform from a
test-hooks build can never be reused by a store build on any platform.
