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
   - [Engine](#29-engine)
   - [Recording gameplay](#210-recording-gameplay)
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

**Authority: `backend/games/module_base.py` (`GameModuleBase`) and `backend/games/protocol.py` (`GameModule`)**

Every game module is a subclass of `GameModuleBase` (#2995): a class of declarations plus four optional hooks, each with a default that changes nothing. The shared code (`games/sessions.py`, `games/stats.py`, `games/boards/`) is typed against the `GameModule` `typing.Protocol`, which the base satisfies, and calls every hook on every module directly (there are no `getattr` lookups):

```python
class GameModuleBase:
    # Declarations
    game_type: ClassVar[GameType]                  # required: identifies this module in the registry
    metadata_model: ClassVar[type[BaseModel]]      # required: Pydantic model for games.metadata validation
    board: ClassVar[BoardDefinition]               # required: how the game is ranked (#2617)
    result_model: ClassVar[type[BaseModel] | None] = None  # result block on PATCH /games/{id}/complete
    has_winner: ClassVar[bool] = False             # True → this game can record win/loss/push (see §1.2)

    # Optional hooks (defaults shown)
    def stats_shape(self, raw_stats: dict) -> dict:
        return default_stats_shape(raw_stats)      # §1.5; Blackjack overrides
    def derive_final_score(self, final_score, outcome, result) -> int | None:
        return final_score                         # Blackjack overrides (#2745)
    async def reconcile_result(self, session, game, result) -> dict:
        return result                              # Daily Word overrides (#2541)
    def validate_event(self, name, data) -> dict | None:
        return data                                # Star Swarm overrides (#3250); None drops the event
```

A subclass that leaves out `game_type`, `metadata_model` or `board` fails at import with a `TypeError`. Every registered module still declares `has_winner` itself (`tests/test_game_module_protocol.py` checks the class body), so the default only matters for a game in progress.

| Hook                 | Called by                                            | Contract                                                                                                                                                                                       |
| -------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stats_shape`        | `get_stats_for_session` (`/stats/me`)                | The game-specific part of the stats entry (§1.5).                                                                                                                                              |
| `derive_final_score` | `complete_game`, after the result block is validated | Returns the `final_score` to store, given the one sent, the outcome and the validated result. Raising `ValueError` rejects the completion (400, reported to Sentry as `final_score mismatch`). |
| `reconcile_result`   | `_validate_result`, after `result_model` validation  | Awaited with the DB session and the game row; returns the result block corrected against server-side state. Runs only for a game that declares a `result_model`.                               |
| `validate_event`     | `append_events`, for each event of a known type      | Returns the event `data` to store, or `None` to drop that event (the module logs and reports it). The rest of the batch is stored and the request still succeeds. Default: stored as sent.     |

**`board`** (`backend/games/board.py`, #2617) declares the game's leaderboard rule once. It is required: a game with no leaderboard declares a board with `enabled=False`, never `None`. Boards are shared class-level singletons, so the model is frozen and every container field is a tuple. The generic leaderboard routes below read them (#2618); stats read them too (#2620, §1.5).

| Field                  | Type                                      | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `metric`               | `str`                                     | What is ranked: `"final_score"` or `"duration_ms"` (`SCORE_METRIC` / `DURATION_METRIC`, `games` columns; the latter the play time sent on completion, #2747) or a `games.metadata` key.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `direction`            | `"asc" \| "desc"`                         | `desc` = higher is better, `asc` = lower is better.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `tiebreak`             | `tuple[str, Direction] \| None`           | Optional `(metadata key, direction)` applied before the final tie-break, `received_at asc` (the server time the completion arrived, not the device-reported `completed_at`; #2765; a row without one ranks last, #3225), which every board uses.                                                                                                                                                                                                                                                                                                                                                                                                            |
| `label_key`            | `str`                                     | i18n key for the metric's label.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `partitions`           | `tuple[str, ...]`                         | Metadata keys that split the game into one board per combination of values.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `partition_defaults`   | `tuple[tuple[str, str], ...]`             | `(key, value)`: the value assumed when a row lacks that partition key or holds `null` (legacy rows). Keys must be in `partitions`, once each. Read with `partition_default(key)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `partition_values`     | `tuple[tuple[str, tuple[str, ...]], ...]` | `(key, allowed values)`: the only values that key has a board for; a request for any other is a 400, and a row holding another value is stored but can't be named, so it never ranks (`test_partition_values_fill_every_board_and_nothing_else_ranks`). The models accept every allowed value, and other values too: a 4xx on create or completion would dead-letter the whole game in the app. A key not listed takes any value. Keys must be in `partitions`, once each; values non-empty and distinct; that key's `partition_defaults` and `partition_max_values` values must be among them. Read with `allowed_values(key)` / `is_allowed(key, value)`. |
| `max_value`            | `int \| None`                             | Highest legitimate `metric` value on any of the game's boards (absorbs #2215). `None` = no ceiling.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `min_value`            | `int`                                     | Lowest `metric` value that ranks (default 0; at most `max_value` and every partition cap). A lower value is stored, never rejected, but no board, rank or stats best counts it, e.g. Mahjong's 36,000 ms clear-time floor (#2747).                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `partition_max_values` | `tuple[tuple[str, str, int], ...]`        | `(key, value, cap)`: a tighter cap for rows in that partition. Keys must be in `partitions`, each `(key, value)` once, each cap at most `max_value` (which must be set). `max_value_for(metadata)` returns the effective cap for a row.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `qualifying_outcomes`  | `tuple[str, ...] \| None`                 | `games.outcome` values that count toward the board and the per-game "best" in stats. `None` = every non-abandoned row. Never includes `abandoned`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `enabled`              | `bool`                                    | `False` for games with no leaderboard. Their `metric`, `direction`, `label_key` and `qualifying_outcomes` still define the "best" in stats.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

The definitions are exported to the app as `BOARDS` in `frontend/src/api/vocab.ts` by `backend/scripts/gen_vocab_ts.py`, every field camelCased (`tiebreak`, `labelKey`, `partitions`, `partitionDefaults`, `partitionValues`, `maxValue`, `minValue`, `partitionMaxValues`, `qualifyingOutcomes`, `enabled`); the pair and triple tuples become records (`{ variant: "classic" }`, `{ difficulty_tier: ["Ensign", …] }`, `{ difficulty: { easy: 100, … } }`). `tests/test_vocab.py` fails on drift. The generic leaderboard and rank routes (#2618, below) read them; stats read them too (#2620, §1.5).

| Game       | metric          | direction | tie-break | partitions (default)                | max_value                            | qualifying outcomes | enabled |
| ---------- | --------------- | --------- | --------- | ----------------------------------- | ------------------------------------ | ------------------- | ------- |
| Yacht      | `final_score`   | desc      | —         | —                                   | 1575                                 | any                 | yes     |
| Solitaire  | `final_score`   | desc      | —         | —                                   | 1245                                 | any                 | yes     |
| FreeCell   | `final_score`   | asc       | —         | —                                   | —                                    | any                 | yes     |
| Mahjong    | `duration_ms`   | asc       | —         | `layout` (none)                     | — (min 36,000 ms)                    | `win`               | yes     |
| Hearts     | `final_score`   | desc      | —         | —                                   | 100                                  | any                 | yes     |
| Sudoku     | `final_score`   | desc      | —         | `difficulty`, `variant` (`classic`) | 300 (easy 100, medium 200, hard 300) | any                 | yes     |
| Cascade    | `final_score`   | desc      | —         | —                                   | —                                    | any                 | yes     |
| Sort       | `level_reached` | desc      | —         | —                                   | 23                                   | any                 | yes     |
| Blackjack  | `final_chips`   | desc      | —         | —                                   | —                                    | any                 | no      |
| Daily Word | `guesses_used`  | asc       | —         | —                                   | —                                    | `win`               | no      |
| Twenty48   | `final_score`   | desc      | —         | —                                   | —                                    | any                 | yes     |
| Star Swarm | `final_score`   | desc      | —         | `difficulty_tier` (`LieutenantJG`)  | —                                    | any                 | yes     |

"any" means every non-abandoned row. Notes on the declarations:

- **Yacht** 1575 is the theoretical maximum with bonus Yachts, recomputed from `engine.ts` in `tests/test_board_definitions.py`. Solo and vs-the-computer games share the board; the session metadata records `mode` (`solo` | `vs`) and, for a vs game, `difficulty` (#2630). The legacy `POST /yacht/score` and `GET /yacht/scores` were removed in #2630.
- **Integer bounds** (#3304): a request integer stored in a 32-bit column is bounded to the column, so an out-of-range value is a 422 rather than a database error (500). `final_score` is -2³¹ to 2³¹−1 (negatives are stored, never rejected); `duration_ms` and `event_index` are 0 to 2³¹−1; Twenty48's result `final_score` / `duration_ms` follow the same bounds. The catalog path id is 1 to 32767 (a `SmallInteger` key). Shared types: `backend/int_bounds.py`.
- **Yacht result** (#2839): `YachtResult` also stores the final category scorecard (`scorecard`, and `opponent_scorecard` for a finished vs game) beside the unchanged `final_score`, with a server-written `scorecard_reconciled`. A malformed card is dropped and one that fails to add up is flagged; neither rejects the completion. Bonus accounting and bounds: [`games/yacht.md`](games/yacht.md#saved-final-scorecard-2839).
- **Sudoku** scores `DIFFICULTY_BASE[difficulty] - 10 × errors` (`SudokuScreen.tsx`; `errors` counts illegal moves, i.e. row/column/box duplicates, not digits that differ from the solution, #2943), so each difficulty has its own cap. Rows from before #748 carry no `variant` and count as `classic`, as in `sudoku/router.py`.
- **Daily Word**'s best is the fewest guesses in a won game; a loss is not a best.
- **Twenty48** has one global board with no ceiling (#2519 decisions 1 and 14). A `kept_playing` completion counts like `completed`.
- **Star Swarm** has one board per `difficulty_tier` (plan §4.2) and no ceiling (decision 14). The tier is creation metadata and is repeated in the result, so it is in `games.metadata` either way. Only the ten tiers the app can send have a board (`partition_values`, from `DIFFICULTY_TIERS` in `starswarm/models.py`, which `tests/test_starswarm_module.py` checks against `DIFFICULTY_TIERS` in the client's `engine/tuning.ts`); a run on any other tier (a forged `captain`, or a tier a newer app sends first) is stored but can't be named (400 `This game's board does not exist.`), so it can't open a public board and the run isn't dead-lettered. A row with no tier counts as `LieutenantJG` (`DEFAULT_DIFFICULTY_TIER`, the engine's default). The result also carries a bounded per-wave `score_breakdown` (#2837; ≤ 4 KiB, a malformed one is dropped, never the run), which is recorded but never ranked: see [Star Swarm](games/starswarm.md#per-wave-score-breakdown-2837).
- **Mahjong** (#2747) ranks by fastest clear: `duration_ms` ascending, wins only, one board per `layout`. Only the app's layouts have a board (`partition_values`, `LAYOUTS` in `mahjong/models.py`, checked against the client's layout registry by `tests/test_board_definitions.py`). There is no default layout: a row from before #2627 has none, so it ranks on no board (`not_rankable`) rather than on Turtle's, and a board request needs `?layout=`. A clear under `min_value` (36 s, half a second per pair) or with no `duration_ms` is stored but never ranks. `final_score` is still recorded and shown on the result card, but ranks nothing. See [Mahjong](games/mahjong.md#scoring-persistence).
- **Legacy rows:** the removed per-game routes wrote their rows under unattributable `*-anon` sessions, with values unlike the boards' declarations (Yacht's stored `400 - raw`, Sort's the level in `final_score`). Migrations 0026 (#2622) and 0029 (#2644, after the routes were gone) deleted them; any written during the deploy window after 0029 are kept off every board by the `*-anon` filter (rule 3).
- **Sort** (#2625): every solved level is a session row with `won: true` and the `level` actually played, its `moves` and `undos` (`SortResult`). Every solve, replays included, is scored with the player's standing after it: `final_score` and `level_reached` are the highest level solved, and `total_moves` is the sum of the player's best moves over levels 1 to it (`@sort/best_moves`; left out when one of them has no best on record). `total_moves` is recorded but not ranked (#2746): levels are random per request, so players on the same level rank by the entry the server received first (`received_at`). The board keeps each player's best row, their first solve of their highest level; a replay never displaces it. Abandons carry no score and never rank.
- **FreeCell** (#2632): a win sends `final_score = moveCount` (installed builds still send none). Abandons carry no score and never rank.
- **Blackjack** (#2745): the metric is the run's closing balance, `final_chips` from the result block (`BlackjackResult`: an integer from 0 to 2³¹−1), so Stats "Best" reads it from every non-abandoned row, including rows stored before #2745 with no `final_score`. A finished run (`win` / `loss`) also sends it as `final_score`, and a non-abandoned completion that sends a `final_score` must send an equal `final_chips` (400 otherwise); when a completion leaves `final_score` out (older builds, offline-queued completions, the unmount / killed-process `win`), `BlackjackModule.derive_final_score` fills it in from `final_chips`. Abandons carry no score and never count. The board stays disabled.

Every `GameType` has a module since #2623, so no game exports `null`.

#### Leaderboard routes (#2618)

**Authority: `backend/games/boards/`, `backend/games/ranking.py`, `backend/games/router.py`.** Every game's board is served by these generic routes; a game gets a leaderboard by declaring `board`, with no router of its own. The rank route computes a player's standing with `games.boards.queries.player_standing`, using the board's own filters and order, so it always agrees with the listed board. A player joins the boards, under a server-generated name, with `PUT /players/me` (below; #2778); `PATCH /games/{id}/name`, which set a typed name, was removed in #2644.

- **`GET /games/leaderboard/{game_type}`** returns `{game_type, partition, label_key, entries: [{rank, player_name, value, completed_at, is_me}], me}`, top 10 by default (`?limit=` 1–100). With a valid `X-Session-ID` (#2633) the caller's own entry is flagged `is_me`, and `me` is their best entry on that board with its exact rank (`games.boards.queries.viewer_entry`, the same filters, order and `compute_rank` as the list), whether or not it is in `entries`; `me` is null without the header or when the caller has no entry (no display name, or no eligible game). The app never matches a row by name. Read-only; a free board stays public without the header. Partition values are query params named after `board.partitions` (e.g. `?difficulty=hard&variant=mini`); a missing, unknown, empty or repeated partition is a 400, and so is a value outside the key's `partition_values` (e.g. `?difficulty_tier=captain`). Unknown games, games without a module or board, and `enabled=False` boards are a 404.
- **`GET /games/{id}/rank`** (#2677) is the result card's call: where this game puts the caller, without setting anything. It returns `{rank, is_best, ranked, reason}`. When `ranked` is true, `rank` is the exact rank of the caller's best entry in that game's partition and `is_best` says whether this game is that entry. When it is false, both are null and `reason` is the first of these that applies: `board_disabled` (the board has `enabled=False`, e.g. Blackjack); `not_finished` (no `completed_at` or no metric value yet, usually because the completion is still in the app's sync queue, so asking again later can give a rank); `not_rankable` (the game can never rank: abandoned, a non-qualifying outcome, a disallowed partition value or a missing one with no default, a bad, below-floor or over-cap metric, or a session the board excludes; a completed game with no `duration_ms` on a `duration_ms` board is `not_rankable`, not `not_finished`, since the completion writes both; a row the stale-game sweep closed (`metadata.swept`) is `not_finished` on every board, since its real completion can still replace it); or `no_name` (the player has no display name, so no board shows them and no rank is computed). `not_finished` and `not_rankable` both come before `no_name`, so a card never asks for a name the game couldn't use. "Has a name" is decided through `players.names`, like every board. 403 if another session owns the game or a premium game isn't entitled, 404 if the game doesn't exist or its game has no board definition, 400 without `X-Session-ID`. It is read-only: no name and no metadata are written. Rate limit: 60/minute per session with a 300/minute per-IP backstop, like the leaderboard.
- **Public names are generated, never typed** (#2778; decision record [LEADERBOARD-IDENTITIES.md](LEADERBOARD-IDENTITIES.md)). **`GET /players/me`** returns `{display_name}`, the caller's generated name or `null`. **`PUT /players/me`** joins the leaderboards: it takes **no body** (any `display_name` sent is ignored and never stored), assigns a generated name (`players.generated`: curated adjective + animal + number, e.g. "Brave Otter 4821") and returns `{display_name}`. Joining again keeps the current name and writes nothing. **`POST /players/me/reroll`** assigns a different generated name (404 when the caller hasn't joined, so it never opts anyone in). **`DELETE /players/me`** leaves (204, also when not joined), which takes the player off every board. **Authority: `backend/players/`.** The player is the `X-Session-ID` (one per install until accounts, #1047); `players` holds one generated `display_name` per player, with no history. `DELETE /me` erases it with the player's other data, and the app's "Delete my data" also forgets the name on the device (after any sync in flight). Profile's "Leave leaderboards" (#2637) forgets the name on the device and sends `DELETE /players/me` through the same one-slot sync as the join, so an offline leave goes out on reconnect.
- **A legacy name path still opts the player in** (#2624, #2778): builds from before #2624 never call `PUT /players/me`, so a non-blank `player_name` they send in `POST /games` metadata joins the caller to the boards (that was the old model's opt-in), **under a generated name**. The typed text is never used as the public name. The name routes that did the same (`PATCH /games/{id}/name`, `PATCH /sudoku/score/{id}`, `PATCH /cascade/score/{id}`, the `POST /<game>/score` routes) were removed in #2644.
- **Result-card flow for session boards** (#2677): the card doesn't submit a score. A game runs `useGameRank(gameType)` (`frontend/src/game/_shared/useGameRank.ts`, #2990; screens get it through `useGameLeaderboard`) and calls `lookup(gameId)` when the game ends. `lookupGameRank` (`frontend/src/game/_shared/lookupGameRank.ts`) flushes the local game queue and any pending display-name sync, then calls `statsApi.getGameRank(gameId)` (`frontend/src/api/stats.ts`), retrying a 404 or `not_finished` briefly while the completion lands (`retryUntilGameSynced`); `not_rankable` is final at once. With no local name (and no join pending) the card shows `needsName`, the one-time **Join leaderboards** prompt; `joinLeaderboards()` stores the join (synced through `PUT /players/me`, which assigns the generated name) and then fetches the rank. A server `no_name` also shows the prompt once the sync has settled. Online, the card shows `saved` with the rank of the player's best entry when it is in the top 10: "#N on the leaderboard" when this game is that entry (`is_best`), else "Your best: #N" (#2633; `toRankLookup` carries both). Every game with an openable board (`hasLeaderboard`: enabled and visible in the build) also gets a "View leaderboard" link on the card and a "Leaderboard" item in its ⋯ menu (`useLeaderboardLink`), both opening the shared `Leaderboard` screen in the Home stack. The board refetches when the player returns to it and on pull-to-refresh; opened from a card whose rank is still pending (`refreshAfterSync`), it refetches once local games and the display name have synced. A game covered by the board (or by Stats or the Scorecard) pauses its own clock on the navigation `blur` event: Star Swarm's run, Mahjong's clock (#2633), Hearts' play clock (the `useFocusEffect` cleanup in `HeartsScreen.tsx`, #2629), and Solitaire, Sudoku, Twenty48 and Cascade (#2743); `useGameSync`'s own play window stops too (§2.3). Offline, the card shows `offline` and **nothing is queued**: the game syncs through `SyncWorker` and the join through `displayNameSync`. Until the lookup settles (still `not_finished`, a join still syncing, a network failure), the hook asks again while the card is mounted: on reconnect, and while online after 5 s, 15 s, 60 s and then every 60 s; `reset()` and unmounting stop it. A game on no board (`board_disabled`, `not_rankable`) gets the `unranked` status, and `GameResultModal` shows no leaderboard line for it. Other failures (403, a 404 that outlasts the retries, 5xx) show `error` with Retry. Every game with an enabled board uses `useGameRank` (Yacht, Solitaire, FreeCell, Mahjong, Hearts, Sudoku, Cascade, Sort, Twenty48, Star Swarm); Blackjack and Daily Word have disabled boards and pass no `submission`. `useGameRank` has only this one lookup, so there is no adapter to pass (#2990 removed `LeaderboardAdapter`, `SessionBoardSubmission` and `sessionBoardAdapter`): the old per-game adapter that submitted scores, and the `scoreQueue` it queued through, were removed in #2644. The frontend side of this flow is in §2.5.
- **`PATCH /games/{id}/complete`** rejects a metric above the row's effective cap, `board.max_value_for(metadata)` (e.g. 100 for an easy Sudoku), with 400 (absorbs #2215); on an uncapped board the bound is 2³¹−1. A metric or tie-break read from metadata must be an integer from 0 to 2³¹−1. A negative `final_score` is **not** rejected: a 400 would dead-letter the game in the sync worker and lose its stats, so the board ignores the row instead (rule 6). Nor is a metric below `min_value` (Mahjong's floor), and a `duration_ms` metric is bounded only by the body's own validation (non-negative): the board ignores what it can't rank.

Board rules, identical for every game:

1. **One entry per player** (#2519 decision 12). Rows are grouped by `session_id` (the device, until accounts in #1047) and only each session's best row is listed: best `metric` in `direction`, then `tiebreak`, then the earliest `received_at` (server receipt time; a row that has none ranks after every row that does, ordered among themselves by `completed_at`, #3225; otherwise the device-reported `completed_at` is never a tie key, #2765). The same key orders the board. A replay that doesn't beat the player's best never appears; a better one replaces it.
2. **Only named players rank** (#2519 decisions 17–18, #2624). A session ranks only if its player has joined the leaderboards (a `players` row holding their server-generated name, #2778), and then **every** eligible finished game of that player counts, including ones finished before they joined; there is no per-game "submit to leaderboard" step. The name shown is the player's current one, so a new generated name shows on all of their entries at once. `metadata.player_name` plays no part. There is no "anon" label. Boards find the name through one helper, `players.names.name_lookup`, which is what accounts (#1047) will change.
3. **Abandoned rows** (`not_abandoned()`), rows whose `outcome` is outside `board.qualifying_outcomes` (when set) and **sentinel `*-anon` sessions** never appear. The removed `POST /<game>/score` routes wrote those; migrations 0026 and 0029 deleted them, but the deploy runs 0029 while the old instance still serves the routes, so the filter (`SENTINEL_SESSION_SUFFIX`) stays as the guard.
4. **Exact rank** = 1 + the number of players whose best beats yours. It counts sessions, not rows, and there is no "11 = not in the top 10" sentinel. Players with identical keys share a rank.
5. **Partitions** filter on `games.metadata`. A row or request without a key that has a `partition_default` takes that value (Sudoku: no `variant` means `classic`); any other partition key is required in the request, and a row without a value for it is on no board (Mahjong rows from before #2627, which carry no `layout`).
6. **Only sane values rank**, whenever they were written: the metric must be a JSON integer (or the `final_score` / `duration_ms` column) from the board's `min_value` (0 unless set) to the partition's effective cap (`board.max_value_for`, 2³¹−1 when uncapped). A tie-break that isn't an integer from 0 to 2³¹−1 counts as missing and sorts last. The queries check the JSON type (`jsonb_typeof` on Postgres, `json_type` on SQLite) before casting to an integer, so a malformed stored row (a string, a negative or a `10**400`) can neither top a board nor make it fail.

All these routes are rate-limited by session (`session_key`, which keys on the `X-Session-ID` only when it is a valid UUID) and by a looser per-IP backstop (limits: `backend/rate_limits.py`). For a premium game (`game_types.is_premium`, read from the catalog), the leaderboard GET, the rank GET and the name PATCH check the caller's entitlement exactly like `require_entitlement` (both are in `backend/entitlements/dependencies.py`; `games/router.py` calls `check_entitlement`); a premium leaderboard GET without `X-Session-ID` is a 400.

The per-game leaderboard routes (`/solitaire/scores`, `/cascade/score/{id}`, …) were removed in #2644 and answer 404 (`tests/test_legacy_leaderboard_routes_removed.py`).

The `@runtime_checkable` decorator means CI can assert `isinstance(module, GameModule)` for each registered game (see `tests/test_game_module_protocol.py`).

**Registry:** `backend/games/registry.py` builds `_REGISTRY` (keyed by `GameType` string value) from the `_MODULES` tuple of module singletons. `games/stats.py`, `games/sessions.py` and `games/boards/` use `get_module(name)` for generic dispatch — there are no `if name == "<game>"` branches anywhere in the service layer. `tests/test_game_module_base.py` fails if a `<game>/module.py` is left out of `_MODULES`.

**Adding a module:**

1. Create `backend/<game>/module.py` with a `GameModuleBase` subclass declaring `game_type`, `metadata_model`, `has_winner`, `board` and, if the game sends a result block, `result_model`. Override a hook only if the game needs it.
2. Expose a module-level singleton: `module = MyGameModule()`.
3. Add the singleton to `_MODULES` in `backend/games/registry.py`, the game to `_HAS_WINNER` in `tests/test_game_module_protocol.py` and to `_GAMES` in `tests/test_board_definitions.py`. A hook override also goes in `_OVERRIDES` in `tests/test_game_module_base.py`.
4. Regenerate `frontend/src/api/vocab.ts` (§1.1): `BOARDS` and `HAS_WINNER` come from the module.

Example (pass-through stats, no result block):

```python
# backend/mygame/module.py
from games.board import SCORE_METRIC, BoardDefinition
from games.module_base import GameModuleBase
from mygame.models import MyGameMetadata
from vocab import GameType

class MyGameModule(GameModuleBase):
    game_type = GameType.MYGAME
    metadata_model = MyGameMetadata
    has_winner = False  # score-only: outcome is completed / kept_playing
    board = BoardDefinition(metric=SCORE_METRIC, direction="desc", label_key="score")

module = MyGameModule()
```

---

### 1.4 Metadata models

**Authority: `backend/<game>/models.py` (per-game `*Metadata` class)**

Each game's `games.metadata` JSONB column is validated on write by a Pydantic model attached to the `GameModule`. The `CreateGameRequest` validator calls `mod.metadata_model.model_validate(metadata)` and returns a 422 if it fails.

All metadata models use `extra="forbid"` to prevent arbitrary data from being silently stored: a key a game's model doesn't declare is a 422 on `POST /games`, for every game (#3221). `tests/test_metadata_forbid_extra.py` checks this for every registered game, and that each game's model accepts the metadata the current app sends (the audited key sets are hardcoded there, with the frontend source beside each); a new game must be added to that table.

This rule covers creation-time metadata only. The `result_model` blocks are separate (see "Completion merge" below): Hearts' and Yacht's keep `extra="allow"` on purpose, because a 400 on `/complete` is dead-lettered by the app's sync worker and would lose the score.

| Game        | Model               | Fields                                                                                                                                                                                                                                                           |
| ----------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blackjack   | `BlackjackMetadata` | none. The retired run aggregates (`best_run_chips`, `total_runs`, `runs_completed`, `current_table`) are still accepted from older clients, then stripped before the row is stored (#3140)                                                                       |
| Cascade     | `CascadeMetadata`   | `player_name: str = ""` (max 64 chars)                                                                                                                                                                                                                           |
| Daily Word  | `DailyWordMetadata` | `puzzle_id: str` (required), `language: Literal["en","hi"] = "en"`                                                                                                                                                                                               |
| FreeCell    | `FreeCellMetadata`  | None (empty model). Since #2632 a win carries its move count as `final_score`                                                                                                                                                                                    |
| Hearts      | `HeartsMetadata`    | `player_name: str = ""` (max 64 chars), `ai_difficulty: str \| None` (≤ 32 chars): the opponent style, recorded and not ranked on (`conservative`, the only value store builds send; dev / pre-launch builds also send `cautious`, `schemer`, `daring`, `mixed`) |
| Mahjong     | `MahjongMetadata`   | `player_name: str = ""` (max 64 chars), `layout: str \| None` (layout id, `^[a-z0-9_]+$`, ≤ 32 chars; sent since #2627)                                                                                                                                          |
| Solitaire   | `SolitaireMetadata` | `player_name: str = ""` (max 64 chars), `draw_mode: Literal[1, 3] \| None` (#2632; recorded, not a partition: both modes share one board)                                                                                                                        |
| Bottle Sort | `SortMetadata`      | `player_name: str = ""` (max 64 chars; 32 before #2995)                                                                                                                                                                                                          |
| Starswarm   | `StarSwarmMetadata` | `difficulty_tier: str \| None` (≤ 32 chars); only the app's ten tiers (`DIFFICULTY_TIERS`) rank                                                                                                                                                                  |
| Sudoku      | `SudokuMetadata`    | `player_name: str = ""` (max 64 chars), `difficulty: Literal["easy","medium","hard"]` (required), `variant: Literal["classic","mini"] = "classic"`                                                                                                               |
| Twenty48    | `Twenty48Metadata`  | None (empty model). The opening board is `game_started` event data                                                                                                                                                                                               |
| Yacht       | `YachtMetadata`     | `mode: Literal["solo","vs"] \| None`, `difficulty: Literal["easy","medium","hard"] \| None` (the computer's: required for `vs`, forbidden for `solo`; builds before #2630 send no `mode`)                                                                        |

**Legacy `player_name`:** the six models that accept it declare it as `player_name: LegacyPlayerName = ""` (`backend/games/metadata.py`), one limit for every game: `LEGACY_PLAYER_NAME_MAX_LENGTH = 64` (#2995; Sort allowed 32 before). It is validation-only JSON metadata that plays no part in ranking (§1.3 "Leaderboard routes"), so changing the limit needs no migration. `tests/test_game_module_base.py` checks that 64 characters pass and 65 fail for every game with the field.

**Completion merge:** `PATCH /games/{id}/complete` merges the validated result block into `games.metadata` (`merge_result_metadata` in `games/boards/limits.py`; the board's limit check merges the same way). Creation-time keys win, so a result can't rewrite `player_name` or a partition. A creation key holding `null` has no value to protect and doesn't win: the result's value fills it (a Star Swarm run created with `difficulty_tier: null` keeps the tier its completion reports). A `null` in the result never clears a creation value.

**Hearts result** (#2838): `HeartsResult` adds the optional `hand_scores` / `final_scores` / `human_seat` breakdown of a finished game. A breakdown that is malformed or doesn't reconcile is dropped, not rejected (a 400 on `/complete` would dead-letter the game). See [`games/hearts.md`](games/hearts.md). Result models are validated with `context={"final_score": <the /complete body's final_score>}` (`_validate_result`), so a model can reconcile its block against the value that becomes `games.final_score`; models that don't read `info.context` are unaffected.

**Adding a metadata model:**

1. Create a `*Metadata(BaseModel)` class in `backend/<game>/models.py` with `model_config = ConfigDict(extra="forbid")`.
2. Assign it as `metadata_model = MyGameMetadata` in the module class.
3. Add at least one unit test: valid payload passes, invalid payload raises `ValidationError`.

Unregistered game types (e.g. seeded in the DB before their module is implemented) skip validation — `get_module()` returns `None` and the check is skipped.

---

### 1.5 stats_shape()

**Authority: `backend/<game>/module.py` (`stats_shape` method); `games/stats.py` (`get_stats_for_session`) for the comparable fields**

`games/stats.py` runs one aggregate query per session, pre-fetches the latest score and metadata per game, and (only when some game has a `win` or `loss`) one ordered scan for win streaks. It then:

1. calls `module.stats_shape(raw_stats)` for the game-specific part of the `/stats/me` entry, and
2. sets the **comparable fields** itself, from the queries and the game's `BoardDefinition` (§1.3). `stats_shape` cannot change them, nor `completed` (the Arcade XP input; see [PROGRESSION.md](PROGRESSION.md) and `games/progression.py`).

There is no game-specific logic in `games/stats.py`.

**`raw_stats` keys passed to every `stats_shape` call:**

| Key              | Type               | Description                                                                                                         |
| ---------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `best`           | `int \| None`      | highest non-abandoned `final_score` (Blackjack's `best_chips`; `best_value` reads Blackjack's `final_chips`, #2745) |
| `last_played_at` | `datetime \| None` | most recent `completed_at`, ignoring rows the stale-session sweep closed (§1.7)                                     |
| `latest_score`   | `int \| None`      | `final_score` of the most recently completed non-abandoned game                                                     |

**Return value:** a dict with `last_played_at` and, optionally, `extras`, a dict of game-specific figures. Omitted keys default to `None` (`{}` for `extras`).

**Comparable fields (#2620)** — the same meaning for every game, set by the service:

| Field                                    | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sessions`                               | rows with `completed_at`, abandons included                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `completed`                              | `sessions` minus `abandoned` rows; the XP input                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `won` / `lost` / `tied`                  | rows with `outcome` = `win` / `loss` / `push`. All three `null` when the player has no row of the game with any of them (score-only games, solo-only Yacht): clients show "—". Older builds' certain wins count as `win` (§1.2, #2703)                                                                                                                                                                                                                                                                                                                                                                                         |
| `current_win_streak` / `best_win_streak` | runs of consecutive `win` rows in `completed_at` order (see rules below); `null` when the win fields are `null`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `time_played_ms`                         | reported play time only: the sum over `sessions` of `duration_ms` where it is > 0, each row capped at 24 h. Rows with a null or 0 `duration_ms` add nothing; the server adds no `completed_at − started_at` fallback. It is only as good as what the app reports: current builds send a game's own clock, else `useGameSync`'s active-play window (§2.3, #2684), which leaves out backgrounded time. Solitaire, Twenty48, Cascade and Mahjong send their own clock, which also leaves out backgrounded time from #2750 on (earlier builds' rows for those four do count it). Rows from older builds and swept rows add nothing |
| `best_value`                             | best value of the board's `metric` in its `direction`, over non-abandoned rows whose `outcome` is in the board's `qualifying_outcomes` (any outcome when that is `null`). FreeCell: fewest moves; Daily Word: fewest `guesses_used` in a won game, `null` with only losses. A metadata metric that is not a JSON number is ignored. A game with no registered module is an error, never a guessed board                                                                                                                                                                                                                        |
| `best_label_key`                         | the board's `label_key` (`"score"` for a game with no board)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `extras`                                 | what `stats_shape` returned under `extras`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

**Win rate** = `won / (won + lost + tied)`. `completed` and `kept_playing` rows are not in the denominator. Undefined ("—") when the win fields are `null`.

**Win streak rules:**

- a `win` extends the run;
- a `loss` ends it;
- a `push` neither extends nor breaks it;
- `abandoned`, `completed` and `kept_playing` rows are skipped (leaving a game is never penalised).

The deprecated aliases `played` (= `sessions`), `best`, `avg` and Blackjack's top-level `best_chips` … `current_table` were removed in #2644, once #2637 had moved every screen to the fields above.

`/stats/me` runs the stale-session sweep (§1.7) for the caller before it aggregates. The app surfaces that read it are in §2.6.

**Default implementation** — pass `last_played_at` through; `best`, `latest_score` and `metadata` are inputs only. Every game but Blackjack inherits it from `GameModuleBase`, which calls the shared helper `default_stats_shape` in `games/protocol.py`:

```python
# games/module_base.py
def stats_shape(self, raw_stats: dict) -> dict:
    return default_stats_shape(raw_stats)
```

**Blackjack implementation** — moves `best` and `latest_score` into `extras` as chips and nothing else (the run aggregates it once added were unread and were removed, #3140):

```python
def stats_shape(self, raw_stats: dict) -> dict:
    return {
        "last_played_at": raw_stats["last_played_at"],
        "extras": {
            "best_chips": raw_stats["best"],
            "current_chips": raw_stats["latest_score"],
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

**Authority: `backend/games/sessions.py`** (`create_game`, `append_events`, `complete_game`) and `backend/games/sweep.py` (`sweep_stale_games`).

- **Idempotent writes (#364).** `POST /games` with a client `id` that already exists returns that row (403 if another session owns it). Events are keyed `(game_id, event_index)` and inserted with `ON CONFLICT DO NOTHING`, so a resent batch is harmless — but only while the row is open (or swept, below): `POST /games/{id}/events` on a row with a real completion returns **409** `Game is already completed.`, and `SyncWorker` deletes those events from the device without retrying (`frontend/src/game/_shared/syncWorker.ts`, `isAlreadyCompleted`). **Events that arrive after a real completion are dropped.** `PATCH /games/{id}/complete` on a finished row returns it unchanged: **the first completion wins**, so a replayed or late completion from the device's sync queue never overwrites a result. This has been the rule since the write API (#364); it is not new in #2519.
- **Stale-session sweep (#2621).** `GET /stats/me` and the first page of `GET /games/me` (no `cursor`; later pages continue the listing just swept) first close the caller's own games still open 24 h after `started_at`: `outcome = 'abandoned'`, `completed_at = started_at + 24 h` (and the same `received_at`), `duration_ms` left null, and `metadata.swept = true` (`SWEPT_KEY` in `games/filters.py`, server-written only: `create_game` and `complete_game` strip it from client input). A sweep failure is logged and never fails the read. A swept row is the only finished row that still accepts events (`append_events` checks `is_swept`), and a real completion that arrives later **replaces** the sweep and clears the flag; after that, first completion wins again. Swept rows are abandoned, so they never rank, score or earn XP, and `last_played_at` ignores them.
- **Device-side sweep (#2654).** The app itself resolves sessions a killed process left open, at launch (`sweepPreviousProcess` in `frontend/src/game/_shared/gameEventClient.ts`): an unstarted one is dropped from the device (it never reached the server); a started one is kept for up to 24 h so its screen can continue it (`useGameSync.resume()`), and is abandoned when a fresh session of that type counts as started — `markStarted()` or a completion (`onStarting` in `gameEventClient.ts`), not `start()`, which only opens it on the device — or at a later launch once it is 24 h old. A session whose progress snapshot reported `outcome: "win"` (#2682, e.g. Blackjack's run goal) is closed as `win`, not `abandoned`. If that snapshot also had a `result`, it is persisted with the override (`PendingGame.progressResult`, #2745) and the sweep's `win` carries it, as the in-process abandon would; e.g. Blackjack's closing chips. Other games' sweeps are unchanged.
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
| Gameplay recorder and its caps (§2.10)                                                                                | `gameRecorder.ts`, `useGameRecorder.ts`, `eventQueueConfig.ts`, `replayDial.ts` in `frontend/src/game/_shared/`        |
| Result card outcome → `games.outcome`                                                                                 | `frontend/src/game/_shared/recordedOutcome.ts`                                                                        |
| Outcome guard                                                                                                         | `frontend/src/game/_shared/outcomeGuard.ts`                                                                           |
| Result card                                                                                                           | `frontend/src/components/shared/GameResultModal.tsx`                                                                  |
| Rank lookup for the card                                                                                              | `useGameLeaderboard.ts` (wraps `useGameRank.ts`, `lookupGameRank.ts`) in `frontend/src/game/_shared/`                 |
| Hook state → card's `submission`                                                                                      | `frontend/src/components/shared/toSubmission.ts`                                                                      |
| Display name                                                                                                          | `displayName.ts`, `displayNameSync.ts` in `frontend/src/game/_shared/`                                                |
| Leaderboard link / availability                                                                                       | `frontend/src/hooks/useLeaderboardLink.ts`, `frontend/src/game/_shared/leaderboardAvailability.ts`                    |
| Screen wrapper                                                                                                        | `frontend/src/components/shared/GameShell.tsx` (game screens), `ScreenFrame.tsx` (other screens)                      |
| Shared screens                                                                                                        | `LeaderboardScreen.tsx`, `GameStatsScreen.tsx`, `ScorecardScreen.tsx`, `ProfileScreen.tsx` in `frontend/src/screens/` |

`frontend/src/game/_shared/types.ts` holds the shared `GameType` re-export only; the unused `GameSession` and `Player` types were removed earlier.

### 2.2 GameShell

Every game screen renders inside `GameShell` (`frontend/src/components/shared/GameShell.tsx`), which draws the shared `AppHeader` (title, back, ⋯ menu), a loading state and an error banner, and keeps content clear of the tab bar. The game supplies only its own UI as children.

- **`gameType` is required** (#2635). With a game type, `GameShell` adds a **Stats** item to the ⋯ menu (the shared `GameStats` screen for that game) and, for a game in `SCORECARD_GAMES` (`frontend/src/navigation/scorecards.ts`: Hearts, Yacht, Blackjack), a **Scorecard** item (#2636). The game does not wire either. Pass `gameType={null}` only for a screen that is not one game's play screen (a scorecard, a run history, a dev tool).
- The game passes the other menu entries it has: `onOpenLeaderboard` (from `useLeaderboardLink`, §2.5), `onNewGame`, `onLevelSelect`, `onEditPlayerNames`.
- While `loading` is true the header keeps its title and back button and hides the ⋯ menu.
- **Back defaults to the lobby** (#2976): without `onBack`, the back button calls `navigation.popToTop()` (`GameShell` already has the navigation). Pass `onBack` only for another back (Hearts and Sort go back one screen; Star Swarm saves a paused run first), or `onBack={null}` for no back button. The back button is icon-only (a chevron, mirrored in RTL, 44×44 plus `hitSlop`) so translated titles keep their width (#3211); its accessible name is `common:nav.backLabel` or the screen's `backAccessibilityLabel`, and its `testID` is `nav-back`.
- **Side gutter** (#2976): `GameShell` pads the container's sides by `Math.max(inset, gutter)`, so content clears a landscape notch and keeps a margin. `gutter` defaults to 12 (`GAME_SHELL_GUTTER`); pass `gutter={16}` (Yacht, Twenty48) or `gutter={0}` (insets only, Star Swarm) for outliers, and `gutter={null}` for a screen that lays out its own edges (no side padding). A `paddingBottom` in `style` is still a minimum over the tab bar.
- **Screens that are not a game** (Profile, Leaderboard, Game Stats, Game Detail, Settings) wrap their `AppHeader` and content in `ScreenFrame` (`frontend/src/components/shared/ScreenFrame.tsx`): the themed full-height container that clears the header and the bottom safe area (`padBottom={false}` leaves the bottom to the screen). A run history or dev tool that wants the ⋯ menu shell uses `GameShell gameType={null}` instead.

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

**Duration.** The rule in one line: the game's own `durationMs` when it is > 0, otherwise the hook's active-play window; a value of 0 is sent as "unknown". Solitaire, Sudoku, Mahjong, Hearts, Twenty48 and Cascade send their own clock; Yacht, Blackjack, FreeCell, Sort, Daily Word and Star Swarm rely on the window. The window and every game's own clock leave out time in the background (`AppState`) and time while another screen covers the game (navigation `blur`). Solitaire, Twenty48, Cascade, Mahjong, Sudoku and Hearts pause on both through `usePauseWhileAway` (`frontend/src/hooks/usePauseWhileAway.ts`, #2750), which pauses when the first reason starts (at mount too, when the screen opens away) and resumes only once both have ended. A game whose clock is on its React state (Solitaire, Twenty48, Mahjong) uses `usePausableClock` on top of it: the pause and the resume are functional updates, `adoptLoaded` pauses a game loaded while the player is away, and the pause saves in its own event handler. Their clock is a `PlayClock` (`startedAt`, `accumulatedMs`, and `paused` for a paused clock, as opposed to one not started or stopped); an engine move starts a clock that never started but never a paused one. Across an app kill, Solitaire, Twenty48 and Mahjong save the clock banked and restart it from the load (`clockForSave` / `clockOnLoad` in `frontend/src/game/_shared/playClock.ts`), and Cascade saves its `playedMs`, so the play before the kill is kept and the time the app was closed never counts. Sudoku's clock restarts from 0 on a relaunch (intentional). See each game's Duration note in [`docs/games/`](games/). The details:

**`durationMs` (#2619).** Pass the game's own active play time — a timer that
should pause while the app is backgrounded or the game is covered (see
above). `SyncWorker` sends a
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

**The card.** Every game ends on `GameResultModal` (`frontend/src/components/result/GameResultModal.tsx`, #2504; split in #2990 into `GameResultModal` (modal + `useResultFeedback`), `ResultCard`, `SubmissionLine` (the only part that knows the rank-lookup status), `resultButtons` and `resultTypes`, with `components/shared/GameResultModal.tsx` re-exporting them for one release): the game passes data (`outcome`, `hero`, `stats`, `detail`, actions) and never builds its own result screen. (Blackjack's Goal Reached screen renders the same `ResultCard` inline, with `useResultFeedback`.) Two props connect it to the leaderboard:

- `submission` — the rank line: `{ status, rank, isBest, playerName, onJoinLeaderboards, onRetry }`. The card keeps this shape of its own (owner decision on #2976 / #2990); build it from the hook with `toSubmission(leaderboard)` (`frontend/src/components/shared/toSubmission.ts`), which passes the status fields through and renames the hook's `joinLeaderboards` / `retry` to `onJoinLeaderboards` / `onRetry`. Omit it for a game without a leaderboard (Blackjack, Daily Word).
- `onViewLeaderboard` — the "View leaderboard" link, `openLeaderboard` from `useGameLeaderboard` (or `useLeaderboardLink`).

**The rank line.** There is no score submission and no per-game name (#2624, #2677): a finished game of a named player is already on its board once `SyncWorker` uploads it. The card only asks where it landed:

```tsx
const { leaderboard, openLeaderboard } = useGameLeaderboard("sudoku", navigation, {
  difficulty, // the partition played, if the board has one
});
// on game over, with the id complete() returned:
void leaderboard.lookup(gameId);
// the card:
<GameResultModal submission={toSubmission(leaderboard)} onViewLeaderboard={openLeaderboard} … />
// the shell:
<GameShell gameType="sudoku" onOpenLeaderboard={openLeaderboard} … />
```

`useGameLeaderboard(gameType, navigation, partition?)` (`frontend/src/game/_shared/useGameLeaderboard.ts`, #2976) is the whole preamble: it runs `useGameRank(gameType)` for the rank lookup and `useLeaderboardLink` for the opener, and returns `{ leaderboard, openLeaderboard }`. `leaderboard` is `useGameRank`'s `{ status, rank, isBest, playerName, lookup(gameId), joinLeaderboards, retry, reset }`. Cascade still wires the pieces by hand (`useGameRank("cascade")` and `useLeaderboardLink`; its screen is out of scope while epic #3033 reworks it).

`lookupGameRank` (`frontend/src/game/_shared/lookupGameRank.ts`) flushes the local game queue and any pending display-name sync, then calls `GET /games/{id}/rank`, retrying briefly while the completion lands. `useGameRank` turns the answer into a status — `saved` (with the top-10 rank of the player's best entry and `isBest`), `needsName` (the one-time Join leaderboards prompt; `joinLeaderboards()` joins through `PUT /players/me`, which assigns a generated name), `submitting`, `offline`, `unranked` (no line) or `error` (Retry) — and keeps asking while the card is mounted until it settles. Nothing is ever queued. The server side, statuses and retry timings are in [Leaderboard routes (#2618)](#leaderboard-routes-2618). Call `leaderboard.reset()` when a new game starts, so the next card starts clean.

**The name.** One server-generated name per player who has joined (#2624, #2778): `players` table, `PUT` (join) / `POST .../reroll` / `GET` / `DELETE` (leave) on `/players/me`. In the app it is `displayName.ts` (the device copy of the server-assigned name) and `displayNameSync.ts` (a one-slot queue that sends the latest join or leave on the action, launch, reconnect and foreground, and refreshes the device copy from `GET /players/me`). Profile shows the name with "Get a new name" and "Leave leaderboards", or "Join leaderboards" (#2637, #2778); "Delete my data" clears it on the device and the server.

**The board definition on the client.** The app never fetches a board definition: `BOARDS` is generated into `frontend/src/api/vocab.ts` from each module's `board` (§1.3) and ships in the build. It decides:

- whether a game has a leaderboard at all — `hasLeaderboard` / `openableBoard` (`frontend/src/game/_shared/leaderboardAvailability.ts`): the board is `enabled` and the game is visible in this build (`isGameVisible`; store builds hide the premium games);
- the metric label on `LeaderboardScreen` (`labelKey`) and its partition picker (`partitions`, e.g. Sudoku's difficulty and variant).

Stats use the server's copy instead: `/stats/me` sends `best_value` with `best_label_key` (§1.5).

**Opening the board.** `useLeaderboardLink(navigation, gameType, partition?)` (called for you by `useGameLeaderboard`) (`frontend/src/hooks/useLeaderboardLink.ts`) returns an opener, or `undefined` when the game has no openable board. Pass it to both `GameResultModal.onViewLeaderboard` and `GameShell.onOpenLeaderboard`, so the card link and the ⋯ menu item appear together. Pass the partition the player just played. Both open `LeaderboardScreen` (#2633, `Leaderboard` route in the Home stack): one entry per player, the player's own row flagged by `is_me` and, when outside the list, pinned below it from `me`; pull to refresh; opened from a card whose rank is pending (`refreshAfterSync`), it refetches once local games and the name have synced.

**Covered screens.** A game with its own clock pauses it on the navigation `blur` event, since a pushed Leaderboard, Stats or Scorecard screen leaves it mounted, and while the app is in the background: `usePauseWhileAway` handles both (§2.3 for the play window).

### 2.6 Stats, Scorecard and Profile

These read the server; a game adds nothing for them beyond passing `gameType` to `GameShell` and having a module on the backend.

- **`GameStatsScreen`** (#2635, `GameStats` route, from the ⋯ menu's Stats item): one game's `/stats/me` entry as tiles — sessions, completed, wins, losses, ties and win rate ("—" for a game with no win concept), the win streaks (left out for such a game), best (`best_value` labelled by `best_label_key`), play time and last played — plus a "View leaderboard" link when the game has an openable board. The last good response is remembered in memory for the app session (`useMyStats`), keyed by session id, so the screen still shows figures offline; "Delete my data" clears it (`clearMyStatsCache`).
- **`ScorecardScreen`** (#2636, `Scorecard` route): a live view of the match in progress, only for `SCORECARD_GAMES` (Hearts, Yacht, Blackjack). A game's history is its Stats screen.
- **Profile** (#2637): top tiles show only figures that mean the same for every game (sessions, completed, completion rate, time played, games tried, favourite), summed over the games visible in the build; no score is compared across games and there is no cross-game "top score". Per-game rows show each game's own best with its label. It also holds leaderboard membership: Join, the generated name with "Get a new name", and "Leave leaderboards" (#2637, #2778).

### 2.7 ESLint boundary

`frontend/eslint.config.js` has one custom boundary rule, `bc-arcade/no-game-ui-imports`: no file under `frontend/src/game/` (engines, reducers, helpers, per-game contexts) may import from `src/components/` or `src/screens/`. The only exemption is `.tsx` under `src/game/_shared/**` (the shared card/drag/deck UI kit); see [`ARCHITECTURE.md` §3.1](ARCHITECTURE.md#31-where-game-code-lives). A game's own UI lives in `src/components/<game>/`. There is **no** rule against one game importing another game's folder; keep game code in its own `src/game/<game>/` and share through `src/game/_shared/`.

### 2.8 Testing and QA

- Screen tests normally run against the real `useGameSync` with the shared `foregroundClock` mock (§2.3); `HeartsScreen.test.tsx`, `MahjongScreen.test.tsx` and `BlackjackGameContext.test.tsx` mock the hook, so the guard does not run in those suites. The outcome guard throws in tests, so drive every finish path your game has.
- **Maestro is paused past v1.0** (owner decision; [`docs/MAESTRO.md`](MAESTRO.md)), including the result-submission flow (#2643). The result card, leaderboards, stats and Profile are checked by hand on iOS and Android builds with [`docs/MANUAL-QA-LEADERBOARDS.md`](MANUAL-QA-LEADERBOARDS.md).

### 2.9 Engine

The rules live in `frontend/src/game/<game>/engine.ts`: headless (no React, no storage, no platform imports, §2.7) and pure apart from module-level singletons. Two rules apply to every engine; the detail is [`ARCHITECTURE.md` §3.2](ARCHITECTURE.md#32-determinism-rng-and-counters-2985-2999):

- **Replayable from `(seed, inputs)`.** Randomness that affects play goes through a seed (`createSeededRng` from `game/_shared/seededRng.ts`) or the engine's `setRng` slot, never `Math.random` directly; tests pin the slot with `setRng(createSeededRng(seed))`.
- **Counters are restored on load.** An id counter or RNG state kept at module level (Twenty48's `seedNextTileId`, Star Swarm's `engineCounters` / `restoreEngineCounters`) is saved with the game, or derived from it, and put back when the storage module loads it, before the first move.

How a screen wraps the engine (shell, session, saving, pausing, result card) is the screen layer in [`GAMEPLAY_STANDARDS.md` §8](GAMEPLAY_STANDARDS.md#8-screen-layer).

### 2.10 Recording gameplay

**Authority: `frontend/src/game/_shared/gameRecorder.ts`, `useGameRecorder.ts`; caps in `eventQueueConfig.ts`** (#3274, epic #3273). A game that records its play for replay uses the shared recorder. It never builds its own batching, caps or size handling. Star Swarm is the first user (`on_session_end`, #3280): its `wave_completed` goes through the recorder like any other, with the one difference of the envelope opt-out below. Solitaire and FreeCell record every action in chunks of 25, one chunkable `moves` event each (`on_unit_close`, #3289: [Solitaire](games/solitaire.md#replay-recording), [FreeCell](games/freecell.md#replay-recording)), through `createMoveLog` (`_shared/cards/moveLog.ts`) and `useFlushOnBackground`. Blackjack follows (`on_unit_close`, #3284): a unit per round, two event types (`round_played`, `hand_resolved`) ([Blackjack, Replay recording](games/blackjack.md#replay-recording)), saved at one idle moment after the round closes and at once, via `flush()`, when the app goes to the background (not on `inactive`).

```ts
const sync = useGameRecorder("hearts"); // useGameSync + recorder; default policy on_unit_close
sync.start(eventData, metadata);
sync.beginUnit(hand); // a round / hand / trick / chunk; numbers from 1 if omitted
sync.record(
  "card_played",
  { c: "QS" },
  { seat: 2, kind: "cpu", cpu_type: "shark", difficulty: "hard" },
);
sync.closeUnit();
sync.flush(); // on app background: save what waits now, synchronously
sync.complete(summary, payload);
```

- **Session.** `useGameRecorder` returns everything `useGameSync` does. Its `complete` / `close` and the unmount end the recorder session, which saves what the recorder still holds **before** the session's `game_ended`.
  - `start` / `restart` over an open game session end the recorder session (saved to the old game) and open a new one (`t_ms` from 0, units from 1).
  - `start` with **no** game session open keeps the recorder session in progress: units recorded before `start()` wait in memory (the recorder saves nothing while `canAccept()` says no game is open) and are saved under the new game's id, with their unit numbers and `t_ms` continuing.
  - `resume` first saves what is waiting (`flush`: the open unit carries on under its number). A failed resume keeps the numbering and the clock. A successful resume over an open game session restarts recording (units from 1, `t_ms` from 0); with no game session open, units recorded before it are kept and saved under the resumed game's id, as with `start`. **A game that resumes passes its own unit number** (`beginUnit(n)`, from its restored state): the recorder cannot know which units the game saved before the app was killed, so its default numbering (from 1) would repeat them. `t_ms` of a resumed session counts from the recorder session's start in this process.
  - **Between games nothing is recorded.** After `complete` / `close` (or any `endSession`), `record()` and `beginUnit()` do nothing until the next `start` / `resume`: what a game records after its session ended belongs to no game and is dropped, never carried into the next one. The next game numbers its units from 1 and counts `t_ms` from its own start.
  - A new `gameType` (or policy) ends the old recorder's session and uses a new recorder. While the same game session stays open, the old recorder's events are saved to it and the new recorder carries the `t_ms` clock, the unit numbering and what the session has used of its caps (`sessionBytes`, events taken, full) on, so a switch never resets the per-game cap. With no game open, what the old recorder held is dropped (reported as `dropped_unsent`) and the new recorder starts fresh.
  - **Unsent events.** Measured events that never reach the queue — the session ends while no game session can take them, the sink refuses them at the end, or the sink fails — are counted as `dropped_unsent`, not as `saved`, and reported.
  - **Resuming a killed game.** The recorder cannot know the units the killed process saved, so a game that resumes carries its own count in its saved state and calls `beginUnit(n)` with it: for the unit it was in the middle of at once, and for every later unit by number (Blackjack saves `round` with the game).
  - **`flush()`** hands every unit waiting to the queue now, synchronously (the open unit's events so far included), without ending the session. A screen calls it when the app leaves the foreground (`useFlushOnBackground`), because the idle save may never run before a kill; units recorded before the game session opened stay waiting and are saved when it opens. Blackjack flushes on `background` only, because `inactive` also fires for Control Center and call banners on iOS and always precedes `background` when the app really leaves.
  - React StrictMode's extra effect cleanup/setup on mount re-arms the recorder (`rearm()`), so the remount records like a fresh mount.
- **`data` is taken by ownership.** Pass a fresh, compact object to `record()` and never change it afterwards: the recorder keeps the reference until it is measured and does not copy it. Development builds shallow-freeze it on every `record()` call, kept or not, so a later change throws there. Keep payloads **ASCII** (short keys, compact codes): the cap is a JSON length in UTF-16 code units, while Star Swarm's own server-side check measures `ensure_ascii` bytes, where a non-ASCII character becomes a 6-byte `\uXXXX` escape (the replay caps in `backend/games/replay_caps.py` measure raw UTF-8).
- **Envelope.** The recorder writes these fields on every event, over any `data` field with the same name: `v` (the type's schema version, `RecordedEventConfig.v`, default 1), `unit`, `t_ms` (ms since the session started) and, where the game passes one, `actor` (`seat`, `kind: "human" | "cpu"`, `cpu_type`, `difficulty`). The parts of a chunked event also carry `part` (0-based) and `parts`.
  - **Opting out: `envelope: false`.** A type registered with `envelope: false` is sent as recorded, with none of those fields, and is measured exactly as sent (its cap and the session cap count the data's own JSON). It is never chunked (a `chunkField` is ignored; the registry test rejects both together). Use it only for a type whose payload is already a fixed, versioned wire contract that the backend validates as is: today only Star Swarm's `wave_completed` (it carries its own `wave` index and `v`). **New types use the envelope** (the default).
- **Send policies.** Under both, a closed unit is measured at the next idle moment (`requestIdleCallback` with `timeout: RECORDER_IDLE_TIMEOUT_MS`, 2 s — React Native's own deadline, so a busy JS thread still runs it within that time; a runtime without it uses `setTimeout(task, 0)`), never inside the gesture or animation callback that closed it. Only the measured form is kept: an oversized event's data is released then, and the session cap trips as early as it can. `on_unit_close` (turn-based games): the measured unit is saved in that same idle task; units closed before it runs are saved together. `on_session_end` (Star Swarm): measured units are held, and the whole session is saved in one call when it ends.
- **One write per unit.** A save is one `gameEventClient.enqueueEvents` call. The call gives the events contiguous `event_index` values and makes one `eventStore.enqueueMany` write per priority tier the events touch. A unit whose events share a tier costs one AsyncStorage write. A unit that spans tiers costs one write per tier. Priority is read from the event registry (#3276), so a game's gameplay events share the replay tier and a unit is usually one write, two with a lifecycle event.
- **Sizes.** Every size is a JSON length (UTF-16 code units, `JSON.stringify(data).length`). Each event is measured once (at idle, or at the session's end for what is still open) against its type's cap, and never again: a save the sink cannot take keeps the measured form. That cap is the type's `maxBytes` in `gameEventRegistry` (the recorder reads it through `gameRecordingConfigs`, derived from the registry), else the game's `defaultEventMaxBytes`, and never more than the queue's `MAX_EVENT_PAYLOAD_BYTES`. The session is measured against `sessionMaxBytes`. An oversized event is split into parts when its type sets `chunkField` (the array spread across the parts); otherwise it is dropped. An event that cannot be serialised (a BigInt, a cycle) is dropped as invalid; the rest of the unit is still saved. Once the session cap is reached, the rest of the session is dropped, so what is saved is a clean prefix. Memory is bounded too: measured events held add up to at most `sessionMaxBytes`, and past `sessionMaxBytes / 16` events taken in a session (`memoryEventCeiling`; an envelope alone is longer than 16), or once measuring has filled the session, `record()` keeps nothing more and counts the drop, and nothing more is measured. Unmeasured events are bounded as well: a long open unit hands its events so far to the idle measuring every `RECORDER_MEASURE_EVERY` (64) records, keeping its unit number, and at most `RECORDER_MAX_RAW_EVENTS` (256) unmeasured events are held — past that `record()` drops events (`dropped_memory`) until idle has measured the backlog. `record()` stays allocation-only. Drops are reported once per session, by counts and sizes only (`RecordingDropReport`), through the Sentry throttle (`captureThrottledMessage`, key `gameRecorder.drop.<game_type>`, level warning): at most one report per game type per app session. A recorded event therefore never reaches eventStore's silent `{_truncated: true}` stub. A game whose registry entry overrides no cap gets `DEFAULT_RECORDING_CONFIG`: 2 KB per event and 64 KB per session (JSON lengths).
- **Performance rules.** `record()` only pushes to an in-memory array: nothing is serialised, stored, logged or breadcrumbed per event. The recorder owns no timers or intervals (the idle deadline is React Native's).
- **Event registry (#3278, #3276).** `gameEventRegistry` in `frontend/src/game/_shared/eventQueueConfig.ts` is the one table of every event type each game sends: `tier` (the queue `Priority`, which `logConfig.priorityForEvent` reads), `maxBytes` (unset: the game's `defaultEventMaxBytes`), `chunkField` (set: chunkable), `v` and `envelope` (`false`: no envelope, above). A game's entry may also set `sessionMaxBytes` and `defaultEventMaxBytes`. The recorder's caps (`gameRecordingConfigs`, `recordingConfigFor`) are derived from it, so there is no second table. A type the registry does not list queues as `Priority.GRANULAR` (diagnostics, evicted first).
- **Queue tier (#3276).** Every type chooses its `tier`: `Priority.REPLAY` for a gameplay event that rebuilds a game (turn_completed, roll, score, move, moves, wave_completed, bet_placed, hand_dealt, player_action, round_played, drop, merge, ...), `Priority.LIFECYCLE` for `game_started`, `game_ended` and `hand_resolved`. Under pressure the queue evicts granular and diagnostic rows first, then replay rows a whole game at a time (the least recently active game first, since a partial replay is useless; the game being played goes last), and drops the later replay rows of a game it already evicted, and lifecycle rows last. A new gameplay type that is not `REPLAY` is evicted before the rest of its game, so leave it out of `REPLAY` only for telemetry that does not rebuild the game.
- **The replay dial (#3279).** Two server-controlled values per game, served on `GET /games/catalog` as `replay: {enabled, sample_rate}` (`game_types.replay_enabled` / `replay_sample_rate`, migration 0036; `enabled` is also false while `REPLAY_RECORDING_ENABLED` is off). The app reads the stored dial and fetches the catalog once per launch, and again on a return to the foreground once an hour has passed (`replayDial.ts`, `replayDialSync.ts`). A response is kept only when it is valid; otherwise the app keeps the last-known dial, for at most 30 days (`REPLAY_DIAL_MAX_AGE_MS`, owner decision D4-B in #3353), and falls back to the default: enabled at 10 % (`REPLAY_DEFAULT_SAMPLE_RATE`, never 100 %). A game the catalog does not list gets the default too. The E2E test-hook build (`EXPO_PUBLIC_TEST_HOOKS=1`, no backend) defaults to 100 % instead (read when the first session is decided, `replayDial.ts`), as jest does, because its specs drain whole sessions; a catalog it fetches still wins.
  - **Flag off.** The recorder records when the open game session's stored mode is not `off` (`useGameRecorder` asks `gameEventClient.replayMode`, so a resume in a new process or a dial change cannot disagree with the decision made at the start); with no game session open yet, `isRecordingEnabled(gameType)` (the dial) decides, and units recorded before `start()` are dropped if the new game is `off`. Off: the recorder records nothing and does no work (no sink call, nothing scheduled, nothing reported), and `gameEventClient` queues only the session's lifecycle events (keep-list types included: off drops them too).
  - **Sample, once per session.** `gameEventClient.startGame` decides the session's mode from the dial held then, and stores it on the pending game (`replay`): `full` when `replayBucket(gameId)` (FNV-1a of the id, mod 10,000) is below `rate × 10,000`, else `local`. A resume, a kill and relaunch, or a later dial change never changes it. A pending game from an older build has no mode and counts as `full`.
  - **`local` sessions.** The recorder records and saves exactly as for `full` (the rows sit in the replay tier and count against the queue's caps), but SyncWorker sends only the session's lifecycle rows and its **keep-list** rows, in every case (completed, backgrounded, past the hold, or left by a killed process), and its other rows never hold back its `PATCH /complete`. The keep-list (`RETENTION_KEEP_TYPES` in `eventQueueConfig.ts`, owner decision D5-A in #3353) is the server's retention keep-list (`RETENTION_KEEP_NAMES`, `backend/games/replay_caps.py`): per-game summaries, today Star Swarm's `wave_completed` (`guess_submitted` is listed but not registered yet). They are held like any gameplay row while the session is open in the foreground (#3275: released on completion, on going to the background, or after `GAMEPLAY_HOLD_MAX_MS`), exactly as for a `full` session; they are just never deleted. A backend test fails when the two lists differ. The other rows stay on the device until SyncWorker's last step for the session: they are deleted just before its `PATCH /complete` (`eventStore.deleteByGameIds(ids, uploadsWhenSampledOut)`, which keeps lifecycle and keep-list rows), so a late error report can still upgrade it, and a session completed by a process killed before that step is cleaned up at the next launch's sync. Without the network (offline, or in a backoff) every pass deletes them anyway once the session completed `LATE_UPGRADE_GRACE_MS` (60 s) ago (a completion dated in the future, after the clock moved back, counts as past it), and a game the server refuses for good (POST /games 4xx) loses them at once, so they never pile up behind the sync. Each delete first marks the game `replayFinal` (persisted on the pending game), after which no upgrade is accepted, so a `full` session's rows are never deleted. A discarded session loses all its rows at once. A failed delete, or one a killed process never got to after persisting the mark, is run again on the next pass (it is idempotent); the queue's 7-day TTL is the last resort. Their `event_index` values leave a harmless gap on the server.
  - **Upload on error.** `gameEventClient.upgradeReplay(gameId, reason)` turns a `local` session into `full`, so its held rows go out as usual: `reportBug` (any level) for the open game; Sentry's `beforeSend` (App.tsx, `replayErrorUpgrade.ts`) for an `error` or `fatal` event, upgrading the game named by the **event's own `game.id` tag** (stamped at capture; on native `beforeSend` runs later, when that game may have ended and another started), and only for game errors — not an event with no game (`game.id` absent or `none`), a forwarded `console.error`, an API request event (`api` tag), one from a plumbing subsystem (`UPGRADE_IGNORED_SUBSYSTEMS`: syncWorker, entitlements, purchases, ...) or from a game's persistence (`<game>.storage`, `.pauseStore`, `.unlocks`: device storage failing); game-logic subsystems (`outcomeGuard`, `autoComplete`, `drag`, `hearts.integrity`, ...) count; and at launch, when `Sentry.crashedLastRun()` is true, the most recently active `local` session the crashed process left open (owner decision D2-A, `REPLAY_UPGRADE_ORPHANS`), decided only after the stored dial is read (one AsyncStorage read, within the sweep's 2 s bound; the catalog fetch never blocks it), so a turned-down game is not upgraded on a cold launch. It is a synchronous flag set with a fire-and-forget write, never a Sentry event. It applies to a completed session until its completion has synced or its rows' delete has begun (`replayFinal`), and does nothing for an `off`, `full`, synced, finalized or unknown session, or while the game's flag is off or its sample rate is 0 (the storage-budget turn-down: no error, bug or crash upgrades, so the turn-down is a real stop). A session upgraded after it ended keeps `m: "s"` in its `game_ended` summary (already queued); its uploaded gameplay rows are authoritative, and `replay_game.py` prints such a session as upgraded after the game ended.
  - **Summary.** `game_ended` data gains `replay: {m, u?, n?, b?, x?, up?}` (about 60–90 B): `m` is `"s"` (summary only: not sampled) or `"f"` (full), `up` the upgrade reason (`bug`, `error`, `crash`). `u` (last unit), `n` (events saved), `b` (their JSON length) and `x` (events the caps dropped, when any) come from the recorder: `useGameRecorder.complete` passes `recorder.stats()` as the payload's `replay` field and the client adds `m` / `up`. An `off` session carries no summary. No new event type or seed. `backend/scripts/replay_game.py` prints the mode (`summary only` for `m: "s"`).
  - **Server side.** `append_events` drops a game's replay rows while its `replay_enabled` (or the env switch) is off, cutting the game as the env kill switch does (`replay_paused`); lifecycle rows are still stored. The sample is not checked on the server (owner decision D3-A). At 90 % of the storage budget every game's sample rate is set to 0 (D1-A). See [DATA-INVENTORY.md §2a](DATA-INVENTORY.md#2a-replay-storage-budget).
- **Uploads (#3275).** SyncWorker does not upload a session's gameplay events while it is open in the foreground: only its lifecycle events (`game_started`, `hand_resolved`, `game_ended`) go out on the usual 30 s schedule. The rest are sent when the session completes, when the app goes to the background, or once the oldest held event is `GAMEPLAY_HOLD_MAX_MS` (5 min, `eventQueueConfig.ts`) old. See [ARCHITECTURE.md](ARCHITECTURE.md) ("SyncWorker") and the budgets in [PERFORMANCE.md](PERFORMANCE.md#replay-recording-3275).

#### Adding an event type

Adding a type on one side only fails CI. Do all of these in one change:

1. **Registry** — add `name: { tier: Priority.X, maxBytes?, chunkField?, v? }` (leave `envelope` out unless the payload is already a fixed, versioned wire contract) to the game's `events` in `gameEventRegistry`, choosing the tier (#3276): `Priority.REPLAY` if the event is needed to rebuild the game, `Priority.LIFECYCLE` only for the lifecycle trio. Add the type to `REPLAY_TYPES` in `eventRegistry.test.ts`. Keep the literal shape: the backend test parses the file as text.
2. **Seed** — add an Alembic migration inserting the `event_types` row for the game (see `0034_starswarm_wave_event.py`). The server answers `400 unknown_event_type` for an unseeded type, and the queue holds the batch for 24 h.
3. **Validation** — either validate it in the game module's `validate_event` (return `None` to drop a bad event) and add `(game, name)` to `VALIDATED`, or add it to `STORED_AS_SENT`, both in `backend/tests/test_event_registry_contract.py`. The test probes the module, so a list that disagrees with the module fails.
4. **Run** `backend/tests/test_event_registry_contract.py` (app registry <-> seeded types <-> validation; it also proves, on a fixture, that a one-sided type fails) and `frontend/src/game/_shared/__tests__/eventRegistry.test.ts`.

A mismatch that cannot be fixed in the same change goes in `KNOWN_GAPS` in that test, with a tracking issue; the entry fails as stale once the gap is closed. A new payload vocabulary (Star Swarm's `wave_completed`) has its own parity: [Star Swarm, Adding content](games/starswarm.md#adding-content).

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
- [ ] **`backend/mygame/module.py`** — subclass `GameModuleBase` (§1.3): declare `game_type`, `metadata_model`, `has_winner`, `board` and `result_model` (if the game sends a result block); override `stats_shape` / `derive_final_score` / `reconcile_result` only if the game needs it
  - `has_winner`: `True` only if the client records `win` / `loss` / `push` (§1.2); a score-only game is `False` and records `completed`
  - `board`: a `BoardDefinition` — metric, direction, tie-break, partitions, `max_value` cap, `qualifying_outcomes`; `enabled=False` if the game has no leaderboard (it still defines the "best" in stats)
  - CI: `tests/test_game_module_protocol.py` (registry-wide conformance; add the game to `_HAS_WINNER`) and `tests/test_board_definitions.py` (add it to `_GAMES`)
- [ ] **`backend/games/registry.py`** — add the module singleton to `_MODULES`
  - CI: `tests/test_game_module_base.py` (every `<game>/module.py` registered)
- [ ] **`backend/scripts/gen_vocab_ts.py`** — regenerate `frontend/src/api/vocab.ts` (`GAME_TYPES`, `HAS_WINNER`, `BOARDS`)
  - CI: `tests/test_vocab.py` (TS contract drift check)
- [ ] **Premium tier** _(if applicable)_ — set `is_premium=true` in the Alembic migration; `POST /games` and the generic leaderboard and rank routes then check the entitlement themselves (`check_entitlement`, defined in `backend/entitlements/dependencies.py` and called from `games/router.py`); add `require_entitlement("<slug>")` to the game's own router, if it has one; add the slug to `PREMIUM_GAMES` in `frontend/src/entitlements/EntitlementContext.tsx` and to `HIDDEN_GAMES` for v1.0 store builds (frontend routing: see Route and Home tile below). See [`docs/ARCHITECTURE.md §10`](ARCHITECTURE.md#10-premium-entitlements).
- [ ] **`docs/games/mygame.md`** — the game's page, including its Scoring (Persistence) section: metric, outcomes, metadata, result block (see the existing pages in [`docs/games/`](games/))

### Frontend

- [ ] **`frontend/src/api/vocab.ts`** — the committed generated file includes the new `GameType`, its `HAS_WINNER` flag and its `BOARDS` entry
- [ ] **Engine** — game logic in `frontend/src/game/mygame/engine.ts` (no imports from `components/` or `screens/`, §2.7), seeded or behind `setRng`, with any module-level counter restored on load (§2.9).
- [ ] **Route and Home tile** — a screen in `frontend/src/screens/`, typed in `frontend/src/types/navigation.ts`. A free game is registered as a plain `HomeStack.Screen` in `frontend/App.tsx`. A premium game is **not**: add its route to `PREMIUM_ROUTES` (`frontend/src/entitlements/premiumRoutes.ts`) and its unguarded screen to `PREMIUM_SCREEN_BASES` in `App.tsx`; `LobbyStack` registers it wrapped in `makePremiumScreen` (the entitlement gate, `LockedGameScreen` when not entitled) and only when it is visible in the build (`visiblePremiumRoutes()`). Add the slug to `PREMIUM_GAMES` (`EntitlementContext.tsx`) and, while v1.0 hides premium games, to `HIDDEN_GAMES` (`frontend/src/entitlements/gameVisibility.ts`); the `gameVisibility` / `premiumRoutes` tests fail if these sets drift. This mirrors [`docs/ARCHITECTURE.md` §10.6](ARCHITECTURE.md#106-adding-a-premium-game), step 5. Add a tile in `HomeScreen.tsx` and an i18n namespace (`frontend/src/i18n/localeLoaders.ts`) with `game.title`
- [ ] **`GameShell`** with `gameType="mygame"` (required, §2.2): the ⋯ menu then gets Stats (and Scorecard, if the game is in `SCORECARD_GAMES`) with no further wiring. `gameType={null}` is only for screens that are not one game's play screen (a live scorecard, a run history, a dev tool)
- [ ] **`useGameSync`** (§2.3) — `start()` with the metadata, `markStarted()` on the first real action, `complete()` with an explicit `result` block, `setProgressSnapshot()` so the hook's abandons carry it; `resume()` if the screen restores saved progress; no `beforeRemove` abandon handler
- [ ] **Outcome** (§2.4) — `recordedOutcome(cardOutcome)` if `has_winner`, else `"completed"`; drive every finish path in a screen test (the outcome guard throws there)
- [ ] **Duration** — send the game's own active clock as `durationMs` if it has one (paused while backgrounded and on `blur`); otherwise send nothing and let the play window count; call `resetPlayWindow()` where a new board or picker appears before the session opens (§2.3)
- [ ] **Result card** (§2.5) — end on `GameResultModal`; with an enabled board, `useGameLeaderboard("mygame", navigation, partition)`, `leaderboard.lookup(gameId)` with the id `complete()` returned, `leaderboard.reset()` on a new game, and `toSubmission(leaderboard)` as `submission`
- [ ] **Leaderboard link** — `useGameLeaderboard`'s `openLeaderboard` passed to both `GameResultModal.onViewLeaderboard` and `GameShell.onOpenLeaderboard`
- [ ] **Stats entry** — nothing to build: `GameStats` and Profile read `/stats/me` (§2.6); check the game's tiles show sensible values (win figures "—" for a score-only game)
- [ ] **`noUncheckedIndexedAccess`** clean — no suppression comments
- [ ] **Icon assets are WebP** — any new icons added to `assets/fruit-icons/` or `assets/celestial-icons/` must be converted before committing: `python tools/assets/convert_icons_to_webp.py <dir>`. Raw PNGs in non-exempt asset directories will fail CI (`assetTransparency.test.ts`).

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
