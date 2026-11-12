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

Swipe in the desired direction, anywhere below the header: the whole play area takes swipes, not only the board (#3688). A swipe is a move as soon as the finger has travelled 24 px, once per gesture, not when it lifts (#3689).

### Web

Use:

- arrow keys; or
- WASD.

A move is locked for 120 ms during tile animation. Up to two inputs can be queued during that time and play one after another; queued input is dropped when the winning result interrupts play or when the app/screen goes away (#3689).

There is no undo feature.

## Board and UI (#3688)

Part of the 2048 look-and-feel epic (#3683); motion and sound are the next stories (#3689, #3690).

### Layout

Top to bottom, below the header: one slim stats row (Score, Best, Highest Tile, Time), the board centred in the free height, and an action bar (Hint, New Game). The play area (`twenty48-play-area`) is the swipe target, so a swipe starting on the stats row, beside the board or on the action bar counts; taps on the bar's buttons still work (the Pan gesture only activates after 30 px). The board is the screen's width less 32 px, up to 360 px; the screen measures the free height (`twenty48-board-area`) and caps the board to it less 8 px above and below, so a short screen (320 × 568) shrinks the board instead of clipping it. The ambient glow blobs and the always-on instruction lines (`swipe.hint`, `controls.keyboardHint`) are gone, with their i18n keys.

### Tiles

Flat, high-contrast tiles replace the neon glow look. Colours are in `frontend/src/theme/theme.twenty48.ts` (`TWENTY48_TILES`), one per value from 2 to 131072, the same in light and dark mode; only the empty slot differs by theme (`TWENTY48_SLOT`). Each number is dark (`#14141a`) or white, whichever clears WCAG AA (4.5:1) on its tile.

| Value  | Fill      | Text  | Contrast |
| ------ | --------- | ----- | -------- |
| 2      | `#f4ede0` | dark  | 15.8     |
| 4      | `#e9d5a6` | dark  | 12.7     |
| 8      | `#f4a259` | dark  | 8.9      |
| 16     | `#ee7b30` | dark  | 6.6      |
| 32     | `#e5533d` | dark  | 4.9      |
| 64     | `#c2255c` | white | 5.7      |
| 128    | `#f5e463` | dark  | 14.1     |
| 256    | `#b5d334` | dark  | 10.8     |
| 512    | `#35b05a` | dark  | 6.6      |
| 1024   | `#12908e` | dark  | 4.7      |
| 2048   | `#ffa800` | dark  | 9.5      |
| 4096   | `#2cb8e8` | dark  | 8.0      |
| 8192   | `#2f6bdb` | white | 4.9      |
| 16384  | `#5b47c9` | white | 6.6      |
| 32768  | `#a040c8` | white | 5.2      |
| 65536  | `#e0509a` | dark  | 5.1      |
| 131072 | `#7b1730` | white | 10.5     |

Every pair of tiles is at least 18 (CIE76 ΔE) apart, and every tile at least 15 from the empty slot in both themes (the old 2 tile was the slot's colour). Only 2048 and above get a gold ring and glow; the rest are flat. The number's font size is computed from the tile size and the digit count (`getTileFontSize`: as large as fits the tile's width less 10% each side, up to 45% of its height, never under 10), not a fixed size. `tileStyles.test.ts` guards all of this.

### Hint

Like Mahjong, FreeCell and Solitaire, 2048 has no always-on instructions: a **Hint** button sits in the action bar under the board (the shared `GameActionBar`, which Mahjong's bar now renders too).

- **Suggestion.** `suggestMove(board)` in the engine: the legal move that merges the most tiles, then the one that scores the most, then the first in left, up, right, down (which keeps the big tiles in the top-left corner). It is pure: it spawns nothing and draws nothing from the RNG. It is null on a stuck board.
- **Display.** An arrow and a label ("Swipe left", plus "or ←" on web) over the board, on the edge the swipe points to, for 2 s. It takes no touches. Any swipe or arrow key clears it (and still moves); a second press restarts the 2 s; New Game clears it.
- **No hint.** On a board with no move, a "No hint available" message for 2 s (`useTransientToast(2000)`, as in Mahjong). In practice a stuck board is also game over, so the result card covers it; the case is kept so the button never does nothing silently.
- **Disabled** while the win card is up.
- **Accessibility.** The button's label is "Show a hint: suggests a swipe for 2 seconds"; the suggestion is announced ("Hint: Swipe left") and the label is a polite live region. Under Reduce Motion (`useReduceMotion`) the arrow appears at once with no fade; it always disappears at once.
- **Not recorded.** A hint changes nothing in the game (no move, no score cost) and the replay's move format ([Replay recording](#replay-recording)) has no slot for it: a `moves` chunk holds only `[direction, cell, value, gained, total]` tuples, and a new action type would need a server model and a seed migration for data nobody uses (cost, then performance, then data). FreeCell records `hintAction` because its hints cost points; 2048's are free.

## Motion (#3689)

Every timing is in `frontend/src/game/twenty48/motion.ts`; `__tests__/motion.test.ts` holds the ceilings. Times are from the moment the swipe's board renders.

| What                  | When / how long              | Notes                                                                                                                   |
| --------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Slide                 | 0 to 100 ms                  | ease-out; every tile, and both tiles of a merge                                                                         |
| Merge: the tiles meet | 100 ms (`SLIDE_MS`)          | the two source tiles (ghosts) slide into the destination and vanish; the merged tile appears and pops                   |
| Merge pop             | 100 to 240 ms                | 1 to 1.15 and back, 70 + 70 ms; peak at 170 ms                                                                          |
| Spawn                 | starts 60 ms, at rest 220 ms | appears at once from 0.4 scale, up to 1.1 (90 ms), back (70 ms)                                                         |
| Move lock             | 120 ms                       | up to 2 swipes queue behind it                                                                                          |
| Score float           | 600 ms                       | "+N" rises 24 px and fades (RN `Animated`)                                                                              |
| Win beat              | card at 1000 ms              | the 2048 tile pops to 1.35 (peak at 280 ms, back by 540 ms) with a gold glow (100 to 800 ms)                            |
| Game-over beat        | card at 600 ms               | the board dims (220 to 470 ms, to 45%) and shakes 5 px (220 to 520 ms); it stays dimmed under the card until a New Game |

For the sounds (#3690): the merge "meet" is at 100 ms, the spawn appears from 60 ms, the win card at 1000 ms and the game-over card at 600 ms after the winning or last move. The win and game-over sounds start with the move today; they should end on the card.

How it works:

- **Sliding merges.** The engine puts an optional `mergedFrom: [{ id, row, col }, { id, row, col }]` on a merged `TileData` (the old tiles' ids and the cells they started the move in, in the order the move reads the line). `Grid` renders a `MergeGhost` for each source; `AnimatedTile` keeps the merged tile unseen until they meet. Absent, a tile just pops where it is, as before. It changes no board, score or tile id, so the replay's move tuple is unchanged. `mergedFrom` is never stored (`storage.ts` drops it on save, and on load for safety), so the stored format and size are unchanged and a reopened game opens at rest; a save without it loads as always.
- **Beats.** The result card waits for a beat. `useTwenty48Beat` is started in the same handler as the `setState` that ends the game, so the board and the hold render together (no flash). A game restored already finished shows its card at once. New Game ends a beat. A 2048 move that also ends the game uses the win beat.
- **Reduce Motion** (`useReduceMotion`, read live, [ACCESSIBILITY.md section 3](../ACCESSIBILITY.md)): tiles jump to their cells at full size, with no ghosts, glow, dim, shake or score float, and both cards show as soon as the move lands. Turning it on mid-move snaps the tiles; turning it on mid-beat cancels its timer and shows the card.
- **Input.** `Pan.onUpdate` fires the move once when an axis passes 24 px (`createSwipeTracker`); the gesture is built once. The queue (`createMoveQueue`, depth 2) is drained from the committed state when the lock ends, not inside a `setState` updater. A queued move the engine refuses lets the next queued one play.

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

**A `moves` event** is `{ v: 1, unit, t_ms, m: [move, ...] }` (the recorder's envelope plus `m`): up to **25** moves, one recorder unit per chunk (`MOVES_PER_CHUNK`), built in memory by `createMoveLog` and saved by the recorder at an idle moment, never inside the swipe's handler. Per move the screen scans 16 tiles and allocates one 5-number array; no `JSON.stringify`, no storage. A partial chunk is handed to the recorder when the game ends, a new game starts, the player leaves and on unmount, always before the session's `game_ended`. Leaving is another screen covering the game (navigation `blur`) or the app going to the `background`, not `inactive` (an incoming call or the iOS app switcher would spend a row each time): `useFlushOnBackground` hands the chunk over and calls the recorder's `flush()`, so it is saved in the same tick, not at an idle moment that may never come. Moves after the win (Keep Playing) belong to no session and are not recorded. Recording runs inside `guardRecording` (`twenty48/replay.ts`): a failure there is reported once (`sentryThrottle`, fixed text, the error's type only) and never reaches play.

**Why a new type, not a chunked `move`.** Builds from before #3286 send one flat `move` event per swipe, with no envelope. Reusing the name would put two shapes behind one validator, whose registry contract test (a validated type rejects `{}`; a stored-as-sent type comes back unchanged) cannot describe. A new `moves` type keeps `move` stored as sent for the old builds (the server never rejects it) and gives `moves` its own versioned model. It costs a seed migration (`0037_twenty48_moves_event`), which must be deployed before the app that sends the type, or the server answers `400 unknown_event_type`.

**Validation** (`backend/twenty48/models.py`, `validate_moves`): a `Twenty48Moves` pydantic model, `extra="forbid"`, `v == 1`, 1..32 moves each a tuple of five strict ints in range (direction 0..3, cell 0..15, value 2 or 4, scores 0..2^31-1), and 1,024 B of compact JSON (`MAX_MOVES_BYTES`, the same figure as the app's `TWENTY48_MOVES_MAX_BYTES`; a test holds the two equal). A bad event is dropped, not the batch (the request still succeeds), with one Sentry report by reason and error types, never values.

### Size against the budget (about 40 KB per game, 45 KB for 2048 by owner decision #3373; server cap #3318: 2,000 events / 690,000 B)

Row cost on the server is the JSON as Postgres stores it (`jsonb::text`, which adds a space after each `,` and `:`) plus `ROW_OVERHEAD_BYTES` (200).

- **Per-game limits, saved with the game.** The recorder's 64 KB session cap (`DEFAULT_RECORDING_CONFIG`) restarts with every process, so it bounds a process, not a game. The game bounds itself with two counts in its saved state, `recordedMoves` and `recordedRows` (rows used, partial chunks from flushes and the chunk in progress included), stamped on the state of every recorded move (`withRecorded`): at `MAX_RECORDED_MOVES` (1,250, 50 full chunks) or `MAX_RECORDED_ROWS` (60: 10 for partial chunks) the log stops collecting, and a game resumed at a limit (or with a corrupt count) records nothing more.
- **Worst game the limits allow: 46,061 B stored** (`replay.test.ts` measures it and holds it under `WORST_GAME_STORED_MAX_BYTES`, 45 KB = 46,080 B). That is over the epic's 40 KB (40,960 B) plan by owner decision #3373: every win is recorded in full. It is all 1,250 moves spread over all 60 rows, each move the widest a recorded game can hold. In 1,250 moves the board sums at most 4 + 4 × 1,250, so no tile passes 4,096, the score stays under 5,004 × 11 (5 digits) and one move gains under 5,004 (4 digits): `[3, 15, 4, 9999, 99999]`, 19 B compact, 23 B as `jsonb` text; a 10-digit `t_ms`. A full worst chunk is 672 B as `jsonb` text, 872 B a row. Plus the game's two lifecycle rows.
- **Real games** (seeded corner-player games to the game over, through the screen's log and the recorder): 136 to 288 moves, 4.0 to 8.6 KB stored, about 30 B a move with the row overhead. A game that runs to the move limit at that rate is about 37 KB; late moves with 5-digit scores add a byte or two each.
- **Why 1,250 (owner decision #3373).** A game to the 2048 tile takes about 950 to 1,200 swipes (each spawns 2.2 on average, and the board then sums 2,048 and more), and the win ends the recorded session, so every win is recorded in full. A limit of 1,100 moves / 54 rows would have held the worst game under 40 KB (40,829 B) but cut the last moves of the longer wins. A longer game that never reaches 2048 is recorded up to the limit (a clean prefix; `game_ended` still has the result).
- Against the server cap: 60 rows and at most 46 KB, against `TWENTY48_CAP`'s 2,000 events and 690,000 B. Before #3286 a game was up to 2,000 × 335 B = 670,000 B. `TWENTY48_CAP` stays as it is while builds from before #3286 are in the field.
- The event cap: a worst-case chunk of 25 (`[3,15,4,131072,3932156]` each, the validator's widest) with the envelope (a 10-digit `t_ms`) is 641 B compact, under the 1,024 B `TWENTY48_MOVES_MAX_BYTES`.

Why 25: a chunk is also the most a kill can lose (24 moves); 25 keeps a row near 750 B, so the 200 B overhead is about a quarter of the row (8 B per move; at 5 per chunk it would be 40 B per move), and a game of 200 moves still saves every 25 swipes. A larger chunk saves overhead but loses more on a kill and makes each row larger; 50 would halve the rows (about −6 KB on a 1,250-move game) and raise the loss to 49 moves.

### Measured (`twenty48/__tests__/replay.bench.test.ts`)

2,000 seeded swipes (several games in one stream, so without the per-game limits) over the real GameEventClient → EventStore → AsyncStorage mock, an idle moment between swipes:

|                                                               | Before (one `move` per swipe) | After (`moves`, 25 per chunk) |
| ------------------------------------------------------------- | ----------------------------- | ----------------------------- |
| Queue saves (`EventStore.enqueueEvent` / `enqueueMany` calls) | 2,000                         | **80**                        |
| AsyncStorage writes                                           | 4,000                         | **160**                       |
| Bytes written to storage                                      | 23,931,815                    | **1,162,300**                 |
| Events                                                        | 2,000                         | 80                            |
| Recorded JSON (sum of `data`)                                 | 231,954 B                     | **32,898 B**                  |

### Resumed games

A game resumed after a kill continues its session (#2654), and its log continues from the counts saved with the game (`savedPosition`, `MoveLog.reset`): the next chunk is unit `recordedRows + 1` (`beginUnit(n)`), so unit numbers never restart or repeat, and the per-game limits hold across any number of kills. The chunk a kill cut short (at most 24 moves) is lost; the saved row count already included it, so it shows as a skipped unit number and as a `total` that does not follow from the replay (the same check the golden test uses), and a reader can stop trusting the game at that point. `t_ms` restarts from the resume. A saved game whose session is gone starts a new session from its current board (`initial_board`), with its log from 0. A save with no counts (a game saved before the counts existed) starts at 0; a corrupt count is taken as the limit, so that game records nothing more.

## Local "Best" vs server history

The screen retains a local best score only to support immediate result-card/UI presentation such as a "New best" badge.

Historical Stats and public ranking come from the shared server reporting model, not legacy local counters.

## Implementation

- Engine: `frontend/src/game/twenty48/engine.ts` (including `suggestMove`, the hint's swipe)
- Tiles and board: `frontend/src/components/twenty48/` (`tileStyles.ts`, `Grid.tsx`, `AnimatedTile.tsx`, `HintOverlay.tsx`); palette in `frontend/src/theme/theme.twenty48.ts`
- Screen: [`frontend/src/screens/Twenty48Screen.tsx`](../../frontend/src/screens/Twenty48Screen.tsx) (its header lists the screen's concerns; see [GAMEPLAY_STANDARDS §8](../GAMEPLAY_STANDARDS.md#8-screen-layer))
- Storage: `frontend/src/game/twenty48/storage.ts`
- Types: `frontend/src/game/twenty48/types.ts`
- Motion and input: `frontend/src/game/twenty48/motion.ts` (every timing), `input.ts` (swipe threshold, move queue); the beat hold is `components/twenty48/useTwenty48Beat.ts`
- Backend descriptor: `backend/twenty48/module.py`

## Sound

Registry: `frontend/src/game/twenty48/sounds.ts` (`TWENTY48_SOUNDS`), played through the shared `useSound` hook, which honours the player's sound setting. The effects are being replaced with original synthesized sounds shared across the puzzle, tile and dice games (#3578); the reasoning behind each is in the [puzzle sound design log](puzzle-sound-design.md). Volume is `useSound`'s default (1.0) unless noted.

Triggers are in `frontend/src/screens/Twenty48Screen.tsx`.

| Key                                              | File                                        | Plays when                                                                                          | Volume |
| ------------------------------------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------ |
| `twenty48.tileMerge`, `tileMerge2`, `tileMerge3` | `tile-merge-1/2/3.ogg` (synthesized, #3578) | a swipe with a merge; the clack lands as the sliding tiles meet (100 ms, #3690); `useSoundVariants` | 1.0    |
| `twenty48.tileSpawn`, `tileSpawn2`, `tileSpawn3` | `tile-spawn-1/2/3.ogg` (synthesized, #3578) | a new tile appears (every swipe); lands as it scales in (60 ms); `useSoundVariants`                 | 1.0    |
| `twenty48.win2048`                               | `win-2048.ogg` (synthesized, #3578)         | the 2048 tile is reached; the chord lands as the win card shows (1.0 s, #3690)                      | 1.0    |
| `twenty48.gameOver`                              | `game-over-2048.ogg` (synthesized, #3578)   | no moves are left; the chord lands as the result card shows (0.6 s, #3690)                          | 1.0    |

Reopening a saved game plays nothing: a save keeps its last move's tile flags, so the tiles a restored game opens with are skipped (#3578). A fresh deal still plays its spawn.
