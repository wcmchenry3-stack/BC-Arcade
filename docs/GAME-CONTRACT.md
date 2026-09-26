# Game Contract

This document is the single reference for adding a new game to BC Arcade. It covers every system boundary a new game must satisfy — backend protocol, vocabulary sources of truth, metadata validation, stats shaping, leaderboards and player identity on the backend; session sync, outcome recording, the result card and the stats surfaces on the frontend — plus the step-by-step checklist a contributor follows.

**Status:** Backend and frontend contracts both describe the code as of epic #2519 (leaderboards and scoring), Phases 1–3. Per-game detail (each game's metric, outcomes, metadata and quirks) lives in [`docs/games/*.md`](games/); this document holds only what every game shares.

---

## Table of contents

1. [Backend contract](#1-backend-contract)
   - [GameType — game type vocabulary](#11-gametype--game-type-vocabulary)
   - [GameOutcome — outcome vocabulary](#12-gameoutcome--outcome-vocabulary)
   - [GameModule Protocol](#13-gamemodule-protocol)
   - [Metadata models](#14-metadata-models)
   - [stats_shape()](#15-stats_shape)
   - [players\[\]](#16-players)
   - [Completion, idempotency and the stale-session sweep](#17-completion-idempotency-and-the-stale-session-sweep)
2. [Frontend contract](#2-frontend-contract)
   - [Where the shared pieces live](#21-where-the-shared-pieces-live)
   - [GameShell](#22-gameshell)
   - [useGameSync](#23-usegamesync)
   - [Recording the outcome](#24-recording-the-outcome)
   - [Result card and leaderboard](#25-result-card-and-leaderboard)
   - [Stats, Scorecard and Profile](#26-stats-scorecard-and-profile)
   - [ESLint boundary](#27-eslint-boundary)
   - [Testing and QA](#28-testing-and-qa)
3. [New-game checklist](#3-new-game-checklist)

---

## 1. Backend contract

### 1.1 GameType — game type vocabulary

**Authority: `backend/vocab.py` + the `game_types` DB table.**

```python
# backend/vocab.py
class GameType(str, Enum):
    YACHT      = "yacht"
    TWENTY48   = "twenty48"
    BLACKJACK  = "blackjack"
    CASCADE    = "cascade"
    SOLITAIRE  = "solitaire"
    HEARTS     = "hearts"
    SUDOKU     = "sudoku"
    MAHJONG    = "mahjong"
    STARSWARM  = "starswarm"
    FREECELL   = "freecell"
    SORT       = "sort"
    DAILY_WORD = "daily_word"
```

The Python enum and the DB table are kept in sync by a CI test (`tests/test_vocab.py`) that fails if any enum member is missing a DB row or vice versa. The TypeScript `GAME_TYPES as const` in `frontend/src/api/vocab.ts` is **generated** from the enum — never edit it by hand.

**To add a new game type:**

1. Add a member to `GameType` in `backend/vocab.py`.
2. Write an Alembic migration that `INSERT`s the new row into `game_types`.
3. Regenerate the TS contract:
   ```bash
   python backend/scripts/gen_vocab_ts.py > frontend/src/api/vocab.ts
   ```
4. CI will fail until both the enum and the DB row exist.

---

### 1.2 GameOutcome — outcome vocabulary

**Authority: `backend/vocab.py` (`GameOutcome` enum).** Its docstring is the
one place the meaning of each value — and which games write it, and when — is
written down. Read it there; this section is a summary.

```python
class GameOutcome(str, Enum):
    # Result vocabulary — games with a winner (GameModule.has_winner)
    WIN          = "win"
    LOSS         = "loss"
    PUSH         = "push"      # a tie

    # Lifecycle vocabulary
    COMPLETED    = "completed"     # finished, no win concept
    ABANDONED    = "abandoned"     # the player quit
    KEPT_PLAYING = "kept_playing"  # legacy: Twenty48 builds before #2631

# Exported to the app as RESULT_OUTCOMES / LIFECYCLE_OUTCOMES (#2642)
RESULT_OUTCOMES = (GameOutcome.WIN, GameOutcome.LOSS, GameOutcome.PUSH)
LIFECYCLE_OUTCOMES = tuple(o for o in GameOutcome if o not in RESULT_OUTCOMES)
```

`games.outcome` carries the result (#2519 decision 11, PR #2592): games with a
winner record `win` / `loss` / `push` — Yacht vs the computer, Hearts, Daily
Word, Blackjack (a run that reached its goal / ran out of chips, #2628),
Mahjong (a cleared board is a `win` since #2627, a deadlock the player leaves
a `loss`) and Twenty48 (the 2048 tile / a game over before it, #2631).
`GameModule.has_winner` means "this game can record win / loss / push" and is
set only once the client really writes them, a win included: true for Yacht,
Hearts, Daily Word, Blackjack, Mahjong and Twenty48. It is a
per-game flag, not a per-row fact — a `completed` row from a `has_winner` game
(solo Yacht) is a finish with no winner, not a win. Score-only games
(Solitaire, FreeCell, Sudoku, Cascade, Sort, Star Swarm) record `completed`,
which means "no win concept" (win rate shows "—"); so does a `kept_playing`
from a Twenty48 build before #2631 that isn't stored as a win (below). `abandoned` is a quit and is excluded from leaderboards, stats and
XP by `games.filters.not_abandoned()`. There is no separate `won` field. The
client maps its result card to these values in one place,
`frontend/src/game/_shared/recordedOutcome.ts` (§2.4). The never-written `blackjack`
value was removed in migration `0024_drop_blackjack_outcome` (#2619).

**Older builds' wins (#2703).** Builds from before a game started writing
`win` / `loss` (Mahjong #2627, Blackjack #2628, Twenty48 #2631) still send
`completed` (or `kept_playing`). Where the stored result proves the game was
won — Mahjong `metadata.won` true, Blackjack `metadata.final_chips` > 0,
Twenty48 the session in which 2048 was first reached — the row is stored as
`win`. `backend/games/legacy_outcomes.py` holds the rules; `complete_game`
applies them to each such completion, and migration
`0028_backfill_win_outcomes` applied them once to older rows.

**Who may record a result.** Only a game whose module has `has_winner` true
records `win` / `loss` / `push`. The **backend does not enforce this**:
`PATCH /games/{id}/complete` rejects only a string outside `GameOutcome`
(400 `Invalid outcome`), because a rejected completion would dead-letter the
game in the app. The rule is enforced in the app instead: `RESULT_OUTCOMES`,
`LIFECYCLE_OUTCOMES` and `HAS_WINNER` (each module's `has_winner`) are
generated into `frontend/src/api/vocab.ts` (#2642, #2744), and the runtime
outcome guard (§2.4) checks every outcome the app sends.

The `CHECK` constraint on `games.outcome` is **generated** from this enum in `db/models.py` — it cannot drift. The TS `GAME_OUTCOMES as const` is also generated by the same script.

**To add or rename an outcome:**

1. Update `GameOutcome` in `backend/vocab.py`.
2. Generate a new Alembic migration — the `CHECK` constraint rebuilds automatically from the enum.
3. Regenerate the TS contract (same command as above).

---

### 1.3 GameModule Protocol

**Authority: `backend/games/protocol.py`**

Every game module must expose an object that satisfies the `GameModule` `typing.Protocol` (structural subtyping — no inheritance required):

```python
@runtime_checkable
class GameModule(Protocol):
    game_type: GameType          # identifies this module in the registry
    metadata_model: type[BaseModel]  # Pydantic model for games.metadata validation
    result_model: type[BaseModel] | None  # result block on PATCH /games/{id}/complete, or None
    has_winner: bool             # True → this game can record win/loss/push (see §1.2)
    board: BoardDefinition            # how the game is ranked (#2617); required

    def stats_shape(self, raw_stats: dict) -> dict: ...
```

**`board`** (`backend/games/board.py`, #2617) declares the game's leaderboard rule once. It is required: a game with no leaderboard declares a board with `enabled=False`, never `None`. Boards are shared class-level singletons, so the model is frozen and every container field is a tuple. The generic leaderboard routes below read them (#2618); stats read them too (#2620, §1.5).

| Field                  | Type                                      | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `metric`               | `str`                                     | What is ranked: `"final_score"` (the `games` column) or a `games.metadata` key.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `direction`            | `"asc" \| "desc"`                         | `desc` = higher is better, `asc` = lower is better.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `tiebreak`             | `tuple[str, Direction] \| None`           | Optional `(metadata key, direction)` applied before the final tie-break, `completed_at asc`, which every board uses.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `label_key`            | `str`                                     | i18n key for the metric's label.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `partitions`           | `tuple[str, ...]`                         | Metadata keys that split the game into one board per combination of values.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `partition_defaults`   | `tuple[tuple[str, str], ...]`             | `(key, value)`: the value assumed when a row lacks that partition key or holds `null` (legacy rows). Keys must be in `partitions`, once each. Read with `partition_default(key)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `partition_values`     | `tuple[tuple[str, tuple[str, ...]], ...]` | `(key, allowed values)`: the only values that key has a board for; a request for any other is a 400, and a row holding another value is stored but can't be named, so it never ranks (`test_partition_values_fill_every_board_and_nothing_else_ranks`). The models accept every allowed value, and other values too: a 4xx on create or completion would dead-letter the whole game in the app. A key not listed takes any value. Keys must be in `partitions`, once each; values non-empty and distinct; that key's `partition_defaults` and `partition_max_values` values must be among them. Read with `allowed_values(key)` / `is_allowed(key, value)`. |
| `max_value`            | `int \| None`                             | Highest legitimate `metric` value on any of the game's boards (absorbs #2215). `None` = no ceiling.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `partition_max_values` | `tuple[tuple[str, str, int], ...]`        | `(key, value, cap)`: a tighter cap for rows in that partition. Keys must be in `partitions`, each `(key, value)` once, each cap at most `max_value` (which must be set). `max_value_for(metadata)` returns the effective cap for a row.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `qualifying_outcomes`  | `tuple[str, ...] \| None`                 | `games.outcome` values that count toward the board and the per-game "best" in stats. `None` = every non-abandoned row. Never includes `abandoned`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `enabled`              | `bool`                                    | `False` for games with no leaderboard. Their `metric`, `direction`, `label_key` and `qualifying_outcomes` still define the "best" in stats.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

The definitions are exported to the app as `BOARDS` in `frontend/src/api/vocab.ts` by `backend/scripts/gen_vocab_ts.py`, every field camelCased (`tiebreak`, `labelKey`, `partitions`, `partitionDefaults`, `partitionValues`, `maxValue`, `partitionMaxValues`, `qualifyingOutcomes`, `enabled`); the pair and triple tuples become records (`{ variant: "classic" }`, `{ difficulty_tier: ["Ensign", …] }`, `{ difficulty: { easy: 100, … } }`). `tests/test_vocab.py` fails on drift. The generic leaderboard and rank routes (#2618, below) read them; stats read them too (#2620, §1.5).

| Game       | metric          | direction | tie-break         | partitions (default)                | max_value                            | qualifying outcomes | enabled |
| ---------- | --------------- | --------- | ----------------- | ----------------------------------- | ------------------------------------ | ------------------- | ------- |
| Yacht      | `final_score`   | desc      | —                 | —                                   | 1575                                 | any                 | yes     |
| Solitaire  | `final_score`   | desc      | —                 | —                                   | 1245                                 | any                 | yes     |
| FreeCell   | `final_score`   | asc       | —                 | —                                   | —                                    | any                 | yes     |
| Mahjong    | `final_score`   | desc      | —                 | —                                   | 1220                                 | any                 | yes     |
| Hearts     | `final_score`   | desc      | —                 | —                                   | 100                                  | any                 | yes     |
| Sudoku     | `final_score`   | desc      | —                 | `difficulty`, `variant` (`classic`) | 300 (easy 100, medium 200, hard 300) | any                 | yes     |
| Cascade    | `final_score`   | desc      | —                 | —                                   | —                                    | any                 | yes     |
| Sort       | `level_reached` | desc      | `total_moves` asc | —                                   | 23                                   | any                 | yes     |
| Blackjack  | `final_score`   | desc      | —                 | —                                   | —                                    | any                 | no      |
| Daily Word | `guesses_used`  | asc       | —                 | —                                   | —                                    | `win`               | no      |
| Twenty48   | `final_score`   | desc      | —                 | —                                   | —                                    | any                 | yes     |
| Star Swarm | `final_score`   | desc      | —                 | `difficulty_tier` (`LieutenantJG`)  | —                                    | any                 | yes     |

"any" means every non-abandoned row. Notes on the declarations:

- **Yacht** 1575 is the theoretical maximum with bonus Yachts, recomputed from `engine.ts` in `tests/test_board_definitions.py`. Solo and vs-the-computer games share the board; the session metadata records `mode` (`solo` | `vs`) and, for a vs game, `difficulty` (#2630). The legacy `POST /yacht/score` and `GET /yacht/scores` were removed in #2630.
- **Sudoku** scores `DIFFICULTY_BASE[difficulty] - 10 × errors` (`SudokuScreen.tsx`), so each difficulty has its own cap. Rows from before #748 carry no `variant` and count as `classic`, as in `sudoku/router.py`.
- **Daily Word**'s best is the fewest guesses in a won game; a loss is not a best.
- **Twenty48** has one global board with no ceiling (#2519 decisions 1 and 14). A `kept_playing` completion counts like `completed`.
- **Star Swarm** has one board per `difficulty_tier` (plan §4.2) and no ceiling (decision 14). The tier is creation metadata and is repeated in the result, so it is in `games.metadata` either way. Only the ten tiers the app can send have a board (`partition_values`, from `DIFFICULTY_TIERS` in `starswarm/models.py`, which `tests/test_starswarm_module.py` checks against `DIFFICULTY_TIERS` in the client's `engine.ts`); a run on any other tier (a forged `captain`, or a tier a newer app sends first) is stored but can't be named (400 `This game's board does not exist.`), so it can't open a public board and the run isn't dead-lettered. A row with no tier counts as `LieutenantJG`, the legacy `POST /starswarm/score` default.
- **Legacy rows:** the per-game routes wrote different values than the boards declare. Yacht's removed `POST /yacht/score` stored `400 - raw` in `final_score` under the `yacht-anon` session; Sort stored the level in `final_score` under `sort-anon`. The generic board (#2657) excludes every `*-anon` row, so these rows never meet the declarations.
- **Sort** (#2625): every solved level is a session row with `won: true` and the `level` actually played, its `moves` and `undos` (`SortResult`). Every solve, replays included, is scored with the player's standing after it: `final_score` and `level_reached` are the highest level solved, and `total_moves` is the sum of the player's best moves over levels 1 to it (`@sort/best_moves`; left out when one of them has no best on record, so the row ranks after equal levels that have one). The board keeps each player's best row, so a replay that lowers a best improves their rank. Abandons carry no score and never rank.
- **FreeCell** (#2632): a win sends `final_score = moveCount` (installed builds still send none). Abandons carry no score and never rank.

Every `GameType` has a module since #2623, so no game exports `null`.

#### Leaderboard routes (#2618)

**Authority: `backend/games/leaderboard.py`, `backend/games/ranking.py`, `backend/games/router.py`.** Every game's board is served by these generic routes; a game gets a leaderboard by declaring `board`, with no router of its own. The name and rank routes compute a player's standing with one function, `leaderboard.player_standing`, using the board's own filters and order, so the two routes and the listed board always agree.

- **`GET /games/leaderboard/{game_type}`** returns `{game_type, partition, label_key, entries: [{rank, player_name, value, completed_at, is_me}], me}`, top 10 by default (`?limit=` 1–100). With a valid `X-Session-ID` (#2633) the caller's own entry is flagged `is_me`, and `me` is their best entry on that board with its exact rank (`leaderboard.viewer_entry`, the same filters, order and `compute_rank` as the list), whether or not it is in `entries`; `me` is null without the header or when the caller has no entry (no display name, or no eligible game). The app never matches a row by name. Read-only; a free board stays public without the header. Partition values are query params named after `board.partitions` (e.g. `?difficulty=hard&variant=mini`); a missing, unknown, empty or repeated partition is a 400, and so is a value outside the key's `partition_values` (e.g. `?difficulty_tier=captain`). Unknown games, games without a module or board, and `enabled=False` boards are a 404.
- **`PATCH /games/{id}/name`** with `{player_name}` (1–32 characters after trimming) is kept for installed builds (#2624). The name is the player's, not the game's, so it upserts the caller's display name exactly like `PUT /players/me` (below) and every board shows it. It returns `{rank, is_best}`: the rank of the caller's **best** entry in that game's partition, and whether this game is that entry. 400 if the game could never rank: unfinished, no metric value, abandoned, an outcome outside `qualifying_outcomes`, a partition value the board doesn't allow (`This game's board does not exist.`), or a metric that is negative, not an integer or above the row's cap; nothing is written then. 403 if another session owns it; 404 if the game or its board doesn't exist. It also still writes `metadata.player_name` on that row, only because the legacy per-game `GET /<game>/scores` routes read it from session rows; #2644 removes both.
- **`GET /games/{id}/rank`** (#2677) is the result card's call: where this game puts the caller, without setting anything. It returns `{rank, is_best, ranked, reason}`. When `ranked` is true, `rank` and `is_best` are exactly what `PATCH /games/{id}/name` would return. When it is false, both are null and `reason` is the first of these that applies: `board_disabled` (the board has `enabled=False`, e.g. Blackjack); `not_finished` (no `completed_at` or no metric value yet, usually because the completion is still in the app's sync queue, so asking again later can give a rank); `not_rankable` (the game can never rank: abandoned, a non-qualifying outcome, a disallowed partition value, a bad or over-cap metric, or a session the board excludes); or `no_name` (the player has no display name, so no board shows them and no rank is computed). `not_finished` and `not_rankable` together are the name route's 400 reasons. Both come before `no_name`, so a card never asks for a name the game couldn't use. "Has a name" is decided through `players.names`, like every board. 403 if another session owns the game or a premium game isn't entitled, 404 if the game doesn't exist or its game has no board definition, 400 without `X-Session-ID`. It is read-only: no name and no metadata are written. Rate limit: 60/minute per session with a 300/minute per-IP backstop, like the leaderboard.
- **`GET /players/me`** returns `{display_name}`, the caller's name or `null`. **`PUT /players/me`** with `{display_name}` (validated like `player_name`) upserts it and returns `{display_name}` with the stored, trimmed name; sending the current name again writes nothing and returns the same response. **`DELETE /players/me`** clears it (204, also when none was set), which takes the player off every board. **Authority: `backend/players/`.** The player is the `X-Session-ID` (one per install until accounts, #1047); `players` holds one `display_name` per player, with no history. A name is 1–32 characters after `str.strip()` with no control characters (Unicode `Cc`); the app's `normalizeDisplayName` applies the same rule. `DELETE /me` erases it with the player's other data, and the app's "Delete my data" also forgets the name on the device (after any sync in flight), so the next launch doesn't send it again. Profile's "Remove my name from leaderboards" (#2637) forgets the name on the device and sends `DELETE /players/me` through the same one-slot sync as the PUT, so an offline removal goes out on reconnect.
- **Legacy name paths still name the player** (#2624): builds from before #2624 never call `PUT /players/me`, so a name they send through `PATCH /sudoku/score/{id}`, `PATCH /cascade/score/{id}`, a legacy `POST /<game>/score` (when the request carries a valid `X-Session-ID`) or a `player_name` in `POST /games` metadata also becomes the caller's display name (cut to 32 characters; ignored if it isn't a valid name).
- **Result-card flow for session boards** (#2677): the card doesn't submit a score. A game passes `sessionBoardAdapter(gameType)` (`frontend/src/game/_shared/sessionBoardAdapter.ts`) to `useLeaderboardSubmit` and calls `submit({ gameId })` when the game ends. The adapter flushes the local game queue and any pending display-name sync, then calls `statsApi.getGameRank(gameId)` (`frontend/src/api/stats.ts`), retrying a 404 or `not_finished` briefly while the completion lands (`retryUntilGameSynced`); `not_rankable` is final at once. With no local name the card shows `needsName`, and `provideName()` saves it (`saveDisplayName`, synced through `PUT /players/me`) and then fetches the rank; a server `no_name` also shows the prompt once the name sync has settled. Online, the card shows `saved` with the rank of the player's best entry when it is in the top 10: "#N on the leaderboard" when this game is that entry (`is_best`), else "Your best: #N" (#2633; `toRankLookup` carries both). Every game with an openable board (`hasLeaderboard`: enabled and visible in the build) also gets a "View leaderboard" link on the card and a "Leaderboard" item in its ⋯ menu (`useLeaderboardLink`), both opening the shared `Leaderboard` screen in the Home stack. The board refetches when the player returns to it and on pull-to-refresh; opened from a card whose rank is still pending (`refreshAfterSync`), it refetches once local games and the display name have synced. A game covered by the board (or by Stats or the Scorecard) pauses its own clock on the navigation `blur` event: Star Swarm's run, Mahjong's clock (#2633), Hearts' play clock (the `useFocusEffect` cleanup in `HeartsScreen.tsx`, #2629), and Solitaire, Sudoku, Twenty48 and Cascade (#2743); `useGameSync`'s own play window stops too (§2.3). Offline, the card shows `offline` and **nothing is queued**: the game syncs through `SyncWorker` and the name through `displayNameSync`. Until the lookup settles (still `not_finished`, a name still syncing, a network failure), the hook asks again while the card is mounted: on reconnect, and while online after 5 s, 15 s, 60 s and then every 60 s; `reset()` and unmounting stop it. A game on no board (`board_disabled`, `not_rankable`) gets the `unranked` status, and `GameResultModal` shows no leaderboard line for it. Other failures (403, a 404 that outlasts the retries, 5xx) show `error` with Retry. Every game with an enabled board uses `sessionBoardAdapter` (Yacht, Solitaire, FreeCell, Mahjong, Hearts, Sudoku, Cascade, Sort, Twenty48, Star Swarm); Blackjack and Daily Word have disabled boards and pass no `submission`. `useLeaderboardSubmit` still accepts the old per-game `LeaderboardAdapter` shape, which queues through `scoreQueue`, but no game uses it and no game registers a `scoreQueue` handler any more: that path is dead code, slated for removal in #2644. The frontend side of this flow is in §2.5.
- **`PATCH /games/{id}/complete`** rejects a metric above the row's effective cap, `board.max_value_for(metadata)` (e.g. 100 for an easy Sudoku), with 400 (absorbs #2215); on an uncapped board the bound is 2³¹−1. A metric or tie-break read from metadata must be an integer from 0 to 2³¹−1. A negative `final_score` is **not** rejected: a 400 would dead-letter the game in the sync worker and lose its stats, so the board ignores the row instead (rule 6).

Board rules, identical for every game:

1. **One entry per player** (#2519 decision 12). Rows are grouped by `session_id` (the device, until accounts in #1047) and only each session's best row is listed: best `metric` in `direction`, then `tiebreak`, then the earliest `completed_at`. The same key orders the board. A replay that doesn't beat the player's best never appears; a better one replaces it.
2. **Only named players rank** (#2519 decisions 17–18, #2624). A session ranks only if its player has a display name (a `players` row), and then **every** eligible finished game of that player counts, including ones finished before they set it; there is no per-game "submit to leaderboard" step. The name shown is the player's current one, so a rename shows on all of their entries at once. `metadata.player_name` plays no part. There is no "anon" label. Boards find the name through one helper, `players.names.name_lookup`, which is what accounts (#1047) will change.
3. **Abandoned rows** (`not_abandoned()`), rows whose `outcome` is outside `board.qualifying_outcomes` (when set) and **sentinel `*-anon` sessions** (rows the legacy `POST /<game>/score` routes write) never appear.
4. **Exact rank** = 1 + the number of players whose best beats yours. It counts sessions, not rows, and there is no "11 = not in the top 10" sentinel. Players with identical keys share a rank.
5. **Partitions** filter on `games.metadata`. A row or request without a key that has a `partition_default` takes that value (Sudoku: no `variant` means `classic`); any other partition key is required in the request.
6. **Only sane values rank**, whenever they were written: the metric must be a JSON integer (or the `final_score` column) from 0 to the partition's effective cap (`board.max_value_for`, 2³¹−1 when uncapped). A tie-break that isn't an integer from 0 to 2³¹−1 counts as missing and sorts last. The queries check the JSON type (`jsonb_typeof` on Postgres, `json_type` on SQLite) before casting to an integer, so a malformed stored row (a string, a negative or a `10**400`) can neither top a board nor make it fail.

All these routes are rate-limited by session (`session_key`); the leaderboard GET also has a per-IP backstop. For a premium game (`game_types.is_premium`, read from the catalog), the leaderboard GET, the rank GET and the name PATCH check the caller's entitlement exactly like `require_entitlement` (both are in `backend/entitlements/dependencies.py`; `games/router.py` calls `check_entitlement`); a premium leaderboard GET without `X-Session-ID` is a 400.

The per-game leaderboard routes (`/solitaire/scores`, `/cascade/score/{id}`, …) still serve v1.0 clients unchanged until #2644 removes them.

The `@runtime_checkable` decorator means CI can assert `isinstance(module, GameModule)` for each registered game (see `tests/test_game_module_protocol.py`).

**Registry:** `backend/games/registry.py` maps `GameType` string values to module singletons. `games/service.py` uses `get_module(name)` for generic dispatch — there are no `if name == "<game>"` branches anywhere in the service layer.

**Adding a module:**

1. Create `backend/<game>/module.py` with a class that has `game_type`, `metadata_model`, `result_model`, `has_winner`, `board` and `stats_shape`.
2. Expose a module-level singleton: `module = MyGameModule()`.
3. Add an entry to `_REGISTRY` in `backend/games/registry.py`, to `_HAS_WINNER` in `tests/test_game_module_protocol.py` and to `_GAMES` in `tests/test_board_definitions.py`.
4. Regenerate `frontend/src/api/vocab.ts` (§1.1): `BOARDS` and `HAS_WINNER` come from the module.

Example (pass-through stats, no metadata):

```python
# backend/mygame/module.py
from games.board import SCORE_METRIC, BoardDefinition
from games.protocol import default_stats_shape
from mygame.models import MyGameMetadata
from vocab import GameType

class MyGameModule:
    game_type = GameType.MYGAME
    metadata_model = MyGameMetadata
    result_model = None
    has_winner = False  # score-only: outcome is completed / kept_playing
    board = BoardDefinition(metric=SCORE_METRIC, direction="desc", label_key="score")

    def stats_shape(self, raw_stats: dict) -> dict:
        return default_stats_shape(raw_stats)

module = MyGameModule()
```

---

### 1.4 Metadata models

**Authority: `backend/<game>/models.py` (per-game `*Metadata` class)**

Each game's `games.metadata` JSONB column is validated on write by a Pydantic model attached to the `GameModule`. The `CreateGameRequest` validator calls `mod.metadata_model.model_validate(metadata)` and returns a 422 if it fails.

All metadata models use `extra="forbid"` to prevent arbitrary data from being silently stored.

| Game        | Model               | Fields                                                                                                                                                                                                   |
| ----------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blackjack   | `BlackjackMetadata` | `best_run_chips: int \| None`, `total_runs: int \| None`, `runs_completed: int \| None`, `current_table: Literal["beginner","intermediate","high_roller"] \| None`                                       |
| Cascade     | `CascadeMetadata`   | `player_name: str = ""` (max 64 chars)                                                                                                                                                                   |
| Daily Word  | `DailyWordMetadata` | `puzzle_id: str` (required), `language: Literal["en","hi"] = "en"`                                                                                                                                       |
| FreeCell    | `FreeCellMetadata`  | None (empty model). The per-session row (#2452) is separate from the legacy router's own rows (which hold `player_name`); since #2632 a win carries its move count as `final_score`                      |
| Hearts      | `HeartsMetadata`    | `player_name: str = ""` (max 64 chars), `ai_difficulty: str \| None` (≤ 32 chars): the opponent style, recorded and not ranked on (`cautious`, `schemer`, `daring`, `mixed`)                             |
| Mahjong     | `MahjongMetadata`   | `player_name: str = ""` (max 64 chars), `layout: str \| None` (layout id, `^[a-z0-9_]+$`, ≤ 32 chars; sent since #2627)                                                                                  |
| Solitaire   | `SolitaireMetadata` | `player_name: str = ""` (max 64 chars), `draw_mode: Literal[1, 3] \| None` (#2632; recorded, not a partition: both modes share one board)                                                                |
| Bottle Sort | `SortMetadata`      | `player_name: str = ""` (max 32 chars)                                                                                                                                                                   |
| Starswarm   | `StarSwarmMetadata` | `difficulty_tier: str \| None` (≤ 32 chars); only the app's ten tiers (`DIFFICULTY_TIERS`) rank. The router's own leaderboard rows (`POST /starswarm/score`) are written directly and hold `player_name` |
| Sudoku      | `SudokuMetadata`    | `player_name: str = ""` (max 64 chars), `difficulty: Literal["easy","medium","hard"]` (required), `variant: Literal["classic","mini"] = "classic"`                                                       |
| Twenty48    | `Twenty48Metadata`  | None (empty model). The opening board is `game_started` event data                                                                                                                                       |
| Yacht       | `YachtMetadata`     | `mode: Literal["solo","vs"] \| None`, `difficulty: Literal["easy","medium","hard"] \| None` (the computer's: required for `vs`, forbidden for `solo`; builds before #2630 send no `mode`)                |

**Completion merge:** `PATCH /games/{id}/complete` merges the validated result block into `games.metadata` (`merge_result_metadata` in `games/leaderboard.py`; the board's limit check merges the same way). Creation-time keys win, so a result can't rewrite `player_name` or a partition. A creation key holding `null` has no value to protect and doesn't win: the result's value fills it (a Star Swarm run created with `difficulty_tier: null` keeps the tier its completion reports). A `null` in the result never clears a creation value.

**Adding a metadata model:**

1. Create a `*Metadata(BaseModel)` class in `backend/<game>/models.py` with `model_config = ConfigDict(extra="forbid")`.
2. Assign it as `metadata_model = MyGameMetadata` in the module class.
3. Add at least one unit test: valid payload passes, invalid payload raises `ValidationError`.

Unregistered game types (e.g. seeded in the DB before their module is implemented) skip validation — `get_module()` returns `None` and the check is skipped.

---

### 1.5 stats_shape()

**Authority: `backend/<game>/module.py` (`stats_shape` method); `games/service.py` (`get_stats_for_session`) for the comparable fields**

`games/service.py` runs one aggregate query per session, pre-fetches the latest score and metadata per game, and (only when some game has a `win` or `loss`) one ordered scan for win streaks. It then:

1. calls `module.stats_shape(raw_stats)` for the game-specific part of the `/stats/me` entry, and
2. sets the **comparable fields** itself, from the queries and the game's `BoardDefinition` (§1.3). `stats_shape` cannot change them, nor `completed` (the Arcade XP input, `games/progression.py`).

There is no game-specific logic in `service.py`.

**`raw_stats` keys passed to every `stats_shape` call:**

| Key              | Type               | Description                                                                                                                                                                 |
| ---------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `played`         | `int`              | finished game count, abandons included                                                                                                                                      |
| `best`           | `int \| None`      | best non-abandoned `final_score` in the board's direction: the lowest for an `asc` board (FreeCell's moves, #2632), else the highest                                        |
| `avg`            | `float \| None`    | mean non-abandoned `final_score`                                                                                                                                            |
| `last_played_at` | `datetime \| None` | most recent `completed_at`, ignoring rows the stale-session sweep closed (§1.7)                                                                                             |
| `latest_score`   | `int \| None`      | `final_score` of the most recently completed non-abandoned game                                                                                                             |
| `metadata`       | `dict`             | `games.metadata` of the most recently started **finished** row (`completed_at` set), whatever its outcome, abandons included (Blackjack writes its run aggregates at start) |

**Return value:** a dict with any of `played`, `best`, `avg`, `last_played_at` (deprecated aliases, see below) and `extras`, a dict of game-specific figures. Omitted keys default to `None` (`{}` for `extras`).

**Comparable fields (#2620)** — the same meaning for every game, set by the service:

| Field                                    | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sessions`                               | rows with `completed_at`, abandons included                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `completed`                              | `sessions` minus `abandoned` rows; the XP input                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `won` / `lost` / `tied`                  | rows with `outcome` = `win` / `loss` / `push`. All three `null` when the player has no row of the game with any of them (score-only games, solo-only Yacht): clients show "—". Older builds' certain wins count as `win` (§1.2, #2703)                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `current_win_streak` / `best_win_streak` | runs of consecutive `win` rows in `completed_at` order (see rules below); `null` when the win fields are `null`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `time_played_ms`                         | reported play time only: the sum over `sessions` of `duration_ms` where it is > 0, each row capped at 24 h. Rows with a null or 0 `duration_ms` add nothing; the server adds no `completed_at − started_at` fallback. It is only as good as what the app reports: current builds send a game's own clock, else `useGameSync`'s active-play window (§2.3, #2684), which leaves out backgrounded time. Solitaire, Twenty48, Cascade and Mahjong send their own clock, which pauses only while another screen covers the game (`blur`), not while the app is in the background, so their rows **do** count backgrounded time (#2750). Rows from older builds and swept rows add nothing |
| `best_value`                             | best value of the board's `metric` in its `direction`, over non-abandoned rows whose `outcome` is in the board's `qualifying_outcomes` (any outcome when that is `null`). FreeCell: fewest moves; Daily Word: fewest `guesses_used` in a won game, `null` with only losses. A metadata metric that is not a JSON number is ignored. A game with no registered module is an error, never a guessed board                                                                                                                                                                                                                                                                              |
| `best_label_key`                         | the board's `label_key` (`"score"` for a game with no board)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `extras`                                 | what `stats_shape` returned under `extras`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

**Win rate** = `won / (won + lost + tied)`. `completed` and `kept_playing` rows are not in the denominator. Undefined ("—") when the win fields are `null`.

**Win streak rules:**

- a `win` extends the run;
- a `loss` ends it;
- a `push` neither extends nor breaks it;
- `abandoned`, `completed` and `kept_playing` rows are skipped (leaving a game is never penalised).

**Deprecated aliases** (#2637 has shipped, so current builds read only the fields above; the aliases stay for builds already installed until #2644 removes them): `played` (= `sessions`), `best`, `avg`, and Blackjack's top-level `best_chips`, `current_chips`, `best_run_chips`, `total_runs`, `runs_completed`, `current_table`, which mirror `extras`. The app falls back to `played` only for a server that predates #2620 (`sessionsOf` in `frontend/src/api/statsDisplay.ts`).

`/stats/me` runs the stale-session sweep (§1.7) for the caller before it aggregates. The app surfaces that read it are in §2.6.

**Default (pass-through) implementation** — strip `latest_score`, forward everything else (the service ignores `metadata`). Every game but Blackjack uses the shared helper in `games/protocol.py`:

```python
from games.protocol import default_stats_shape

def stats_shape(self, raw_stats: dict) -> dict:
    return default_stats_shape(raw_stats)
```

**Blackjack implementation** — moves `best` and `latest_score` into `extras` as chips, adds the run aggregates from the latest metadata, drops `best` and `avg`:

```python
def stats_shape(self, raw_stats: dict) -> dict:
    meta = raw_stats.get("metadata") or {}
    return {
        "played": raw_stats["played"],
        "best": None,
        "avg": None,
        "last_played_at": raw_stats["last_played_at"],
        "extras": {
            "best_chips": raw_stats["best"],
            "current_chips": raw_stats["latest_score"],
            "best_run_chips": meta.get("best_run_chips"),
            "total_runs": meta.get("total_runs"),
            "runs_completed": meta.get("runs_completed"),
            "current_table": meta.get("current_table"),
        },
    }
```

---

### 1.6 players[]

**Authority: `games.players` JSONB column + `PlayerRef` in `backend/games/schemas.py`**

`players` is a first-class JSONB column on the `games` table. Every game row stores at least one player (length ≥ 1), but the model enforces no maximum — the design is multiplayer-compatible.

```python
class PlayerRef(BaseModel):
    player_id: str = Field(..., min_length=1, max_length=128)
```

When a client omits `players` from `POST /games`, the router auto-fills `[{"player_id": session_id}]`. Clients can supply an explicit list for future multiplayer flows.

`GET /games/{id}` and `GET /games/me` both return `players` in every item. The frontend `GameRow` interface mirrors this field.

---

### 1.7 Completion, idempotency and the stale-session sweep

**Authority: `backend/games/service.py`** (`create_game`, `append_events`, `complete_game`, `sweep_stale_games`).

- **Idempotent writes (#364).** `POST /games` with a client `id` that already exists returns that row (403 if another session owns it). Events are keyed `(game_id, event_index)` and inserted with `ON CONFLICT DO NOTHING`, so a resent batch is harmless — but only while the row is open (or swept, below): `POST /games/{id}/events` on a row with a real completion returns **409** `Game is already completed.`, and `SyncWorker` deletes those events from the device without retrying (`frontend/src/game/_shared/syncWorker.ts`, `isAlreadyCompleted`). **Events that arrive after a real completion are dropped.** `PATCH /games/{id}/complete` on a finished row returns it unchanged: **the first completion wins**, so a replayed or late completion from the device's sync queue never overwrites a result. This has been the rule since the write API (#364); it is not new in #2519.
- **Stale-session sweep (#2621).** `GET /stats/me` and the first page of `GET /games/me` (no `cursor`; later pages continue the listing just swept) first close the caller's own games still open 24 h after `started_at`: `outcome = 'abandoned'`, `completed_at = started_at + 24 h`, `duration_ms` left null, and `metadata.swept = true` (`SWEPT_KEY` in `games/filters.py`, server-written only: `create_game` and `complete_game` strip it from client input). A sweep failure is logged and never fails the read. A swept row is the only finished row that still accepts events (`append_events` checks `is_swept`), and a real completion that arrives later **replaces** the sweep and clears the flag; after that, first completion wins again. Swept rows are abandoned, so they never rank, score or earn XP, and `last_played_at` ignores them.
- **Device-side sweep (#2654).** The app itself resolves sessions a killed process left open, at launch (`sweepPreviousProcess` in `frontend/src/game/_shared/gameEventClient.ts`): an unstarted one is dropped from the device (it never reached the server); a started one is kept for up to 24 h so its screen can continue it (`useGameSync.resume()`), and is abandoned when a fresh session of that type counts as started — `markStarted()` or a completion (`onStarting` in `gameEventClient.ts`), not `start()`, which only opens it on the device — or at a later launch once it is 24 h old. A session whose progress snapshot reported `outcome: "win"` (#2682, e.g. Blackjack's run goal) is closed as `win`, not `abandoned`.
- **Deferred create (#2654).** A new session stays on the device until `markStarted()` or a completion: a game the player opened and never touched never creates a server row.

---

## 2. Frontend contract

The app side of a game: how it opens and closes its `games` row, what outcome and duration it reports, and how its result card, leaderboard and stats reach the player. Per-game wiring (which screen, which clock, which result block) is in [`docs/games/<game>.md`](games/).

### 2.1 Where the shared pieces live

| Piece                                                                                                                 | File                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Generated vocabulary (`GAME_TYPES`, `GAME_OUTCOMES`, `RESULT_OUTCOMES`, `LIFECYCLE_OUTCOMES`, `HAS_WINNER`, `BOARDS`) | `frontend/src/api/vocab.ts` — never edit by hand (§1.1)                                                               |
| Session lifecycle hook                                                                                                | `frontend/src/game/_shared/useGameSync.ts`                                                                            |
| Device queue, sync and sweep                                                                                          | `gameEventClient.ts`, `pendingGamesStore.ts`, `syncWorker.ts` in `frontend/src/game/_shared/`                         |
| Result card outcome → `games.outcome`                                                                                 | `frontend/src/game/_shared/recordedOutcome.ts`                                                                        |
| Outcome guard                                                                                                         | `frontend/src/game/_shared/outcomeGuard.ts`                                                                           |
| Result card                                                                                                           | `frontend/src/components/shared/GameResultModal.tsx`                                                                  |
| Rank lookup for the card                                                                                              | `useLeaderboardSubmit.ts`, `sessionBoardAdapter.ts` in `frontend/src/game/_shared/`                                   |
| Display name                                                                                                          | `displayName.ts`, `displayNameSync.ts` in `frontend/src/game/_shared/`                                                |
| Leaderboard link / availability                                                                                       | `frontend/src/hooks/useLeaderboardLink.ts`, `frontend/src/game/_shared/leaderboardAvailability.ts`                    |
| Screen wrapper                                                                                                        | `frontend/src/components/shared/GameShell.tsx`                                                                        |
| Shared screens                                                                                                        | `LeaderboardScreen.tsx`, `GameStatsScreen.tsx`, `ScorecardScreen.tsx`, `ProfileScreen.tsx` in `frontend/src/screens/` |

`frontend/src/game/_shared/types.ts` also declares `GameSession<TState, TAction>` and `Player`. Only Yacht, Twenty48, Blackjack and Cascade alias `GameSession` in their `types.ts`, and nothing else reads those aliases: they are optional, not part of the contract.

### 2.2 GameShell

Every game screen renders inside `GameShell` (`frontend/src/components/shared/GameShell.tsx`), which draws the shared `AppHeader` (title, back, ⋯ menu), a loading state and an error banner, and keeps content clear of the tab bar. The game supplies only its own UI as children.

- **`gameType` is required** (#2635). With a game type, `GameShell` adds a **Stats** item to the ⋯ menu (the shared `GameStats` screen for that game) and, for a game in `SCORECARD_GAMES` (`frontend/src/navigation/scorecards.ts`: Hearts, Yacht, Blackjack), a **Scorecard** item (#2636). The game does not wire either. Pass `gameType={null}` only for a screen that is not one game's play screen (a scorecard, a run history, a dev tool).
- The game passes the other menu entries it has: `onOpenLeaderboard` (from `useLeaderboardLink`, §2.5), `onNewGame`, `onLevelSelect`, `onEditPlayerNames`.
- While `loading` is true the header keeps its title and back button and hides the ⋯ menu.

### 2.3 useGameSync

**Authority: `frontend/src/game/_shared/useGameSync.ts`.** A screen never writes a game through the `/games` API itself: it calls this hook, which writes to the device queue through `gameEventClient`, and `SyncWorker` uploads it (create, events, completion) when online. Every call is isolated: a failure in the queue never throws into the game. (The one deliberate throw is the outcome guard's, in development and tests, §2.4.)

```ts
const sync = useGameSync("sudoku");
```

**Lifecycle.**

- `start(eventData?, metadata?)` opens a session (`metadata` is validated against the module's `metadata_model` on `POST /games`; `eventData` is the `game_started` event). An open session it replaces is closed first, as below. `restart` is the same function, kept for New Game / theme-switch call sites.
- `markStarted()` marks the player's first real action. Call it on every action; only the first counts. Until it is called the session stays on the device and is **discarded**, not abandoned, if it closes (§1.7). It is also a player-activity ping for the duration window.
- `enqueue(event)` records a gameplay event (and pings).
- `complete(summary, payload?)` finishes the session once; later calls are no-ops. `summary` is `{ finalScore?, outcome?, durationMs?, result? }` (`CompleteSummary`); **`summary.result` is the `result` block** sent on `PATCH /games/{id}/complete`, validated by the module's `result_model` and merged into `games.metadata`. It must be passed explicitly: `payload` is only the analytics `game_ended` event and is never copied into the result (#2619). `complete()` returns the id of the session it closed (or `null`), which is the id the result card's rank lookup needs (#2706).
- `close()` ends the open session without starting another: abandoned if started, else discarded.
- `resume(match?)` continues the session a killed process left open for this game (#2654). A screen that restores saved progress calls it before `start()`; it returns `false` when there is nothing to continue.
- `resetPlayWindow()` restarts the duration window (below). `getGameId()`, `reportBug()` are helpers.

**Abandons are the hook's job.** Unmount, `start()` / `restart()` over an open session and `close()` all close it the same way: `abandoned` if the player started it, discarded otherwise. A game registers `setProgressSnapshot(() => ({ result, durationMs?, outcome? }))` so those abandons carry its result block; the getter reads refs, must not throw, and has no score (an abandon never ranks). Screens do not add `beforeRemove` abandon handlers. A screen that ends a session in place — FreeCell's New Game, Sort switching or restarting a level, Daily Word moving to a new puzzle, Yacht's New Game, Cascade's restart and fruit-set switch — calls `complete({ outcome: "abandoned", result })` with the **same** helper its snapshot getter uses, so the two paths can't drift. (Mahjong's `beforeRemove` records a deadlock `loss`, not an abandon.)

**Outcome.** Pass `recordedOutcome(cardOutcome)` (§2.4) for a game with a winner, `"completed"` for a score-only game. `complete()` and the hook's abandons run the outcome guard first.

**Duration.** The rule in one line: the game's own `durationMs` when it is > 0, otherwise the hook's active-play window; a value of 0 is sent as "unknown". Solitaire, Sudoku, Mahjong, Hearts, Twenty48 and Cascade send their own clock; Yacht, Blackjack, FreeCell, Sort, Daily Word and Star Swarm rely on the window. The window and the Sudoku and Hearts clocks leave out time in the background (`AppState`). **The Solitaire, Twenty48, Cascade and Mahjong clocks do not:** they pause only on the navigation `blur` event, and none of those screens handles `AppState`, so a backgrounded app keeps counting and the reported duration includes it. That and the other gaps (time lost or gained across an app kill) are tracked in #2750; see each game's Duration note in [`docs/games/`](games/). The details:

**`durationMs` (#2619).** Pass the game's own active play time — a timer that
should pause while the app is backgrounded or the game is idle (not every
game's does yet: see above). `SyncWorker` sends a
value > 0 as `duration_ms` and sends anything else (0, null, missing,
negative) as `null`, meaning "unknown". It never derives a duration from the
session's wall-clock start and end times: those count idle and backgrounded
time as play.

**Active-play window (#2684).** A game that measures no active time of its own
needs no code for a duration: `useGameSync` fills in `durationMs` with the
foreground time its active-play window has counted, with each idle gap capped
at 10 minutes; a game's own measured duration wins.

- Foreground time comes from `foregroundClock.foregroundNow()`, one app-wide
  counter that stops while `AppState` is `background` or `inactive`.
- Screen focus (#2735, PR #2743): the window also stops counting while a screen is
  pushed on top of the game's own (Stats, Leaderboard, Scorecard) — it isn't
  backgrounded, so `foregroundClock` alone doesn't cover it. `useGameSync`
  tracks the screen's own navigation focus (`useIsScreenFocused`) and banks
  time up to the blur, then resumes counting from the moment focus returns;
  outside a navigator (and in tests) the screen is always focused.
- The window is running or paused (#2710):
  - It starts **running** when the hook mounts, so the thinking time before
    the first move counts (Daily Word's puzzle is on screen from mount) and a
    game won on its first action still gets a duration.
  - A session ending **pauses** it at zero: `complete()`, and a close that
    ended a session — unmount, `close()`, or `start()` / `restart()` /
    `resume()` replacing one — after the abandon has read it. While paused,
    pings add nothing, so time on a result card or a menu between games is
    never counted (Yacht's Play Again and mode picker, Star Swarm's New Run,
    Blackjack's table picker).
  - `start()` / `restart()` resume a paused window from zero at that moment.
    A running window is left alone, so a game that opens its session at the
    first move keeps the time before it.
  - `resume()` restarts it from zero: the session counts from the resume.
  - `resetPlayWindow()` restarts it from zero, running. It is for a screen
    that shows a new puzzle before its session opens: Sort when it enters a
    level (a level card, Next Level, Play Again, or Continue with no session
    to resume) or starts it over (New Game), FreeCell when it deals. The
    thinking time on the new board counts; the level grid and the previous
    board do not. A screen that shows a picker before its first game calls it
    when the player leaves the picker, so the picker's time from mount is not
    counted either: Yacht's mode picker, Star Swarm's difficulty picker,
    Blackjack's table picker. Call it with no session open — it drops what
    the window has counted; where one may be open, `start()` / `restart()`
    close it and start the window over themselves.
- Idle cap: player-activity pings — `markStarted()`, `enqueue()`,
  `complete()` — split a running window into gaps, and each gap adds at most
  `IDLE_GAP_CAP_MS` (10 minutes). A screen left awake and idle, or an in-app
  pause, stops counting there.
- `complete()` sends the game's own `summary.durationMs` when it is > 0,
  otherwise the window. The hook's own abandons send
  `ProgressSnapshot.durationMs` when it is > 0, otherwise the window. A
  discarded (never-started) session sends nothing.
- A session resumed after a killed process counts from the resume; time
  before the kill is lost (an undercount, never an overcount).
- A window reading 0 sends no duration — the `resolveDurationMs` rule: 0 means
  "unknown".
- Tests: `jest.setup.ts` pins `foregroundClock` for every test file to the
  shared manual mock `src/game/_shared/__mocks__/foregroundClock.ts` (#2710),
  which reads 0 at the start of each test and moves only when a test calls
  `advanceForegroundNow()` / `setForegroundNow()` (reached with
  `jest.requireMock<ForegroundClockMock>(".../foregroundClock")`). Screen tests
  do not mock it themselves; tests of the real clock opt out with
  `jest.unmock(".../foregroundClock")`.

### 2.4 Recording the outcome

**Authority: `backend/vocab.py` (`GameOutcome` docstring, §1.2).**

- **`recordedOutcome()`** (`frontend/src/game/_shared/recordedOutcome.ts`) is the one mapping from the result card's outcome to `games.outcome`: `win` → `win`, `loss` → `loss`, `draw` → `push`, `ended` → `completed`. A game with a winner passes `recordedOutcome(cardOutcome)` to `complete()`; a score-only game records `completed`. Blackjack's run outcome (`win` / `loss` / `abandoned`) is already a `GameOutcome` and is passed as is; Mahjong's deadlock records `loss` directly.
- **Outcome guard** (#2642, #2744; `frontend/src/game/_shared/outcomeGuard.ts`). `assertOutcomeAllowed(gameType, outcome, path)` refuses a result outcome (`RESULT_OUTCOMES`) for a game whose `HAS_WINNER` is false. It runs in `useGameSync.complete()`, in the hook's own abandon, on a progress snapshot that reports `win`, and in `gameEventClient.completeGame` (so the killed-session sweep is covered too; see the note below). **In development and tests it throws** `OutcomeNotAllowedError`, so a screen test that drives a wrong finish path fails. **In production it sends the outcome unchanged** and reports to Sentry once per game and outcome: the backend stores any vocabulary value (§1.2), and blocking the completion would lose the game.
- **Dev/test only: a guard throw inside the device sweep.** The sweep closes orphans inside `pendingGamesStore.batch(...)`, and `batch` runs its callback synchronously, so a throw there leaves the loop. At launch (`sweepPreviousProcess`), the `try` around the batch catches it and reports it to Sentry; the orphans after the offending one in that batch stay open until a later launch's sweep, and that launch's discarded-events cleanup is skipped. On the fresh-start path (`abandonOrphans`, called from `onStarting`) the throw reaches the caller: `useGameSync` swallows it (`markStarted()` / `complete()` isolate every client call), and a `completeGame` that triggered it stops before recording its own `game_ended` event and completion. In production the guard never throws, so none of this happens. It needs an orphan whose snapshot left `win` on a game with no winner, which the guard's check on every progress ping already stops in development.
- `has_winner` is set on the backend module only once the client really writes win / loss / push; turning it on and regenerating `vocab.ts` is what lets the guard accept them.

### 2.5 Result card and leaderboard

**The card.** Every game ends on `GameResultModal` (`frontend/src/components/shared/GameResultModal.tsx`, #2504): the game passes data (`outcome`, `hero`, `stats`, `detail`, actions) and never builds its own result screen. (Blackjack's Goal Reached screen renders the same `ResultCard` inline, with `useResultFeedback`.) Two props connect it to the leaderboard:

- `submission` — the rank line: `{ status, rank, isBest, playerName, onProvideName, onRetry }` from `useLeaderboardSubmit`. Omit it for a game without a leaderboard (Blackjack, Daily Word).
- `onViewLeaderboard` — the "View leaderboard" link, from `useLeaderboardLink`.

**The rank line.** There is no score submission and no per-game name (#2624, #2677): a finished game of a named player is already on its board once `SyncWorker` uploads it. The card only asks where it landed:

```ts
const board = sessionBoardAdapter("sudoku"); // module scope
const leaderboard = useLeaderboardSubmit(board);
// on game over, with the id complete() returned:
void leaderboard.submit({ gameId });
```

`sessionBoardAdapter` (`frontend/src/game/_shared/sessionBoardAdapter.ts`) flushes the local game queue and any pending display-name sync, then calls `GET /games/{id}/rank`, retrying briefly while the completion lands. `useLeaderboardSubmit` turns the answer into a status — `saved` (with the top-10 rank of the player's best entry and `isBest`), `needsName` (the one-time name prompt; `provideName()` saves the name and syncs it through `PUT /players/me`), `submitting`, `offline`, `unranked` (no line) or `error` (Retry) — and keeps asking while the card is mounted until it settles. Nothing is ever queued. The server side, statuses and retry timings are in [Leaderboard routes (#2618)](#leaderboard-routes-2618). Call `leaderboard.reset()` when a new game starts, so the next card starts clean.

**The name.** One display name per player (#2624): `players` table, `PUT` / `GET` / `DELETE /players/me`. In the app it is `displayName.ts` (the device copy; `normalizeDisplayName` mirrors the server rule) and `displayNameSync.ts` (a one-slot queue that sends the latest name, or its removal, on save, launch, reconnect and foreground). Profile can remove it from every board ("Remove my name from leaderboards", #2637, PR #2727); "Delete my data" clears it on the device and the server.

**The board definition on the client.** The app never fetches a board definition: `BOARDS` is generated into `frontend/src/api/vocab.ts` from each module's `board` (§1.3) and ships in the build. It decides:

- whether a game has a leaderboard at all — `hasLeaderboard` / `openableBoard` (`frontend/src/game/_shared/leaderboardAvailability.ts`): the board is `enabled` and the game is visible in this build (`isGameVisible`; store builds hide the premium games);
- the metric label on `LeaderboardScreen` (`labelKey`) and its partition picker (`partitions`, e.g. Sudoku's difficulty and variant).

Stats use the server's copy instead: `/stats/me` sends `best_value` with `best_label_key` (§1.5).

**Opening the board.** `useLeaderboardLink(navigation, gameType, partition?)` (`frontend/src/hooks/useLeaderboardLink.ts`) returns an opener, or `undefined` when the game has no openable board. Pass it to both `GameResultModal.onViewLeaderboard` and `GameShell.onOpenLeaderboard`, so the card link and the ⋯ menu item appear together. Pass the partition the player just played. Both open `LeaderboardScreen` (#2633, `Leaderboard` route in the Home stack): one entry per player, the player's own row flagged by `is_me` and, when outside the list, pinned below it from `me`; pull to refresh; opened from a card whose rank is pending (`refreshAfterSync`), it refetches once local games and the name have synced.

**Covered screens.** A game with its own clock pauses it on the navigation `blur` event, since a pushed Leaderboard, Stats or Scorecard screen leaves it mounted (§2.3 for the play window).

### 2.6 Stats, Scorecard and Profile

These read the server; a game adds nothing for them beyond passing `gameType` to `GameShell` and having a module on the backend.

- **`GameStatsScreen`** (#2635, `GameStats` route, from the ⋯ menu's Stats item): one game's `/stats/me` entry as tiles — sessions, completed, wins, losses, ties and win rate ("—" for a game with no win concept), the win streaks (left out for such a game), best (`best_value` labelled by `best_label_key`), play time and last played — plus a "View leaderboard" link when the game has an openable board. The last good response is remembered in memory for the app session (`useMyStats`), keyed by session id, so the screen still shows figures offline; "Delete my data" clears it (`clearMyStatsCache`).
- **`ScorecardScreen`** (#2636, `Scorecard` route): a live view of the match in progress, only for `SCORECARD_GAMES` (Hearts, Yacht, Blackjack). A game's history is its Stats screen.
- **Profile** (#2637): top tiles show only figures that mean the same for every game (sessions, completed, completion rate, time played, games tried, favourite), summed over the games visible in the build; no score is compared across games and there is no cross-game "top score". Per-game rows show each game's own best with its label. It also holds the display name editor and "Remove my name from leaderboards" (PR #2727).

### 2.7 ESLint boundary

`frontend/eslint.config.js` has one custom boundary rule, `bc-arcade/no-game-ui-imports`: a non-`.tsx` file under `frontend/src/game/` (engines, reducers, helpers) must not import from `src/components/` or `src/screens/`. `.tsx` files in `src/game/` (a game's context or UI pieces) are exempt. There is **no** rule against one game importing another game's folder; keep game code in its own `src/game/<game>/` and share through `src/game/_shared/`.

### 2.8 Testing and QA

- Screen tests normally run against the real `useGameSync` with the shared `foregroundClock` mock (§2.3); `HeartsScreen.test.tsx`, `MahjongScreen.test.tsx` and `BlackjackGameContext.test.tsx` mock the hook, so the guard does not run in those suites. The outcome guard throws in tests, so drive every finish path your game has.
- **Maestro is paused past v1.0** (owner decision; [`docs/MAESTRO.md`](MAESTRO.md)), including the result-submission flow (#2643). The result card, leaderboards, stats and Profile are checked by hand on iOS and Android builds with [`docs/MANUAL-QA-LEADERBOARDS.md`](MANUAL-QA-LEADERBOARDS.md).

---

## 3. New-game checklist

Use this checklist when adding a new game. Each item links to the file to create or modify and the CI check that validates it.

### Backend

- [ ] **`vocab.py`** — add `MYGAME = "mygame"` to `GameType`
  - CI: `tests/test_vocab.py` (asserts enum ↔ DB parity)
- [ ] **Alembic migration** — `INSERT INTO game_types` for the new row; add event types as needed
  - CI: `schema-check` job (`alembic upgrade head` on SQLite)
- [ ] **`backend/mygame/`** — create the game package with at minimum `__init__.py`, `models.py`, `module.py`. No `router.py` is needed: the generic `/games` routes create, complete, rank and list every game (§1.3). Add one only for game-specific server logic (e.g. Daily Word's puzzle routes)
- [ ] **`backend/mygame/models.py`** — define `MyGameMetadata(BaseModel)` with `extra="forbid"`, and a `MyGameResult` model for the completion's `result` block (or `result_model = None` to accept any dict). Accept any value a shipped app could send: a 4xx on create or completion dead-letters the game on the device
  - CI: `tests/test_game_metadata.py` pattern (add a valid/invalid unit test)
- [ ] **`backend/mygame/module.py`** — implement the `GameModule` Protocol (§1.3): `game_type`, `metadata_model`, `result_model`, `has_winner`, `board`, `stats_shape()`
  - `has_winner`: `True` only if the client records `win` / `loss` / `push` (§1.2); a score-only game is `False` and records `completed`
  - `board`: a `BoardDefinition` — metric, direction, tie-break, partitions, `max_value` cap, `qualifying_outcomes`; `enabled=False` if the game has no leaderboard (it still defines the "best" in stats)
  - CI: `tests/test_game_module_protocol.py` (registry-wide conformance; add the game to `_HAS_WINNER`) and `tests/test_board_definitions.py` (add it to `_GAMES`)
- [ ] **`backend/games/registry.py`** — add the module singleton to `_REGISTRY`
- [ ] **`backend/scripts/gen_vocab_ts.py`** — regenerate `frontend/src/api/vocab.ts` (`GAME_TYPES`, `HAS_WINNER`, `BOARDS`)
  - CI: `tests/test_vocab.py` (TS contract drift check)
- [ ] **Premium tier** _(if applicable)_ — set `is_premium=true` in the Alembic migration; `POST /games` and the generic leaderboard, rank and name routes then check the entitlement themselves (`check_entitlement`, defined in `backend/entitlements/dependencies.py` and called from `games/router.py`); add `require_entitlement("<slug>")` to the game's own router, if it has one; add the slug to `PREMIUM_GAMES` in `frontend/src/entitlements/EntitlementContext.tsx` and to `HIDDEN_GAMES` for v1.0 store builds (frontend routing: see Route and Home tile below). See [`docs/ARCHITECTURE.md §10`](ARCHITECTURE.md#10-premium-entitlements).
- [ ] **`docs/games/mygame.md`** — the game's page, including its Scoring (Persistence) section: metric, outcomes, metadata, result block (see the existing pages in [`docs/games/`](games/))

### Frontend

- [ ] **`frontend/src/api/vocab.ts`** — the committed generated file includes the new `GameType`, its `HAS_WINNER` flag and its `BOARDS` entry
- [ ] **Engine** — game logic in `frontend/src/game/mygame/engine.ts` (no imports from `components/` or `screens/`, §2.7). A `GameSession<TState>` alias in `types.ts` is optional (§2.1)
- [ ] **Route and Home tile** — a screen in `frontend/src/screens/`, typed in `frontend/src/types/navigation.ts`. A free game is registered as a plain `HomeStack.Screen` in `frontend/App.tsx`. A premium game is **not**: add its route to `PREMIUM_ROUTES` (`frontend/src/entitlements/premiumRoutes.ts`) and its unguarded screen to `PREMIUM_SCREEN_BASES` in `App.tsx`; `LobbyStack` registers it wrapped in `makePremiumScreen` (the entitlement gate, `LockedGameScreen` when not entitled) and only when it is visible in the build (`visiblePremiumRoutes()`). Add the slug to `PREMIUM_GAMES` (`EntitlementContext.tsx`) and, while v1.0 hides premium games, to `HIDDEN_GAMES` (`frontend/src/entitlements/gameVisibility.ts`); the `gameVisibility` / `premiumRoutes` tests fail if these sets drift. This mirrors [`docs/ARCHITECTURE.md` §10.6](ARCHITECTURE.md#106-adding-a-premium-game), step 5. Add a tile in `HomeScreen.tsx` and an i18n namespace (`frontend/src/i18n/localeLoaders.ts`) with `game.title`
- [ ] **`GameShell`** with `gameType="mygame"` (required, §2.2): the ⋯ menu then gets Stats (and Scorecard, if the game is in `SCORECARD_GAMES`) with no further wiring. `gameType={null}` is only for screens that are not one game's play screen (a live scorecard, a run history, a dev tool)
- [ ] **`useGameSync`** (§2.3) — `start()` with the metadata, `markStarted()` on the first real action, `complete()` with an explicit `result` block, `setProgressSnapshot()` so the hook's abandons carry it; `resume()` if the screen restores saved progress; no `beforeRemove` abandon handler
- [ ] **Outcome** (§2.4) — `recordedOutcome(cardOutcome)` if `has_winner`, else `"completed"`; drive every finish path in a screen test (the outcome guard throws there)
- [ ] **Duration** — send the game's own active clock as `durationMs` if it has one (paused while backgrounded and on `blur`); otherwise send nothing and let the play window count; call `resetPlayWindow()` where a new board or picker appears before the session opens (§2.3)
- [ ] **Result card** (§2.5) — end on `GameResultModal`; with an enabled board, `useLeaderboardSubmit(sessionBoardAdapter("mygame"))`, `submit({ gameId })` with the id `complete()` returned, `reset()` on a new game, and the hook's state as `submission`
- [ ] **Leaderboard link** — `useLeaderboardLink(navigation, "mygame", partition)` passed to both `GameResultModal.onViewLeaderboard` and `GameShell.onOpenLeaderboard`
- [ ] **Stats entry** — nothing to build: `GameStats` and Profile read `/stats/me` (§2.6); check the game's tiles show sensible values (win figures "—" for a score-only game)
- [ ] **`noUncheckedIndexedAccess`** clean — no suppression comments
- [ ] **Icon assets are WebP** — any new icons added to `assets/fruit-icons/` or `assets/celestial-icons/` must be converted before committing: `python frontend/scripts/convert_icons_to_webp.py <dir>`. Raw PNGs in non-exempt asset directories will fail CI (`assetTransparency.test.ts`).

### Size Budget

Before merging a new game, verify all four items below. The `android-bundle-check` CI job enforces the hard limit automatically; the remaining items are reviewer responsibilities. See [`docs/PERFORMANCE.md` — JS Bundle Size Guardrail](PERFORMANCE.md#js-bundle-size-guardrail) for full details on the tooling and how to update thresholds.

- [ ] **JS bundle delta ≤ 200 KB** — the `android-bundle-check` PR comment must show Δ ≤ +200 KB vs the 4.5 MB baseline. If exceeded, justify in the PR description with a measurement showing the addition is unavoidable.
- [ ] **No new PNG assets in `assets/`** — all new icon/image assets must be WebP. Exception: Skia pre-composited textures in `*-baked/` directories (separate pipeline — document the exception explicitly in the PR if used).
- [ ] **New asset directories audited** — confirm new assets are not accidentally bundled via an unintended import. Check the Metro bundle output (`--assets-dest`) before opening the PR.
- [ ] **`docs/PERFORMANCE.md` asset inventory updated** — add new directories to the Directory Map table with size, file count, and "Bundled?" column.

### Validation

- [ ] `python -m pytest tests/ -v` — all tests pass, coverage ≥ 80%
- [ ] `black --check . && ruff check .` — no lint errors
- [ ] `npm run -s typecheck`, `npx eslint` and `npx jest` in `frontend/` — clean
- [ ] `npx expo export` (or equivalent) — frontend builds without errors
- [ ] Manual QA on iOS and Android with [`docs/MANUAL-QA-LEADERBOARDS.md`](MANUAL-QA-LEADERBOARDS.md) — Maestro is paused past v1.0 (§2.8)

---

_For questions about the overall architecture, see [`docs/TESTING.md`](TESTING.md) (test patterns) and [`docs/BRANDING.md`](BRANDING.md) (design system). For deployment, see [`docs/RENDER.md`](RENDER.md)._
