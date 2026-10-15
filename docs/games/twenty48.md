# 2048

**Category:** Puzzle  
**Tier:** Free in the v1.0 store build

BC Arcade's 2048 is the standard 4×4 sliding-number puzzle with local save/resume, a score leaderboard, and a run that is considered won when the player first reaches 2048.

Shared session/offline/reporting behavior is defined by [GAME-CONTRACT.md](../GAME-CONTRACT.md). This page owns 2048-specific gameplay, scoring, and run-lifecycle rules.

## How to Play

Swipe the whole 4×4 board up, down, left, or right.

On an effective move:

1. every tile slides as far as it can in that direction;
2. adjacent equal values merge;
3. each tile can participate in at most one merge during that move;
4. one new tile spawns in a random empty cell.

A move that would not change the board is ignored and does not spawn a tile.

## Starting board and tile spawning

A new game begins with **two** randomly placed tiles.

Every spawned tile is:

- **2** with 90% probability;
- **4** with 10% probability.

The game uses a random empty cell for the spawn.

## Merging and score

Two equal tiles merge into their doubled value.

The score increases by the value of each newly created merged tile.

Examples:

- 2 + 2 → 4 and adds 4 points;
- 8 + 8 → 16 and adds 16 points;
- 1024 + 1024 → 2048 and adds 2048 points.

A newly merged tile cannot merge again during the same move.

## Win, Keep Playing, and game over

### Reaching 2048

The first move that creates a **2048** tile is the run's win.

At that moment:

- the game session is completed as `win`;
- the score at that exact moment is the ranked `final_score`;
- the result card appears.

If legal moves remain, the player can choose **Keep Playing**.

### Keep Playing

Keep Playing hides the win card and lets the player continue the local board beyond 2048.

That continuation is deliberately **untracked for the completed session**:

- later points do not replace the ranked score from the 2048 win;
- a later game-over after Keep Playing does not create a second session result/rank submission.

This keeps one game session tied to the first 2048 achievement rather than stretching the same session indefinitely.

### Loss

If no empty cells remain and no horizontally or vertically adjacent equal tiles exist **before 2048 has been reached**, the game ends as `loss`.

The final board score is ranked for that finished run.

## Controls

### Native

Swipe the board in the desired direction.

### Web

Use:

- arrow keys; or
- WASD.

A move is locked briefly during tile animation. One input can be queued during that animation; queued input is dropped when the winning result interrupts play or when the app/screen goes away.

There is no undo feature.

## Scoring and leaderboard

The public board ranks by `final_score`, higher is better.

- One global board; no difficulty/ruleset partitions.
- No natural maximum is declared.
- Equal scores use the shared final tie rule: the completion the server received first (`received_at`) ranks first.

The result block also records:

- `final_score`;
- highest tile;
- move count;
- active-play duration;
- outcome.

Daily Challenge can read score/highest-tile measures from this result data.

## Timer

The active-play clock starts on the first effective move.

It pauses when:

- the app backgrounds; or
- another screen covers the game.

The saved clock banks elapsed active time before a pause/relaunch, so time spent with the app closed does not count.

## Save / resume

The board is saved locally after moves and when play is paused.

A saved in-progress board restores after relaunch, including its accumulated active-play clock.

The local save is cleared when the game is over so the next launch starts fresh.

A board that already reached 2048 can also be restored for Keep Playing, but its original session was already completed at the win.

## Session outcomes

- **win** — first reaches 2048; ranked score freezes at that moment.
- **loss** — game over without having reached 2048; final score ranks.
- **abandoned** — the player starts a new game or leaves while a pre-2048 run is in progress; progress can remain in the result envelope for product features such as Daily Challenge, but the row has no ranked `final_score`.

Older builds used legacy `completed` / `kept_playing` outcomes. Backend compatibility logic preserves those historical rows; new builds use the current win/loss contract.

For generic syncing, ranking, display-name, Stats, and result-card behavior, see [GAME-CONTRACT.md](../GAME-CONTRACT.md).

## Replay recording

_(#3286, epic #3273; the shared recorder is [GAME-CONTRACT §2.10](../GAME-CONTRACT.md#210-recording-gameplay).)_

The opening board is in `game_started` (`initial_board`, 16 numbers). Everything after it is recorded as **`moves` events**: opening board + the `moves` rows in `event_index` order rebuild the final board and score.

**One move** is the 5-tuple `[direction, cell, value, gained, total]`:

| Field       | Meaning                                                                   |
| ----------- | ------------------------------------------------------------------------- |
| `direction` | 0 up, 1 down, 2 left, 3 right (`DIRECTION_ORDER` in `twenty48/replay.ts`) |
| `cell`      | the spawned tile's cell, `row * 4 + col` (0..15)                          |
| `value`     | the spawned tile's value, 2 or 4                                          |
| `gained`    | the points the move scored (the old `score_delta`)                        |
| `total`     | the running score after the move (the old `score_after`)                  |

To replay a move: slide and merge the board in `direction` (the rules above are deterministic), then put `value` at `cell`. The spawn is the only random part, which is why it is what is recorded. `highest_tile_after`, `is_game_over` and `has_won` are not recorded: a replay shows them, and `game_ended` carries the result.

**A `moves` event** is `{ v: 1, unit, t_ms, m: [move, ...] }` (the recorder's envelope plus `m`): up to **25** moves, one recorder unit per chunk (`MOVES_PER_CHUNK`), built in memory by `createMoveLog` and saved by the recorder at an idle moment, never inside the swipe's handler. Per move the screen scans 16 tiles and allocates one 5-number array; no `JSON.stringify`, no storage. A partial chunk is handed to the recorder when the game ends, a new game starts, the player leaves (another screen covers the game, or the app goes to the background) and on unmount, always before the session's `game_ended`. Moves after the win (Keep Playing) belong to no session and are not recorded.

**Why a new type, not a chunked `move`.** Builds from before #3286 send one flat `move` event per swipe, with no envelope. Reusing the name would put two shapes behind one validator, whose registry contract test (a validated type rejects `{}`; a stored-as-sent type comes back unchanged) cannot describe. A new `moves` type keeps `move` stored as sent for the old builds (the server never rejects it) and gives `moves` its own versioned model. It costs a seed migration (`0037_twenty48_moves_event`), which must be deployed before the app that sends the type, or the server answers `400 unknown_event_type`.

**Validation** (`backend/twenty48/models.py`, `validate_moves`): a `Twenty48Moves` pydantic model, `extra="forbid"`, `v == 1`, 1..32 moves each a tuple of five strict ints in range (direction 0..3, cell 0..15, value 2 or 4, scores 0..2^31-1), and 1,024 B of compact JSON (`MAX_MOVES_BYTES`, the same figure as the app's `TWENTY48_MOVES_MAX_BYTES`; a test holds the two equal). A bad event is dropped, not the batch (the request still succeeds), with one Sentry report by reason and error types, never values.

### Size against the cap (#3318: 2,000 moves / 690,000 B per game)

Row cost on the server is the JSON as Postgres stores it (`jsonb::text`, which adds a space after each `,` and `:`) plus `ROW_OVERHEAD_BYTES` (200).

- Worst-case move `[3, 15, 4, 131072, 3932156]`: 23 B compact on the wire, 27 B as `jsonb` text.
- Worst-case chunk of 25 with the envelope (`{"v":1,"unit":80,"t_ms":3600000,"m":[...]}`): 638 B compact (under the 1,024 B event cap), 769 B as `jsonb` text, **969 B per row** with overhead.
- A 2,000-move game is 80 chunks: 80 × 969 B = **77,520 B**, which is 11% of the 690,000 B cap, and 80 of its 2,000 events (4%). Typical moves are shorter (`[2, 11, 2, 8, 1234]`): 80 × 769 B = 61,520 B.
- The cap holds a chunked game of about 17,800 moves, so the device's own 64 KB session cap (`DEFAULT_RECORDING_CONFIG`, about 4,000 moves at the measured 16 B a move) is what bounds a very long game, silently, as a clean prefix.
- Before: 2,000 × 335 B = 670,000 B at the cap's limit. `TWENTY48_CAP` stays as it is while builds from before #3286 are in the field.

Why 25: a chunk is also the most a kill can lose (24 moves); 25 keeps a row near 770 B, so the 200 B overhead is 26% of the row (8 B per move; at 5 per chunk it would be 40 B per move), and a game of 200 moves still saves every 25 swipes. A larger chunk saves overhead but loses more on a kill and makes each row larger; 50 would cut a 2,000-move game from 80 to 40 rows (−8 KB stored) and raise the loss to 49 moves.

### Measured (`twenty48/__tests__/replay.bench.test.ts`)

A seeded 2,000-swipe game over the real GameEventClient → EventStore → AsyncStorage mock, an idle moment between swipes:

|                                                               | Before (one `move` per swipe) | After (`moves`, 25 per chunk) |
| ------------------------------------------------------------- | ----------------------------- | ----------------------------- |
| Queue saves (`EventStore.enqueueEvent` / `enqueueMany` calls) | 2,000                         | **80**                        |
| AsyncStorage writes                                           | 4,000                         | **160**                       |
| Bytes written to storage                                      | 23,899,815                    | **1,160,877**                 |
| Events                                                        | 2,000                         | 80                            |
| Recorded JSON (sum of `data`)                                 | 231,954 B                     | **32,892 B**                  |

### Resumed games

A game resumed after a kill loses the chunk in progress (at most 24 moves) and the recorder cannot know which units were saved, so a resumed game's units and `t_ms` start again (GAME-CONTRACT §2.10). The hole shows as a `total` that does not follow from the replay (the same check the golden test uses), so a reader can stop trusting the game at that point.

## Local "Best" vs server history

The screen retains a local best score only to support immediate result-card/UI presentation such as a "New best" badge.

Historical Stats and public ranking come from the shared server reporting model, not legacy local counters.

## Implementation

- Engine: `frontend/src/game/twenty48/engine.ts`
- Screen: [`frontend/src/screens/Twenty48Screen.tsx`](../../frontend/src/screens/Twenty48Screen.tsx) (its header lists the screen's concerns; see [GAMEPLAY_STANDARDS §8](../GAMEPLAY_STANDARDS.md#8-screen-layer))
- Storage: `frontend/src/game/twenty48/storage.ts`
- Types: `frontend/src/game/twenty48/types.ts`
- Backend descriptor: `backend/twenty48/module.py`
