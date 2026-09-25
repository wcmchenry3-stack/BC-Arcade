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
- `displayNameSync` — one pending display-name sync (see below).
- All four are AsyncStorage-backed and survive app kill.

**Identity and display name (#2624, #2519 decisions 17–18).** A player is
their player id: the app's `game_session_id`, sent as `X-Session-ID` (one per
install; a reinstall or a new device is a new player until accounts, #1047).
Their display name is a property of the player, not of a game: the server
keeps one per player (`players` table, `PUT/GET/DELETE /players/me`), it can
change at any time, and no history is kept. Every leaderboard ranks only
players who have one, counts all of their finished games, and shows the
current name, so a rename applies to all of their history at once. A player
with no name is on no board.

The app sends the name when it is saved (`saveDisplayName` →
`PUT /players/me`). Offline or on failure it keeps **one** pending sync
holding the latest name — five offline saves send one PUT — and flushes it on
reconnect and foreground alongside the queues above; on launch, a stored name
the server was never sent is synced once. See
`frontend/src/game/_shared/displayNameSync.ts`.

**Safe replays.** Retries are the normal case, so every write is safe to
repeat: `POST /games` dedupes on the client game id, a completed game can't be
completed again (a replayed `PATCH /games/{id}/complete` returns the row
unchanged), events dedupe on `(game_id, event_index)`, and `PUT /players/me`
with the current name writes nothing. With the name on the player there is no
per-game name left to duplicate. The only remaining lost-response duplicates
are the legacy per-game `POST /<game>/score` handlers still in `ScoreQueue`
(listed in its header), which Phase 2 of #2519 removes.

What we log:

- **Outcomes:** final score, completion / abandonment, duration, metadata.
- **Gameplay event logs:** per-move or per-action records, useful for analytics
  and for diagnosing reported bugs.

**Result envelope (#2449).** `PATCH /games/{id}/complete` accepts an optional
`result` dict alongside `final_score` / `outcome` / `duration_ms`. Each game
module may declare a `result_model` (a Pydantic model, separate from the
creation-time `metadata_model`, which forbids extra keys); the validated result
is merged into `games.metadata` — creation-time keys always win on a collision,
because leaderboards read partition keys such as `difficulty` (and the legacy
per-game boards `player_name` / `raw_score`) from there — and an
invalid or oversized (> 8 KB) result returns 400 without completing the game
and is reported to Sentry (game type, failing field paths, error types — no
session id or values), because the app's sync worker dead-letters a 400. Modules with
`result_model = None` accept any dict. Result models ignore unknown keys so a
newer app build never fails completion against an older backend. Older app
builds that send no `result` keep working. The client passes the result block
explicitly as `summary.result` to `useGameSync.complete()`; the analytics
`game_ended` payload is never copied into it (#2619).

**Outcome (#2519 decision 11).** `games.outcome` carries the result for games
that can record a winner (`GameModule.has_winner`, set only once the client
writes one): `win` / `loss` / `push` (a tie). A `completed` row from such a
game (solo Yacht) is a finish with no winner, not a win.
Score-only games record `completed` / `kept_playing` — a finished game with no
win concept. `abandoned` is a quit. The per-game rules live in one place, the
`GameOutcome` docstring in `backend/vocab.py`; `won` inside a result block is
only a daily-challenge input, not the win signal.

**Abandons.** Only a session the player started (`markStarted()`) is ever
abandoned — on unmount, `start()`, `restart()` or `close()` over an open session. Those
same paths discard an untouched session instead (`gameEventClient.discardGame()`:
the pending game and its queued events are dropped, so it is neither completed
nor left pending). A game registers a progress snapshot so
the hook's own abandon carries the result block, and any explicit abandon the
screen still sends builds its result with the same helper.

**Duration.** `SyncWorker` sends the game's own `durationMs` (its active play
time) when it is > 0, and `null` ("unknown") for anything else — 0, missing or
negative (#2619). It never derives a duration from the pending game's
`completedAt − startedAt`: wall-clock time counts idle and backgrounded time as
play, so a Daily Word left open all day would record 12 h. A negative value
never reaches the server, where `duration_ms` is `ge=0` and would 400 the
whole completion.

A game with no timer of its own still reports one: `useGameSync` keeps an
active-play clock per session (#2684). It starts at `markStarted()` (or
`resume()`), pauses while the app is `background` or `inactive`, and restarts
from zero with each new session. `complete()` and the hook's own abandons fill
in `durationMs` from it unless the game (or its progress snapshot) passes a
value > 0, which always wins. A resumed session counts only from the resume.

**Deferred create and killed sessions (#2654).** `startGame()` records the
session on the device only. `SyncWorker` sends `POST /games` and the session's
events once `markStarted()` (or a completion) marks it started, so a session the
player never started never reaches the server.

When the OS kills the app no unmount runs, so the next launch finds the pending
games the earlier process left open ("orphans") — decided by where the record
came from (read from disk, not created by this process), not by comparing
clocks, so a session of the current process is never swept. A game the player
resumes stays one game:

- **Startup sweep.** `gameEventClient` registers a sweep that the pending-games
  store runs inside its own `init()`, right after the load. `SyncWorker.flush()`
  awaits that `init()`, so no flush runs between the load and the sweep. An
  unstarted orphan is discarded (it never reached the server). A started orphan
  under 24 h old is kept for its screen to resume; one 24 h old or more — the
  age the server's sweep uses — is abandoned. All changes are written in one
  AsyncStorage write, and the discarded games' events are deleted in one pass.
- **Resume.** A screen that restores saved progress calls
  `useGameSync.resume()`. If a started orphan of that game type exists, the hook
  adopts its id: already started, no new create, no `game_started`, the event
  counter continues. Otherwise nothing changes and the screen starts its session
  as usual. Daily Word passes `{ puzzle_id }` so only that puzzle's session
  matches. Twenty48, Blackjack, Solitaire, FreeCell, Mahjong, Sudoku, Hearts,
  Daily Word, Cascade, Sort, Yacht and a paused Star Swarm run resume.
- **Fresh game instead.** When a session of the same type is marked started (or
  completed) without resuming, its type's orphans are abandoned then. If that
  happens before the load, the sweep abandons them.

Every orphan abandon goes through `completeGame()` (a bare `abandoned`,
`completedAt` = its last event, else its start, and no `durationMs`), so its
`game_ended` is queued before the game is marked completed and the PATCH waits
for it. A pending record saved by an older build has no `started` field: it
counts as started if its create was sent (`startedSynced`), it has an event
beyond `game_started`, or it was finished; otherwise it is an untouched session
and is discarded. The server's 24 h stale-session sweep (#2621) remains the
fallback for devices that never report back; a device's later completion
replaces a swept row. An event batch the server refuses with 409 "Game is
already completed." is dropped quietly — no Sentry error, no dead-letter.

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

v1.0 ships with the premium games hidden entirely — no tile, no route, no
locked screen — until IAP lands (epic #822). As of 2026-09-25 those are blackjack,
cascade, hearts, starswarm and mahjong (Blackjack and Yacht swapped tiers
on 2026-09-23 so the store build carries no simulated gambling; Mahjong and Sort
swapped tiers on 2026-09-24; Sudoku moved to free on 2026-09-25 with no
compensating premium swap — see §10.8). `isGameVisible(slug)` filters:

- the Home grid and chunk prefetch (`HomeScreen.tsx`);
- route and tab registration — `App.tsx` registers premium screens from the
  `premiumRoutes.ts` registry (a game may own several routes — Blackjack has four),
  which also owns the Star Swarm-only **Ranks** tab;
- Profile — bento tiles are re-derived from visible games and hidden-game rows
  are dropped from Recent Games, so earlier plays by a tester cannot resurface.

`SHOW_HIDDEN_GAMES = __DEV__ || EXPO_PUBLIC_TEST_HOOKS === "1" || isPreLaunchApiBuild()`,
so dev builds, e2e test builds and **pre-launch builds** keep all 12 games; a store
build shows 7 tiles and 3 tabs.

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
build, `ci_post_clone.sh` may write only the pre-launch or the production API, and
only an Xcode Cloud workflow with `BC_API_TARGET=prelaunch` gets the pre-launch
one. An unset variable means production (`docs/IOS.md`, "API URL per workflow").

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

A leaked `EXPO_PUBLIC_TEST_HOOKS=1` would unhide everything. Android release
builds refuse to run when the flag is set (`docs/ANDROID-CI.md`, "Release bundle
guard"), `scripts/check-build-env.js` rejects it for the Render web build, and
Xcode Cloud rewrites `.env` on every build (it does not check the workflow's own
environment variables — never add the flag there). `frontend/metro.config.js`
keys Metro's cache on `EXPO_PUBLIC_*` values so a stale transform from a
test-hooks build can never be reused by a store build on any platform.

### 10.8 How the free/premium split is decided

The split is **criteria-driven, not quota-driven.** The original 6/6 was an
artifact of the launch-review pass (six tiles shown to reviewers, six hidden
pending IAP) — it was never a design target, and the roster will keep growing,
so nothing should be swapped just to keep the count balanced. Judge each game
against these, roughly in priority order, and let the ratio fall out wherever it
lands:

1. **Compliance/rating risk (hard constraint).** Simulated gambling, violence,
   or other rating-raising mechanics push a game to premium regardless of
   anything else — this is the only non-negotiable criterion. It's why
   Blackjack and Star Swarm are premium.
2. **Perceived paywall value.** Would someone who's never paid look at this and
   think "that's worth unlocking"? Deep content banks, real AI opponents, a
   skill ceiling — these read as premium. A shallow, single-session mechanic
   doesn't, however polished.
3. **Free-tier onboarding pull.** Name recognition and zero-friction appeal —
   the games that get someone to open the app a second time before they've
   spent anything.
4. **Genre coverage in the free tier.** A non-paying player should get a
   complete arcade, not five variations on one genre.
5. **Engineering churn cost (tie-breaker only).** Swapping a game's tier
   touches the migration, both entitlement registries, the daily-challenge
   goal pool, and the e2e specs — real but bounded, and never a reason to keep
   a game on the wrong side of #1–#4.

### 10.9 Premium difficulty levels

A single level of a game can be premium too (#1129). List it under the game's
key in `PREMIUM_LEVELS` (`frontend/src/entitlements/premiumLevels.ts`); none
is listed yet. Every level picker (the shared `DifficultyPicker`, the Star
Swarm tier picker, the Blackjack table cards and Next Table) goes through
`usePremiumLevels`, which shows the level with a lock and, when it is tapped,
opens `PremiumLevelNotice` ("part of BC Arcade Premium, coming soon") instead
of starting it.

The pickers are not the only guard. Every new game starts through
`useLastDifficulty`'s `rememberDifficulty` (Blackjack: `handleTableSelect`),
which turns a premium level into the game's default. That covers Play Again,
Quick Restart and a remembered level that has since become premium. A game
already in progress at such a level (a resumed save, a paused run) plays on. A
game's default level must never be premium; `useLastDifficulty` warns in dev
if it is. Nothing unlocks a listed level until IAP lands (epic #822); gate
`isPremiumLevel` on the entitlement then.

Each game also remembers the difficulty it was last started at
(`game/_shared/lastDifficulty.ts`, key `<gameKey>.difficulty`) and opens its
picker on it. Yacht keeps its own mode-and-difficulty preference
(`yacht_pref_v1`).

## 11. Database topology and environments

Three tiers, and no tier ever points at another's data:

| Tier       | API                                | Database                                                  | Sentry environment |
| ---------- | ---------------------------------- | --------------------------------------------------------- | ------------------ |
| Production | Render `bc-arcade-api` (`main`)    | **Supabase** Postgres, via the session pooler (port 5432) | `production`       |
| Dev        | Render `bc-arcade-api-dev` (`dev`) | Render Postgres `bc-arcade-db`                            | `development`      |
| Local + CI | uvicorn / pytest                   | SQLite (`tests/conftest.py` creates it)                   | `development`      |

- **Schema has one source: Alembic.** Both Render APIs run `alembic upgrade head`
  on every boot, so a merged migration applies itself on the next deploy. Supabase
  is used as plain Postgres — no Supabase CLI migrations, no branching, no
  PostgREST. Its **Data API is switched off**: Alembic's `public` tables carry no
  RLS, so the Data API would expose every table to anyone holding the anon key.
  (The Supabase MCP server is unaffected — it uses the Management API.)
- **Production started empty.** Nothing is ever copied from dev: no test scores,
  no dev-override entitlements.
- **The environment follows the wiring, not a switch.** The backend reads
  `ENVIRONMENT` (set per service in `render.yaml`; unset means `development`).
  The app derives it from the API URL it was compiled against
  (`frontend/src/utils/sentryConfig.ts`) — the same rule as game visibility
  (§10.7) — so pointing a build at the production API flips visibility,
  entitlements and the Sentry environment together.
- **Keep-alive.** `GET /health` never touches the database; `GET /health/db` does
  a `SELECT 1`. An external uptime monitor polls it so the database connection is
  exercised continuously and a pooler outage is visible.
- **Guards:** `test_render_yaml_prod_database_is_not_a_render_db` and
  `test_render_yaml_prod_does_not_set_dev_override`
  (`backend/tests/test_entitlements.py`) keep the blueprint from wiring prod to
  dev data or to the entitlement override.

Operational detail — env vars, first deploy, connection rules — is in
[`RENDER.md`](RENDER.md).

---

## 12. Daily cross-game challenge

One challenge a day, three goals — **Daily Word always, plus two other games** —
the thread that makes the arcade one product rather than a folder of games (App
Review guideline 4.2). Backend: `backend/daily_challenge/`.

- **Stateless, like Daily Word.** No table, no migration. Today's challenge is
  derived from `date.toordinal()` and `DAILY_CHALLENGE_SALT` for the player's
  **local** date (`tz_offset_minutes`, the same convention as
  `/daily-word/today`): the non-Daily-Word games sit in a salt-shuffled rotation
  and each day steps two places along it, so the day's two games never repeat the
  previous day's. The salt is a per-environment secret, so the schedule cannot be
  read off the public repo. (The day ordinal, not Daily Word's `YYYYMMDD`
  number, whose jumps at month ends can repeat a pick.) Tiers rotate by day too.
- **Completion is a read-side view.** `GET /daily-challenge/status` runs one
  query over the session's own `games` rows finished inside the local day and
  evaluates the goals in Python. It is the data `PATCH /games/{id}/complete`
  already writes, so a game played offline counts as soon as the sync queue
  uploads it (§4) — by the time it was played, not the time it was uploaded.
- **Goals are per game, over the result envelope (#2449).** No one measure fits
  every game, so each game owns three goals (easy / medium / hard) in its own
  terms — moves, pairs, highest tile, chips, guesses. Each goal is a predicate
  over one row's measures: the result block in `games.metadata` plus the
  `final_score` / `duration_ms` columns (`game_facts`). It is met if any one of
  the player's games of that type satisfies it. `games.outcome` is never read —
  a game reports `won` and its progress on abandon, so progress goals ("make 10
  moves") credit a game the player left, and `won` goals need a win. The fields
  each game must send are listed in `definitions.py`.
- **Rules the pick enforces (tested):** Daily Word every day; two distinct other
  games; none repeated from the previous day; at most one goal per day that
  requires a win (luck-dependent — a Klondike deal is not always winnable), the
  win slot rotating by day and any extra win goal falling back to that game's
  easy goal, which never needs a win.
- **Two slates, resolved per request (#2454).** `FREE_GOAL_POOL` (the six free
  games) and a superset `PREMIUM_GOAL_POOL` are static spec tables; which slate a
  session gets is a live database fact. `resolve_slate` runs one join over
  `game_types.is_premium` and the session's `game_entitlements`: a session gets
  the **premium** slate only if it owns **every** premium game that day's premium
  template names — otherwise it would be handed a goal in a game it cannot open —
  else the free slate. `ENTITLEMENT_DEV_OVERRIDE` counts every named premium
  game as owned (§10.4) but follows the same rule, so dev never reports a slate
  production would not. Premium-only goal specs are post-launch (#2458), so today
  the two templates are identical, every session resolves to the free slate —
  override or not — and no query runs. The slate is live: nothing pins it for the
  day, so a mid-day entitlement change swaps the challenge on the next `/status`
  (the feature is stateless by design). Two guards keep the static pool honest: a test
  fails if any free-pool game is premium in `game_types` (the pool would then
  name a game a free player cannot open), and the free pool is disjoint from the
  premium slugs, which a store build hides (§10.7).
- **`/today` is always the free slate; only `/status` can be premium.** `/today`
  has no session, so it never resolves a slate. For an entitled session the goal
  list therefore comes from `/status`, which can differ from `/today` in the goals
  themselves, not just their completion — a client must not build its goals from
  `/today` and only read completion off `/status` (#2455).
- **Streak: replayed, not stored (#2456).** `streak_days` on `GET /stats/me` is the
  number of consecutive local days with at least 2 of that day's 3 goals met — a
  count only, no reward, no new table. It works because a past day's challenge is
  reproducible from its date: `compute_streak` recomputes each day's template and
  scores it with the same `evaluate_template` the live `/status` uses, so there is
  one definition of a day and of a goal. The run ends **today** if today already has
  2 of 3, otherwise **yesterday** (today is not failed, just unfinished). One
  windowed query grouped by day in Python — never a query per day — plus one for the
  session's entitlements only when some day's free and premium templates differ
  (not until #2458). Capped at 60 days: a value of 60 means "at least 60", shown as
  "60+". `/stats/me` takes the same optional `tz_offset_minutes` as
  `/daily-challenge/*`; old clients omit it and get UTC days. A streak failure is
  logged and returns 0 rather than taking down the XP/level fields the same response
  carries. Owner decision, 2026-09-20 — not in the original release plan.
  Accepted approximations: **replay is retroactive re-scoring** — history is not
  stored, so changing a goal target, adding premium goal specs (#2458) or changing
  `DAILY_CHALLENGE_SALT` shifts every streak (treat the salt as permanent once
  players have streaks); past days use the session's _current_ entitlements, so once
  premium goals exist a purchase or refund re-scores the window under the other
  slate; one UTC offset covers the whole window, so a daylight-saving change moves a
  game finished within an hour of local midnight onto the neighbouring day; and
  history is client-reported (`completed_at` is accepted up to a year back), so a
  streak can be fabricated — fine for a count with no reward, to be revisited before
  it earns anything (#2469).
- **No copy on the wire.** Responses carry `kind` (per game, e.g. `won`,
  `moves_at_least`, `highest_tile_at_least`), `game_type` and `target`; the
  client words them in its own i18n namespace.

| Route                         | Auth                         | Limit  |
| ----------------------------- | ---------------------------- | ------ |
| `GET /daily-challenge/today`  | none (IP-keyed)              | 60/min |
| `GET /daily-challenge/status` | `X-Session-ID` (session-key) | 60/min |

## 13. Yacht computer opponent

Since #2246 (architecture decision #2269, epic #2283) all three Yacht difficulties are **one optimal engine, handicapped**. There is no separate "medium brain". The engine is the solved-game oracle (`frontend/src/game/yacht/oracle/`, [YACHT_ORACLE.md](YACHT_ORACLE.md)); `frontend/src/game/yacht/ai.ts` reads it for every decision.

Each tier values a move as **points banked now + λ × the optimal expected points still to come**, then picks among near-best options with a capped softmax:

| Tier   | Foresight λ | Temperature T | Loss cap Δ | Mean score | Upper-bonus rate |
| ------ | ----------- | ------------- | ---------- | ---------- | ---------------- |
| Easy   | 0 (greedy)  | 3             | 10         | ~162       | ~1%              |
| Medium | 0.4         | 1             | 5          | ~212–216   | ~13–17%          |
| Hard   | 1 (optimal) | 0.5           | 3          | ~245–252   | ~63–67%          |

- **Foresight** is the structural dial. λ = 0 grabs the biggest score on the table and never plans for the bonus, which reads as a real beginner. λ = 1 is perfect play. With noise off the tiers still differ.
- **Temperature** adds plausible slips: options are weighted by exp(−loss / T), so small misjudgements happen and big ones are rare.
- **The loss cap** stops outright blunders: nothing more than Δ points below the tier's best is ever picked. Holds whose best outcome can't beat banking the roll are excluded too, so no tier rerolls a made yacht or large straight.
- The tiers ignore the opponent's score (the old Hard adversarial layer was retired), so turn order can't affect their strength.

Head to head, Hard beats Easy ~92% and Medium ~72% of the time. The nightly calibration gate (`frontend/src/game/yacht/sim/gate.ts`, `.github/workflows/yacht-sim-gate.yml`) guards these numbers, and the regret gate checks each tier's per-decision quality against the oracle ([TESTING.md](TESTING.md)).

**Runtime.** The table ships compressed (~0.9 MB of JS) and decodes on first use (~0.3 s on a dev machine; slower on-device). `GameScreen` calls `preloadOracleTable()` when a VS game's difficulty is set, so the first AI turn doesn't pay for it. After that a decision is a few milliseconds.
