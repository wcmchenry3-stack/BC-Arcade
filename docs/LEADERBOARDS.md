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
| Mahjong | Yes | final score | Higher | Max 1220 |
| Star Swarm | Yes | final score | Higher | difficulty-tier partitions |
| FreeCell | Yes | moves / final score | **Lower** | Fewest moves wins |
| Bottle Sort | Yes | level reached | Higher | Max level 23 |
| Daily Word | **No** | guesses used for Stats | **Lower** | Wins only; public board disabled |

When a board's product design changes, update the backend module first and regenerate the frontend vocabulary; do not hand-edit this table independently of code.

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
- Frontend result-card, leaderboard, Stats, Scorecard, and Profile behavior is covered by screen/unit tests.
- Device verification is defined in [MANUAL-QA-LEADERBOARDS.md](MANUAL-QA-LEADERBOARDS.md).

That manual QA file is a **verification procedure**, not a second specification.

## 15. Ownership and change rules

When changing ranking/reporting:

1. Change the game's backend `BoardDefinition` or shared reporting contract.
2. Regenerate frontend vocab when board definitions change.
3. Update the affected per-game scoring doc.
4. Update this document only when the shared ranking/Stats behavior changes.
5. Keep [GAME-CONTRACT.md](GAME-CONTRACT.md) normative for integration details.
6. Keep historical design rationale in [research/LEADERBOARDS-SCORING-PLAN.md](research/LEADERBOARDS-SCORING-PLAN.md), clearly labeled as historical.
