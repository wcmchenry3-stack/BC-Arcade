# BC Arcade — Game Architecture

This document is policy. It applies to every game shipped in this repo. New games
must be designed to fit; existing games that don't fit are tracked in linked
issues for migration.

Use this file for **system ownership and data-flow boundaries**. Use
[GAME-CONTRACT.md](GAME-CONTRACT.md) for the normative game/session integration
contract, [GAMEPLAY_STANDARDS.md](GAMEPLAY_STANDARDS.md) for shared gameplay/UI
engineering rules, and the per-game files under [docs/games/](games/) for actual
gameplay rules. Dedicated subsystem documents should own their detailed product
rules rather than duplicating them here.

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
- The local write queue: every game records its sessions through `useGameSync`
  and the shared `SyncWorker` (see §4).

### 2.2 The server owns

- Persistence: game records, final scores, event logs.
- Pseudonymous install identity (`X-Session-ID`) and the optional, server-generated leaderboard name (#2778); account authentication remains future work.
- **Boundary security:** input validation, payload size caps, rate limits,
  content sanitization, ORM-only DB access. The OWASP layer stays even though
  rule enforcement leaves. See §6.
- Vocabulary: `GameType` and `GameOutcome` enums (see [GAME-CONTRACT.md](GAME-CONTRACT.md)).
- Aggregates: leaderboards, ranks.

### 2.3 The server explicitly does NOT

- Validate game rules.
- Recompute scores from event logs.
- Hold in-memory session state for single-player games.

## 2.4 Backend map

The backend is a **shared reporting/persistence service**, not twelve separate
game servers.

`backend/main.py` holds `create_app()`, which builds the FastAPI application and
mounts a small set of shared product routers plus the few game-specific services
that genuinely need server behavior; `app = create_app()` is the `main:app`
entrypoint Render runs. It also owns the lifespan (background jobs), the
app-level exception handlers, CORS and the middleware order. Process-wide setup
lives beside it (#2993): `backend/observability/` (Sentry options, scrub lists,
`init_sentry()`; logging setup), `backend/middleware/` (`headers_and_log.py`,
one pure-ASGI layer for the security headers and the JSON request log, outermost;
`body_size.py`, the per-path body caps, innermost) and `backend/routes/`
(`/health`, `/health/db`, the test-only `/debug/error`).

**Errors and database sessions in routes (#2993).** Routers raise the domain
errors untranslated: `GameServiceError` (`games/sessions.py`) and
`PurchaseError` (`purchases/verifiers.py`) both carry `status_code` and
`detail`, and one app-level handler in `main.py` answers them with exactly the
response `HTTPException(status_code, detail)` gives (`{"detail": ...}`),
beside the `EntitlementError` handler (`{"detail": "not_entitled", "game": ...}`).
The one exception is the Google RTDN `401`, which the route still raises as
an `HTTPException` because it carries `WWW-Authenticate: Bearer`. Routes take
their session as `db: DbSession`, an `Annotated` alias for
`Depends(db.base.get_db, scope="function")`: one session per request, shared
with `require_entitlement`, and closed when the route returns, before the
response is sent. A session costs no I/O until its first query. Two routes
open their own session on purpose: `POST /daily-word/guess`, whose
degrade-open `try` must also catch a failure to build one, and
`GET /entitlements`, whose dev override answers without a database. The
webhook routes and background jobs pass a session factory, since they run
several transactions. Tests replace the session with
`app.dependency_overrides[get_db]`.

**Background jobs (#2994).** The three in-process jobs (Daily Word retention,
the App Store notification replay, the Google Play jobs) are `PeriodicJob`s
(`backend/jobs/periodic.py`): `run`, `interval_s`, `timeout_s`, and the Sentry
`subsystem_tag` and `fingerprint` for a failed run. `loop()` runs the job now
and then every interval; a failure or timeout is logged, reported through
`observability.report.report_exception` and retried next cycle, never raised.
`backend/jobs/lifespan.py` lists them in `configured_jobs()` (a job whose
config is missing returns `None` and is left out). `main.lifespan` starts them
in that order as tasks in `app.state.job_tasks`, before the DB health check,
and stops them in reverse on every exit. `PeriodicJob.stop` cancels the task
and waits at most `STOP_TIMEOUT_S` (5 s), logging when the task will not stop.
A task that crashed is re-raised when the job sets `reraise_on_crash` (retention
only) and swallowed otherwise (the purchase jobs); either way every other job is
still stopped. Adding a job is one `PeriodicJob(...)` builder plus one line in
`configured_jobs()`.

| Area                      | Location                   | Responsibility                                                                                                     |
| ------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Shared game sessions      | `backend/games/`           | Create/complete games, append events, ranking, board definitions, progression helpers, shared schemas (modules below) |
| Game vocabulary           | `backend/vocab.py`         | Canonical `GameType` and `GameOutcome` vocabulary                                                                  |
| Database                  | `backend/db/`              | SQLAlchemy engine/session setup and persisted models                                                               |
| Schema migrations         | `backend/alembic/`         | The only production schema-evolution path                                                                          |
| Stats / Profile data      | `backend/stats/`           | Cross-game and per-game aggregates over shared session rows                                                        |
| Player display name       | `backend/players/`         | Opt-in leaderboard membership and the server-generated public name for the pseudonymous player id (#2778)          |
| Entitlements              | `backend/entitlements/`    | Which premium games the current session may open                                                                   |
| Daily Challenge           | `backend/daily_challenge/` | Frozen daily goal schedules, evaluation and streak derivation                                                      |
| Daily Word                | `backend/daily_word/`      | Daily puzzle/guess service, one of the deliberate server-side gameplay exceptions                                  |
| Internal bug logs         | `backend/logs/`            | Session-linked diagnostic log ingestion                                                                            |
| Delete-my-data            | `backend/me/`              | Player/session data deletion                                                                                       |
| Bottle Sort level service | `backend/sort/`            | Generated/verified level sets                                                                                      |
| Per-game descriptors      | `backend/<game>/module.py` | `GameModule` metadata/result models, winner semantics, board definition and Stats shaping—not a second rule engine |

The `backend/games/` service layer is split by job (#2991; the former
`games/service.py` is gone, nothing re-exports it):

| Module                   | Responsibility                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `games/sessions.py`      | Session writes: `create_game`, `append_events`, `complete_game` and result validation; `GameServiceError` |
| `games/sweep.py`         | Stale-session sweep (`sweep_stale_games`, `sweep_stale_games_safely`, `STALE_GAME_AFTER`)                 |
| `games/stats.py`         | `/stats/me` aggregation: `get_stats_for_session`, `GameTypeStats`, `StatsSummary`, `win_streaks`          |
| `games/stats_columns.py` | SQL column helpers for the comparable per-game stats (best-value candidate, time played, W/L/T)           |
| `games/history.py`       | Read side of `GET /games/me` and `GET /games/{id}`: `list_games_for_session`, `get_game_detail`           |
| `games/catalog.py`       | `GET /games/catalog` and the admin tier edit `patch_game_type` (invalidates the catalog cache)            |

Leaderboards live in the `backend/games/boards/` package (#2992; the former
`games/leaderboard.py` is gone, nothing re-exports it). Its package docstring
holds the rules every board follows.

| Module                       | Responsibility                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `games/boards/types.py`      | Result types: `BoardEntry`, `Standing`, `GameRank`, `LimitViolation`, and `LeaderboardError`              |
| `games/boards/partitions.py` | Board lookup (`enabled_board`), partition resolution (`resolve_partition`, `row_partition`), `metric_cap` |
| `games/boards/sql.py`        | SQL building blocks: `metadata_count`, `metric_expr`, `board_filters`, `best_rows`, `board_order`         |
| `games/boards/queries.py`    | Board and rank queries: `top_entries`, `viewer_entry`, `player_standing`, `game_rank`, `load_game(_type)` |
| `games/boards/limits.py`     | Submission limits for `PATCH /games/{id}/complete`: `check_completion_limits`, `merge_result_metadata`    |

`RankReason` (why `GET /games/{id}/rank` has no rank) is declared in the
declarative `games/board.py`, and `games/schemas.py` imports the registry only
inside its metadata validator, so importing the request schemas loads no
`<game>/module.py` and no query code (`tests/test_import_graph.py`).

Most per-game backend directories are **descriptors**, not gameplay services.
A normal single-player game's rules stay in the TypeScript engine on the
client. Adding a Python module for a game does not mean the server replays or
validates that game's moves.

### One game module contract

Every registered game exposes a `GameModule` that tells the shared backend:

- its canonical game type;
- whether the game has a winner concept;
- how creation metadata/result data are validated;
- how its public board / Stats "Best" value are defined;
- any game-specific Stats shaping.

Each module is a declarative subclass of `GameModuleBase`
(`backend/games/module_base.py`, #2995). The base supplies the optional hooks
with defaults that change nothing (`stats_shape`, `derive_final_score`,
`reconcile_result`), so a game overrides only what it needs and the shared
code calls every hook on every module, with no `getattr` lookups. The modules
are listed once, in the `_MODULES` tuple in `backend/games/registry.py`.
Field types shared by the metadata models (the legacy `player_name`, 64
characters in every game) live in `backend/games/metadata.py`.

The normative protocol, route behavior, outcome vocabulary, and new-game
checklist live in [GAME-CONTRACT.md](GAME-CONTRACT.md). This architecture file
does not duplicate them.

### Generated backend → frontend vocabulary

`backend/scripts/gen_vocab_ts.py` generates shared product vocabulary into
`frontend/src/api/vocab.ts`, including values such as:

- game/outcome vocabulary;
- winner semantics;
- board definitions.

`backend/tests/test_vocab.py` is the drift guard. When the backend declaration
changes, regenerate the client vocabulary rather than hand-maintaining a second
configuration.

### Persistence

Production schema changes go through Alembic migrations. The production API
uses Supabase as plain PostgreSQL; dev uses its separate Render Postgres
database; local development/CI can use SQLite. Environment/deploy details belong
in [RENDER.md](RENDER.md), not duplicated here.

### Catalog cache and the stale-sweep gate (#2966)

`game_types` and `event_types` change only through migrations and
`PATCH /games/catalog/{id}`, so `backend/games/catalog_cache.py` keeps one
snapshot of both per process: `{name: GameTypeRow}` (frozen dataclasses, never
ORM instances) and `{game_type_id: {event_name: event_type_id}}` for the
non-deprecated event types. `check_entitlement` (it reads `is_premium` there
and queries only the `game_entitlements` row of a premium game),
`POST /games`, `POST /games/{id}/events` and the leaderboard's game-type
lookup read it instead of the tables. **Purchase verification bypasses the
cache** (`purchases/service.py` `_premium_slug_for` reads `is_premium` from the
DB): the store has already charged the user, so a worker whose snapshot
predates a free → premium PATCH must not reject the purchase as
`unknown_product`. That path is not hot.

- **TTL 60 s.** `patch_game_type` invalidates the snapshot after its commit, so
  the worker that served the PATCH applies the change on its next request.
  Other uvicorn workers and instances keep their snapshot until it expires:
  **a PATCH reaches every process within 60 s**. Migrations ship with a
  deploy, which restarts every process.
- **Concurrency.** A refresh builds a new snapshot and swaps one module-level
  reference, so readers never see a half-built one; a load that raced an
  invalidation is discarded rather than stored. No lock, no Redis
  (cross-process caching is out of scope).
- **Tests.** The cache is process-global: `tests/conftest.py` clears it (and
  the sweep gate) around every test, so a test that edits those tables
  directly starts from the DB.

`/stats/me` runs the stale-session sweep (#2621) through
`backend/games/sweep_gate.py`: after a sweep it records, per session and in
process, when the sweep could next match anything (the oldest open game's
start + 24 h, capped at one hour), and skips the UPDATE until then.
`POST /games` on the same process moves that time forward for a backdated
game. A game created through another worker can therefore be counted up to an
hour late, and only in `sessions` / `total_games` / `favorite_game`: abandoned
rows never earn XP, streaks, best values or time played. `/games/me` still
sweeps on every first page. `daily_challenge.definitions.pick_template` is
memoised (pure, hashable arguments, frozen result).

Steady-state statement counts (guarded by
`tests/test_entitlement_lookup_perf.py`): `POST /games` 1-3 (was 4-6),
`/stats/me` 5 (was 7).

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

### 3.1 Where game code lives

One folder convention (#2980, epic #2950):

| Kind of code                                                | Location                          |
| ----------------------------------------------------------- | --------------------------------- |
| Engines, types, storage, sounds, layout, solvers, hooks     | `frontend/src/game/<name>/`       |
| React components for a game (boards, piles, tiles, pickers) | `frontend/src/components/<name>/` |
| Screens                                                     | `frontend/src/screens/`           |

`game/<name>/` is headless: nothing in it may import from `components/` or
`screens/` (enforced by the `bc-arcade/no-game-ui-imports` ESLint rule, which
has no `.tsx` exemption apart from the list below).

Explicit exception to the lint rule, plus contexts that stay under `game/`:

- `game/_shared/**` — the cross-game card/drag/deck UI kit and its contexts
  (`SelectableCard`, `drag/*`, `decks/*`, `CardSizeContext`, `SoundContext`,
  `NetworkContext`). These are the only `.tsx` files allowed to import
  `components/`.
- Per-game React contexts (`game/blackjack/BlackjackGameContext.tsx`,
  `game/hearts/RoundsContext.tsx`, `game/yacht/ScorecardContext.tsx`) stay in
  `game/<name>/` by design. They are **not** exempt from the lint rule; they pass
  because they import no UI.

### 3.2 Determinism and the seeded RNG (#2985)

Engines with seedable shuffles, deals or rolls route that randomness through a
per-engine slot rather than calling `Math.random` directly (purely cosmetic
randomness, such as Star Swarm visual effects, may still use `Math.random`):
`frontend/src/game/_shared/seededRng.ts` exports `createSeededRng(seed)` (one
32-bit LCG, `state / 2^32`, so a draw is always in `[0, 1)`), `createRngSlot()`
(an engine's swappable source: `rng()`, `setRng(fn)`, `getRng()`) and
`RandomSource`. Each engine owns its own slot, so tests pin shuffles or rolls
with `setRng(createSeededRng(seed))` without affecting other engines. Star Swarm
keeps its LCG state in its engine (it is part of the replay counters) and steps
it with the shared `lcgNext`. `_shared/simRandom.ts` (Mulberry32) is the
simulators' separate generator; do not use it in engines.

Known exception: Star Swarm's power-up type (`pickPowerUpType`) and power-up
drop position still call `Math.random`, and they do affect play. Seeding the LCG
alone therefore does not reproduce a Star Swarm run; the golden replay test
stubs `Math.random` as well. Moving those draws onto the seeded source would
change Star Swarm's gameplay sequence and needs its own golden re-record.

### 3.3 Shared engine modules (#2986)

Rule-agnostic engine pieces live once under `frontend/src/game/_shared/` and
are headless and pure like the engines that import them:

| Module                         | Exports                                                                                              | Used by                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `_shared/seededRng.ts`         | `createSeededRng`, `createRngSlot`, `RandomSource` (§3.2)                                            | every seeded engine                                      |
| `_shared/cards/types.ts`       | `Suit`, `Rank`, `SUITS`, `RANKS`, `PlayingCard {suit, rank}`, `cardColor`                            | Solitaire, FreeCell, Hearts                              |
| `_shared/cards/deck.ts`        | `createDeck()` (ordered 52), `fisherYates(deck, rng)`                                                | Solitaire, FreeCell, Hearts                              |
| `_shared/cards/foundations.ts` | `Foundations<C>`, `emptyFoundations`, `withFoundation`, `isWin(f, deckSize)`, `canStackOnFoundation` | Solitaire, FreeCell                                      |
| `_shared/undoStack.ts`         | `UNDO_CAP` (50), `pushCapped(stack, entry, cap)`, `withUndo(prev, next, cap)`                        | Solitaire, FreeCell (`withUndo`), Mahjong (`pushCapped`) |

- Each game's `types.ts` re-exports the shared card names, so `Card`, `Suit`,
  `Foundations` and `cardColor` still import from `game/<name>/types`. A game
  extends `PlayingCard` for its own state: Solitaire's `Card` is
  `PlayingCard & { faceUp: boolean }`; FreeCell's and Hearts' are
  `PlayingCard`. The saved card shape (`{suit, rank[, faceUp]}`, in that key
  order) is unchanged.
- `fisherYates` always takes the RNG as an argument; engines pass a
  `createSeededRng(seed)` or their own slot's `rng`. There is no shared RNG
  slot. The deck order and draw order are part of every seeded deal (and are
  mirrored by `backend/scripts/gen_*_seeds.py`), so changing either is a
  behaviour change that breaks the `seeds.json` parity tests.
- `withUndo` stores whole-state snapshots (the snapshot's own `undoStack`
  emptied so they never nest) and appends `undoStack` after `next`'s fields.
  Solitaire wraps it to drop one-shot `events` and carry the live clock.
  Mahjong keeps its delta entries (#2961) and only shares the capped push.
- Game rules stay in the game: `validateMove`, `applyMove`, tableau stacking,
  hints and auto-complete are not shared. Blackjack's cards (`rank: string`,
  suit glyphs) are a different domain and do not use `_shared/cards`.

### 3.4 Star Swarm engine layout (#2988)

An engine that outgrows one file becomes a package behind a barrel: the
public module keeps its path (`game/starswarm/engine.ts`, now a pure
`export *` barrel, so no importer changes) and the code lives in
`game/starswarm/engine/`, one module per subsystem, each under the
`max-lines` gate with its own `__tests__/engine.<module>.test.ts`:

| Module           | Owns                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `tuning.ts`      | Every tunable, the difficulty tiers (`DIFFICULTY_TIERS`), and the injectable `Tuning` / `DEFAULT_TUNING`    |
| `rng.ts`         | The seeded LCG (`seedRng`, via `_shared/seededRng`) and the id counters; `engineCounters()` for saves       |
| `geometry.ts`    | Béziers, overlap tests, the formation slot layout, path factories, proportional aim, `hashFrac`             |
| `roster.ts`      | Roster reads (leader tiers, Carrier armor and stage), the per-tick `TickCtx`, `mapKeep` / `mapFilterKeep`   |
| `stats.ts`       | Per-tier dodge/flak counters and the run-wide counters                                                      |
| `entities.ts`    | Pickups, explosions, the power-up type roll                                                                 |
| `extraction.ts`  | The `weaponsFree` / `hazardsLive` gates, live hazards, the extraction autopilot, `clearTransientCombat`     |
| `asteroids.ts`   | Rocks: entries, spawns, the threat contract, and the enemies' response to them (`tickAsteroidThreats`)      |
| `buddy.ts`       | Buddy: station, attack runs, evasion, the fire it draws, the hits it takes                                  |
| `carrier.ts`     | The Carrier: cadences, the volley seam, beam, attack run, and the event selectors                           |
| `enemyPhases.ts` | The per-ship phase machine (SwoopIn → Formation → Wiggling → Diving → Circling → Returning, Fleeing)        |
| `enemies.ts`     | `tickEnemies`: the fleet-wide tick (dive scheduling, sway, the Carrier context, reinforcements, stragglers) |
| `collisions.ts`  | Bullets in flight and the single damage-resolution pass (`tickCollisions`, `applyBombBlast`)                |
| `powerups.ts`    | The player's volley, upgrade ladders, pickups, `applyPowerUp`                                               |
| `wave.ts`        | `initStarSwarm`, `buildWaveState`, `tick` (the pipeline order is in its header), the phase machine          |

Modules only import downward in that order (no cycles), and the barrel is the
only thing outside the package that imports them.

**Tuning injection.** The tunables the balance simulator sweeps are fields of
a `Tuning` object; `tick(state, dt, input, tuning = DEFAULT_TUNING)`,
`initStarSwarm(…, tuning)` and `applyPowerUp(state, type, tuning)` thread one
object through the sub-ticks that read it — a property read per use, no
per-tick allocation, and the shipped game never passes one. The simulator
(`tooling/starswarm/engineVariant.ts`) binds those entry points to
`DEFAULT_TUNING` plus a variant's overrides instead of patching the engine's
source. Adding a sweepable knob means adding a `Tuning` field (defaulting to
the module constant of the same name) and reading it where the behaviour
lives; a prototype behaviour is a knob that is a no-op at its default.

## 4. Persistence and offline contract

**One write path.** Every game records its sessions the same way, and **no
game implements its own queue**:

```text
useGameSync → gameEventClient → PendingGamesStore + eventStore (device)
            → SyncWorker → POST /games, POST /games/{id}/events,
                           PATCH /games/{id}/complete
```

- `useGameSync` (`frontend/src/game/_shared/useGameSync.ts`) — the hook every
  game uses: the eleven game screens in `frontend/src/screens/` and
  Blackjack's `game/blackjack/BlackjackGameContext.tsx`. Only `SyncWorker`
  calls the `/games` write routes; screens only read (`api/stats.ts`).
- `PendingGamesStore` — pending games (creation metadata, completion summary)
  persisted across app restarts.
- `eventStore` — queued gameplay events and bug logs, sharded by priority tier.
  The tiers are mirrored in memory (#2959): the first operation loads them
  from AsyncStorage, every change writes the changed tier back, and `peek`,
  `stats`, row updates and dead-lettering read only the mirror — so a game
  move costs one write of its own tier, not a re-read of the whole queue. The
  on-disk format is unchanged. `onStats` tells subscribers (the
  capacity-warning toast) the new stats after each change, so nothing polls
  the queue.
- `SyncWorker` — uploads both: every 30 s (`SYNC_INTERVAL_MS`) while the app
  is active, on foreground and on reconnect (`NetworkContext`), and on demand
  through
  `flushQueuedGames()` (`game/_shared/flushQueuedGames.ts`) from screens that
  read server results — the result card (`lookupGameRank`), `useMyStats`,
  `LeaderboardScreen`, `HomeScreen` and `useDailyChallenge` — so a game just
  finished is uploaded before they ask. After a 5xx or network failure it backs
  off globally, exponentially (1 s → 30 min); after a 429 it backs off globally
  for the response's `Retry-After` when it has one (and delays the refused rows
  by it). An event row is deleted after a 2xx, and also when the server answers
  409 "Game is already completed." (below); a 400 or 403 dead-letters it (kept on the
  device, never re-sent); and `eventStore` drops rows older than 7 days and
  evicts over its cap (see "Queue cap" below). So a row that never got a 2xx
  can still leave the device. The interval is torn down while `AppState` is
  `background` or `inactive` and re-armed, with one immediate flush, on the
  return to `active` (#2959), so nothing wakes to read an empty queue. A
  flush takes one snapshot of the queue (one `peek`) and derives the per-game
  batches, the bug-log batches and the "all events delivered" check for
  completions from it; a game completed after the snapshot waits for the next
  pass, so its `game_ended` is always sent before its completion.
- `displayNameSync` — one pending leaderboard join or leave (see below).
- `PendingGamesStore`, `eventStore` and `displayNameSync`
  (`pendingGamesStore.ts`, `eventStore.ts`, `displayNameSync.ts`) are
  AsyncStorage-backed and survive app kill. `useGameSync`'s and `SyncWorker`'s
  own state (the active-play window, the backoff) is in memory only and does
  not.

Nothing else writes a game's result. The result card submits nothing: it only
asks `GET /games/{id}/rank` where the synced game landed (#2677; §14). There
is no per-game "name attach" either — the name is the player's (below). The
old offline score queue is gone (#2644); what older builds left under its
AsyncStorage key is cleared at launch and by "Delete my data"
(`game/_shared/legacyScoreQueue.ts`). Daily Word's
`POST /daily-word/guess` checks each guess against the server's answer during
play; it is not a result write.

**In-progress saves and device stats (#2987).** Each game keeps its resumable
game (and any device-only stats, best score or progress) in AsyncStorage
through `game/_shared/storageSlot.ts`, not its own copy of the plumbing. A
game's `storage.ts` holds only its key, the check of a stored payload and any
migration or normalising around it; the keys and the bytes written are the
game's own and have not changed (`_shared/__tests__/storageCompat.test.ts`
replays saves recorded from the pre-#2987 modules).

- `createJsonSlot` — the saved game. `load` resolves null when nothing usable
  is stored. A payload that can't be read or parsed, or whose loading throws,
  is removed and reported as a Sentry _warning_ (`captureMessage`): the
  screen recovers by starting fresh. A payload that parses but fails the
  game's check is removed silently (Blackjack, 2048, Yacht and Daily Word
  leave it stored instead; Hearts and Sudoku report it). Save and clear
  failures are reported with `captureException`. Nothing rejects.
- `createRecord` — a value that always loads (stats, a best score, Mahjong's
  layout progress): its fallback when nothing is stored or it can't be read,
  the failure reported with `captureException`, and the stored value left
  alone.
- Every report is tagged `{ subsystem: "<game>.storage", op }`. Sort's
  storage used to swallow every failure; it now reports like the others, and
  a failed read keeps its progress and level cache stored (as Sudoku's does).
- When a game saves is the screen's decision (most after every move;
  Mahjong debounced, #2961), not the slot's.

**Identity and leaderboard name (#2624, #2519 decisions 17–18, #2778).** A
player is their player id: the app's `game_session_id`, sent as `X-Session-ID`
(one per install; a reinstall or a new device is a new player until accounts,
#1047). Their public name is a property of the player, not of a game, and it
is **generated by the server, never typed** (decision record:
[LEADERBOARD-IDENTITIES.md](LEADERBOARD-IDENTITIES.md)). The server keeps one
per player (`players` table): `PUT /players/me` (no body) joins the boards and
assigns a name such as "Brave Otter 4821", `POST /players/me/reroll` swaps it
for another generated one, and `DELETE /players/me` leaves. Every leaderboard
ranks only players who have joined, counts all of their finished games, and
shows the current name, so a new name applies to all of their history at once.
A player who hasn't joined is on no board.

The app keeps **one** pending intent, join or leave, in an AsyncStorage slot
(`displayNameSync.ts`). The latest intent wins, and the slot is cleared only
once the server confirms it. It is flushed on reconnect and foreground
alongside the queues above, and on launch. A leave is stored in the slot
before the device forgets the name, so the DELETE can't be lost (launch
finishes a device clear a kill interrupted). The generated name reaches the
device from the join's response. At launch (after the flush) and when Profile
opens online, the device's copy is refreshed from `GET /players/me`, because
the server is the source of truth: migration 0030 replaced typed names. A name
typed on the device before #2624 that the server was never sent becomes a
join, once. "Get a new name" is online only.

**Safe replays (idempotency).** Retries are the normal case, so every write
the app makes is safe to repeat (`backend/games/sessions.py` module docstring):
`POST /games` dedupes on the client game id (`create_game`); events dedupe on
`(game_id, event_index)` (`INSERT … ON CONFLICT DO NOTHING`); a completed game
can't be completed again — the first completion wins and a replayed
`PATCH /games/{id}/complete` returns the row unchanged (`complete_game`), the
one exception being a row the stale-session sweep closed (#2621, below), which
a real completion replaces. `PUT /players/me` from a player who has already
joined keeps their name and writes nothing, and `DELETE /players/me` without
one deletes nothing (#2624, #2778). With the
name on the player there is no per-game name left to duplicate. The per-game
`POST /<game>/score` routes, which inserted a row per call, were removed in
#2644, and migrations 0026 and 0029 deleted the unattributable `*-anon` rows
they wrote (#2622). Rows the old instance writes during a deploy, after 0029
has run, are kept off the boards by their `*-anon` filter.

What we log:

- **Outcomes:** final score, completion / abandonment, duration, metadata.
- **Gameplay event logs:** per-move or per-action records, useful for analytics
  and for diagnosing reported bugs.

Player-submitted feedback, automatic Sentry diagnostics, and session-linked
internal bug logs are separate channels. Their current data flows and privacy
boundaries are documented in
[FEEDBACK-OBSERVABILITY.md](FEEDBACK-OBSERVABILITY.md); this architecture
section owns only the shared offline event/session pipeline.

**Result envelope (#2449).** `PATCH /games/{id}/complete` accepts an optional
`result` dict alongside `final_score` / `outcome` / `duration_ms`. Each game
module may declare a `result_model` (a Pydantic model, separate from the
creation-time `metadata_model`, which forbids extra keys); the validated result
is merged into `games.metadata` — a creation-time key wins on a collision
unless it holds `null` (`merge_result_metadata`, `backend/games/boards/limits.py`),
because leaderboards read partition keys such as `difficulty` (and the legacy
per-game leaderboard routes read `player_name`) from there — and an
invalid or oversized (> 8 KB) result returns 400 without completing the game
and is reported to Sentry (game type, failing field paths, error types — no
session id or values), because the app's sync worker dead-letters a 400. Modules with
`result_model = None` accept any dict. Result models ignore unknown keys so a
newer app build never fails completion against an older backend. Older app
builds that send no `result` keep working. The client passes the result block
explicitly as `summary.result` to `useGameSync.complete()`; the analytics
`game_ended` payload is never copied into it (#2619).

**Outcome (#2519 decision 11).** `games.outcome` carries the result, not
only the lifecycle. Games that can record a winner (`GameModule.has_winner`:
Yacht, Hearts, Daily Word, Blackjack, Mahjong, Twenty48) record `win` /
`loss` / `push` (a tie); a `completed` row from such a game (solo Yacht) is a
finish with no winner, not a win. Score-only games (Solitaire, FreeCell,
Sudoku, Cascade, Sort, Star Swarm) record `completed` — a finished game with
no win concept. `kept_playing` means the same; only Twenty48 builds from
before #2631 send it. `abandoned` is a quit, excluded from boards, stats and XP
by `games.filters.not_abandoned()`. The per-game rules live in one place, the
`GameOutcome` docstring in `backend/vocab.py`; `won` inside a result block is
only a daily-challenge input, not the win signal. Summary and per-game table:
[GAME-CONTRACT §1.2](GAME-CONTRACT.md#12-gameoutcome--outcome-vocabulary).

- **Client mapping.** A screen turns its result card's outcome into the
  recorded one with `recordedOutcome()`
  (`frontend/src/game/_shared/recordedOutcome.ts`: win→`win`, loss→`loss`,
  draw→`push`, ended→`completed`).
- **Generated vocabulary.** `HAS_WINNER` (each module's `has_winner`),
  `RESULT_OUTCOMES` and `LIFECYCLE_OUTCOMES` are generated into
  `frontend/src/api/vocab.ts` from the backend by
  `backend/scripts/gen_vocab_ts.py`; `backend/tests/test_vocab.py` fails on
  drift.
- **Runtime guard (#2642, PR #2744).** `assertOutcomeAllowed`
  (`frontend/src/game/_shared/outcomeGuard.ts`) checks every outcome as it
  leaves the app: `useGameSync`'s `complete()`, its own abandons, the outcome
  a progress snapshot reports, and `gameEventClient.completeGame`, which the
  killed-session sweep also goes through. A game with no winner recording
  `win` / `loss` / `push` throws `OutcomeNotAllowedError` in development and
  tests; in production the outcome is sent unchanged and the first violation
  per game and outcome is reported to Sentry.
- **The backend does not reject it.** `complete_game` only checks that the
  value is in `GameOutcome` — a 400 would dead-letter the game in the app. It
  does rewrite one case: an older build's certain win (a Mahjong cleared
  board, a Blackjack cash-out, the Twenty48 session that first reached 2048)
  is stored as `win` (`games/legacy_outcomes.py`, #2703).

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

**Duration fallback.** A game's own `durationMs` > 0 always wins. A game with
no timer of its own still reports one (#2684): `useGameSync` fills in the
time its active-play window has counted.

- The window counts foreground time only: `foregroundClock.foregroundNow()`,
  one app-wide counter that stops while `AppState` is `background` or
  `inactive`.
- It also stops while the game screen is blurred by a screen pushed on top
  (Stats, Leaderboard, Scorecard) and resumes when focus returns
  (`useIsScreenFocused`, #2735, PR #2743).
- Each idle gap between player-activity pings (`markStarted()`, `enqueue()`,
  `complete()`) adds at most `IDLE_GAP_CAP_MS` (10 minutes).
- It runs from mount, pauses at zero when a session ends (so a result card or
  a menu between games is never counted), and restarts from zero on
  `start()` / `restart()` after a pause, on `resume()` (a session resumed
  after a killed process counts from the resume), and on `resetPlayWindow()`.
- `complete()` sends the game's `summary.durationMs` when > 0, otherwise the
  window; the hook's own abandons send the progress snapshot's `durationMs`
  when > 0, otherwise the window. A window reading 0 sends nothing
  (`resolveDurationMs`: unknown). Blackjack sends no duration of its own, so
  the window applies.

Every rule, with the screens that call `resetPlayWindow()`, is in
[GAME-CONTRACT.md](GAME-CONTRACT.md) §2.3 "useGameSync". A game's own
clock pauses the same way, in the background and while covered
(`usePauseWhileAway`, #2750).

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
and is discarded. The server's stale-session sweep (below) remains the
fallback for devices that never report back.

**Stale-session sweep (#2621, #2519 decisions 9 and 15).** A row still open
24 h after `started_at` was left by a killed app that never reported back.
`sweep_stale_games` (`backend/games/sweep.py`) closes the caller's own such
rows as `abandoned` — `completed_at = started_at + 24 h`, `duration_ms` left
NULL, `metadata.swept = true` — in one UPDATE. It runs **on read, per player**,
at the start of `GET /stats/me` and on the first page of `GET /games/me` (no
`cursor`; later pages continue a listing that was just swept,
`backend/games/router.py`). There is no scheduler, so a player who never calls
those again keeps their open rows (boards never read open rows). A sweep
failure is logged and the read goes on unswept. A swept row still counts as
open to the device: `append_events` accepts events for it, and a later real
completion replaces it (`complete_game`), so a long-offline queue still lands
its events and then its result.

**Events for a completed game.** Whenever a game's row already has a real
(not swept) completion, `POST /games/{id}/events` answers 409 "Game is already
completed." (`append_events`). `SyncWorker` deletes those rows quietly — no
Sentry error, no dead-letter (`isAlreadyCompleted` in `syncWorker.ts`) —
because retrying can't help; the completion itself still goes out, and a
replayed completion returns the row unchanged.

**Queue cap.** `eventStore` holds at most 5,000 rows or 5 MB
(`MAX_ROWS` / `MAX_SIZE_BYTES` in `game/_shared/eventQueueConfig.ts`) and drops
rows older than 7 days; over the cap it evicts (see §5, and the
`eventStore.ts` header for the order it implements: lifecycle rows are
evicted last, everything else oldest-first). Pending games and their
completion summaries live in `PendingGamesStore`, not in this queue. If the
cap turns out to be too small in practice, that is a signal to revisit _how_
we queue — not a signal to bump the cap.

## 5. Eviction policy

The queue's priority number controls **sync/processing order**, not a simple
"evict P3 before P2 before P0" hierarchy. Capacity eviction deliberately
protects lifecycle rows first and then uses age across the remaining pool.

When the queue exceeds either the 5,000-row or 5 MB cap:

1. **P1 lifecycle rows are protected while any non-P1 rows remain.** These
   events describe the load-bearing game lifecycle (for example
   `game_started`, `game_ended`, and `hand_resolved`).
2. **P0 bug logs, P2 mid-tier events, and P3 granular events form one FIFO
   eviction pool.** The oldest row in that combined pool is evicted first,
   regardless of tier. A newer granular event can therefore outlive an older
   bug log.
3. **If the queue consists only of lifecycle rows, P1 is still FIFO-evictable.**
   It is last-to-evict, not permanently immune to the hard cap.
4. Rows older than the queue TTL are removed independently of capacity
   eviction.

This policy is intentional (#486) and is enforced by `eventStore.ts` plus the
queue-cap tests. It replaced the older pure tier-walk policy because preserving
fresh events sometimes requires evicting older nominally "higher-priority"
rows.

Eviction runs against the in-memory mirror (#2959): the row and byte totals
are kept per row as rows enter and leave, so the check after an enqueue is
O(1) while the queue is under its caps, and a pass over the pool only happens
when it is over. The order above is unchanged.

The current priority assignments still matter for batching/sync behavior:

| Tier   | Typical contents                                      |
| ------ | ----------------------------------------------------- |
| **P0** | Bug logs                                              |
| **P1** | Lifecycle events                                      |
| **P2** | Mid-tier gameplay events such as score/bet/deal/merge |
| **P3** | Granular gameplay events                              |

Bug/event priority is assigned automatically by the client; users do not choose
a priority.

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

- **#893 — Trouble-game migrations.** Its original findings no longer hold in
  the code: Yacht's server-side gameplay routes were deleted (#896) and its
  score routes with #2630 — `backend/yacht/` is a `GameModule` descriptor only;
  Blackjack's server-side engine was deleted (#897), so its one rule engine is
  `frontend/src/game/blackjack/engine.ts`; and Star Swarm's and FreeCell's
  leaderboards are not in memory — both rank finished `games` rows on the
  generic boards (#2626, #2632).
- **#894 — Shared TS rule engine epic.** Audit existing engines for headlessness
  ahead of multi-player work, including Mahjong's
  (`frontend/src/game/mahjong/engine.ts`).

Both issues note that "first step is further research" — the snapshots in those
issues are not authoritative.

**Leaderboards.** Every game's board is served by the generic routes
(`GET /games/leaderboard/{game_type}`, `backend/games/boards/`), from a
`board` each `GameModule` declares; no game has its own leaderboard store. The
rules are the same for every game — most importantly **one entry per player**
(#2519 decision 12): rows are grouped by player (`session_id`, the install,
until accounts in #1047) and only each player's best row is listed and
ranked, so a replay that doesn't beat it never appears. Only players who have joined the
leaderboards rank, under a server-generated name (decisions 17–18, #2778). The rules and routes are in
[GAME-CONTRACT.md — Leaderboard routes](GAME-CONTRACT.md#leaderboard-routes-2618);
each game's board (metric, direction, partitions, cap) is in §1.3 there and
in its own page under [`docs/games/`](games/). The per-game score and
leaderboard routes (e.g. `POST /solitaire/score`, `GET /solitaire/scores`,
`GET /freecell/leaderboard`) were removed in #2644; they now answer 404.

## 10. Premium entitlements

BC Arcade has a server-authoritative premium access layer that is independent of
game rule enforcement. Entitlements control _which games a session may open_, not
how those games behave once open.

How purchases feed this system (store verification, the `purchases` table, restore,
refunds, the product catalog) is specified in [IAP.md](IAP.md). Purchases write
`game_entitlements` rows; they do not add a second entitlement model.

### 10.1 How it works

1. The client calls `GET /entitlements` on startup and on every foreground-resume.
   Purchase and restore responses also carry a fresh token ([IAP.md §8.2](IAP.md#82-endpoints)).
2. The server returns an **RS256-signed JWT** containing:
   - `sub`: session_id
   - `entitled_games`: array of game slugs the session may access
   - `iat` / `exp`: issued-at and expiry (24-hour TTL)
3. The token is cached in AsyncStorage by `EntitlementContext.tsx`.
4. Before navigating to any premium game, the context checks `entitled_games`.
   If the game is absent, the UI shows the paywall instead ([IAP.md §9](IAP.md#9-frontend-contract--841)).

### 10.2 Offline grace period

The client may reuse the cached entitlement set for **7 days past JWT expiry**
when it cannot refresh (reviewed for paid access and retained: [IAP.md §10](IAP.md#10-entitlement-refresh-policy)). If the cache is missing or beyond the grace period,
premium access is denied locally until the app reconnects. Free games remain
accessible.

This grace is client-side continuity only. Once online, current server
authorization comes from the session's database entitlement rows, not from a
client-presented JWT claim.

### 10.3 Server authorization

The JWT is the app's signed entitlement cache; it is **not** the server's
authorization credential.

Server-side premium checks use the validated `X-Session-ID` and current
`game_entitlements` rows:

- generic `POST /games` calls `check_entitlement` before creating a premium
  game session;
- a premium game's own backend router uses
  `require_entitlement(game_slug)` when it exposes game-specific endpoints;
- shared game operations remain scoped to the session that owns the game row.

This means editing/decoding the cached client JWT cannot grant server-side
premium access. An already-open game is allowed to finish under the product rule
that entitlement changes do not interrupt gameplay.

The current session id is a client-held UUID, not an authenticated account
credential. The paid-IAP ownership/replay gate and the exact current trust model
are documented in [../SECURITY.md](../SECURITY.md).

### 10.4 Dev override

Set `ENTITLEMENT_DEV_OVERRIDE=true` in the backend environment to skip all
entitlement checks and grant access to every game. Never set this in production.

### 10.5 Key files

| Layer                            | File                                                                     |
| -------------------------------- | ------------------------------------------------------------------------ |
| Backend — JWT issuance           | `backend/entitlements/service.py`                                        |
| Backend — Route guard            | `backend/entitlements/dependencies.py`                                   |
| Frontend — Token cache & context | `frontend/src/entitlements/EntitlementContext.tsx`                       |
| DB — premium flag                | `backend/alembic/versions/0014_game_types_premium_cat.py`                |
| DB — entitlement rows            | `backend/alembic/versions/0015_add_game_entitlements.py`                 |
| DB — purchases, links, events    | `backend/alembic/versions/0031_add_purchases.py`                         |
| Backend — purchase routes/logic  | `backend/purchases/` ([IAP.md §8.4](IAP.md#84-implementation-notes-840)) |
| Store product catalog            | `frontend/src/entitlements/premiumProducts.json`                         |

### 10.6 Adding a premium game

1. Add `is_premium=true` in the Alembic migration that inserts the game row.
2. Add the game slug to `PREMIUM_GAMES` in `EntitlementContext.tsx`.
3. Add `require_entitlement("<slug>")` to every route in `backend/<game>/router.py`.
4. Document the tier in `docs/games/<game>.md`.
   4a. Add its store product to `frontend/src/entitlements/premiumProducts.json` and create the
   product in both store consoles ([IAP.md §2](IAP.md#2-catalog)); the premium-products drift
   tests fail until the catalog matches `is_premium`.
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
- route registration — `App.tsx` registers premium screens from the
  `premiumRoutes.ts` registry (a game may own several routes — Blackjack has four);
- Profile — the tiles (sessions, completed, completion rate, time played, games
  tried, favourite by completed) and the per-game list are re-derived from
  visible games, and hidden-game rows are dropped from Recent Games, so earlier
  plays by a tester cannot resurface. Profile shows no cross-game score (#2637):
  each game's best appears only in its own row, in its own terms.

`SHOW_HIDDEN_GAMES = __DEV__ || EXPO_PUBLIC_TEST_HOOKS === "1" || isPreLaunchApiBuild()`,
so dev builds, e2e test builds and **pre-launch builds** keep all 12 games; a store
build shows 7 tiles.

Tabs do not depend on visibility: every build has the same three — Lobby,
Profile, Settings — registered by `MainTabs()` from `navigation/mainTabs.ts`
(`mainTabs.test.tsx` fails on a fourth). The Star Swarm-only **Ranks** tab was
retired in #2634; a game's leaderboard opens from its result card and ⋯ menu
(the Home-stack `Leaderboard` route, #2633).

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

**Product policy:** [PRODUCT.md](PRODUCT.md#monetization) permits premium access
to complete games, not paid levels or modes inside a free game. No premium
difficulty levels are configured. The machinery below exists in the client,
but must not be used to create freemium gameplay; #1129 needs review against
this policy before any level is listed.

The existing mechanism can mark a single level of a game as premium (#1129). List it under the game's
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
- **Dialect policy (#2996).** Postgres is the only runtime dialect; SQLite
  exists for the test suite and CI's schema check. Service code never branches
  on `dialect_name(session)` (bar the exceptions listed below). SQL that differs between the two — reading a
  JSON key as a number or a flag, setting a flag, moving a timestamp — is a
  dialect-compiled element in `backend/db/jsonx.py` (`json_number`,
  `json_is_true`, `json_set_true`, `plus_hours`): one statement, compiled per
  dialect through SQLAlchemy's `@compiles`, with the SQLite body as the default.
  `games/boards/sql.py`'s `metadata_count` follows the same pattern. The only
  remaining dialect-aware code is the `insert()` constructor picked in
  `db/dialect.py` (SQLite's `ON CONFLICT` needs its own), engine/pool setup in
  `db/base.py`, `games/legacy_outcomes.py`, whose SQL is frozen against
  migration 0028, and its one caller, `games/sessions.py`, which passes
  `dialect_name(session)` to `win_update`. `JSONB_VARIANT` (`db/models.py`) is the one JSON column type:
  JSONB on Postgres, JSON on SQLite. `tests/test_jsonx.py` compiles each element
  for both dialects and executes it on the suite's database, so running the
  suite with `DATABASE_URL` pointed at a Postgres checks parity.

Operational detail — env vars, first deploy, connection rules — is in
[`RENDER.md`](RENDER.md).

---

## 11.1 Infrastructure and external services

BC Arcade intentionally keeps external-service responsibilities narrow. This is
the system map; operational commands, environment variables and secrets belong
in their runbooks.

| Service                                    | What BC Arcade uses it for                                                           | What happens if it is unavailable                                                                                               | Operational source                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **GitHub**                                 | Source, PR review, Actions/CI, dependency/security automation and repository history | Development/release automation stops; already-installed apps continue to run                                                    | Root workflows + testing/build docs                                                    |
| **Render**                                 | Dev/prod FastAPI services and secondary Expo Web sites; dev Postgres                 | Server reads/sync/entitlement/daily services are unavailable; offline-capable single-player continues locally and queues writes | [RENDER.md](RENDER.md)                                                                 |
| **Supabase**                               | Production PostgreSQL only, through the session pooler                               | Production server features that require DB access fail; local single-player can continue until sync/read services are needed    | [RENDER.md](RENDER.md)                                                                 |
| **Sentry**                                 | Native app + backend crashes/errors/performance and in-app User Feedback             | Diagnostics/feedback visibility is reduced; gameplay should continue                                                            | `sentryConfig.ts`, backend `observability/sentry.py`; canonical feedback/observability doc under #2805 |
| **Cloudflare**                             | DNS/TLS/network routing for BC Arcade domains                                        | Custom domains/routing may fail even when Render services are healthy                                                           | Render/domain configuration                                                            |
| **Apple/Xcode Cloud/App Store Connect**    | iOS build/sign/test/distribution toolchain                                           | New iOS builds/releases stop; installed builds are unaffected                                                                   | [IOS.md](IOS.md)                                                                       |
| **Google Play / Gradle signing toolchain** | Android build/sign/test/distribution                                                 | New Android releases stop; installed builds are unaffected                                                                      | [ANDROID-CI.md](ANDROID-CI.md)                                                         |

### Secrets and configuration ownership

This public repository documents **secret names and required placement, never
secret values**. Runtime credentials live in the appropriate service/dashboard
or the owner's password manager. Do not paste secrets into source, issues,
documentation, PR descriptions, or tool arguments.

For the concrete Render/Supabase environment topology and variable inventory,
use [RENDER.md](RENDER.md). Build-time API-target rules live in
[IOS.md](IOS.md) and [ANDROID-CI.md](ANDROID-CI.md).

**Backend settings (#2997).** The API reads its env vars through one
pydantic-settings object, `Settings` in `backend/settings.py`. `create_app()`
builds it once, keeps it on `app.state.settings` and passes it to the code that
needs it, so a test either passes a `Settings` to `create_app()` or sets env
vars before calling it. `Settings(...)` still fills any field it is not given
from the environment (including a developer's `backend/.env` once `main` has
loaded it), so tests should build it with `Settings.isolated(ENVIRONMENT="test",
...)`, which ignores the environment and uses defaults for the rest. Env var names (case-sensitive,
no prefix) and defaults are exactly the ones the old `os.environ.get` calls
used, and a bad `TRUSTED_PROXY_*` value still raises `ValueError` at startup.
Operational tunables (TTLs, windows, caps) are named constants, never env vars.

| Setting                | Default when unset                                | Read by                                                 |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| `ENVIRONMENT`          | unset (Sentry reports `development`)              | `main` (docs routes, `/debug/error`), Sentry, `limiter` |
| `ALLOWED_ORIGINS`      | `http://localhost:8081`, `http://localhost:19006` | `main` (CORS)                                           |
| `SENTRY_DSN`           | unset (Sentry off)                                | `observability/sentry.py`                               |
| `RENDER_GIT_COMMIT`    | unset (no Sentry release)                         | `observability/sentry.py`                               |
| `TRUSTED_PROXY_MODE`   | `cloudflare`                                      | `limiter.py`                                            |
| `TRUSTED_PROXY_HOPS`   | `1` (1–10)                                        | `limiter.py`                                            |
| `LOG_PROXY_HEADERS`    | unset (off; ignored in production)                | `limiter.py`                                            |
| `DATABASE_URL`         | unset or blank (no database; the API still boots) | `db/base.py` (on first use), `alembic/env.py`           |
| `DAILY_WORD_SALT`      | `0` (empty or non-integer fails the import)       | `daily_word/puzzle.py` (at import)                      |
| `DAILY_CHALLENGE_SALT` | `0` (blank → `0`; non-integer is hashed)          | `daily_challenge/definitions.py` (at import)            |

`db/base.py` reads `DATABASE_URL` on its first `is_configured()` /
`get_engine()` call and keeps it for the process, because the engine is
process-wide; `create_app()` does not pass its `Settings` there, and tests
override it with `monkeypatch.setattr(base, "_settings", Settings.isolated(...))`.
The two salts are still read when their modules are imported (the Daily Word
shuffle needs its salt), so `load_dotenv()` in `main` must still run before the
imports.

Not yet migrated (each package moves in its own PR): `ADMIN_API_TOKEN`
(`games/router.py`), `ENTITLEMENT_*` (`entitlements/service.py`) and the
`APPLE_*` / `GOOGLE_*` store config (`purchases/`). Their meanings and where
each is set are in [RENDER.md](RENDER.md#environment-variables).

## 12. Daily cross-game challenge

Daily Challenge is a shared read-side product system built on completed
`games` rows: three goals per local day, frozen per date/slate, plus an
app-wide derived streak.

The current product rules, goal scheduling/evaluation, free/premium slate
resolution, API behavior, streak algorithm, offline implications, and the
known UTC-offset/DST limitation are canonicalized in
[DAILY-CHALLENGE.md](DAILY-CHALLENGE.md).

At the architecture level, the important boundaries are:

- normal games write their existing shared session/result data; they do not
  call a separate challenge-completion endpoint;
- `backend/daily_challenge/` reads those rows and freezes each day's assigned
  goal specs in `daily_challenge_days`;
- the challenge and streak are derived views, not mutable counters;
- the Home card consumes the session-scoped status route and localizes goal
  copy on the client.

## 13. Yacht computer opponent

Since #2246 (architecture decision #2269, epic #2283) all three Yacht difficulties are **one optimal engine, handicapped**. There is no separate "medium brain". The engine is the solved-game oracle (`frontend/src/game/yacht/oracle/`, [research/YACHT_ORACLE.md](research/YACHT_ORACLE.md)); `frontend/src/game/yacht/ai.ts` reads it for every decision.

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

Head to head, Hard beats Easy ~92% and Medium ~72% of the time. The nightly calibration gate (`frontend/tooling/yacht/gate.ts`, `.github/workflows/yacht-sim-gate.yml`) guards these numbers, and the regret gate checks each tier's per-decision quality against the oracle ([TESTING.md](TESTING.md)).

**Runtime.** The table ships compressed (~0.6 MB of JS) and decodes on first use (~0.3 s on a dev machine; slower on-device). `GameScreen` calls `preloadOracleTable()` when a VS game's difficulty is set, so the first AI turn doesn't pay for it. After that a decision is a few milliseconds.

## 14. Result, leaderboard and stats screens

BC Arcade has five distinct player-facing reporting surfaces: the end-of-game
result card, one-game leaderboards, one-game Stats, live Scorecards, and the
cross-game personal Profile.

Their current product behavior and ranking model are documented in
[LEADERBOARDS.md](LEADERBOARDS.md). The normative integration contract—what a
game records, how `BoardDefinition` works, and how `GameShell` /
`useGameSync` connect those surfaces—remains
[GAME-CONTRACT.md](GAME-CONTRACT.md).

At the architecture level, the important boundary is:

- completed/history/ranking surfaces read the shared server-side game/session
  model;
- a Scorecard reads the live game already running on the device;
- no surface submits an independent per-game score outside the shared game
  session contract;
- Profile aggregates only metrics that are comparable across games and never
  invents a cross-game score.

The result card lives in `frontend/src/components/result/` (`GameResultModal`,
`ResultCard`, `SubmissionLine`, `resultButtons`, `resultTypes`; #2990). Its
leaderboard line is fed by `useGameRank(gameType)`
(`game/_shared/useGameRank.ts`), which runs `lookupGameRank` and exposes
`{ status, rank, isBest, playerName, lookup(gameId), joinLeaderboards, retry,
reset }`; `toSubmission(leaderboard)` maps that state to the card's
`submission` prop.

Manual device verification lives in
[MANUAL-QA-LEADERBOARDS.md](MANUAL-QA-LEADERBOARDS.md).
