# Leaderboards, Stats, Scorecards, and Profile

This document explains how BC Arcade turns completed game sessions into rankings and player-facing history.

For the **normative implementation contract**—how a game opens/completes its session, which outcome it records, and how frontend/backend modules integrate—see [GAME-CONTRACT.md](GAME-CONTRACT.md). Per-game score formulas and gameplay rules belong in [docs/games/](games/).

## 1. One reporting model

BC Arcade does not have a separate leaderboard implementation for each game.

Every game writes the shared `games` session model. Each backend `GameModule` declares a frozen `BoardDefinition` that says how that game's completed rows should be interpreted for:

- its public leaderboard, when enabled;
- the game's "Best" value in Stats, even when the public board is disabled;
- client labels and partition pickers.

The server exports those board definitions into the generated frontend vocabulary (`frontend/src/api/vocab.ts`). The app therefore does not maintain a second hand-written ranking configuration.

## 2. BoardDefinition

The authoritative model lives in `backend/games/board.py`.

A board declares:

| Field | Meaning |
| --- | --- |
| `metric` | Ranked value: either `final_score` or a validated metadata/result key |
| `direction` | `desc` when higher is better; `asc` when lower is better |
| `label_key` | Player-facing meaning of the value, such as score, moves, level, chips, or guesses |
| `tiebreak` | Optional game-specific secondary metric |
| `partitions` | Keys that split one game into separate comparable boards |
| `partition_defaults` | Value used for older/missing partition metadata when a default is valid |
| `partition_values` | Allowed public values for a partition |
| `max_value` / partition caps | Sanity bounds for values that are allowed to rank |
| `qualifying_outcomes` | Optional outcome filter; abandoned rows never qualify |
| `enabled` | Whether a public board can be opened |

A disabled board is still useful: its metric/direction/label can define the per-game "Best" shown in Stats.

## 3. Which game rows can rank

A stored session is eligible for a board only when all applicable rules pass:

1. It is **not abandoned**.
2. If the board declares `qualifying_outcomes`, the row's outcome is one of them.
3. The metric exists and is a sane integer within the board's effective bounds.
4. Any required partition values resolve to an allowed board.
5. The player has joined the leaderboards (so has a generated public name; see §4a).
6. Legacy sentinel anonymous rows are excluded.

A malformed or legacy row can remain in storage without being allowed to rank.

## 4. One best entry per player

Public boards show one entry per current player identity.

Today that identity is the player's BC Arcade session id. The leaderboard query groups eligible rows by `session_id` and keeps only that session's best row for the selected board/partition.

The player's public name comes from the `players` table, not from old per-game score metadata. Getting a new name therefore updates the name shown for that player's ranking without rewriting historical game rows.

Anonymous play remains fully supported. A player simply does not appear publicly until they choose to join the leaderboards.

Future account identity work can change how player identity is resolved without changing each game's scoring contract.

## 4a. Public names are generated, not typed (#2778)

Launch decision, recorded in [LEADERBOARD-IDENTITIES.md](LEADERBOARD-IDENTITIES.md): players never type public text.

- **Join** (`PUT /players/me`, no body) is the explicit opt-in. The server assigns a generated name such as "Brave Otter 4821" (`backend/players/generated.py`: curated adjective + animal + number).
- **Get a new name** (`POST /players/me/reroll`) swaps it for another generated name. It is online only, and it never opts anyone in.
- **Leave** (`DELETE /players/me`) takes the player off every board. Joining again gives a new name.
- The API ignores any name text a client sends. An older build's `player_name` in `POST /games` metadata only counts as that player's choice to join, and they get a generated name.
- Existing players who had set a name were kept on the boards under a generated name by migration 0030. Nobody who never set a name was opted in.
- Names are the same English words on every locale, and they are not unique. The board identifies a player by id.

## 5. Ordering and ties

Boards use one ordering rule everywhere: top list, exact rank, and "is this my best?" all use the same comparison.

1. Primary `metric`, in the board's direction.
2. Optional declared `tiebreak`, if a board has one.
3. Final tie-break: **earlier `completed_at` ranks first**.

No board currently declares a game-specific secondary tie-break. If that changes, the `BoardDefinition` is the single place to add it.

"Exact rank" means the number of players whose best entry beats yours, plus one.

## 6. Partitions

Some scores are only comparable within a specific ruleset/difficulty. Those boards are partitioned rather than mixed together.

Current examples:

- **Sudoku:** difficulty + variant.
- **Star Swarm:** difficulty tier.

The backend validates partition keys/values. Defaults exist only where an older or omitted value has a defined meaning (for example, older Sudoku rows without a variant are treated as Classic).

The result card and leaderboard link should open the partition the player just played; the Leaderboard screen also exposes partition pickers.

## 7. Current board definitions

This table summarizes the generated board configuration on `dev`. Per-game docs own the meaning of the score itself.

| Game | Public board | Metric | Direction | Partitions / cap notes |
| --- | --- | --- | --- | --- |
| Yacht | Yes | final score | Higher | Max 1575 |
| 2048 | Yes | final score | Higher | No natural cap declared |
| Blackjack | **No** | chips / final score for Stats | Higher | Public board disabled |
| Cascade | Yes | final score | Higher | No natural cap declared |
| Solitaire | Yes | final score | Higher | Max 1245 |
| Hearts | Yes | final score | Higher | Max 100 |
| Sudoku | Yes | final score | Higher | difficulty + variant; effective caps 100/200/300 by difficulty |
| Mahjong | Yes | clear time (`duration_ms`), wins only | **Lower** | One board per layout (no default: rows without a layout rank nowhere); clears under 36 s ignored (#2747) |
| Star Swarm | Yes | final score | Higher | difficulty-tier partitions |
| FreeCell | Yes | moves / final score | **Lower** | Fewest moves wins |
| Bottle Sort | Yes | level reached | Higher | Max level 23 |
| Daily Word | **No** | guesses used for Stats | **Lower** | Wins only; public board disabled |

When a board's product design changes, update the backend module first and regenerate the frontend vocabulary; do not hand-edit this table independently of code.

## 7a. Indexes (#2965)

Every board read (`top_statement`, the caller's own entry and `GET /games/{id}/rank`) applies the same `board_filters`: `game_type_id = ?`, the metric `IS NOT NULL`, `completed_at IS NOT NULL`, then the value, outcome, name and partition checks. Each metric kind rides a partial index whose `WHERE` those filters imply, so the query seeks to its game type instead of scanning every game:

| Metric kind | Boards | Index |
| --- | --- | --- |
| `final_score` | every score board | `games_game_type_score_idx (game_type_id, final_score) WHERE final_score IS NOT NULL` (alembic 0002); the value bounds are index conditions too |
| `duration_ms` | Mahjong | `games_game_type_duration_idx (game_type_id, duration_ms) WHERE duration_ms IS NOT NULL AND completed_at IS NOT NULL` (alembic 0032); the clear-time floor and cap are index conditions |
| metadata key | Bottle Sort (`level_reached`) | `games_game_type_completed_idx (game_type_id, completed_at) WHERE completed_at IS NOT NULL` (alembic 0032): seeks on `game_type_id` only, then checks the JSON value on each of the type's finished rows |

No board uses `completed_at` in `games_game_type_completed_idx`, neither as an index condition nor as a sort key (the window sorts by session first). It is there for a future "recent finished games of this type" read. A one-column `(game_type_id) WHERE completed_at IS NOT NULL` index serves the boards identically: on Postgres 16 with 3,000,000 rows the Sort plan is the same bitmap scan with `Index Cond: (game_type_id = ...)` either way (median 58 ms vs 57 ms; 19 MB vs 25 MB).

Migration 0032 builds both indexes `CONCURRENTLY`, outside the migration transaction, so a deploy (`alembic upgrade head` while the previous instance still serves) never blocks writes to `games` during the builds. If a concurrent build fails it leaves an INVALID index of that name: drop it and rerun the upgrade.

The one-per-player window (`PARTITION BY session_id`) still reads every eligible row of the board's game type; the indexes bound that to one game type rather than the whole table. Measured on Postgres 16 with 3,000,000 rows (Sort and Mahjong 25,000 each), median of the bound-parameter query: Sort 244 ms to 65 ms, Mahjong 279 ms to 21 ms.

**Sort: why not a Sort-specific index.** Two options were compared with `EXPLAIN` on Postgres before choosing (#2965):

- *An expression index on the `metadata_count` guard.* Postgres matches an expression index only when the query's expression is identical, operand types included. The app binds the cap as a `bigint` parameter (`<= '23'::bigint`); an index built with the literal `23` (an `integer`) is not matched by the app's query, and one built with `23::bigint` is not matched by a literally inlined query. When unmatched, the planner still uses it, but only as a `(game_type_id) WHERE completed_at IS NOT NULL` index, which is exactly `games_game_type_completed_idx`. Even when matched it reads the same rows (every finished Sort row has a valid `level_reached`). It would also silently stop matching whenever the cap (23), the key or the guard's SQL changes.
- *Mirroring `level_reached` into `final_score` and ranking `final_score`.* This rides `games_game_type_score_idx` and halves Sort's query time (about 21 ms at 3,000,000 rows, because it skips the JSON checks), but a board only implies `final_score IS NOT NULL` when it ranks `final_score`. Switching the metric changes which stored rows rank wherever `final_score` and `level_reached` disagree (older builds, abandons, invalid values), and needs a backfill. Ranking semantics are out of scope here, and #2761 (seeded levels) and #2765 (tie order) change the same board.

So Sort rides `games_game_type_completed_idx`, with no Seq Scan and no change to what ranks. Revisit the mirror only together with a deliberate ranking change.

**Gate.** `backend/tests/test_leaderboard_query_plans.py` EXPLAINs `top_statement` for every enabled board and partition, as the app binds it. On SQLite (the default suite, and CI) it requires `SEARCH games USING INDEX <the index above> (game_type_id=?...)` (older and covering-index wordings accepted) and no `SCAN games`. On Postgres it fails on any `Seq Scan` over `games`, or any access to `games` that does not seek by `game_type_id`. The Postgres half runs only when `LEADERBOARD_EXPLAIN_PG_URL` names a scratch server; the suite's `DATABASE_URL` is never used, since it may name a real database. The test uses that URL only to create a dedicated database (`explain_gate_<random>`, `TEMPLATE template0`), migrates it to head, seeds 25,000 games per enabled board's game type, runs `ANALYZE`, EXPLAINs, and drops the database, so nothing (rows or `ANALYZE` statistics) is left behind; the role needs CREATEDB. It refuses to seed a `games` table that already holds rows. Without the variable it skips with that reason; CI's `test-python` job has no Postgres service, so in CI only the SQLite half runs. Run the Postgres half locally with:

```bash
cd backend && source .venv/bin/activate
LEADERBOARD_EXPLAIN_PG_URL=postgresql://user@localhost/postgres \
  python -m pytest tests/test_leaderboard_query_plans.py --no-cov
```

A new metric kind, or a filter that stops implying an index's `WHERE`, fails this gate: add the index (migration plus `Game.__table_args__`) in the same change.

## 8. Result card

The result card answers one narrow question: **where did this completed game place?**

For an openable board, the app asks `GET /games/{id}/rank` for the completed session. It does not re-submit a score through the result card.

Possible outcomes include:

- exact rank for the player's best entry;
- a message that this game did not beat the player's existing best;
- one-time **Join leaderboards** prompt (no name entry: the server generates the name);
- no rank line for a disabled/unavailable board;
- retry/offline state while the session or the join is still syncing.

The result card can link to the full Leaderboard screen.

Implementation contract: [GAME-CONTRACT §2.5](GAME-CONTRACT.md#25-result-card-and-leaderboard).

## 9. Leaderboard screen

The Leaderboard screen shows the top entries for **one game and one partition**.

It provides:

- one best entry per player who has joined;
- rank, current generated name, metric value, and completion date;
- the current player's row highlighted when it is in the returned list;
- the current player's exact best pinned below the list when it is outside the visible results;
- partition controls for partitioned boards;
- pull-to-refresh and offline/error states.

A game's leaderboard is only openable when:

1. its `BoardDefinition.enabled` is true; and
2. that game is visible in the current build.

Hidden premium games therefore do not expose a public-board navigation path in a store build even though their board definition still exists in generated code.

## 10. Game Stats

Stats answer: **how have I done in this game over time?**

`GET /stats/me` returns a per-game block containing the comparable fields that apply:

- sessions;
- completed games;
- wins/losses/ties where the game has a winner concept;
- current/best win streaks where meaningful;
- play time;
- last played;
- the game's own Best value and label;
- game-specific extras where defined by the module.

The backend uses the game's `BoardDefinition` for the meaning/direction of Best; a game does not need a public board to have a Stats Best.

The app keeps the last good Stats response in memory for the current app session so the Stats/Profile surfaces can remain useful during a later offline period.

## 11. Scorecards

A Scorecard is **not history and not a leaderboard**. It is a live view of a match already in progress on the device.

Current Scorecard games are:

- Hearts
- Yacht
- Blackjack

The scorecard reads live local game state. Historical results belong in Stats.

## 12. Profile

Profile is the cross-game **personal** summary.

It may aggregate only measures that have the same meaning across games, such as:

- sessions;
- completed games;
- completion rate;
- time played;
- games tried;
- favourite game.

Per-game rows can show that game's own Best and win-rate information.

BC Arcade does **not** compare a Hearts score to a Sudoku score or create a cross-game "highest score" leaderboard.

Profile also owns the player's leaderboard membership (#2778): **Join leaderboards** when they haven't joined, and otherwise their generated name with **Get a new name** and **Leave leaderboards**. There is no name text field. Profile refreshes its copy of the name from `GET /players/me` when it opens online, so a name the server replaced (migration 0030) shows as the new generated one.

## 13. Offline and sync behavior

Gameplay/session completion is offline-capable through the shared game sync queue. Public ranking and server Stats require the server.

Consequences:

- a finished offline game can upload later;
- the result card may temporarily have no rank while its game or a join is pending sync;
- a join or leave made offline is kept in one pending slot and sent on reconnect, foreground or launch; the generated name appears once the join reaches the server;
- **Get a new name** needs a connection;
- opening a leaderboard from a pending result can trigger a refresh after queued games and a pending join/leave flush;
- public boards themselves are server reads and show an offline/error state when unavailable.

The underlying session/offline contract remains [ARCHITECTURE §4](ARCHITECTURE.md#4-persistence-and-offline-contract) and [GAME-CONTRACT](GAME-CONTRACT.md).

## 14. Testing

- Backend ranking/partition/value rules are covered by generic game/leaderboard tests.
- Every enabled board's query must seek its index, never scan `games` (EXPLAIN gate, [§7a](#7a-indexes-2965)).
- Frontend result-card, leaderboard, Stats, Scorecard, and Profile behavior is covered by screen/unit tests.
- Device verification is defined in [MANUAL-QA-LEADERBOARDS.md](MANUAL-QA-LEADERBOARDS.md).

That manual QA file is a **verification procedure**, not a second specification.

## 15. Ownership and change rules

When changing ranking/reporting:

1. Change the game's backend `BoardDefinition` or shared reporting contract.
2. Regenerate frontend vocab when board definitions change.
   A board with a new metric kind needs an index its filters can use ([§7a](#7a-indexes-2965)).
3. Update the affected per-game scoring doc.
4. Update this document only when the shared ranking/Stats behavior changes.
5. Keep [GAME-CONTRACT.md](GAME-CONTRACT.md) normative for integration details.
6. Keep historical design rationale in [research/LEADERBOARDS-SCORING-PLAN.md](research/LEADERBOARDS-SCORING-PLAN.md), clearly labeled as historical.
